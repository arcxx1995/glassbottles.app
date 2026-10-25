-- Runnable check for migration 056 (The Harbour).
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/056_harbour.test.sql
-- Runs inside one transaction and rolls back.

BEGIN;

ALTER TABLE public.profiles ALTER COLUMN age_confirmed_at SET DEFAULT now();

-- Users 01–21. Pool (parked, Keeper, active, screened ok): 01–15.
-- 16 unparked · 17 lapsed · 18 not a Keeper · 19 inactive · 20 held profile · 21 no handle.
INSERT INTO auth.users (id, email, email_confirmed_at)
SELECT ('00000000-0000-4000-8000-0000000056' || lpad(g::text, 2, '0'))::uuid,
       'harbour-' || g || '@example.invalid', now()
FROM generate_series(1, 21) g;
UPDATE public.profiles SET last_active = now()
WHERE id::text LIKE '00000000-0000-4000-8000-0000000056%';
UPDATE public.profiles SET last_active = now() - interval '30 days'
WHERE id = '00000000-0000-4000-8000-000000005619';

INSERT INTO public.memberships (user_id, plan, status, access_until)
SELECT ('00000000-0000-4000-8000-0000000056' || lpad(g::text, 2, '0'))::uuid, 'monthly', 'active',
       CASE WHEN g = 17 THEN now() - interval '1 day' ELSE now() + interval '30 days' END
FROM generate_series(1, 20) g
WHERE g <> 18;

INSERT INTO public.social_profiles (user_id, handle, bio_screen)
SELECT ('00000000-0000-4000-8000-0000000056' || lpad(g::text, 2, '0'))::uuid,
       'h' || lpad(g::text, 2, '0'), CASE WHEN g = 20 THEN 'held' ELSE 'ok' END
FROM generate_series(1, 20) g;

INSERT INTO public.kayaks (user_id, parked)
SELECT ('00000000-0000-4000-8000-0000000056' || lpad(g::text, 2, '0'))::uuid, g <> 16
FROM generate_series(1, 20) g;

-- ── the daily pick: only the pool, idempotent, shuffle-deck ────────────────
DO $$
DECLARE
  n INT;
BEGIN
  IF public.pick_harbour('2030-01-01') <> 12 THEN
    RAISE EXCEPTION 'BUG: first day did not pick twelve';
  END IF;
  IF EXISTS (SELECT 1 FROM public.harbour_days d JOIN public.social_profiles sp USING (user_id)
             WHERE d.day = '2030-01-01' AND sp.handle NOT IN
               ('h01','h02','h03','h04','h05','h06','h07','h08','h09','h10','h11','h12','h13','h14','h15')) THEN
    RAISE EXCEPTION 'BUG: an ineligible kayak was picked';
  END IF;
  IF public.pick_harbour('2030-01-01') <> 0
     OR (SELECT count(*) FROM public.harbour_days WHERE day = '2030-01-01') <> 12 THEN
    RAISE EXCEPTION 'BUG: picking a day twice changed it';
  END IF;

  PERFORM public.pick_harbour('2030-01-02');
  SELECT count(DISTINCT user_id) INTO n FROM public.harbour_days WHERE day IN ('2030-01-01', '2030-01-02');
  IF n <> 15 THEN
    RAISE EXCEPTION 'BUG: shuffle-deck skipped someone (% of 15 shown in two days)', n;
  END IF;
  RAISE NOTICE 'ok: pool only, idempotent, everyone shown before repeats';
END $$;

-- ── save_kayak gates ────────────────────────────────────────────────────────
SET LOCAL role authenticated;
DO $$
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000005618","role":"authenticated"}', true);
  BEGIN
    PERFORM public.save_kayak('teal', 'black', TRUE);
    RAISE EXCEPTION 'BUG: a non-Keeper parked a kayak';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  -- Not parking is allowed (a lapsed Keeper can still recolour ashore).
  PERFORM public.save_kayak('teal', 'black', FALSE);

  PERFORM set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000005621","role":"authenticated"}', true);
  BEGIN
    PERFORM public.save_kayak('teal', 'black', FALSE);
    RAISE EXCEPTION 'BUG: a kayak launched without a handle';
  EXCEPTION WHEN no_data_found THEN NULL;
  END;

  PERFORM set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000005616","role":"authenticated"}', true);
  BEGIN
    PERFORM public.save_kayak('purple', 'red', TRUE);
    RAISE EXCEPTION 'BUG: an off-palette hull was saved';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  IF NOT (public.save_kayak('coral', 'blue', TRUE) ->> 'afloat')::boolean THEN
    RAISE EXCEPTION 'BUG: a Keeper parking did not float';
  END IF;
  RAISE NOTICE 'ok: save_kayak gates';
END $$;
RESET role;

DO $$
BEGIN
  -- Joined at the pool's lowest round (1 after two days), not at 0 — the
  -- unpicked lapsed / inactive kayaks still sit at 0.
  IF (SELECT round FROM public.kayaks WHERE user_id = '00000000-0000-4000-8000-000000005616') <> 1 THEN
    RAISE EXCEPTION 'BUG: a new kayak did not join at the current round';
  END IF;
  RAISE NOTICE 'ok: new kayak joins the current round';
END $$;

-- ── get_harbour: blocks, reports, lapse, own kayak ─────────────────────────
-- Today's ring is fixed to 01–12 so the checks don't depend on the shuffle.
DELETE FROM public.harbour_days WHERE day = (now() AT TIME ZONE 'UTC')::date;
INSERT INTO public.harbour_days (day, slot, user_id)
SELECT (now() AT TIME ZONE 'UTC')::date, g, ('00000000-0000-4000-8000-0000000056' || lpad(g::text, 2, '0'))::uuid
FROM generate_series(1, 12) g;

SET LOCAL role authenticated;
DO $$
DECLARE
  h JSONB;
  handles TEXT[];
BEGIN
  -- 01 blocks 02; 03 reports 04; 07, 08, 09 report 06.
  PERFORM set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000005601","role":"authenticated"}', true);
  IF NOT public.block_kayak('h02') THEN RAISE EXCEPTION 'BUG: block failed'; END IF;
  PERFORM set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000005603","role":"authenticated"}', true);
  PERFORM public.report_kayak('h04', 'spam');
  PERFORM set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000005607","role":"authenticated"}', true);
  PERFORM public.report_kayak('h06', 'harassment');
  PERFORM public.report_kayak('h06', 'harassment'); -- twice from one reporter counts once
  PERFORM set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000005608","role":"authenticated"}', true);
  PERFORM public.report_kayak('h06', 'harassment');
  PERFORM set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000005609","role":"authenticated"}', true);
  IF public.report_kayak('h09', 'other') THEN RAISE EXCEPTION 'BUG: reported own kayak'; END IF;
  PERFORM public.report_kayak('h06', 'harassment');

  PERFORM set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000005601","role":"authenticated"}', true);
  h := public.get_harbour();
  SELECT array_agg(k ->> 'handle') INTO handles FROM jsonb_array_elements(h -> 'kayaks') k;
  IF NOT (h ->> 'keeper')::boolean OR 'h02' = ANY (handles) THEN
    RAISE EXCEPTION 'BUG: blocked kayak shown to the blocker: %', handles;
  END IF;
  IF 'h06' = ANY (handles) THEN
    RAISE EXCEPTION 'BUG: a kayak with three reports still floats';
  END IF;
  IF NOT ('h04' = ANY (handles)) OR NOT ('h01' = ANY (handles)) THEN
    RAISE EXCEPTION 'BUG: kayaks missing from a normal view: %', handles;
  END IF;
  IF h -> 'mine' ->> 'handle' <> 'h01' OR NOT (h -> 'mine' ->> 'in_ring')::boolean THEN
    RAISE EXCEPTION 'BUG: own kayak not reported as in the ring: %', h -> 'mine';
  END IF;
  IF h::text LIKE '%00000000-0000-4000-8000%' THEN
    RAISE EXCEPTION 'BUG: get_harbour leaked a user id';
  END IF;

  PERFORM set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000005602","role":"authenticated"}', true);
  SELECT array_agg(k ->> 'handle') INTO handles FROM jsonb_array_elements(public.get_harbour() -> 'kayaks') k;
  IF 'h01' = ANY (handles) THEN
    RAISE EXCEPTION 'BUG: a block did not hide both ways';
  END IF;

  PERFORM set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000005603","role":"authenticated"}', true);
  SELECT array_agg(k ->> 'handle') INTO handles FROM jsonb_array_elements(public.get_harbour() -> 'kayaks') k;
  IF 'h04' = ANY (handles) THEN
    RAISE EXCEPTION 'BUG: a reported kayak still shown to its reporter';
  END IF;

  -- Own kayak outside the ring still comes back.
  PERFORM set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000005613","role":"authenticated"}', true);
  h := public.get_harbour();
  IF h -> 'mine' ->> 'handle' <> 'h13' OR (h -> 'mine' ->> 'in_ring')::boolean THEN
    RAISE EXCEPTION 'BUG: own kayak outside the ring wrong: %', h -> 'mine';
  END IF;

  -- Non-Keepers see nothing.
  PERFORM set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000005618","role":"authenticated"}', true);
  h := public.get_harbour();
  IF (h ->> 'keeper')::boolean OR jsonb_array_length(h -> 'kayaks') <> 0 THEN
    RAISE EXCEPTION 'BUG: a non-Keeper saw the harbour';
  END IF;

  PERFORM set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000005601","role":"authenticated"}', true);
  IF public.get_kayak_blocks() <> '["h02"]'::jsonb THEN
    RAISE EXCEPTION 'BUG: block list wrong';
  END IF;
  PERFORM public.block_kayak('h02', FALSE);
  IF public.get_kayak_blocks() <> '[]'::jsonb THEN
    RAISE EXCEPTION 'BUG: unblock failed';
  END IF;
  RAISE NOTICE 'ok: blocks both ways, reports hide, own kayak, non-Keepers see nothing';
END $$;
RESET role;

DO $$
DECLARE
  h JSONB;
BEGIN
  IF (SELECT reports FROM public.moderation_queue WHERE kind = 'profile'
      AND target_id = '00000000-0000-4000-8000-000000005606' AND resolved_at IS NULL) <> 3 THEN
    RAISE EXCEPTION 'BUG: kayak reports not tracked on the queue item';
  END IF;

  -- A Keeper who lapses mid-day leaves the ring at once.
  UPDATE public.memberships SET access_until = now() - interval '1 minute'
  WHERE user_id = '00000000-0000-4000-8000-000000005611';
  PERFORM set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000005601","role":"authenticated"}', true);
  SET LOCAL role authenticated;
  h := public.get_harbour();
  RESET role;
  IF h::text LIKE '%"h11"%' THEN
    RAISE EXCEPTION 'BUG: a lapsed Keeper still floats';
  END IF;
  RAISE NOTICE 'ok: report queue, lapse leaves the ring';
END $$;

-- ── grants: tables and the picker are server-only ──────────────────────────
SET LOCAL role authenticated;
DO $$
BEGIN
  BEGIN
    PERFORM 1 FROM public.kayaks;
    RAISE EXCEPTION 'BUG: clients can read kayaks';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.pick_harbour('2030-02-01');
    RAISE EXCEPTION 'BUG: clients can run the pick';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RAISE NOTICE 'ok: kayak tables and pick are server-only';
END $$;
RESET role;

ROLLBACK;
