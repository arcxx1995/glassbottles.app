-- Runnable check for migration 032. Fails (raises) if either bug returns.
-- Run against a DB with migrations applied, as a superuser/owner role:
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/032_timezone_guard.test.sql
-- Everything runs inside one transaction and rolls back — no data persists.

BEGIN;

-- Fixtures: two throwaway users (rolled back at the end). User A gets the
-- poisoned timezone; user B throws the bottle. The matcher's candidate scan
-- excludes the sender, so the poison must live on a NON-sender profile for
-- the scan to hit it.
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-4000-8000-000000000032', 'tz-guard-a@example.invalid'),
  ('00000000-0000-4000-8000-000000000042', 'tz-guard-b@example.invalid');
INSERT INTO public.profiles (id, timezone) VALUES
  ('00000000-0000-4000-8000-000000000032', 'UTC'),
  ('00000000-0000-4000-8000-000000000042', 'UTC');

-- 1. Invalid timezone must be REJECTED by the trigger.
DO $$
BEGIN
  BEGIN
    UPDATE public.profiles
    SET timezone = 'not/a-zone'
    WHERE id = '00000000-0000-4000-8000-000000000032';
    RAISE EXCEPTION 'BUG: invalid timezone was accepted (trigger missing?)';
  EXCEPTION
    WHEN check_violation THEN
      RAISE NOTICE 'ok: invalid timezone rejected';
  END;
END;
$$;

-- 2. Valid timezone must still be accepted.
UPDATE public.profiles
SET timezone = 'Pacific/Kiritimati'  -- UTC+14, the nastiest real zone
WHERE id = '00000000-0000-4000-8000-000000000032';

-- 3. Matcher isolation: a poisoned profile (trigger bypassed, simulating
--    pre-032 data or a future regression) must NOT make
--    retry_unmatched_bottles() raise — the run must survive and return.
ALTER TABLE public.profiles DISABLE TRIGGER validate_timezone;
UPDATE public.profiles
SET timezone = 'boom/invalid'
WHERE id = '00000000-0000-4000-8000-000000000032';
ALTER TABLE public.profiles ENABLE TRIGGER validate_timezone;

-- An unmatched bottle old enough to pass the 1-hour adrift rule, so the
-- matcher actually scans candidate profiles (and hits the poisoned one).
INSERT INTO public.bottles (id, sender_id, message, sent_at, day_key)
VALUES ('00000000-0000-4000-8000-000000000033',
        '00000000-0000-4000-8000-000000000042',
        'tz guard test bottle', now() - interval '2 hours', CURRENT_DATE);

DO $$
DECLARE
  n INTEGER;
BEGIN
  BEGIN
    n := public.retry_unmatched_bottles();
    RAISE NOTICE 'ok: retry_unmatched_bottles survived poison profile (matched %)', n;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'BUG: retry_unmatched_bottles raised through a poison profile: %', SQLERRM;
  END;
END;
$$;

ROLLBACK;
