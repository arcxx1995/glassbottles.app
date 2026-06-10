-- Migration: 010_email_notified_at
-- Adds email_notified_at to bottles for idempotent Resend notification tracking.
--
-- WHY:
--   The match-bottle edge function and the retry_unmatched_bottles() cron both call
--   the notify-receiver edge function after assigning a receiver. Without a guard,
--   every retry attempt could re-send the email. email_notified_at IS NULL is the
--   idempotency check — the column is set to NOW() exactly once per bottle, by the
--   notify-receiver function (service role).
--
-- DESIGN:
--   - Nullable TIMESTAMPTZ. NULL = not yet notified. Non-null = email sent at that time.
--   - Only writable by service role (authenticated role cannot UPDATE this column —
--     migration 005 already restricts authenticated UPDATE to is_read, read_at, is_reported).
--   - No RLS adjustment needed: service role bypasses RLS; authenticated clients
--     cannot reach email_notified_at at all.

ALTER TABLE public.bottles
  ADD COLUMN email_notified_at TIMESTAMPTZ DEFAULT NULL;

COMMENT ON COLUMN public.bottles.email_notified_at IS
  'Set to NOW() by notify-receiver edge function after Resend email is delivered. '
  'NULL means not yet notified. Used as idempotency guard — email is sent at most once.';
