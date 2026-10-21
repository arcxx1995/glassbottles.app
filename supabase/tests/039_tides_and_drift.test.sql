-- Runnable check for migration 039.
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/039_tides_and_drift.test.sql
-- Runs inside one transaction and rolls back.

BEGIN;

INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('00000000-0000-4000-8000-000000000390', 'tide-s@example.invalid', now()),
  ('00000000-0000-4000-8000-000000000391', 'tide-near@example.invalid', now()),
  ('00000000-0000-4000-8000-000000000392', 'tide-far@example.invalid', now());
UPDATE public.profiles SET timezone = 'UTC'          WHERE id = '00000000-0000-4000-8000-000000000390';
UPDATE public.profiles SET timezone = 'Europe/Athens' WHERE id = '00000000-0000-4000-8000-000000000391';
UPDATE public.profiles SET timezone = 'Asia/Tokyo'   WHERE id = '00000000-0000-4000-8000-000000000392';

-- Thrown yesterday, the day before, and the day before that; a two-day gap;
-- then two older days. Nothing today yet → anchor is yesterday → 3 tides.
-- (Two days, since 045 forgives a single missed day a month.)
INSERT INTO public.bottles (sender_id, receiver_id, message, sent_at, received_at, day_key)
SELECT '00000000-0000-4000-8000-000000000390',
       CASE g WHEN 1 THEN '00000000-0000-4000-8000-000000000391'::uuid
              WHEN 2 THEN '00000000-0000-4000-8000-000000000392'::uuid END,
       'tide ' || g,
       now() - make_interval(days => g),
       CASE WHEN g IN (1, 2) THEN now() - make_interval(days => g) + interval '2 hours' END,
       (now() AT TIME ZONE 'UTC')::date - g
FROM unnest(ARRAY[1, 2, 3, 6, 7]) g;

SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000390","role":"authenticated"}', true);

DO $$
DECLARE
  s JSONB := public.get_today_bottle_status();
  bands TEXT[];
BEGIN
  IF (s ->> 'tides')::int <> 3 THEN
    RAISE EXCEPTION 'BUG: tides = %, expected 3 (yesterday-anchored run, stops at the gap)', s ->> 'tides';
  END IF;
  SELECT array_agg(e ->> 'drift_band' ORDER BY e ->> 'received_at' DESC)
  INTO bands FROM jsonb_array_elements(s -> 'unackedDelivered') e;
  IF bands IS DISTINCT FROM ARRAY['near', 'distant'] THEN
    RAISE EXCEPTION 'BUG: drift bands %, expected {near,distant} (Athens +2/3h, Tokyo +9h)', bands;
  END IF;
  IF (s -> 'unackedDelivered') ::text ~ '(receiver|timezone|Tokyo|Athens)' THEN
    RAISE EXCEPTION 'BUG: status leaks receiver details: %', s -> 'unackedDelivered';
  END IF;
  RAISE NOTICE 'ok: tides % and drift bands %', s ->> 'tides', bands;
END;
$$;

RESET role;
ROLLBACK;
