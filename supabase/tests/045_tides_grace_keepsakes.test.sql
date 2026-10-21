-- Runnable check for migration 045.
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/045_tides_grace_keepsakes.test.sql
-- Runs inside one transaction and rolls back.

BEGIN;

-- One user per tides shape; offsets are days before today (UTC).
CREATE TEMP TABLE shapes (n INT, offsets INT[], expected INT);
INSERT INTO shapes VALUES
  -- one gap mid-run: forgiven, not counted
  (1, '{0,1,3,4}', 4),
  -- two gaps: both forgiven only if they fall in different months
  (2, '{0,1,3,5}', CASE WHEN to_char((now() AT TIME ZONE 'UTC')::date - 2, 'YYYY-MM')
                           = to_char((now() AT TIME ZONE 'UTC')::date - 4, 'YYYY-MM')
                        THEN 3 ELSE 4 END),
  -- two missed days in a row break it
  (3, '{0,3,4}', 1),
  -- today still open, yesterday missed, the run before it holds
  (4, '{2,3}', 2),
  -- today open, yesterday and the day before missed: gone
  (5, '{3,4}', 0),
  -- unbroken run, no grace needed
  (6, '{0,1,2}', 3);

INSERT INTO auth.users (id, email, email_confirmed_at)
SELECT ('00000000-0000-4000-8000-00000000045' || n)::uuid, 'tides-' || n || '@example.invalid', now()
FROM shapes;
UPDATE public.profiles SET timezone = 'UTC'
WHERE id::text LIKE '00000000-0000-4000-8000-00000000045%';

INSERT INTO public.bottles (sender_id, message, sent_at, day_key)
SELECT ('00000000-0000-4000-8000-00000000045' || s.n)::uuid, 'tide', now() - make_interval(days => o),
       (now() AT TIME ZONE 'UTC')::date - o
FROM shapes s, unnest(s.offsets) o;

GRANT SELECT ON shapes TO authenticated;
SET LOCAL role authenticated;

DO $$
DECLARE
  s RECORD;
  got INT;
BEGIN
  FOR s IN SELECT * FROM shapes ORDER BY n LOOP
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', '00000000-0000-4000-8000-00000000045' || s.n, 'role', 'authenticated')::text, true);
    got := (public.get_today_bottle_status() ->> 'tides')::int;
    IF got <> s.expected THEN
      RAISE EXCEPTION 'BUG: tides shape % (days ago %) = %, expected %', s.n, s.offsets, got, s.expected;
    END IF;
  END LOOP;
  RAISE NOTICE 'ok: tides grace — one forgiven day a month, never two in a row';
END;
$$;

-- Keepsakes: the receiver keeps and unkeeps; nobody else can.
RESET role;
INSERT INTO public.bottles (id, sender_id, receiver_id, message, sent_at, received_at, day_key)
VALUES ('00000000-0000-4000-8000-0000000045b1', '00000000-0000-4000-8000-000000000451',
        '00000000-0000-4000-8000-000000000452', 'keep me', now() - interval '3 hours',
        now() - interval '2 hours', (now() AT TIME ZONE 'UTC')::date - 9);
SET LOCAL role authenticated;

DO $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    '{"sub":"00000000-0000-4000-8000-000000000451","role":"authenticated"}', true);
  IF public.keep_bottle('00000000-0000-4000-8000-0000000045b1', true) THEN
    RAISE EXCEPTION 'BUG: the sender kept a bottle they threw';
  END IF;
  PERFORM set_config('request.jwt.claims',
    '{"sub":"00000000-0000-4000-8000-000000000452","role":"authenticated"}', true);
  -- Separate statements: a read in the same expression sees the pre-update snapshot.
  IF NOT public.keep_bottle('00000000-0000-4000-8000-0000000045b1', true) THEN
    RAISE EXCEPTION 'BUG: receiver could not keep';
  END IF;
  IF (SELECT kept_at FROM public.get_received_bottles() WHERE id = '00000000-0000-4000-8000-0000000045b1') IS NULL THEN
    RAISE EXCEPTION 'BUG: kept bottle not marked kept';
  END IF;
  PERFORM public.keep_bottle('00000000-0000-4000-8000-0000000045b1', false);
  IF (SELECT kept_at FROM public.get_received_bottles() WHERE id = '00000000-0000-4000-8000-0000000045b1') IS NOT NULL THEN
    RAISE EXCEPTION 'BUG: unkeep didn''t clear';
  END IF;
  RAISE NOTICE 'ok: keepsakes are the receiver''s alone';
END;
$$;

ROLLBACK;
