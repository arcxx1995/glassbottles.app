-- Migration: 007_pg_net_notify
-- Adds WhatsApp notification via pg_net for bottles matched by the SQL retry path.
-- Closes the v1 known limitation from migration 006: "SQL retry path does NOT trigger
-- WhatsApp notification."
--
-- How it works:
--   retry_unmatched_bottles() is recreated with a pg_net.http_post() call after
--   each successful match. pg_net is async fire-and-forget — the match is already
--   committed before the HTTP call, so WhatsApp failure cannot un-match a bottle.
--
-- REQUIRED SETUP (set out-of-band — do NOT commit secrets to this file):
--   ALTER DATABASE postgres SET app.supabase_url = 'https://<ref>.supabase.co';
--   ALTER DATABASE postgres SET app.service_role_key = '<service_role_key>';
--
--   Recommended: store via Supabase Vault and read with vault.decrypted_secrets.
--   DB GUC approach is acceptable for single-region deployments (key visible to
--   superuser via pg_settings — acceptable given Supabase's managed infra model).
--
-- Dependencies:
--   pg_net already enabled — migration 003.
--   send-whatsapp edge function validates receiver_id ownership — safe to call
--   from SQL context; function will 403 on mismatch.

CREATE OR REPLACE FUNCTION public.retry_unmatched_bottles()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bottle         RECORD;
  v_receiver_id    UUID;
  v_matched_count  INTEGER := 0;
  v_supabase_url   TEXT;
  v_service_key    TEXT;
BEGIN
  -- Read config once — NULL-safe (second arg TRUE = return NULL if unset, not ERROR)
  v_supabase_url := current_setting('app.supabase_url',     true);
  v_service_key  := current_setting('app.service_role_key', true);

  -- Iterate unmatched, non-stale bottles; oldest first (idx_bottles_unmatched)
  FOR v_bottle IN
    SELECT id, sender_id, day_key
    FROM   bottles
    WHERE  received_at IS NULL
      AND  is_stale    = FALSE
    ORDER BY sent_at ASC
  LOOP

    -- Find one eligible receiver:
    --   • not the sender
    --   • has not already received a bottle on this bottle's day_key
    --   • prefer whatsapp_verified (notification will fire immediately)
    --   • RANDOM() tie-break for fair distribution
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
    ORDER BY p.whatsapp_verified DESC, RANDOM()
    LIMIT 1;

    -- No eligible receiver right now — leave queued, retry next hour
    CONTINUE WHEN v_receiver_id IS NULL;

    -- Assign receiver — idempotent guard: only update if still unmatched
    UPDATE bottles
    SET    receiver_id = v_receiver_id,
           received_at = NOW()
    WHERE  id          = v_bottle.id
      AND  received_at IS NULL;

    -- Concurrent process beat us to it — skip, don't double-count or double-notify
    CONTINUE WHEN NOT FOUND;

    -- Atomically claim receiver daily quota slot
    INSERT INTO daily_quotas (user_id, date, has_sent, has_received)
    VALUES (v_receiver_id, v_bottle.day_key, FALSE, TRUE)
    ON CONFLICT (user_id, date)
    DO UPDATE SET has_received = TRUE
    WHERE daily_quotas.has_received = FALSE;
    -- If UPDATE WHERE fails (already TRUE), another process already claimed it.
    -- The bottles UPDATE above already guarded us — safe to continue.

    -- Fire WhatsApp notification via pg_net (best-effort — match already committed)
    -- Skip silently if DB settings not configured (e.g. local dev without secrets)
    IF v_supabase_url IS NOT NULL AND v_service_key IS NOT NULL THEN
      PERFORM net.http_post(
        url     := v_supabase_url || '/functions/v1/send-whatsapp',
        headers := jsonb_build_object(
                     'Authorization', 'Bearer ' || v_service_key,
                     'Content-Type',  'application/json'
                   ),
        body    := jsonb_build_object(
                     'bottle_id',   v_bottle.id,
                     'receiver_id', v_receiver_id
                   )::text
      );
    END IF;

    v_matched_count := v_matched_count + 1;
  END LOOP;

  RETURN v_matched_count;
END;
$$;

COMMENT ON FUNCTION public.retry_unmatched_bottles() IS
  'Hourly retry: match bottles with no eligible receiver at send time. '
  'Calls send-whatsapp edge function via pg_net after each successful match. '
  'Requires app.supabase_url and app.service_role_key DB GUC settings. '
  'Called by pg_cron job ''retry-unmatched-bottles'' (migration 006).';
