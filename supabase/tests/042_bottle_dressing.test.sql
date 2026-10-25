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

-- Free user: free pieces, weather and vibe fine; a Keeper piece is refused.
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
  b := public.send_bottle('free and dressed', '{"glass":"seafoam","ink":"sepia"}', 'foggy', 'wondering');
  IF b -> 'style' ->> 'glass' <> 'seafoam' OR b ->> 'weather' <> 'foggy' OR b ->> 'current' IS NOT NULL THEN
    RAISE EXCEPTION 'BUG: free dressing not stored: %', b;
  END IF;
  RAISE NOTICE 'ok: free pieces allowed, Keeper piece / wrong kind / bad weather refused';
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

-- Lapse + delivery: the membership ends, the bottle keeps its look, and the
-- receiver sees all of it — without learning who sent it.
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
  IF r.style ->> 'glass' <> 'amber' OR r.weather <> 'stormy' OR r.vibe <> 'venting' OR r.current <> 'night_owl' THEN
    RAISE EXCEPTION 'BUG: receiver lost the dressing: % % % %', r.style, r.weather, r.vibe, r.current;
  END IF;
  IF (public.get_today_bottle_status() -> 'receivedBottle' -> 'style' ->> 'paper') <> 'dusk' THEN
    RAISE EXCEPTION 'BUG: status RPC lost the dressing';
  END IF;
  IF to_jsonb(r)::text ~ '00000000-0000-4000-8000-000000000421' THEN
    RAISE EXCEPTION 'BUG: received bottle leaks the sender';
  END IF;
  RAISE NOTICE 'ok: lapsed Keeper''s bottle keeps its look; receiver sees dressing, not sender';
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
