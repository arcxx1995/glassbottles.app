-- Migration 027: partial index for the notification-retry pass.
--
-- retry_unmatched_bottles() (migration 026) added a second pass selecting
-- matched bottles whose email never landed:
--   received_at IS NOT NULL AND email_notified_at IS NULL AND is_stale = FALSE
-- The existing partial indexes (idx_bottles_unmatched, idx_bottles_adrift)
-- cover the OPPOSITE predicate (received_at IS NULL), so that pass seq-scanned
-- all matched bottles every 15 minutes. This index keeps it O(orphans): in the
-- steady state the claim is stamped seconds after the match, so the indexed
-- set stays near-empty and cheap to maintain.
CREATE INDEX IF NOT EXISTS idx_bottles_email_retry
  ON public.bottles (received_at)
  WHERE received_at IS NOT NULL
    AND email_notified_at IS NULL
    AND is_stale = FALSE;
