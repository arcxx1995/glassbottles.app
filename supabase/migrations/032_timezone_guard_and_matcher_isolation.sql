-- Migration 032: validate profiles.timezone at the DB + isolate matcher iterations
--
-- Two bugs, one failure chain:
--
-- 1. profiles.timezone was validated ONLY in /api/profile (IANA allowlist +
--    Intl check). But RLS "update own" + default column grants let any
--    authenticated user write profiles.timezone directly via PostgREST,
--    bypassing the API. A stored invalid zone makes every
--    `now() AT TIME ZONE timezone` expression raise:
--      - the victim's own sends + get_today_bottle_status throw (account
--        bricked), and worse
--      - match_bottle()'s candidate scan (029) evaluates the expression for
--        OTHER users' profiles, so one poisoned profile makes every
--        match_bottle() call raise as soon as the scan reaches it.
--    Fix: BEFORE trigger — the only reliable DB-level guard (a CHECK cannot
--    evaluate AT TIME ZONE against session state portably). Heals existing
--    bad rows to UTC first so the matcher recovers on the next tick.
--
-- 2. retry_unmatched_bottles() ran every match in one transaction with no
--    per-iteration exception handling — any raising match_bottle() call
--    (e.g. the poisoned-timezone scan above) rolled back the ENTIRE run,
--    every 15 minutes, forever: global matching stall from one bad row.
--    Fix: per-bottle BEGIN/EXCEPTION sub-block — a poison bottle logs a
--    warning and the rest of the batch still matches + notifies.

-- ── 1a. Heal any already-stored invalid timezone ─────────────────────────────
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT id, timezone FROM public.profiles WHERE timezone IS NOT NULL
  LOOP
    BEGIN
      PERFORM now() AT TIME ZONE r.timezone;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'profiles.%: invalid timezone % reset to UTC', r.id, r.timezone;
      UPDATE public.profiles SET timezone = 'UTC' WHERE id = r.id;
    END;
  END LOOP;
END;
$$;

-- ── 1b. Reject invalid timezones at write time ───────────────────────────────
CREATE OR REPLACE FUNCTION public.validate_profile_timezone()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.timezone IS NOT NULL THEN
    BEGIN
      PERFORM now() AT TIME ZONE NEW.timezone;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'invalid timezone: %', NEW.timezone
        USING ERRCODE = '23514'; -- check_violation, same class the API maps
    END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_timezone ON public.profiles;
CREATE TRIGGER validate_timezone
  BEFORE INSERT OR UPDATE OF timezone ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_profile_timezone();

-- ── 2. retry_unmatched_bottles: per-bottle fault isolation ──────────────────
-- Verbatim migration 031 body plus the BEGIN/EXCEPTION sub-block around each
-- match. pg_net enqueues transactionally, so a failed iteration's rollback
-- also discards its (never-sent) notification post — no half-fired emails.
CREATE OR REPLACE FUNCTION public.retry_unmatched_bottles()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id               UUID;
  v_result           JSONB;
  v_matched_count    INTEGER := 0;
  v_supabase_url     TEXT;
  v_service_role_key TEXT;
  v_notify_url       TEXT;
BEGIN
  BEGIN
    v_supabase_url     := current_setting('app.settings.supabase_url', true);
    v_service_role_key := current_setting('app.settings.service_role_key', true);
  EXCEPTION WHEN OTHERS THEN
    v_supabase_url     := NULL;
    v_service_role_key := NULL;
  END;

  v_notify_url := CASE
    WHEN v_supabase_url IS NOT NULL
    THEN v_supabase_url || '/functions/v1/notify-receiver'
    ELSE NULL
  END;

  FOR v_id IN
    SELECT id
    FROM   public.bottles
    WHERE  received_at IS NULL
      AND  is_stale    = FALSE
    ORDER BY random()
  LOOP
    -- Sub-transaction per bottle: one raising match must not roll back the
    -- whole run (the June poison-timezone chain stalled ALL matching).
    BEGIN
      v_result := public.match_bottle(v_id);

      -- Fire notification only on a fresh match (a receiver was assigned now).
      IF COALESCE((v_result ->> 'matched')::boolean, false)
         AND (v_result ? 'receiver_id') THEN
        v_matched_count := v_matched_count + 1;

        IF v_notify_url IS NOT NULL AND v_service_role_key IS NOT NULL THEN
          PERFORM net.http_post(
            url     := v_notify_url,
            headers := jsonb_build_object(
                         'Content-Type',  'application/json',
                         'Authorization', 'Bearer ' || v_service_role_key
                       ),
            body    := jsonb_build_object('bottle_id', v_id)
          );
        END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'retry_unmatched_bottles: match_bottle(%) failed: %', v_id, SQLERRM;
    END;
  END LOOP;

  -- Second pass: matched bottles whose notification email never landed —
  -- released claim (Resend 4xx) or lost pg_net call. notify-receiver's
  -- claim-before-send makes re-firing idempotent. 10-minute grace excludes
  -- bottles matched in this run; 7-day window bounds the retry.
  IF v_notify_url IS NOT NULL AND v_service_role_key IS NOT NULL THEN
    FOR v_id IN
      SELECT b.id
      FROM   public.bottles b
      JOIN   public.profiles p ON p.id = b.receiver_id
      WHERE  b.received_at IS NOT NULL
        AND  b.email_notified_at IS NULL
        AND  b.is_stale = FALSE
        AND  p.email_notifications = TRUE
        AND  b.received_at < now() - interval '10 minutes'
        AND  b.received_at > now() - interval '7 days'
    LOOP
      PERFORM net.http_post(
        url     := v_notify_url,
        headers := jsonb_build_object(
                     'Content-Type',  'application/json',
                     'Authorization', 'Bearer ' || v_service_role_key
                   ),
        body    := jsonb_build_object('bottle_id', v_id)
      );
    END LOOP;
  END IF;

  RETURN v_matched_count;
END;
$$;

COMMENT ON FUNCTION public.retry_unmatched_bottles() IS
  'Every-15-min retry: (1) iterate unmatched non-stale bottles in random order '
  'and delegate each to match_bottle() (029 — claim-first, race-free) inside a '
  'per-bottle exception sub-block (032 — poison bottle cannot stall the batch), '
  'firing notify-receiver via pg_net for each fresh match; (2) re-fire '
  'notify-receiver for matched bottles still missing email_notified_at '
  '(released claim / lost call), 10min–7d window. Called by pg_cron job '
  '''retry-unmatched-bottles''.';
