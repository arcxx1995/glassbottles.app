-- Runnable check for migration 042.
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/042_bottle_dressing.test.sql
-- Runs inside one transaction and rolls back.

BEGIN;

-- 051: fixture users are confirmed adults and their bottles count as screened
-- (the screen itself is covered by 043 and 051). Rolled back with the rest.
ALTER TABLE public.profiles ALTER COLUMN age_confirmed_at SET DEFAULT now();
ALTER TABLE public.bottles  ALTER COLUMN screen SET DEFAULT 'ok';

INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('00000000-0000-4000-8000-000000000420', 'dress-free@example.invalid', now()),
  ('00000000-0000-4000-8000-000000000421', 'dress-keeper@example.invalid', now()),
  ('00000000-0000-4000-8000-000000000422', 'dress-receiver@example.invalid', now());
UPDATE public.profiles SET timezone = 'UTC';
UPDATE public.profiles SET current = 'night_owl' WHERE id = '00000000-0000-4000-8000-000000000421';
INSERT INTO public.memberships (user_id, plan, status, access_until)
VALUES ('00000000-0000-4000-8000-000000000421', 'yearly', 'active', now() + interval '30 days');

SET LOCAL role authenticated;

-- Free user: plain defaults, weather and vibe fine; any other piece is refused (057).
SELECT set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000420","role":"authenticated"}', true);
DO $$
DECLARE
  b JSONB;
BEGIN
  BEGIN
    PERFORM public.send_bottle('hi', '{"glass":"amber"}', NULL, NULL);
    RAISE EXCEPTION 'BUG: a free user threw a Keeper glass';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.send_bottle('hi', '{"glass":"gold"}', NULL, NULL);
    RAISE EXCEPTION 'BUG: a seal id passed as a glass';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    PERFORM public.send_bottle('hi', NULL, 'hurricane', NULL);
    RAISE EXCEPTION 'BUG: unknown weather accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    PERFORM public.send_bottle('hi', '{"glass":"seafoam"}', NULL, NULL);
    RAISE EXCEPTION 'BUG: a free user threw a formerly free glass';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  b := public.send_bottle('plain', '{"glass":"clear"}', 'foggy', 'wondering');
  IF b ->> 'weather' <> 'foggy' OR b ->> 'current' IS NOT NULL THEN
    RAISE EXCEPTION 'BUG: free bottle not stored: %', b;
  END IF;
  RAISE NOTICE 'ok: defaults allowed, other pieces / wrong kind / bad weather refused';
END;
$$;

-- Keeper: Keeper pieces allowed; the joined current rides along.
SELECT set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000421","role":"authenticated"}', true);
DO $$
DECLARE
  b JSONB := public.send_bottle('gold seal', '{"glass":"amber","seal":"gold","paper":"dusk","ink":"pearl"}', 'stormy', 'venting');
BEGIN
  IF b -> 'style' ->> 'seal' <> 'gold' OR b ->> 'current' <> 'night_owl' THEN
    RAISE EXCEPTION 'BUG: Keeper dressing not stored: %', b;
  END IF;
  RAISE NOTICE 'ok: Keeper dressing + current stored';
END;
$$;

-- Lapse + delivery: the stored look survives the sender's lapse. A free receiver
-- gets the plain bottle and the fact it was dressed (057), never the sender.
RESET role;
UPDATE public.memberships SET access_until = now() - interval '1 second';
UPDATE public.bottles SET receiver_id = '00000000-0000-4000-8000-000000000422', received_at = now()
WHERE sender_id = '00000000-0000-4000-8000-000000000421';
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000422","role":"authenticated"}', true);
DO $$
DECLARE
  r RECORD;
BEGIN
  SELECT * INTO r FROM public.get_received_bottles() LIMIT 1;
  IF r.style IS NOT NULL OR NOT r.dressed OR r.weather <> 'stormy' OR r.vibe <> 'venting' OR r.current <> 'night_owl' THEN
    RAISE EXCEPTION 'BUG: free receiver got: % % % % %', r.style, r.dressed, r.weather, r.vibe, r.current;
  END IF;
  IF (public.get_today_bottle_status() -> 'receivedBottle' ->> 'style') IS NOT NULL THEN
    RAISE EXCEPTION 'BUG: status RPC leaked the dressing to a free receiver';
  END IF;
  IF to_jsonb(r)::text ~ '00000000-0000-4000-8000-000000000421' THEN
    RAISE EXCEPTION 'BUG: received bottle leaks the sender';
  END IF;
  RAISE NOTICE 'ok: free receiver sees that it was dressed, not how, and not by whom';
END;
$$;

-- The catalog is readable, not writable.
DO $$
BEGIN
  IF (SELECT count(*) FROM public.atelier_pieces WHERE sort = 0) <> 4 THEN
    RAISE EXCEPTION 'BUG: each kind needs exactly one default (sort 0) piece';
  END IF;
  BEGIN
    UPDATE public.atelier_pieces SET tier = 'free' WHERE id = 'amber';
    RAISE EXCEPTION 'BUG: a client rewrote the catalog';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RAISE NOTICE 'ok: catalog read-only';
END;
$$;

ROLLBACK;
