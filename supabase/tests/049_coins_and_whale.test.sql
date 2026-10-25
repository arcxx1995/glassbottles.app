-- Runnable check for migration 049.
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/049_coins_and_whale.test.sql
-- Runs inside one transaction and rolls back.

BEGIN;

-- 051: fixture users are confirmed adults and their bottles count as screened
-- (the screen itself is covered by 043 and 051). Rolled back with the rest.
ALTER TABLE public.profiles ALTER COLUMN age_confirmed_at SET DEFAULT now();
ALTER TABLE public.bottles  ALTER COLUMN screen SET DEFAULT 'ok';

INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('00000000-0000-4000-8000-000000000490', 'coins-a@example.invalid', now()),
  ('00000000-0000-4000-8000-000000000491', 'coins-b@example.invalid', now());
UPDATE public.profiles SET timezone = 'UTC'
WHERE id IN ('00000000-0000-4000-8000-000000000490', '00000000-0000-4000-8000-000000000491');

-- Six days of tide; the seventh throw (today) is the milestone.
INSERT INTO public.bottles (sender_id, message, sent_at, day_key)
SELECT '00000000-0000-4000-8000-000000000490', 'tide', now() - make_interval(days => g),
       (now() AT TIME ZONE 'UTC')::date - g
FROM generate_series(1, 6) g;
INSERT INTO public.bottles (id, sender_id, receiver_id, message, sent_at, received_at, day_key) VALUES
  ('00000000-0000-4000-8000-0000000049b1', '00000000-0000-4000-8000-000000000490',
   '00000000-0000-4000-8000-000000000491', 'found', now() - interval '20 days',
   now() - interval '19 days', (now() AT TIME ZONE 'UTC')::date - 20);

SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000490","role":"authenticated"}', true);

DO $$
DECLARE
  bal INT;
BEGIN
  -- Coin piece refused before it's unlocked.
  BEGIN
    PERFORM public.send_bottle('moonstone?', '{"glass":"moonstone"}');
    RAISE EXCEPTION 'BUG: a locked coin piece was thrown';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM public.send_bottle('seventh day');
  bal := (public.get_coins() ->> 'balance')::int;
  IF bal <> 5 THEN
    RAISE EXCEPTION 'BUG: seventh tide paid %, expected 5', bal;
  END IF;
  IF (public.get_today_bottle_status() ->> 'tides')::int <> 7 THEN
    RAISE EXCEPTION 'BUG: tides via tides_for changed: %', public.get_today_bottle_status() ->> 'tides';
  END IF;
  RAISE NOTICE 'ok: tide milestone pays once, locked coin piece refused';
END;
$$;

-- A ripple pays the sender once.
SELECT set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000491","role":"authenticated"}', true);
SELECT public.ripple_bottle('00000000-0000-4000-8000-0000000049b1');
SELECT set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000490","role":"authenticated"}', true);

DO $$
DECLARE
  bal INT;
BEGIN
  bal := (public.get_coins() ->> 'balance')::int;
  IF bal <> 8 THEN
    RAISE EXCEPTION 'BUG: after a ripple balance %, expected 8', bal;
  END IF;
  BEGIN
    PERFORM public.unlock_piece('ink', 'lavender'); -- costs 15
    RAISE EXCEPTION 'BUG: 8 coins bought a 15-coin piece';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  RAISE NOTICE 'ok: a ripple pays 3; 8 coins can''t buy a 15-coin piece';
END;
$$;

-- Give enough coins (as the owner) and spend them.
RESET role;
INSERT INTO public.coin_ledger (user_id, delta, reason, ref)
VALUES ('00000000-0000-4000-8000-000000000490', 20, 'whale', 'test-grant');
SET LOCAL role authenticated;
DO $$
DECLARE
  bal INT;
BEGIN
  bal := public.unlock_piece('ink', 'lavender');
  IF bal <> 13 THEN
    RAISE EXCEPTION 'BUG: 28 - 15 = %, expected 13', bal;
  END IF;
  -- Unlocking twice is free and idempotent.
  IF public.unlock_piece('ink', 'lavender') <> 13 THEN
    RAISE EXCEPTION 'BUG: a second unlock charged again';
  END IF;
  BEGIN
    PERFORM public.unlock_piece('glass', 'amber'); -- a Keeper piece isn't for sale
    RAISE EXCEPTION 'BUG: bought a Keeper piece with coins';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  IF NOT (public.get_coins() -> 'unlocked') ? 'ink:lavender' THEN
    RAISE EXCEPTION 'BUG: unlock not listed';
  END IF;
  RAISE NOTICE 'ok: unlock spends once, Keeper pieces not for sale';
END;
$$;

-- The unlocked piece now passes the shared (internal) style check, which
-- send_bottle and send_future_bottle both use.
RESET role;
SELECT public.check_bottle_style('00000000-0000-4000-8000-000000000490', '{"ink":"lavender"}');
SET LOCAL role authenticated;

-- The whale: only while surfaced, once a day. Outside the window → false.
DO $$
DECLARE
  w JSONB := public.get_today_bottle_status() -> 'whale';
  ok BOOLEAN := public.spot_whale();
BEGIN
  IF now() BETWEEN (w ->> 'start')::timestamptz AND (w ->> 'end')::timestamptz THEN
    IF NOT ok OR public.spot_whale() THEN
      RAISE EXCEPTION 'BUG: in-window whale should pay exactly once';
    END IF;
  ELSIF ok THEN
    RAISE EXCEPTION 'BUG: whale spotted outside its window %', w;
  END IF;
  IF (w ->> 'end')::timestamptz - (w ->> 'start')::timestamptz <> interval '90 minutes' THEN
    RAISE EXCEPTION 'BUG: whale window %', w;
  END IF;
  RAISE NOTICE 'ok: whale window honoured (% to %)', w ->> 'start', w ->> 'end';
END;
$$;

-- Clients can't write the ledger.
DO $$
BEGIN
  INSERT INTO public.coin_ledger (user_id, delta, reason, ref)
  VALUES ('00000000-0000-4000-8000-000000000490', 999, 'whale', 'hack');
  RAISE EXCEPTION 'BUG: a client minted coins';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'ok: ledger is server-only';
END;
$$;

ROLLBACK;
