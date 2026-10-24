-- Runnable check for migration 047.
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/047_future_self.test.sql
-- Runs inside one transaction and rolls back.

BEGIN;

INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('00000000-0000-4000-8000-000000000470', 'future-keeper@example.invalid', now()),
  ('00000000-0000-4000-8000-000000000471', 'future-free@example.invalid', now());
UPDATE public.profiles SET timezone = 'UTC'
WHERE id IN ('00000000-0000-4000-8000-000000000470', '00000000-0000-4000-8000-000000000471');
INSERT INTO public.memberships (user_id, plan, status, access_until)
VALUES ('00000000-0000-4000-8000-000000000470', 'yearly', 'active', now() + interval '30 days');

SET LOCAL role authenticated;

DO $$
DECLARE
  b JSONB;
  f JSONB;
BEGIN
  PERFORM set_config('request.jwt.claims',
    '{"sub":"00000000-0000-4000-8000-000000000471","role":"authenticated"}', true);
  BEGIN
    PERFORM public.send_future_bottle('hello me', 1);
    RAISE EXCEPTION 'BUG: a free user wrote to the future';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  PERFORM set_config('request.jwt.claims',
    '{"sub":"00000000-0000-4000-8000-000000000470","role":"authenticated"}', true);
  BEGIN
    PERFORM public.send_future_bottle('hello me', 3);
    RAISE EXCEPTION 'BUG: 3 months accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  b := public.send_future_bottle('dear me, did it get easier?', 6, '{"glass":"amber"}', 'foggy');
  IF (b ->> 'deliver_on')::date <> ((now() AT TIME ZONE 'UTC')::date + interval '6 months')::date THEN
    RAISE EXCEPTION 'BUG: wrong delivery date %', b;
  END IF;
  BEGIN
    PERFORM public.send_future_bottle('again', 1);
    RAISE EXCEPTION 'BUG: two in a week';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  f := public.get_future_bottles();
  IF jsonb_array_length(f -> 'waiting') <> 1 OR f::text ~ 'did it get easier'
     OR f -> 'can_send_after' = 'null'::jsonb THEN
    RAISE EXCEPTION 'BUG: a waiting bottle leaked its words or state is wrong: %', f;
  END IF;
  BEGIN
    PERFORM count(*) FROM public.future_bottles;
    RAISE EXCEPTION 'BUG: future_bottles readable directly';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RAISE NOTICE 'ok: Keeper-only, 1/6/12 months, one a week, sealed while waiting';
END;
$$;

-- Due date reached → delivered even after the membership lapsed.
RESET role;
UPDATE public.memberships SET access_until = now() - interval '1 second';
UPDATE public.future_bottles SET deliver_on = (now() AT TIME ZONE 'UTC')::date;
DO $$
BEGIN
  IF public.deliver_future_bottles() <> 1 THEN
    RAISE EXCEPTION 'BUG: due bottle not delivered';
  END IF;
  IF public.deliver_future_bottles() <> 0 THEN
    RAISE EXCEPTION 'BUG: delivered twice';
  END IF;
END;
$$;
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000470","role":"authenticated"}', true);
DO $$
DECLARE
  f JSONB := public.get_future_bottles();
BEGIN
  IF f -> 'arrived' -> 0 ->> 'message' <> 'dear me, did it get easier?' THEN
    RAISE EXCEPTION 'BUG: arrived bottle missing: %', f;
  END IF;
  PERFORM public.mark_future_read((f -> 'arrived' -> 0 ->> 'id')::uuid);
  IF public.get_future_bottles() -> 'arrived' -> 0 ->> 'read_at' IS NULL THEN
    RAISE EXCEPTION 'BUG: read not recorded';
  END IF;
  RAISE NOTICE 'ok: arrives on its date after a lapse, once; readable and markable';
END;
$$;

ROLLBACK;
