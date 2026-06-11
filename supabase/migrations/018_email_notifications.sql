-- Migration 018: email notification preference (debug report bug 5)
--
-- The notify-receiver email tells users they can "turn off email notifications
-- in your account settings" — but no such toggle or column existed, and
-- notify-receiver always sent. That is a broken unsubscribe promise (and a
-- CAN-SPAM / GDPR exposure). This adds the missing preference; the settings
-- page exposes a toggle and notify-receiver honours it before sending.
--
-- Default TRUE: existing behaviour (notifications on) is preserved for all
-- current users; the toggle is purely opt-OUT.

ALTER TABLE public.profiles
  ADD COLUMN email_notifications BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN public.profiles.email_notifications IS
  'When FALSE the receiver is not emailed on a new bottle. Honoured by the '
  'notify-receiver edge function. Owner-readable/updatable under existing '
  'profiles RLS (read own / update own); no column-level lockdown needed.';
