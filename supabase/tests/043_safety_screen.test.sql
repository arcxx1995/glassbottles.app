-- Runnable check for migration 043.
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/043_safety_screen.test.sql
-- Runs inside one transaction and rolls back.

BEGIN;

-- 051: fixture users are confirmed adults. Rolled back with the rest.
ALTER TABLE public.profiles ALTER COLUMN age_confirmed_at SET DEFAULT now();

INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('00000000-0000-4000-8000-000000000430', 'screen-a@example.invalid', now()),
  ('00000000-0000-4000-8000-000000000431', 'screen-b@example.invalid', now());
UPDATE public.profiles SET timezone = 'UTC'
WHERE id IN ('00000000-0000-4000-8000-000000000430', '00000000-0000-4000-8000-000000000431');

SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000430","role":"authenticated"}', true);

-- Throw 1 → held: ashore, out of the sea, words back, and the day restored.
DO $$
DECLARE
  b JSONB := public.send_bottle('find me at insta @someone');
  s JSONB;
BEGIN
  RESET role;
  IF public.apply_screen((b ->> 'id')::uuid, 'held', 'contact') <> 'held' THEN
    RAISE EXCEPTION 'BUG: held verdict not applied';
  END IF;
  SET LOCAL role authenticated;
  s := public.get_today_bottle_status();
  IF (s -> 'quota' ->> 'has_sent')::boolean THEN
    RAISE EXCEPTION 'BUG: the day''s throw was not restored after a hold';
  END IF;
  IF jsonb_array_length(s -> 'sailingBottles') <> 0 OR s -> 'sentBottle' <> 'null'::jsonb THEN
    RAISE EXCEPTION 'BUG: a held bottle is still in the sea: %', s;
  END IF;
  IF s -> 'heldBottle' ->> 'screen_reason' <> 'contact'
     OR s -> 'heldBottle' ->> 'message' <> 'find me at insta @someone' THEN
    RAISE EXCEPTION 'BUG: held bottle not handed back: %', s -> 'heldBottle';
  END IF;
  RAISE NOTICE 'ok: held → ashore, words back, day restored';
END;
$$;

-- Throw 2 (the rewrite) is allowed the same day; holding it too does NOT
-- restore the day again.
DO $$
DECLARE
  b JSONB := public.send_bottle('a kinder rewrite');
BEGIN
  RESET role;
  PERFORM public.apply_screen((b ->> 'id')::uuid, 'held', 'spam');
  SET LOCAL role authenticated;
  IF NOT (public.get_today_bottle_status() -> 'quota' ->> 'has_sent')::boolean THEN
    RAISE EXCEPTION 'BUG: a second hold restored the day — the screen becomes unlimited throws';
  END IF;
  BEGIN
    PERFORM public.send_bottle('third try');
    RAISE EXCEPTION 'BUG: a third throw got through';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  RAISE NOTICE 'ok: rewrite allowed once; no unlimited throws';
END;
$$;

-- Ack hides it; only the sender can ack.
DO $$
DECLARE
  h UUID := (public.get_today_bottle_status() -> 'heldBottle' ->> 'id')::uuid;
BEGIN
  PERFORM set_config('request.jwt.claims',
    '{"sub":"00000000-0000-4000-8000-000000000431","role":"authenticated"}', true);
  PERFORM public.ack_held_bottle(h);
  PERFORM set_config('request.jwt.claims',
    '{"sub":"00000000-0000-4000-8000-000000000430","role":"authenticated"}', true);
  IF (public.get_today_bottle_status() -> 'heldBottle' ->> 'id')::uuid IS DISTINCT FROM h THEN
    RAISE EXCEPTION 'BUG: another user acked my held bottle';
  END IF;
  PERFORM public.ack_held_bottle(h);
  -- The earlier held bottle is next in line; ack it too.
  PERFORM public.ack_held_bottle((public.get_today_bottle_status() -> 'heldBottle' ->> 'id')::uuid);
  IF public.get_today_bottle_status() -> 'heldBottle' <> 'null'::jsonb THEN
    RAISE EXCEPTION 'BUG: acked held bottles still shown';
  END IF;
  RAISE NOTICE 'ok: ack is sender-only';
END;
$$;

-- Crisis is held (052); the matcher never delivers a held bottle; a late hold on
-- a delivered bottle is recorded but never claws it back.
RESET role;
DO $$
DECLARE
  c UUID;
  held_old UUID;
  late UUID;
BEGIN
  INSERT INTO public.bottles (sender_id, message, sent_at, day_key)
  VALUES ('00000000-0000-4000-8000-000000000431', 'i don''t want to be here anymore',
          now() - interval '2 hours', (now() AT TIME ZONE 'UTC')::date - 3)
  RETURNING id INTO c;
  PERFORM public.apply_screen(c, 'crisis');
  -- 052: crisis no longer sails; it is held ashore with reason 'crisis'.
  IF (SELECT NOT is_stale OR screen <> 'held' OR screen_reason <> 'crisis' FROM public.bottles WHERE id = c) THEN
    RAISE EXCEPTION 'BUG: a crisis bottle stayed in the water';
  END IF;

  SELECT id INTO held_old FROM public.bottles
  WHERE sender_id = '00000000-0000-4000-8000-000000000430' AND screen = 'held' LIMIT 1;
  UPDATE public.bottles SET sent_at = now() - interval '2 hours' WHERE id = held_old;
  IF (public.match_bottle(held_old) ->> 'matched')::boolean
     OR (SELECT received_at FROM public.bottles WHERE id = held_old) IS NOT NULL THEN
    RAISE EXCEPTION 'BUG: the matcher delivered a held bottle';
  END IF;

  INSERT INTO public.bottles (sender_id, receiver_id, message, sent_at, received_at, day_key)
  VALUES ('00000000-0000-4000-8000-000000000431', '00000000-0000-4000-8000-000000000430', 'late',
          now() - interval '3 hours', now() - interval '1 hour', (now() AT TIME ZONE 'UTC')::date - 5)
  RETURNING id INTO late;
  IF public.apply_screen(late, 'held', 'harm') <> 'held_too_late'
     OR (SELECT is_stale FROM public.bottles WHERE id = late) THEN
    RAISE EXCEPTION 'BUG: a late hold clawed back a delivered bottle';
  END IF;
  IF public.apply_screen(late, 'ok') <> 'already_screened' THEN
    RAISE EXCEPTION 'BUG: a second verdict overwrote the first';
  END IF;
  RAISE NOTICE 'ok: crisis held, held never matched, late hold recorded only, verdict once';
END;
$$;

-- Clients can't judge bottles.
SET LOCAL role authenticated;
DO $$
BEGIN
  PERFORM public.apply_screen(gen_random_uuid(), 'ok');
  RAISE EXCEPTION 'BUG: a client can call apply_screen';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'ok: apply_screen is service-role only';
END;
$$;

ROLLBACK;
