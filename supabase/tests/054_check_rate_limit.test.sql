-- Runnable check for migration 054.
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/054_check_rate_limit.test.sql
-- Runs inside one transaction and rolls back.

BEGIN;

INSERT INTO auth.users (id, email, email_confirmed_at, raw_user_meta_data) VALUES
  ('00000000-0000-4000-8000-000000000540', 'rate-a@example.invalid', now(), '{"age_confirmed": true}'),
  ('00000000-0000-4000-8000-000000000541', 'rate-b@example.invalid', now(), '{"age_confirmed": true}');

SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000540","role":"authenticated"}', true);

-- 60 checks in a window pass; the 61st is refused, and keeps being refused.
DO $$
BEGIN
  FOR i IN 1..60 LOOP
    PERFORM public.precheck_message('the tide came in slow today');
  END LOOP;
  FOR i IN 1..2 LOOP
    BEGIN
      PERFORM public.precheck_message('one more');
      RAISE EXCEPTION 'BUG: check % past the limit went through', 60 + i;
    EXCEPTION WHEN program_limit_exceeded THEN NULL;
    END;
  END LOOP;
  RAISE NOTICE 'ok: 60 checks per window, then rate_limited';
END;
$$;

-- Another user has their own budget.
SELECT set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000541","role":"authenticated"}', true);
DO $$
BEGIN
  PERFORM public.precheck_message('hello sea');
  RAISE NOTICE 'ok: limits are per user';
END;
$$;

-- A new window starts the count again.
RESET role;
UPDATE public.check_rate SET window_start = now() - interval '11 minutes'
WHERE user_id = '00000000-0000-4000-8000-000000000540';
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000540","role":"authenticated"}', true);
DO $$
BEGIN
  PERFORM public.precheck_message('back again');
  RAISE NOTICE 'ok: a new window resets the count';
END;
$$;

DO $$
BEGIN
  PERFORM 1 FROM public.check_rate;
  RAISE EXCEPTION 'BUG: clients can read check_rate';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'ok: check_rate is server-only';
END;
$$;

ROLLBACK;
