-- Migration 033: bound the orphaned-email retry pass
--
-- The second pass of retry_unmatched_bottles() (029/031/032) re-fires
-- notify-receiver for matched bottles still missing email_notified_at. A
-- PERMANENT Resend 4xx (invalid/bouncing address) releases the claim every
-- time, so one bad address re-fired every 15 minutes for the full 7-day
-- window — ~670 wasted edge-function + Resend calls per address.
--
-- Fix: count re-fire attempts on the bottle and stop after
-- EMAIL_RETRY_CAP = 8 (covers a ~2h transient outage at the 15-min cadence;
-- the first-match attempt is separate and uncounted). Transient failures
-- recover long before the cap; permanent ones stop burning invocations.

ALTER TABLE public.bottles
  ADD COLUMN IF NOT EXISTS email_retry_count SMALLINT NOT NULL DEFAULT 0;

-- Verbatim migration 032 body + the retry cap (filter + increment) in the
-- second pass.
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
        AND  b.is_stale = FALSE
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
  'Every-15-min retry: (1) iterate unmatched non-stale bottles in random order '
  'and delegate each to match_bottle() (029 — claim-first, race-free) inside a '
  'per-bottle exception sub-block (032 — poison bottle cannot stall the batch), '
  'firing notify-receiver via pg_net for each fresh match; (2) re-fire '
  'notify-receiver for matched bottles still missing email_notified_at '
  '(released claim / lost call), 10min–7d window, capped at 8 attempts per '
  'bottle (033 — permanent 4xx addresses stop burning invocations). Called by '
  'pg_cron job ''retry-unmatched-bottles''.';
