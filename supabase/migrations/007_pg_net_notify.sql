-- Migration: 007_retry_unmatched_bottles_v2
-- Recreates retry_unmatched_bottles() removing notification logic.
-- Preserves matching logic from migration 006.

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
BEGIN
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

    v_matched_count := v_matched_count + 1;
  END LOOP;

  RETURN v_matched_count;
END;
$$;

COMMENT ON FUNCTION public.retry_unmatched_bottles() IS
  'Hourly retry: match bottles with no eligible receiver at send time. '
  'Called by pg_cron job ''retry-unmatched-bottles'' (migration 006).';
