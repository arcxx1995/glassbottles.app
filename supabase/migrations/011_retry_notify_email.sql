-- Migration: 011_retry_notify_email
-- Extends retry_unmatched_bottles() to call notify-receiver edge function via
-- pg_net after each successful match, ensuring emails are sent even when the
-- initial match-bottle invocation did not (or could not) call notify-receiver.
--
-- IDEMPOTENCY:
--   notify-receiver checks email_notified_at IS NULL before sending. If the
--   match-bottle edge function already notified successfully, this pg_net call
--   is a harmless no-op (notify-receiver returns {notified: true, reason: 'already notified'}).
--
-- SECURITY:
--   pg_net fires HTTP calls as the postgres role (superuser context). The
--   notify-receiver function requires the service role key in the Authorization
--   header. We read it from Vault via app.settings.service_role_key, which is
--   set by Supabase infrastructure. No key is embedded in SQL text.
--
-- DEPENDENCY:
--   pg_net extension — enabled in migration 003.
--   notify-receiver edge function — created in this release.
--   email_notified_at column — migration 010.

CREATE OR REPLACE FUNCTION public.retry_unmatched_bottles()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bottle           RECORD;
  v_receiver_id      UUID;
  v_matched_count    INTEGER := 0;
  v_supabase_url     TEXT;
  v_service_role_key TEXT;
  v_notify_url       TEXT;
BEGIN
  -- Read runtime config injected by Supabase infrastructure.
  -- If either setting is absent (local dev without config), notification is
  -- skipped gracefully — matching still proceeds.
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

  -- Iterate unmatched, non-stale bottles (index: idx_bottles_unmatched)
  FOR v_bottle IN
    SELECT id, sender_id, day_key
    FROM   bottles
    WHERE  received_at IS NULL
      AND  is_stale    = FALSE
    ORDER BY sent_at ASC
  LOOP

    SELECT p.id
    INTO   v_receiver_id
    FROM   profiles p
    WHERE  p.id != v_bottle.sender_id
      AND  NOT EXISTS (
             SELECT 1
             FROM   daily_quotas dq
             WHERE  dq.user_id = p.id
               AND  dq.date    = v_bottle.day_key
               AND  dq.has_received = TRUE
           )
    ORDER BY RANDOM()
    LIMIT 1;

    CONTINUE WHEN v_receiver_id IS NULL;

    UPDATE bottles
    SET    receiver_id = v_receiver_id,
           received_at = NOW()
    WHERE  id          = v_bottle.id
      AND  received_at IS NULL;

    CONTINUE WHEN NOT FOUND;

    INSERT INTO daily_quotas (user_id, date, has_sent, has_received)
    VALUES (v_receiver_id, v_bottle.day_key, FALSE, TRUE)
    ON CONFLICT (user_id, date)
    DO UPDATE SET has_received = TRUE
    WHERE daily_quotas.has_received = FALSE;

    -- Notify receiver by email via pg_net (fire-and-forget).
    -- Guard: only attempt if runtime URL/key are available.
    -- notify-receiver will skip if email_notified_at is already set (idempotent).
    IF v_notify_url IS NOT NULL AND v_service_role_key IS NOT NULL THEN
      PERFORM net.http_post(
        url     := v_notify_url,
        headers := jsonb_build_object(
                     'Content-Type',  'application/json',
                     'Authorization', 'Bearer ' || v_service_role_key
                   ),
        body    := jsonb_build_object('bottle_id', v_bottle.id)
      );
    END IF;

    v_matched_count := v_matched_count + 1;
  END LOOP;

  RETURN v_matched_count;
END;
$$;

COMMENT ON FUNCTION public.retry_unmatched_bottles() IS
  'Hourly retry: match bottles with no eligible receiver at send time, then '
  'fire notify-receiver via pg_net for each newly matched bottle. '
  'Called by pg_cron job ''retry-unmatched-bottles'' (migration 006). '
  'Email idempotency enforced by email_notified_at IS NULL check in notify-receiver.';

-- REVOKE grants remain in force from migration 009 — no re-grant needed.
