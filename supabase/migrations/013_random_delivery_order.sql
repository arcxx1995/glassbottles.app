-- Migration: 013_random_delivery_order
--
-- Change: the retry matcher no longer delivers a user's bottles in the order
-- they were thrown (FIFO). Iteration order is now RANDOM, so when receivers are
-- scarce, any undelivered bottle — not necessarily the oldest — may be the one
-- that gets matched. A user with several bottles in the sea sees them depart in
-- arbitrary order.
--
-- This is a verbatim copy of migration 011's retry_unmatched_bottles() with a
-- single change: `ORDER BY sent_at ASC` → `ORDER BY RANDOM()` on the outer loop.
-- All email-notify (pg_net) and idempotency logic is preserved unchanged.

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

  -- Iterate unmatched, non-stale bottles in RANDOM order (was sent_at ASC).
  -- Random delivery: no FIFO guarantee across a user's own bottles.
  FOR v_bottle IN
    SELECT id, sender_id, day_key
    FROM   bottles
    WHERE  received_at IS NULL
      AND  is_stale    = FALSE
    ORDER BY RANDOM()
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
  'Hourly retry: match unmatched bottles in RANDOM order (no FIFO), then fire '
  'notify-receiver via pg_net for each newly matched bottle. '
  'Called by pg_cron job ''retry-unmatched-bottles'' (migration 006).';
