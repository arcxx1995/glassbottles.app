-- Migration: 006_match_retry_cron
-- SQL-based bottle matching retry function + hourly pg_cron job.
--
-- Why needed:
--   The match-bottle edge function runs fire-and-forget on bottle send.
--   If it fails (no eligible receiver at send time, transient error, cold start),
--   the bottle sits unmatched until midnight when it is marked stale.
--   Nagoya spec: "No eligible receiver today → bottle is queued, matched next
--   available day." This cron closes that gap by retrying every hour in SQL,
--   without a round-trip to the edge runtime.
--
CREATE OR REPLACE FUNCTION public.retry_unmatched_bottles()
RETURNS INTEGER  -- returns count of bottles newly matched
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bottle         RECORD;
  v_receiver_id    UUID;
  v_matched_count  INTEGER := 0;
BEGIN
  -- Iterate unmatched, non-stale bottles (index: idx_bottles_unmatched)
  FOR v_bottle IN
    SELECT id, sender_id, day_key
    FROM   bottles
    WHERE  received_at IS NULL
      AND  is_stale    = FALSE
    ORDER BY sent_at ASC  -- oldest first
  LOOP

    -- Find one eligible receiver:
    --   • not the sender
    --   • has not already received a bottle on this bottle's day_key
    --   • RANDOM() tie-break to spread load across users
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

    -- No eligible receiver right now — leave bottle queued, try again next hour
    CONTINUE WHEN v_receiver_id IS NULL;

    -- Assign receiver — guard: only update if still unmatched (idempotent)
    UPDATE bottles
    SET    receiver_id = v_receiver_id,
           received_at = NOW()
    WHERE  id          = v_bottle.id
      AND  received_at IS NULL;

    -- If another concurrent process beat us (0 rows updated), skip quota update
    CONTINUE WHEN NOT FOUND;

    -- Atomically claim the receiver's daily quota slot
    INSERT INTO daily_quotas (user_id, date, has_sent, has_received)
    VALUES (v_receiver_id, v_bottle.day_key, FALSE, TRUE)
    ON CONFLICT (user_id, date)
    DO UPDATE SET has_received = TRUE
    WHERE daily_quotas.has_received = FALSE;
    -- If the ON CONFLICT UPDATE WHERE fails (already TRUE), another process won —
    -- that's fine; the UPDATE above already guarded us.

    v_matched_count := v_matched_count + 1;
  END LOOP;

  RETURN v_matched_count;
END;
$$;

-- Schedule: run every hour at :30 past (offset from the midnight stale-cleanup job)
SELECT cron.schedule(
  'retry-unmatched-bottles',
  '30 * * * *',
  $$ SELECT public.retry_unmatched_bottles(); $$
);

COMMENT ON FUNCTION public.retry_unmatched_bottles() IS
  'Hourly retry: match any bottles that had no eligible receiver at send time. '
  'Called by pg_cron.';
