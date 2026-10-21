-- Runnable check for migration 046.
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/046_sparks.test.sql
-- Runs inside one transaction and rolls back.

BEGIN;

INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('00000000-0000-4000-8000-000000000460', 'spark-free@example.invalid', now()),
  ('00000000-0000-4000-8000-000000000461', 'spark-keeper@example.invalid', now());
INSERT INTO public.memberships (user_id, plan, status, access_until)
VALUES ('00000000-0000-4000-8000-000000000461', 'monthly', 'active', now() + interval '30 days');

SET LOCAL role authenticated;

DO $$
DECLARE
  left_ INT;
BEGIN
  PERFORM set_config('request.jwt.claims',
    '{"sub":"00000000-0000-4000-8000-000000000460","role":"authenticated"}', true);
  BEGIN
    PERFORM public.use_spark();
    RAISE EXCEPTION 'BUG: a free user spent an AI spark';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  PERFORM set_config('request.jwt.claims',
    '{"sub":"00000000-0000-4000-8000-000000000461","role":"authenticated"}', true);
  FOR i IN 1..5 LOOP
    left_ := public.use_spark();
  END LOOP;
  IF left_ <> 0 THEN
    RAISE EXCEPTION 'BUG: after 5 sparks, % left', left_;
  END IF;
  BEGIN
    PERFORM public.use_spark();
    RAISE EXCEPTION 'BUG: a sixth spark was allowed';
  EXCEPTION WHEN program_limit_exceeded THEN NULL;
  END;
  RAISE NOTICE 'ok: Keeper-only, five a day';
END;
$$;

-- The spark row must not look like a send or a receive to the quota logic.
RESET role;
DO $$
BEGIN
  IF (SELECT has_sent OR has_received FROM public.daily_quotas
      WHERE user_id = '00000000-0000-4000-8000-000000000461') THEN
    RAISE EXCEPTION 'BUG: sparks touched the daily throw';
  END IF;
  RAISE NOTICE 'ok: the daily throw is untouched';
END;
$$;

ROLLBACK;
