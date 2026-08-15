-- Migration 036: delivery-path hardening — four fixes from the 2026-08-15 audit
--
-- 1. bottles INSERT was never column-restricted (SECURITY).
--    Migration 005 revoked column-level UPDATE, 015 revoked column-level
--    SELECT — INSERT kept Supabase's default full-table grant to
--    `authenticated`, and the RLS INSERT policy only checks sender_id +
--    quota. Any signed-in client could POST straight to PostgREST with
--    receiver_id / received_at / day_key / is_stale / email_notified_at of
--    their choosing:
--      - plant a message directly into a chosen user's inbox, bypassing
--        match_bottle() and the random-stranger model entirely,
--      - spam unbounded rows: a client that never calls send_bottle() never
--        sets daily_quotas.has_sent, so the policy's NOT EXISTS never trips,
--        and UNIQUE (sender_id, day_key) is trivially dodged by varying the
--        client-supplied day_key.
--    Fix: revoke INSERT. send_bottle() (024) is SECURITY DEFINER and runs as
--    the owner, so the only sanctioned write path is unaffected.
--
-- 2. Inbox history is unbounded now (035) — index the query that reads it.
--
-- 3. Timezone flip re-granted the daily quota. day_key and daily_quotas.date
--    both derive from profiles.timezone, which the user controls. Sending
--    from Pacific/Kiritimati then switching to Pacific/Midway moves the local
--    date back a day: fresh day_key (no UNIQUE collision) and a quota row
--    with has_sent = FALSE. Same trick re-arms has_received for a second
--    bottle. Fix: one timezone change per 24h — enough for a traveller,
--    not enough to farm the boundary.
--
-- 4. The matcher treated every profile that ever signed up as an equally good
--    receiver, so most bottles landed in accounts that had not opened the app
--    in months: the receiver's daily quota burned, the message never read,
--    and engaged users starved. Fix: prefer receivers active in the last 30
--    days, falling back to everyone else in the same query (a bottle must
--    never stall for want of a *fresh* receiver).
--
-- 5. pg_cron does not skip a tick while the previous run is still going, and
--    retry_unmatched_bottles() takes a row lock per bottle. Once a run
--    exceeds the 15-minute cadence, runs pile up and contend. Fix: an
--    advisory lock (transaction-scoped, so it cannot leak) plus a driving
--    query that no longer locks bottles the 1-hour rule will reject anyway.

-- ── 1. Clients may no longer INSERT bottles directly ────────────────────────
REVOKE INSERT ON public.bottles FROM authenticated;
REVOKE INSERT ON public.bottles FROM anon;

-- The RLS INSERT policy stays as defence in depth (it is what protects the
-- table if a future grant is restored by accident).
COMMENT ON POLICY "bottles: sender inserts with quota check" ON public.bottles IS
  'Defence in depth only — INSERT is revoked from authenticated/anon (036). '
  'All throws go through send_bottle() (024), which runs SECURITY DEFINER.';

-- ── 2. Index the inbox read ─────────────────────────────────────────────────
-- get_received_bottles(): WHERE receiver_id = auth.uid() ORDER BY received_at
-- DESC, now with no retention window (035).
CREATE INDEX IF NOT EXISTS idx_bottles_receiver_received
  ON public.bottles (receiver_id, received_at DESC);

-- ── 3. Timezone change cooldown ─────────────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS timezone_changed_at TIMESTAMPTZ;

-- Replaces the 032 validator: same IANA check, plus the cooldown. The check
-- fires only on an actual change, so a client re-sending its current timezone
-- (the settings page saves both fields together) is never rejected.
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

  IF TG_OP = 'UPDATE' AND NEW.timezone IS DISTINCT FROM OLD.timezone THEN
    IF OLD.timezone_changed_at IS NOT NULL
       AND OLD.timezone_changed_at > now() - interval '24 hours' THEN
      RAISE EXCEPTION 'timezone was already changed in the last 24 hours'
        USING ERRCODE = '23514';
    END IF;
    NEW.timezone_changed_at := now();
  END IF;

  RETURN NEW;
END;
$$;

-- The trigger from 032 fires on `UPDATE OF timezone`, which would skip the
-- cooldown bookkeeping if a future write touched only timezone_changed_at.
-- Widen it to any UPDATE; the body is a no-op when the timezone is unchanged.
DROP TRIGGER IF EXISTS validate_timezone ON public.profiles;
CREATE TRIGGER validate_timezone
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_profile_timezone();

-- ── 4. match_bottle: prefer receivers who are actually still here ───────────
-- Verbatim migration 029 body except the candidate ORDER BY.
CREATE OR REPLACE FUNCTION public.match_bottle(p_bottle_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_bottle        RECORD;
  v_receiver_id   UUID;
  v_receiver_date DATE;
  v_claimed       UUID;
BEGIN
  -- Lock the bottle row for the duration of the transaction. Concurrent
  -- match attempts FOR THIS BOTTLE serialize here.
  SELECT id, sender_id, received_at, sent_at
  INTO   v_bottle
  FROM   public.bottles
  WHERE  id = p_bottle_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('matched', false, 'reason', 'not found');
  END IF;

  -- Idempotent: already matched. Never touches quota.
  IF v_bottle.received_at IS NOT NULL THEN
    RETURN jsonb_build_object('matched', true, 'reason', 'already matched');
  END IF;

  -- THE 1-HOUR ADRIFT RULE (migration 022): unchanged.
  IF v_bottle.sent_at > now() - interval '1 hour' THEN
    RETURN jsonb_build_object('matched', false, 'queued', true, 'reason', 'too early');
  END IF;

  -- Candidate → claim loop (029). Each iteration picks an eligible receiver,
  -- then tries to CLAIM their local-day quota row; losing the claim retries
  -- with a fresh candidate.
  --
  -- 036: liveness preference. A signed-up-once-never-returned account is a
  -- dead inbox — matching to it burns the bottle AND that account's daily
  -- quota while the message is never read. Sorting on the liveness boolean
  -- first drains the active pool before the dormant one, and random() still
  -- shuffles within each pool, so selection stays uniform among peers and no
  -- bottle stalls when everyone active has already received today.
  -- last_active is stamped on send (024) and on any profile PATCH; brand-new
  -- accounts fall back to created_at so a fresh signup counts as live.
  --
  -- ponytail: ORDER BY random() sorts the whole eligible set per bottle per
  -- tick — fine at current scale, O(bottles × profiles) at 10k+. Swap for a
  -- sampled offset against a precomputed pool when that shows up in pg_stat.
  LOOP
    SELECT p.id,
           (now() AT TIME ZONE COALESCE(p.timezone, 'UTC'))::date
    INTO   v_receiver_id, v_receiver_date
    FROM   public.profiles p
    WHERE  p.id <> v_bottle.sender_id
      AND  NOT EXISTS (
             SELECT 1
             FROM   public.daily_quotas dq
             WHERE  dq.user_id      = p.id
               AND  dq.date         = (now() AT TIME ZONE COALESCE(p.timezone, 'UTC'))::date
               AND  dq.has_received = TRUE
           )
    ORDER BY (COALESCE(p.last_active, p.created_at) > now() - interval '30 days') DESC,
             random()
    LIMIT 1;

    IF v_receiver_id IS NULL THEN
      RETURN jsonb_build_object(
        'matched', false, 'queued', true, 'reason', 'no eligible receiver'
      );
    END IF;

    -- THE SERIALIZATION POINT (029): take the receiver's local-day quota row
    -- only if has_received is still FALSE.
    v_claimed := NULL;
    INSERT INTO public.daily_quotas (user_id, date, has_sent, has_received)
    VALUES (v_receiver_id, v_receiver_date, FALSE, TRUE)
    ON CONFLICT (user_id, date)
    DO UPDATE SET has_received = TRUE
    WHERE daily_quotas.has_received = FALSE
    RETURNING user_id INTO v_claimed;

    IF v_claimed IS NOT NULL THEN
      EXIT; -- quota claimed — this receiver is ours alone
    END IF;
  END LOOP;

  UPDATE public.bottles
  SET    receiver_id = v_receiver_id,
         received_at = now()
  WHERE  id = p_bottle_id;

  RETURN jsonb_build_object(
    'matched', true,
    'receiver_id', v_receiver_id,
    'bottle_id', p_bottle_id
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.match_bottle(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.match_bottle(UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION public.match_bottle(UUID) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.match_bottle(UUID) TO service_role;

COMMENT ON FUNCTION public.match_bottle(UUID) IS
  'Claim-first, race-free matcher (029). Refuses bottles younger than 1 hour '
  '(022). Prefers receivers active in the last 30 days, falling back to '
  'dormant accounts so no bottle stalls (036). Service role only.';

-- ── 5. retry_unmatched_bottles: no overlapping runs, no pointless locks ─────
-- Verbatim migration 034 body except the advisory lock and the sent_at
-- prefilter on the driving query.
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
  -- One run at a time. pg_cron starts a tick regardless of whether the last
  -- one finished; a slow run used to pile up against its own row locks.
  -- Transaction-scoped, so it is released even if this function raises.
  IF NOT pg_try_advisory_xact_lock(hashtext('retry_unmatched_bottles')) THEN
    RAISE WARNING 'retry_unmatched_bottles: previous run still in progress — skipping tick';
    RETURN 0;
  END IF;

  SELECT c.supabase_url, c.service_role_key
  INTO   v_supabase_url, v_service_role_key
  FROM   public._notify_config() c;

  IF v_supabase_url IS NULL OR v_service_role_key IS NULL THEN
    -- Loud, every run: a silent skip here hid a dead email pipeline for
    -- 3+ weeks (matching still proceeds below).
    RAISE WARNING 'retry_unmatched_bottles: notify config missing — emails are '
                  'NOT being sent. Run set_notify_config().';
  END IF;

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
      -- 036: match_bottle() rejects these anyway (022), but only after taking
      -- a row lock. Every fresh bottle was locked and released 4×/hour.
      AND  sent_at <= now() - interval '1 hour'
    ORDER BY random()
  LOOP
    -- Sub-transaction per bottle (032): one raising match must not roll back
    -- the whole run.
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
  -- bottles matched in this run; 7-day window and the 8-attempt cap (033)
  -- bound the retry.
  IF v_notify_url IS NOT NULL AND v_service_role_key IS NOT NULL THEN
    FOR v_id IN
      SELECT b.id
      FROM   public.bottles b
      JOIN   public.profiles p ON p.id = b.receiver_id
      WHERE  b.received_at IS NOT NULL
        AND  b.email_notified_at IS NULL
        AND  b.email_retry_count < 8
        AND  p.email_notifications = TRUE
        AND  b.received_at < now() - interval '10 minutes'
        AND  b.received_at > now() - interval '7 days'
    LOOP
      UPDATE public.bottles
      SET    email_retry_count = email_retry_count + 1
      WHERE  id = v_id;

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
  'Every-15-min retry, single-flight via advisory lock (036): (1) iterate '
  'unmatched bottles older than 1 hour in random order and delegate each to '
  'match_bottle() inside a per-bottle exception sub-block (032), firing '
  'notify-receiver via pg_net for each fresh match; (2) re-fire '
  'notify-receiver for matched bottles still missing email_notified_at, '
  '10min–7d window, capped at 8 attempts (033). Config from GUC or Vault via '
  '_notify_config() (034). Called by pg_cron job ''retry-unmatched-bottles''.';
