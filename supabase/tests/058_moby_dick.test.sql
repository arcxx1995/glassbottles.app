-- Runnable check for migrations 058 and 059.
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/058_moby_dick.test.sql
-- Runs inside one transaction and rolls back.

BEGIN;

-- 051: fixture users are confirmed adults and their bottles count as screened
-- (the screen itself is covered by 043 and 051). Rolled back with the rest.
ALTER TABLE public.profiles ALTER COLUMN age_confirmed_at SET DEFAULT now();
ALTER TABLE public.bottles  ALTER COLUMN screen SET DEFAULT 'ok';

INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('00000000-0000-4000-8000-000000000580', 'moby-free@example.invalid', now()),
  ('00000000-0000-4000-8000-000000000581', 'moby-keeper@example.invalid', now());
UPDATE public.profiles SET timezone = 'UTC'
WHERE id IN ('00000000-0000-4000-8000-000000000580', '00000000-0000-4000-8000-000000000581');
INSERT INTO public.memberships (user_id, plan, status, access_until)
VALUES ('00000000-0000-4000-8000-000000000581', 'yearly', 'active', now() + interval '30 days');

-- Coins and vibes are gone, and Keeper holds every former coin piece.
DO $$
BEGIN
  IF to_regclass('public.coin_ledger') IS NOT NULL
     OR to_regprocedure('public.get_coins()') IS NOT NULL
     OR to_regprocedure('public.unlock_piece(text, text)') IS NOT NULL
     OR to_regprocedure('public.award_bottle_coins()') IS NOT NULL
     OR to_regprocedure('public.send_bottle(text, jsonb, text, text)') IS NOT NULL THEN
    RAISE EXCEPTION 'BUG: coin or vibe objects remain';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public'
               AND ((table_name = 'bottles' AND column_name = 'vibe')
                 OR (table_name = 'atelier_pieces' AND column_name = 'coin_cost'))) THEN
    RAISE EXCEPTION 'BUG: vibe or coin_cost column remains';
  END IF;
  IF (SELECT count(*) FROM public.atelier_pieces
      WHERE tier = 'keeper'
        AND (kind, id) IN (('glass', 'moonstone'), ('seal', 'pearl'),
                           ('paper', 'tidepool'), ('ink', 'lavender'))) <> 4 THEN
    RAISE EXCEPTION 'BUG: a former coin piece is not a Keeper piece';
  END IF;
  BEGIN
    UPDATE public.atelier_pieces SET tier = 'coin' WHERE id = 'amber';
    RAISE EXCEPTION 'BUG: coin tier still accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  RAISE NOTICE 'ok: no coins, no vibes, four pieces moved to Keeper';
END;
$$;

-- One day in every ISO week, inside 09:00-19:00 local, over ten fixed years.
DO $$
DECLARE
  weekdays INT;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM generate_series(DATE '2026-01-05', DATE '2035-12-30', interval '1 day') d
    GROUP BY to_char(d, 'IYYY-IW')
    HAVING count(*) FILTER (WHERE public.moby_start(d::date, 'UTC') IS NOT NULL) <> 1
  ) THEN
    RAISE EXCEPTION 'BUG: a week without exactly one Moby day';
  END IF;
  SELECT count(DISTINCT extract(isodow FROM d)) INTO weekdays
  FROM generate_series(DATE '2026-01-05', DATE '2035-12-30', interval '1 day') d
  WHERE public.moby_start(d::date, 'UTC') IS NOT NULL;
  IF weekdays <> 7 THEN
    RAISE EXCEPTION 'BUG: Moby only ever surfaces on % weekdays', weekdays;
  END IF;
  IF EXISTS (
    SELECT 1
    FROM generate_series(DATE '2026-01-01', DATE '2035-12-31', interval '1 day') d,
         LATERAL (SELECT public.moby_start(d::date, 'Asia/Kolkata') AS s) x
    WHERE x.s IS NOT NULL
      AND (x.s AT TIME ZONE 'Asia/Kolkata')::time NOT BETWEEN TIME '09:00' AND TIME '19:00'
  ) THEN
    RAISE EXCEPTION 'BUG: Moby surfaced outside local 09:00-19:00';
  END IF;
  RAISE NOTICE 'ok: one Moby day a week, any weekday, local daytime';
END;
$$;

-- An earlier sighting counts toward the lifetime number.
INSERT INTO public.whale_sightings (user_id, day)
VALUES ('00000000-0000-4000-8000-000000000580', DATE '2026-01-01');

-- Not a Moby day: no whale, nothing to spot. moby_start is replaced below so
-- each case doesn't depend on today's date. Rolled back with the rest.
CREATE OR REPLACE FUNCTION public.moby_start(p_day DATE, p_tz TEXT)
RETURNS TIMESTAMPTZ LANGUAGE sql STABLE AS $$ SELECT NULL::timestamptz $$;

SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000580","role":"authenticated"}', true);
DO $$
BEGIN
  IF jsonb_typeof(public.get_today_bottle_status() -> 'whale') <> 'null' THEN
    RAISE EXCEPTION 'BUG: whale shown on a non-Moby day';
  END IF;
  IF public.spot_whale() <> 0 THEN
    RAISE EXCEPTION 'BUG: spotted on a non-Moby day';
  END IF;
  RAISE NOTICE 'ok: nothing on a non-Moby day';
END;
$$;

-- A Moby day, before the window opens.
RESET role;
CREATE OR REPLACE FUNCTION public.moby_start(p_day DATE, p_tz TEXT)
RETURNS TIMESTAMPTZ LANGUAGE sql STABLE AS $$ SELECT now() + interval '1 hour' $$;
SET LOCAL role authenticated;
DO $$
DECLARE
  w JSONB := public.get_today_bottle_status() -> 'whale';
BEGIN
  IF (w ->> 'end')::timestamptz - (w ->> 'start')::timestamptz <> interval '90 minutes'
     OR (w ->> 'spotted')::boolean THEN
    RAISE EXCEPTION 'BUG: window %', w;
  END IF;
  IF public.spot_whale() <> 0 THEN
    RAISE EXCEPTION 'BUG: spotted before the window';
  END IF;
  RAISE NOTICE 'ok: not before the window';
END;
$$;

-- Surfaced: a free user spots it once, and the count includes the old sighting.
RESET role;
CREATE OR REPLACE FUNCTION public.moby_start(p_day DATE, p_tz TEXT)
RETURNS TIMESTAMPTZ LANGUAGE sql STABLE AS $$ SELECT now() - interval '1 minute' $$;
SET LOCAL role authenticated;
DO $$
BEGIN
  IF public.spot_whale() <> 2 THEN
    RAISE EXCEPTION 'BUG: first sighting today should make the count 2';
  END IF;
  IF public.spot_whale() <> 0 THEN
    RAISE EXCEPTION 'BUG: spotted twice in one day';
  END IF;
  IF NOT (public.get_today_bottle_status() -> 'whale' ->> 'spotted')::boolean THEN
    RAISE EXCEPTION 'BUG: status does not say spotted';
  END IF;
  RAISE NOTICE 'ok: once a day, lifetime count, free users included';
END;
$$;

-- Sightings are server-only.
DO $$
BEGIN
  INSERT INTO public.whale_sightings (user_id, day)
  VALUES ('00000000-0000-4000-8000-000000000580', DATE '2026-01-02');
  RAISE EXCEPTION 'BUG: a client wrote a sighting';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'ok: sightings are server-only';
END;
$$;

-- A former coin piece needs Keeper and nothing else.
DO $$
BEGIN
  PERFORM public.send_bottle('lavender?', '{"ink":"lavender"}');
  RAISE EXCEPTION 'BUG: a free user threw a Keeper piece';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'ok: free user refused';
END;
$$;

-- Six days of tide; the seventh throw still counts, in the former coin piece.
RESET role;
INSERT INTO public.bottles (sender_id, message, sent_at, day_key)
SELECT '00000000-0000-4000-8000-000000000581', 'tide', now() - make_interval(days => g),
       (now() AT TIME ZONE 'UTC')::date - g
FROM generate_series(1, 6) g;
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000581","role":"authenticated"}', true);
DO $$
DECLARE
  b JSONB := public.send_bottle('in lavender', '{"ink":"lavender"}', 'calm');
BEGIN
  IF b -> 'style' ->> 'ink' <> 'lavender' OR b ->> 'weather' <> 'calm' OR b ? 'vibe' THEN
    RAISE EXCEPTION 'BUG: Keeper bottle stored as %', b;
  END IF;
  IF (public.get_today_bottle_status() ->> 'tides')::int <> 7 THEN
    RAISE EXCEPTION 'BUG: tides changed: %', public.get_today_bottle_status() ->> 'tides';
  END IF;
  RAISE NOTICE 'ok: Keeper throws it with no unlock; tides still count';
END;
$$;

ROLLBACK;
