-- Runnable check for migration 063 (Kayak voyages).
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/063_kayak_voyages.test.sql
-- Runs inside one transaction and rolls back. now() is frozen for the whole run,
-- so tests move time by rewriting sail_until, arrived_at and access_until.

BEGIN;

ALTER TABLE public.profiles ALTER COLUMN age_confirmed_at SET DEFAULT now();
-- Earlier test files or seeds must not join the pool.
DELETE FROM public.memberships;

-- Users 01–10 are paid members, joined long ago. 11 is free. 12 has no confirmed email.
INSERT INTO auth.users (id, email, email_confirmed_at)
SELECT ('00000000-0000-4000-8000-0000000063' || lpad(g::text, 2, '0'))::uuid,
       'kayak-' || g || '@example.invalid', CASE WHEN g = 12 THEN NULL ELSE now() END
FROM generate_series(1, 12) g;
INSERT INTO public.memberships (user_id, plan, status, access_until, keeper_since)
SELECT ('00000000-0000-4000-8000-0000000063' || lpad(g::text, 2, '0'))::uuid, 'monthly', 'active',
       now() + interval '30 days', now() - interval '40 days'
FROM generate_series(1, 12) g WHERE g <> 11;

CREATE FUNCTION pg_temp.u(n INT) RETURNS UUID LANGUAGE sql AS
  $$ SELECT ('00000000-0000-4000-8000-0000000063' || lpad(n::text, 2, '0'))::uuid $$;
CREATE FUNCTION pg_temp.as_user(n INT) RETURNS VOID LANGUAGE sql AS
  $$ SELECT set_config('request.jwt.claims', json_build_object('sub', pg_temp.u(n), 'role', 'authenticated')::text, true) $$;
CREATE FUNCTION pg_temp.server() RETURNS VOID LANGUAGE sql AS
  $$ SELECT set_config('request.jwt.claims', '', true) $$;
CREATE FUNCTION pg_temp.look() RETURNS JSONB LANGUAGE sql AS
  $$ SELECT '{"vessel":"canoe","color":"rose_pale","pattern":"waves","paddle":"wooden_oars","deck":{"bow":"lantern"}}'::jsonb $$;
-- Every leg's delay has passed.
CREATE FUNCTION pg_temp.due() RETURNS VOID LANGUAGE sql AS $$
  UPDATE public.voyages SET sail_until = now() - interval '1 second' WHERE state IN ('sailing', 'returning');
$$;
-- Empty the water between sections.
CREATE FUNCTION pg_temp.clear() RETURNS VOID LANGUAGE sql AS $$
  DELETE FROM public.kayak_comments;
  DELETE FROM public.gems;
  DELETE FROM public.kayaks;
  DELETE FROM public.kayak_allowances;
  DELETE FROM public.kayak_blocks;
  DELETE FROM public.kayak_reports;
  DELETE FROM public.moderation_queue;
  UPDATE public.memberships SET access_until = now() + interval '30 days';
  UPDATE public.profiles SET suspended_at = NULL, suspension_reason = NULL;
$$;
-- A Kayak of user n with c gems, launched with its note passed.
CREATE FUNCTION pg_temp.sail(n INT, c INT DEFAULT 5) RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE
  k UUID;
  v UUID;
BEGIN
  PERFORM pg_temp.as_user(n);
  k := public.save_kayak_look(NULL, pg_temp.look());
  PERFORM public.load_gems(k, c);
  v := public.launch_kayak(k, 'What did the sea teach you?');
  PERFORM public.apply_kayak_screen('kayak_notes', (SELECT id FROM public.kayak_notes WHERE voyage_id = v), 'ok');
  RETURN v;
END $$;
-- The voyage's open visit id, its recipient and an aboard gem.
CREATE FUNCTION pg_temp.visit_of(v UUID) RETURNS UUID LANGUAGE sql AS
  $$ SELECT id FROM public.kayak_visits WHERE voyage_id = v AND left_at IS NULL $$;
CREATE FUNCTION pg_temp.gem_of(v UUID) RETURNS UUID LANGUAGE sql AS $$
  SELECT g.id FROM public.gems g JOIN public.voyages y ON y.kayak_id = g.kayak_id
  WHERE y.id = v AND g.state = 'aboard' LIMIT 1
$$;
-- Arrive now, and act as whoever received it. Returns the visit id.
CREATE FUNCTION pg_temp.arrive(v UUID) RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE
  vi public.kayak_visits%ROWTYPE;
  n  INT;
BEGIN
  PERFORM pg_temp.server();
  PERFORM pg_temp.due();
  PERFORM public.advance_kayaks();
  SELECT * INTO vi FROM public.kayak_visits WHERE voyage_id = v AND left_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BUG: voyage % did not arrive', v;
  END IF;
  n := right(vi.recipient_id::text, 2)::int;
  PERFORM pg_temp.as_user(n);
  RETURN vi.id;
END $$;

-- ─── building ───────────────────────────────────────────────────────────────
DO $$
DECLARE
  k UUID;
BEGIN
  PERFORM pg_temp.as_user(11);
  BEGIN
    PERFORM public.save_kayak_look(NULL, pg_temp.look());
    RAISE EXCEPTION 'BUG: a free member built a Kayak';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  PERFORM pg_temp.as_user(1);
  BEGIN
    PERFORM public.save_kayak_look(NULL, '{"vessel":"tank","color":"rose_pale","paddle":"wooden_oars"}'::jsonb);
    RAISE EXCEPTION 'BUG: an unknown vessel saved';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM public.save_kayak_look(NULL, '{"vessel":"canoe","color":"#ff0000","paddle":"wooden_oars"}'::jsonb);
    RAISE EXCEPTION 'BUG: an off-catalogue colour saved';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM public.save_kayak_look(NULL, '{"vessel":"canoe","color":"rose_pale","paddle":"wooden_oars","deck":{"bow":"my phone is 555"}}'::jsonb);
    RAISE EXCEPTION 'BUG: free text got onto a deck';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;

  k := public.save_kayak_look(NULL, pg_temp.look());
  PERFORM public.save_kayak_look(NULL, pg_temp.look());
  PERFORM public.save_kayak_look(NULL, pg_temp.look());
  BEGIN
    PERFORM public.save_kayak_look(NULL, pg_temp.look());
    RAISE EXCEPTION 'BUG: a fourth Kayak was built';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  RAISE NOTICE 'ok: Keepers only, catalogue only, 3 Kayaks';
  PERFORM pg_temp.clear();
END $$;

-- ─── gems and the allowance ─────────────────────────────────────────────────
DO $$
DECLARE
  k     UUID;
  k2    UUID;
  gems  JSONB;
  left_ INT;
BEGIN
  PERFORM pg_temp.as_user(1);
  k := public.save_kayak_look(NULL, pg_temp.look());
  gems := public.load_gems(k, 30);
  IF jsonb_array_length(gems) <> 30 THEN
    RAISE EXCEPTION 'BUG: asked for 30, got %', jsonb_array_length(gems);
  END IF;
  IF (SELECT count(DISTINCT (g ->> 'seed')::bigint % 30) FROM jsonb_array_elements(gems) g) <> 30 THEN
    RAISE EXCEPTION 'BUG: a fresh load of 30 did not show all 30 families';
  END IF;
  IF (SELECT remaining FROM public.kayak_allowances WHERE user_id = pg_temp.u(1)) <> 0 THEN
    RAISE EXCEPTION 'BUG: the allowance was not spent';
  END IF;
  IF (SELECT max((g ->> 'seed')::bigint) FROM jsonb_array_elements(gems) g) >= 238878720 THEN
    RAISE EXCEPTION 'BUG: a seed is outside the engine space';
  END IF;

  BEGIN
    PERFORM public.load_gems(k, 1);
    RAISE EXCEPTION 'BUG: a Kayak took a 31st gem';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  k2 := public.save_kayak_look(NULL, pg_temp.look());
  BEGIN
    PERFORM public.load_gems(k2, 1);
    RAISE EXCEPTION 'BUG: loaded with no allowance left';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- A removed gem waits in stock, and is reused before any new one is made.
  PERFORM public.unload_gem(k, ((public.get_kayak(k) -> 'gems' -> 0) ->> 'id')::uuid);
  gems := public.load_gems(k2, 1);
  IF (SELECT count(*) FROM public.gems WHERE owner_id = pg_temp.u(1)) <> 30 THEN
    RAISE EXCEPTION 'BUG: a new gem was made while one sat in stock';
  END IF;

  -- The refill tops up; it doesn't add.
  UPDATE public.kayak_allowances SET remaining = 7, next_refill_at = now() - interval '1 day'
  WHERE user_id = pg_temp.u(1);
  left_ := public.kayak_topup(pg_temp.u(1));
  IF left_ <> 30 THEN
    RAISE EXCEPTION 'BUG: refill gave % instead of topping up to 30', left_;
  END IF;
  IF (SELECT next_refill_at <= now() FROM public.kayak_allowances WHERE user_id = pg_temp.u(1)) THEN
    RAISE EXCEPTION 'BUG: the next refill is not in the future';
  END IF;

  -- No refill for a lapsed member.
  UPDATE public.kayak_allowances SET remaining = 2, next_refill_at = now() - interval '1 day' WHERE user_id = pg_temp.u(1);
  UPDATE public.memberships SET access_until = now() - interval '1 hour' WHERE user_id = pg_temp.u(1);
  IF public.kayak_topup(pg_temp.u(1)) <> 2 THEN
    RAISE EXCEPTION 'BUG: a lapsed member got a refill';
  END IF;

  -- Trial: 5, then 30 the moment the trial has passed with access still live.
  UPDATE public.memberships SET keeper_since = now() - interval '2 days' WHERE user_id = pg_temp.u(2);
  IF public.kayak_topup(pg_temp.u(2)) <> 5 THEN
    RAISE EXCEPTION 'BUG: a trial member did not get 5';
  END IF;
  UPDATE public.kayak_allowances SET remaining = 1 WHERE user_id = pg_temp.u(2);
  UPDATE public.memberships SET keeper_since = now() - interval '7 days' WHERE user_id = pg_temp.u(2);
  IF public.kayak_topup(pg_temp.u(2)) <> 30 THEN
    RAISE EXCEPTION 'BUG: first payment did not raise the allowance to 30';
  END IF;
  UPDATE public.memberships SET keeper_since = now() - interval '40 days' WHERE user_id = pg_temp.u(2);

  -- Lifetime never counts as a trial.
  UPDATE public.memberships SET plan = 'lifetime', access_until = 'infinity', keeper_since = now() WHERE user_id = pg_temp.u(3);
  IF public.kayak_topup(pg_temp.u(3)) <> 30 THEN
    RAISE EXCEPTION 'BUG: a new lifetime member was treated as a trial';
  END IF;
  UPDATE public.memberships SET plan = 'monthly', keeper_since = now() - interval '40 days' WHERE user_id = pg_temp.u(3);

  RAISE NOTICE 'ok: 30 families, stock first, top-up not rollover, trial 5 then 30';
  PERFORM pg_temp.clear();
END $$;

-- Seeds never repeat, even if the generator lands on one already used.
DO $$
BEGIN
  INSERT INTO public.gems (seed, state) VALUES (42, 'stock');
  BEGIN
    INSERT INTO public.gems (seed, state) VALUES (42, 'stock');
    RAISE EXCEPTION 'BUG: two gems share a seed';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  PERFORM pg_temp.clear();
  RAISE NOTICE 'ok: UNIQUE (engine, seed) holds';
END $$;

-- ─── launch and the note screen ─────────────────────────────────────────────
DO $$
DECLARE
  k UUID;
  v UUID;
  n UUID;
BEGIN
  PERFORM pg_temp.as_user(1);
  k := public.save_kayak_look(NULL, pg_temp.look());
  BEGIN
    PERFORM public.launch_kayak(k, 'Hello?');
    RAISE EXCEPTION 'BUG: launched with no gems';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  PERFORM public.load_gems(k, 3);

  INSERT INTO public.blocked_terms (pattern) VALUES ('kayaktestblockword') ON CONFLICT DO NOTHING;
  BEGIN
    PERFORM public.launch_kayak(k, 'hello kayaktestblockword');
    RAISE EXCEPTION 'BUG: the blocklist let a note through';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  IF EXISTS (SELECT 1 FROM public.voyages WHERE kayak_id = k) THEN
    RAISE EXCEPTION 'BUG: a blocked note left a voyage behind';
  END IF;

  -- Fail closed: no verdict, no sailing, however long it takes.
  v := public.launch_kayak(k, 'What did the sea teach you?');
  PERFORM pg_temp.server();
  PERFORM public.advance_kayaks();
  IF (SELECT state FROM public.voyages WHERE id = v) <> 'screening' THEN
    RAISE EXCEPTION 'BUG: an unscreened note sailed';
  END IF;
  PERFORM pg_temp.as_user(1);
  BEGIN
    PERFORM public.save_kayak_look(k, pg_temp.look());
    RAISE EXCEPTION 'BUG: a look changed after launch';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    PERFORM public.launch_kayak(k, 'twice');
    RAISE EXCEPTION 'BUG: launched twice';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- Held: at the mast, gems aboard, the owner told why.
  n := (SELECT id FROM public.kayak_notes WHERE voyage_id = v);
  PERFORM public.apply_kayak_screen('kayak_notes', n, 'held', 'contact');
  IF (SELECT state FROM public.voyages WHERE id = v) <> 'home'
     OR (SELECT count(*) FROM public.gems WHERE kayak_id = k AND state = 'aboard') <> 3 THEN
    RAISE EXCEPTION 'BUG: a held note did not leave the Kayak ready at the mast';
  END IF;
  IF (public.get_harbour() -> 'notices' -> 0 ->> 'reason') <> 'contact' THEN
    RAISE EXCEPTION 'BUG: the owner was not told why';
  END IF;
  IF public.apply_kayak_screen('kayak_notes', n, 'ok') <> 'already_screened' THEN
    RAISE EXCEPTION 'BUG: a second verdict was applied';
  END IF;
  PERFORM public.ack_kayak_notice('note', n);
  IF jsonb_array_length(public.get_harbour() -> 'notices') <> 0 THEN
    RAISE EXCEPTION 'BUG: an acknowledged notice came back';
  END IF;

  -- Crisis: same, with no strike and no queue item.
  v := public.launch_kayak(k, 'I cannot do this any more');
  PERFORM public.apply_kayak_screen('kayak_notes', (SELECT id FROM public.kayak_notes WHERE voyage_id = v), 'crisis');
  IF (public.get_harbour() -> 'notices' -> 0 ->> 'reason') <> 'crisis' THEN
    RAISE EXCEPTION 'BUG: crisis notice missing';
  END IF;
  IF EXISTS (SELECT 1 FROM public.moderation_queue) THEN
    RAISE EXCEPTION 'BUG: a crisis note was queued';
  END IF;

  -- Passing starts the first leg, a full hour from launch.
  v := public.launch_kayak(k, 'Second try');
  PERFORM public.apply_kayak_screen('kayak_notes', (SELECT id FROM public.kayak_notes WHERE voyage_id = v), 'ok');
  IF (SELECT state FROM public.voyages WHERE id = v) <> 'sailing'
     OR (SELECT sail_until FROM public.voyages WHERE id = v) < now() + interval '59 minutes' THEN
    RAISE EXCEPTION 'BUG: the first leg is not a full hour';
  END IF;
  PERFORM pg_temp.server();
  PERFORM public.advance_kayaks();
  IF (SELECT state FROM public.voyages WHERE id = v) <> 'sailing' THEN
    RAISE EXCEPTION 'BUG: arrived before the delay';
  END IF;

  RAISE NOTICE 'ok: gems required, blocklist, fail-closed, held and crisis stay ashore, delay';
  PERFORM pg_temp.clear();

  -- A rewrite loop can't keep calling the screen.
  PERFORM pg_temp.as_user(1);
  k := public.save_kayak_look(NULL, pg_temp.look());
  PERFORM public.load_gems(k, 1);
  FOR i IN 1..20 LOOP
    v := public.launch_kayak(k, 'Attempt number ' || i);
    PERFORM public.apply_kayak_screen('kayak_notes', (SELECT id FROM public.kayak_notes WHERE voyage_id = v), 'held', 'spam');
  END LOOP;
  BEGIN
    PERFORM public.launch_kayak(k, 'One too many');
    RAISE EXCEPTION 'BUG: the daily note limit did not hold';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  RAISE NOTICE 'ok: 20 notes a day';
  PERFORM pg_temp.clear();
END $$;

-- ─── who receives it ────────────────────────────────────────────────────────
DO $$
DECLARE
  v   UUID;
  vi  public.kayak_visits%ROWTYPE;
  seen UUID[] := '{}';
  v2  UUID;
  v3  UUID;
  v4  UUID;
BEGIN
  -- Eligible: 02–10. 11 is free, 12 unconfirmed, 01 the owner.
  v := pg_temp.sail(1, 20);
  FOR i IN 1..9 LOOP
    PERFORM pg_temp.arrive(v);
    PERFORM pg_temp.server();
    SELECT * INTO vi FROM public.kayak_visits WHERE voyage_id = v AND left_at IS NULL;
    IF vi.recipient_id IN (pg_temp.u(1), pg_temp.u(11), pg_temp.u(12)) THEN
      RAISE EXCEPTION 'BUG: an ineligible member received a Kayak (%)', vi.recipient_id;
    END IF;
    IF vi.recipient_id = ANY (seen) THEN
      RAISE EXCEPTION 'BUG: a harbour repeated before everyone had a turn';
    END IF;
    seen := seen || vi.recipient_id;
    PERFORM pg_temp.as_user(right(vi.recipient_id::text, 2)::int);
    PERFORM public.wave_on(vi.id);
  END LOOP;

  -- Everyone's had a turn, all just now. The 24h rule makes it wait...
  PERFORM pg_temp.server();
  PERFORM pg_temp.due();
  PERFORM public.advance_kayaks();
  IF (SELECT state FROM public.voyages WHERE id = v) <> 'sailing' THEN
    RAISE EXCEPTION 'BUG: revisited a harbour within 24 hours of leaving it';
  END IF;
  -- ...then a new round begins.
  UPDATE public.kayak_visits SET left_at = now() - interval '25 hours' WHERE voyage_id = v;
  PERFORM pg_temp.arrive(v);
  RAISE NOTICE 'ok: only eligible, no repeats until all visited, then a new round';
  PERFORM pg_temp.clear();

  -- Only the owner is paid: it keeps sailing.
  UPDATE public.memberships SET access_until = now() - interval '10 days' WHERE user_id <> pg_temp.u(1);
  v := pg_temp.sail(1);
  PERFORM pg_temp.server();
  PERFORM pg_temp.due();
  PERFORM public.advance_kayaks();
  IF (SELECT state FROM public.voyages WHERE id = v) <> 'sailing' THEN
    RAISE EXCEPTION 'BUG: nobody to visit, and yet it is not sailing';
  END IF;
  RAISE NOTICE 'ok: alone at sea, it waits';
  PERFORM pg_temp.clear();

  -- One harbour left: holds only 1 from any owner.
  UPDATE public.memberships SET access_until = now() - interval '10 days'
  WHERE user_id NOT IN (pg_temp.u(1), pg_temp.u(2), pg_temp.u(3), pg_temp.u(4), pg_temp.u(5));
  -- 01 sails two Kayaks; 05 is made the only possible harbour by blocks.
  INSERT INTO public.kayak_blocks (blocker_id, blocked_id) VALUES
    (pg_temp.u(2), pg_temp.u(1)), (pg_temp.u(3), pg_temp.u(1)), (pg_temp.u(4), pg_temp.u(1));
  v  := pg_temp.sail(1);
  v2 := pg_temp.sail(1);
  PERFORM pg_temp.server();
  PERFORM pg_temp.due();
  PERFORM public.advance_kayaks();
  IF (SELECT count(*) FROM public.kayak_visits WHERE left_at IS NULL AND recipient_id = pg_temp.u(5)) <> 1
     OR (SELECT count(*) FROM public.kayak_visits WHERE left_at IS NULL) <> 1 THEN
    RAISE EXCEPTION 'BUG: two Kayaks of one owner in one harbour, or a block ignored';
  END IF;
  RAISE NOTICE 'ok: blocks respected, 1 per owner';
  PERFORM pg_temp.clear();

  -- 01–04 each send one, and 05 is the only eligible harbour for all of them.
  UPDATE public.memberships SET access_until = now() - interval '10 days'
  WHERE user_id NOT IN (pg_temp.u(1), pg_temp.u(2), pg_temp.u(3), pg_temp.u(4), pg_temp.u(5));
  INSERT INTO public.kayak_blocks (blocker_id, blocked_id)
  SELECT pg_temp.u(a), pg_temp.u(b) FROM generate_series(1, 4) a, generate_series(1, 4) b WHERE a <> b;
  v  := pg_temp.sail(1);
  v2 := pg_temp.sail(2);
  v3 := pg_temp.sail(3);
  v4 := pg_temp.sail(4);
  PERFORM pg_temp.server();
  PERFORM pg_temp.due();
  PERFORM public.advance_kayaks();
  IF (SELECT count(*) FROM public.kayak_visits WHERE left_at IS NULL AND recipient_id = pg_temp.u(5)) <> 3 THEN
    RAISE EXCEPTION 'BUG: harbour limit of 3 not held';
  END IF;
  IF (SELECT count(*) FROM public.voyages WHERE state = 'sailing') <> 1 THEN
    RAISE EXCEPTION 'BUG: the fourth Kayak should keep sailing';
  END IF;
  PERFORM pg_temp.as_user(5);
  IF jsonb_array_length(public.get_harbour() -> 'visitors') <> 3 THEN
    RAISE EXCEPTION 'BUG: the harbour does not show its 3 visitors';
  END IF;
  RAISE NOTICE 'ok: 3 at a time, the rest wait at sea';
  PERFORM pg_temp.clear();
END $$;

-- ─── the exchange ───────────────────────────────────────────────────────────
DO $$
DECLARE
  v    UUID;
  vi   UUID;
  g    UUID;
  c    UUID;
  who  UUID;
  n    UUID;
  res  JSONB;
BEGIN
  v := pg_temp.sail(1, 2);
  vi := pg_temp.arrive(v);
  who := (SELECT recipient_id FROM public.kayak_visits WHERE id = vi);
  g := pg_temp.gem_of(v);

  res := public.get_visit(vi);
  IF (res ->> 'note') <> 'What did the sea teach you?' OR jsonb_array_length(res -> 'gems') <> 2 THEN
    RAISE EXCEPTION 'BUG: the visit does not show the note and gems';
  END IF;

  BEGIN
    PERFORM public.leave_comment(vi, g, 'short');
    RAISE EXCEPTION 'BUG: a too-short comment went through';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- Someone else can't act on this visit.
  PERFORM pg_temp.as_user(11);
  BEGIN
    PERFORM public.get_visit(vi);
    RAISE EXCEPTION 'BUG: a free member read a visit';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM pg_temp.as_user(1);
  BEGIN
    PERFORM public.wave_on(vi);
    RAISE EXCEPTION 'BUG: the owner acted on a visit';
  EXCEPTION WHEN no_data_found THEN NULL;
  END;

  PERFORM pg_temp.as_user(right(who::text, 2)::int);
  PERFORM public.leave_comment(vi, g, 'Patience, mostly. And tides.');
  c := (SELECT id FROM public.kayak_comments WHERE visit_id = vi);

  -- It moved at once, the gem is on its way, and the comment isn't public.
  IF (SELECT state FROM public.voyages WHERE id = v) <> 'sailing' THEN
    RAISE EXCEPTION 'BUG: a comment did not start the next leg';
  END IF;
  IF (SELECT sail_until FROM public.voyages WHERE id = v) < now() + interval '59 minutes' THEN
    RAISE EXCEPTION 'BUG: the next leg skipped the delay';
  END IF;
  IF (SELECT state FROM public.gems WHERE id = g) <> 'reserved' THEN
    RAISE EXCEPTION 'BUG: the gem should be on its way';
  END IF;
  IF (public.get_treasure() -> 0 ->> 'state') <> 'reserved' THEN
    RAISE EXCEPTION 'BUG: an on-its-way gem is not in the treasure list';
  END IF;
  BEGIN
    PERFORM public.leave_comment(vi, pg_temp.gem_of(v), 'A second comment, same visit');
    RAISE EXCEPTION 'BUG: two gems taken in one visit';
  EXCEPTION WHEN no_data_found THEN NULL;
  END;
  PERFORM pg_temp.as_user(1);
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(public.get_kayak((SELECT kayak_id FROM public.voyages WHERE id = v)) -> 'log' -> 0 -> 'notes' -> 0 -> 'comments')) THEN
    RAISE EXCEPTION 'BUG: an unscreened comment reached the owner';
  END IF;

  -- Passing: gem kept, comment public, for the next harbour and the owner.
  PERFORM public.apply_kayak_screen('kayak_comments', c, 'ok');
  IF (SELECT state FROM public.gems WHERE id = g) <> 'kept' THEN
    RAISE EXCEPTION 'BUG: a passed comment did not keep its gem';
  END IF;
  vi := pg_temp.arrive(v);
  res := public.get_visit(vi);
  IF jsonb_array_length(res -> 'guestbook') <> 1 OR (res -> 'guestbook' -> 0 ->> 'body') <> 'Patience, mostly. And tides.' THEN
    RAISE EXCEPTION 'BUG: the next harbour does not see the guestbook';
  END IF;

  -- Taking the last gem sends it home, and home is an hour away.
  PERFORM public.leave_comment(vi, pg_temp.gem_of(v), 'That the shore is always moving.');
  IF (SELECT state FROM public.voyages WHERE id = v) <> 'returning'
     OR (SELECT end_reason FROM public.voyages WHERE id = v) <> 'empty' THEN
    RAISE EXCEPTION 'BUG: an empty Kayak is not heading home';
  END IF;
  PERFORM public.apply_kayak_screen('kayak_comments', (SELECT id FROM public.kayak_comments WHERE visit_id = vi), 'ok');
  PERFORM pg_temp.server();
  PERFORM public.advance_kayaks();
  IF (SELECT state FROM public.voyages WHERE id = v) <> 'returning' THEN
    RAISE EXCEPTION 'BUG: arrived home before the delay';
  END IF;
  PERFORM pg_temp.due();
  PERFORM public.advance_kayaks();
  IF (SELECT state FROM public.voyages WHERE id = v) <> 'home' THEN
    RAISE EXCEPTION 'BUG: never got home';
  END IF;
  RAISE NOTICE 'ok: moves at send, gem on its way, kept on pass, guestbook public, home when empty';
  PERFORM pg_temp.clear();

  -- A held comment: never shown, gem back aboard while it's at sea.
  v := pg_temp.sail(1, 3);
  vi := pg_temp.arrive(v);
  g := pg_temp.gem_of(v);
  PERFORM public.leave_comment(vi, g, 'Some abusive thing in words.');
  c := (SELECT id FROM public.kayak_comments WHERE visit_id = vi);
  who := (SELECT recipient_id FROM public.kayak_visits WHERE id = vi);
  PERFORM public.apply_kayak_screen('kayak_comments', c, 'held', 'harm');
  IF (SELECT state FROM public.gems WHERE id = g) <> 'aboard' OR (SELECT holder_id FROM public.gems WHERE id = g) IS NOT NULL THEN
    RAISE EXCEPTION 'BUG: a held comment''s gem did not return to the Kayak';
  END IF;
  PERFORM pg_temp.as_user(right(who::text, 2)::int);
  IF (public.get_harbour() -> 'notices' -> 0 ->> 'reason') <> 'harm' THEN
    RAISE EXCEPTION 'BUG: the commenter was not told';
  END IF;
  IF jsonb_array_length(public.get_treasure()) <> 0 THEN
    RAISE EXCEPTION 'BUG: a held comment''s gem is in the treasure room';
  END IF;

  -- A held comment after the Kayak has gone home: gem to the owner's stock.
  PERFORM pg_temp.as_user(1);
  vi := pg_temp.arrive(v);
  g := pg_temp.gem_of(v);
  PERFORM public.leave_comment(vi, g, 'Another abusive thing here.');
  c := (SELECT id FROM public.kayak_comments WHERE visit_id = vi);
  PERFORM pg_temp.as_user(1);
  PERFORM public.recall_kayak((SELECT kayak_id FROM public.voyages WHERE id = v));
  PERFORM public.apply_kayak_screen('kayak_comments', c, 'held', 'spam');
  IF (SELECT state FROM public.gems WHERE id = g) <> 'stock' OR (SELECT kayak_id FROM public.gems WHERE id = g) IS NOT NULL THEN
    RAISE EXCEPTION 'BUG: the gem should have gone to the owner''s stock';
  END IF;
  RAISE NOTICE 'ok: held comments hidden, gem returned to the Kayak or to stock';
  PERFORM pg_temp.clear();

  -- A queued hold keeps the gem reserved until an admin rules.
  INSERT INTO public.admins (user_id) VALUES (pg_temp.u(10)) ON CONFLICT DO NOTHING;
  UPDATE public.memberships SET access_until = now() - interval '10 days' WHERE user_id = pg_temp.u(10);
  v := pg_temp.sail(1, 3);
  vi := pg_temp.arrive(v);
  g := pg_temp.gem_of(v);
  PERFORM public.leave_comment(vi, g, 'Ambiguous, needs a human.');
  c := (SELECT id FROM public.kayak_comments WHERE visit_id = vi);
  PERFORM public.apply_kayak_screen('kayak_comments', c, 'held', 'review');
  IF (SELECT state FROM public.gems WHERE id = g) <> 'reserved' THEN
    RAISE EXCEPTION 'BUG: a review hold released the gem';
  END IF;
  PERFORM pg_temp.as_user(10);
  PERFORM public.admin_moderate((SELECT id FROM public.moderation_queue WHERE target_id = c), 'restore');
  IF (SELECT state FROM public.gems WHERE id = g) <> 'kept'
     OR (SELECT screen FROM public.kayak_comments WHERE id = c) <> 'ok' THEN
    RAISE EXCEPTION 'BUG: admin restore did not clear the comment and keep the gem';
  END IF;

  vi := pg_temp.arrive(v);
  g := pg_temp.gem_of(v);
  PERFORM public.leave_comment(vi, g, 'Also ambiguous, needs a human.');
  c := (SELECT id FROM public.kayak_comments WHERE visit_id = vi);
  PERFORM public.apply_kayak_screen('kayak_comments', c, 'held', 'review');
  PERFORM pg_temp.as_user(10);
  PERFORM public.admin_moderate((SELECT id FROM public.moderation_queue WHERE target_id = c), 'remove');
  IF (SELECT state FROM public.gems WHERE id = g) <> 'aboard' THEN
    RAISE EXCEPTION 'BUG: admin remove did not return the gem';
  END IF;
  RAISE NOTICE 'ok: review holds wait for an admin; restore keeps, remove returns';
  PERFORM pg_temp.clear();
END $$;

-- ─── fail-closed for notes and comments ─────────────────────────────────────
DO $$
DECLARE
  v  UUID;
  vi UUID;
  c  UUID;
  k  UUID;
BEGIN
  -- Never got a verdict: 6 tries, then held for review.
  PERFORM pg_temp.as_user(1);
  k := public.save_kayak_look(NULL, pg_temp.look());
  PERFORM public.load_gems(k, 2);
  v := public.launch_kayak(k, 'Is anyone there?');
  PERFORM pg_temp.server();
  UPDATE public.kayak_notes SET created_at = now() - interval '10 minutes', screen_attempts = 6 WHERE voyage_id = v;
  PERFORM public.rescreen_pending();
  IF (SELECT screen_reason FROM public.kayak_notes WHERE voyage_id = v) <> 'review'
     OR (SELECT state FROM public.voyages WHERE id = v) <> 'home' THEN
    RAISE EXCEPTION 'BUG: an unscreenable note was not held for review';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.moderation_queue WHERE kind = 'kayak_note') THEN
    RAISE EXCEPTION 'BUG: an unscreenable note was not queued';
  END IF;
  PERFORM pg_temp.clear();

  v := pg_temp.sail(1, 2);
  vi := pg_temp.arrive(v);
  PERFORM public.leave_comment(vi, pg_temp.gem_of(v), 'A comment the screen never saw.');
  c := (SELECT id FROM public.kayak_comments WHERE visit_id = vi);
  PERFORM pg_temp.server();
  UPDATE public.kayak_comments SET created_at = now() - interval '10 minutes', screen_attempts = 2 WHERE id = c;
  PERFORM public.rescreen_pending();
  IF (SELECT screen_attempts FROM public.kayak_comments WHERE id = c) <> 3 OR (SELECT screen FROM public.kayak_comments WHERE id = c) IS NOT NULL THEN
    RAISE EXCEPTION 'BUG: a pending comment was not retried';
  END IF;
  UPDATE public.kayak_comments SET screen_attempts = 6 WHERE id = c;
  PERFORM public.rescreen_pending();
  IF (SELECT screen_reason FROM public.kayak_comments WHERE id = c) <> 'review' THEN
    RAISE EXCEPTION 'BUG: an unscreenable comment was not held for review';
  END IF;
  RAISE NOTICE 'ok: fail-closed after 6 tries';
  PERFORM pg_temp.clear();
END $$;

-- ─── visits ending on their own ─────────────────────────────────────────────
DO $$
DECLARE
  v  UUID;
  vi UUID;
BEGIN
  v := pg_temp.sail(1, 2);
  vi := pg_temp.arrive(v);
  PERFORM pg_temp.server();
  PERFORM public.advance_kayaks();
  IF (SELECT left_at FROM public.kayak_visits WHERE id = vi) IS NOT NULL THEN
    RAISE EXCEPTION 'BUG: a visit ended early';
  END IF;
  UPDATE public.kayak_visits SET arrived_at = now() - interval '24 hours' WHERE id = vi;
  PERFORM public.advance_kayaks();
  IF (SELECT left_reason FROM public.kayak_visits WHERE id = vi) <> 'expired' THEN
    RAISE EXCEPTION 'BUG: a visit outlasted 24 hours';
  END IF;
  IF (SELECT state FROM public.voyages WHERE id = v) <> 'sailing'
     OR (SELECT sail_until FROM public.voyages WHERE id = v) < now() + interval '59 minutes' THEN
    RAISE EXCEPTION 'BUG: an expired visit did not sail on with the delay';
  END IF;

  -- A recipient who lapses gets no grace.
  vi := pg_temp.arrive(v);
  UPDATE public.memberships SET access_until = now() - interval '1 second'
  WHERE user_id = (SELECT recipient_id FROM public.kayak_visits WHERE id = vi);
  IF jsonb_array_length(public.get_harbour() -> 'visitors') <> 0 THEN
    RAISE EXCEPTION 'BUG: a lapsed recipient still sees a visitor';
  END IF;
  PERFORM pg_temp.server();
  PERFORM public.advance_kayaks();
  IF (SELECT left_reason FROM public.kayak_visits WHERE id = vi) <> 'ineligible' THEN
    RAISE EXCEPTION 'BUG: a lapsed recipient kept the Kayak';
  END IF;
  RAISE NOTICE 'ok: 24h expiry and recipient lapse both sail on';
  PERFORM pg_temp.clear();
END $$;

-- ─── the owner lapsing ──────────────────────────────────────────────────────
DO $$
DECLARE
  v  UUID;
  k  UUID;
  vi UUID;
BEGIN
  v := pg_temp.sail(1, 3);
  k := (SELECT kayak_id FROM public.voyages WHERE id = v);
  vi := pg_temp.arrive(v);

  -- Within 3 days: keeps sailing, but creating stops.
  UPDATE public.memberships SET access_until = now() - interval '2 days' WHERE user_id = pg_temp.u(1);
  PERFORM pg_temp.server();
  PERFORM public.advance_kayaks();
  IF (SELECT state FROM public.voyages WHERE id = v) <> 'visiting' THEN
    RAISE EXCEPTION 'BUG: the grace was not honoured';
  END IF;
  PERFORM pg_temp.as_user(1);
  BEGIN
    PERFORM public.save_kayak_look(NULL, pg_temp.look());
    RAISE EXCEPTION 'BUG: built during the grace';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.edit_note(k, 'a late edit');
    RAISE EXCEPTION 'BUG: edited during the grace';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- Past 3 days: home, gems to stock, relaunch required.
  UPDATE public.memberships SET access_until = now() - interval '3 days' WHERE user_id = pg_temp.u(1);
  PERFORM pg_temp.server();
  PERFORM public.advance_kayaks();
  IF (SELECT state FROM public.voyages WHERE id = v) <> 'returning'
     OR (SELECT end_reason FROM public.voyages WHERE id = v) <> 'lapsed'
     OR (SELECT left_at FROM public.kayak_visits WHERE id = vi) IS NULL THEN
    RAISE EXCEPTION 'BUG: a lapsed owner''s Kayak did not head home';
  END IF;
  IF (SELECT count(*) FROM public.gems WHERE owner_id = pg_temp.u(1) AND state = 'stock') <> 3 THEN
    RAISE EXCEPTION 'BUG: unpicked gems did not go to stock';
  END IF;
  PERFORM pg_temp.due();
  PERFORM public.advance_kayaks();
  IF (SELECT state FROM public.voyages WHERE id = v) <> 'home' THEN
    RAISE EXCEPTION 'BUG: never got home';
  END IF;

  -- They still see it at the mast, with an empty hold.
  PERFORM pg_temp.as_user(1);
  IF (public.get_harbour() -> 'kayaks' -> 0 ->> 'state') <> 'home' THEN
    RAISE EXCEPTION 'BUG: a lapsed member lost sight of their Kayak';
  END IF;
  RAISE NOTICE 'ok: 3-day grace, then home with gems in stock';
  PERFORM pg_temp.clear();

  -- A suspended owner's Kayak can't be read, even before the cron gets there.
  v := pg_temp.sail(1, 3);
  vi := pg_temp.arrive(v);
  UPDATE public.profiles SET suspended_at = now() WHERE id = pg_temp.u(1);
  BEGIN
    PERFORM public.get_visit(vi);
    RAISE EXCEPTION 'BUG: read a suspended owner''s note';
  EXCEPTION WHEN no_data_found THEN NULL;
  END;
  PERFORM pg_temp.server();
  PERFORM public.advance_kayaks();
  IF (SELECT end_reason FROM public.voyages WHERE id = v) <> 'suspended' THEN
    RAISE EXCEPTION 'BUG: a suspended owner''s Kayak kept sailing';
  END IF;
  RAISE NOTICE 'ok: suspended owners are out at once';
  PERFORM pg_temp.clear();
END $$;

-- ─── the owner at sea: recall and edit ──────────────────────────────────────
DO $$
DECLARE
  v   UUID;
  k   UUID;
  vi  UUID;
  n2  UUID;
  res JSONB;
BEGIN
  v := pg_temp.sail(1, 5);
  k := (SELECT kayak_id FROM public.voyages WHERE id = v);
  vi := pg_temp.arrive(v);
  PERFORM public.leave_comment(vi, pg_temp.gem_of(v), 'An answer to the first note.');
  PERFORM public.apply_kayak_screen('kayak_comments', (SELECT id FROM public.kayak_comments WHERE visit_id = vi), 'ok');
  vi := pg_temp.arrive(v);

  -- An edit stays pending, and the old note stays live until it passes.
  PERFORM pg_temp.as_user(1);
  PERFORM public.edit_note(k, 'A better question?');
  n2 := (SELECT id FROM public.kayak_notes WHERE voyage_id = v AND screen IS NULL);
  BEGIN
    PERFORM public.edit_note(k, 'And another');
    RAISE EXCEPTION 'BUG: two edits pending at once';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  PERFORM pg_temp.as_user(right((SELECT recipient_id FROM public.kayak_visits WHERE id = vi)::text, 2)::int);
  res := public.get_visit(vi);
  IF (res ->> 'note') <> 'What did the sea teach you?' OR jsonb_array_length(res -> 'guestbook') <> 1 THEN
    RAISE EXCEPTION 'BUG: an unscreened edit went live';
  END IF;

  -- Held: the old note and guestbook carry on, and the owner is told.
  PERFORM public.apply_kayak_screen('kayak_notes', n2, 'held', 'contact');
  res := public.get_visit(vi);
  IF (res ->> 'note') <> 'What did the sea teach you?' THEN
    RAISE EXCEPTION 'BUG: a held edit replaced the note';
  END IF;

  -- Passed: new note, fresh guestbook, the old comment in the owner's log.
  PERFORM pg_temp.as_user(1);
  PERFORM public.edit_note(k, 'A better question?');
  n2 := (SELECT id FROM public.kayak_notes WHERE voyage_id = v AND screen IS NULL);
  PERFORM public.apply_kayak_screen('kayak_notes', n2, 'ok');
  PERFORM pg_temp.as_user(right((SELECT recipient_id FROM public.kayak_visits WHERE id = vi)::text, 2)::int);
  res := public.get_visit(vi);
  IF (res ->> 'note') <> 'A better question?' OR jsonb_array_length(res -> 'guestbook') <> 0 THEN
    RAISE EXCEPTION 'BUG: a passed edit did not start a fresh guestbook';
  END IF;
  PERFORM pg_temp.as_user(1);
  res := public.get_kayak(k);
  IF jsonb_array_length(res -> 'log' -> 0 -> 'notes') <> 2
     OR jsonb_array_length(res -> 'log' -> 0 -> 'notes' -> 0 -> 'comments') <> 1 THEN
    RAISE EXCEPTION 'BUG: the old note and comment did not stay in the owner''s log';
  END IF;

  -- Three edits a voyage (the held one counts).
  PERFORM public.edit_note(k, 'Third');
  PERFORM public.apply_kayak_screen('kayak_notes', (SELECT id FROM public.kayak_notes WHERE voyage_id = v AND screen IS NULL), 'ok');
  BEGIN
    PERFORM public.edit_note(k, 'Fourth');
    RAISE EXCEPTION 'BUG: a fourth edit';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- Calling home: visit over, gems to stock, a full leg home.
  PERFORM public.recall_kayak(k);
  IF (SELECT state FROM public.voyages WHERE id = v) <> 'returning'
     OR (SELECT left_reason FROM public.kayak_visits WHERE id = vi) <> 'recalled'
     OR (SELECT count(*) FROM public.gems WHERE owner_id = pg_temp.u(1) AND state = 'stock') <> 4 THEN
    RAISE EXCEPTION 'BUG: recall did not end the visit and return the gems';
  END IF;
  RAISE NOTICE 'ok: edit stays pending, held keeps the old note, passed starts fresh, 3 edits, recall';
  PERFORM pg_temp.clear();
END $$;

-- ─── reports and blocks ─────────────────────────────────────────────────────
DO $$
DECLARE
  v    UUID;
  vi   UUID;
  who  UUID;
  c    UUID;
  n    UUID;
BEGIN
  -- Reporting a note: home, queued, and that owner never reaches this reporter again.
  v := pg_temp.sail(1, 3);
  vi := pg_temp.arrive(v);
  who := (SELECT recipient_id FROM public.kayak_visits WHERE id = vi);
  n := (SELECT id FROM public.kayak_notes WHERE voyage_id = v);
  PERFORM public.report_note(vi, 'harassment');
  IF (SELECT state FROM public.voyages WHERE id = v) <> 'returning'
     OR (SELECT end_reason FROM public.voyages WHERE id = v) <> 'reported' THEN
    RAISE EXCEPTION 'BUG: a reported note kept sailing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.moderation_queue WHERE kind = 'kayak_note' AND target_id = n AND source = 'report') THEN
    RAISE EXCEPTION 'BUG: a reported note was not queued';
  END IF;
  PERFORM pg_temp.as_user(1);
  IF EXISTS (SELECT 1 FROM public.kayak_reports WHERE reporter_id = pg_temp.u(1)) THEN
    RAISE EXCEPTION 'BUG: report recorded the wrong way round';
  END IF;
  PERFORM pg_temp.server();
  UPDATE public.memberships SET access_until = now() - interval '10 days'
  WHERE user_id NOT IN (pg_temp.u(1), who);
  IF public.kayak_pick_recipient(gen_random_uuid(), pg_temp.u(1)) IS NOT NULL THEN
    RAISE EXCEPTION 'BUG: the reporter can still receive this owner';
  END IF;
  RAISE NOTICE 'ok: note report sends it home, queues it, excludes the reporter';
  PERFORM pg_temp.clear();

  -- A note reported 3 times in 30 days suspends, the same as bottles.
  FOR i IN 1..3 LOOP
    v := pg_temp.sail(1, 1);
    vi := pg_temp.arrive(v);
    PERFORM public.report_note(vi, 'spam');
  END LOOP;
  IF (SELECT suspended_at FROM public.profiles WHERE id = pg_temp.u(1)) IS NULL THEN
    RAISE EXCEPTION 'BUG: 3 reported notes did not suspend';
  END IF;
  RAISE NOTICE 'ok: 3 strikes from notes suspend';
  PERFORM pg_temp.clear();

  -- Reporting a comment: hidden from everyone, queued, and the gem stays.
  v := pg_temp.sail(1, 3);
  vi := pg_temp.arrive(v);
  who := (SELECT recipient_id FROM public.kayak_visits WHERE id = vi);
  PERFORM public.leave_comment(vi, pg_temp.gem_of(v), 'A comment someone will report.');
  c := (SELECT id FROM public.kayak_comments WHERE visit_id = vi);
  PERFORM public.apply_kayak_screen('kayak_comments', c, 'ok');
  vi := pg_temp.arrive(v);

  -- Only someone who can see it may report it.
  PERFORM pg_temp.as_user(11);
  IF public.report_comment(c, 'spam') THEN
    RAISE EXCEPTION 'BUG: a stranger reported a comment';
  END IF;

  PERFORM pg_temp.as_user(1);
  IF NOT public.report_comment(c, 'harassment') THEN
    RAISE EXCEPTION 'BUG: the owner could not report a comment';
  END IF;
  IF jsonb_array_length(public.get_kayak((SELECT kayak_id FROM public.voyages WHERE id = v)) -> 'log' -> 0 -> 'notes' -> 0 -> 'comments') <> 0 THEN
    RAISE EXCEPTION 'BUG: a reported comment is still showing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.kayak_blocks WHERE blocker_id = pg_temp.u(1) AND blocked_id = who) THEN
    RAISE EXCEPTION 'BUG: an owner''s report did not keep that commenter away';
  END IF;
  PERFORM pg_temp.as_user(right((SELECT recipient_id FROM public.kayak_visits WHERE id = vi)::text, 2)::int);
  IF jsonb_array_length(public.get_visit(vi) -> 'guestbook') <> 0 THEN
    RAISE EXCEPTION 'BUG: a reported comment is still in the guestbook';
  END IF;
  IF (SELECT state FROM public.gems WHERE comment_id = c) <> 'kept' THEN
    RAISE EXCEPTION 'BUG: reporting took the gem back';
  END IF;
  RAISE NOTICE 'ok: comment report hides it for all, keeps the gem, owner report blocks';
  PERFORM pg_temp.clear();

  -- Block: sails on, both ways, and undoing clears it.
  v := pg_temp.sail(1, 3);
  vi := pg_temp.arrive(v);
  who := (SELECT recipient_id FROM public.kayak_visits WHERE id = vi);
  PERFORM public.block_visit(vi);
  IF (SELECT left_reason FROM public.kayak_visits WHERE id = vi) <> 'blocked'
     OR (SELECT state FROM public.voyages WHERE id = v) <> 'sailing' THEN
    RAISE EXCEPTION 'BUG: a block did not send the Kayak on';
  END IF;
  IF public.unblock_all_kayaks() <> 1 THEN
    RAISE EXCEPTION 'BUG: unblock did not clear the block';
  END IF;
  RAISE NOTICE 'ok: block sails on, unblock clears';
  PERFORM pg_temp.clear();

  -- Admin "suspend" pulls a live note, sends the Kayak home and suspends its owner.
  v := pg_temp.sail(1, 3);
  vi := pg_temp.arrive(v);
  n := (SELECT id FROM public.kayak_notes WHERE voyage_id = v);
  PERFORM public.enqueue_moderation('kayak_note', n, 'report', 'other', TRUE);
  PERFORM pg_temp.as_user(10); -- an admin since the section above
  IF (public.admin_queue() -> 0 ->> 'text') <> 'What did the sea teach you?' THEN
    RAISE EXCEPTION 'BUG: the admin queue does not show the note';
  END IF;
  IF public.admin_moderate((SELECT id FROM public.moderation_queue WHERE target_id = n), 'suspend') <> 'suspended' THEN
    RAISE EXCEPTION 'BUG: admin suspend failed';
  END IF;
  IF (SELECT screen FROM public.kayak_notes WHERE id = n) <> 'held'
     OR (SELECT end_reason FROM public.voyages WHERE id = v) <> 'removed'
     OR (SELECT suspended_at FROM public.profiles WHERE id = pg_temp.u(1)) IS NULL THEN
    RAISE EXCEPTION 'BUG: admin suspend did not pull the note, send it home and suspend';
  END IF;
  RAISE NOTICE 'ok: admin suspend removes a live note, sends it home, suspends';
  PERFORM pg_temp.clear();
END $$;

-- ─── fixes from review (064) ────────────────────────────────────────────────
DO $$
DECLARE
  v  UUID;
  k  UUID;
  vi UUID;
  c  UUID;
  n1 UUID;
  n2 UUID;
BEGIN
  -- Refill dates, including clamped month ends.
  IF public.kayak_next_refill('2031-01-31 10:00+00', '2031-02-28 11:00+00') <> '2031-03-31 10:00+00'
     OR public.kayak_next_refill('2031-01-31 10:00+00', '2031-02-28 09:00+00') <> '2031-02-28 10:00+00'
     OR public.kayak_next_refill('2031-01-15 10:00+00', '2031-01-15 10:00+00') <> '2031-02-15 10:00+00'
     OR public.kayak_next_refill('2028-02-29 10:00+00', '2031-03-01 00:00+00') <> '2031-03-29 10:00+00' THEN
    RAISE EXCEPTION 'BUG: wrong refill date';
  END IF;
  FOR i IN 0..400 LOOP
    IF public.kayak_next_refill('2031-01-31 10:00+00', timestamptz '2031-01-31 10:00+00' + make_interval(days => i, hours => 1))
       <= timestamptz '2031-01-31 10:00+00' + make_interval(days => i, hours => 1) THEN
      RAISE EXCEPTION 'BUG: a refill date landed in the past on day %', i;
    END IF;
  END LOOP;

  -- Extra keys in a look are refused, wherever they try to hide.
  PERFORM pg_temp.as_user(1);
  BEGIN
    PERFORM public.save_kayak_look(NULL, pg_temp.look() || '{"x":"insta @me"}');
    RAISE EXCEPTION 'BUG: free text got into a look';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;

  -- A dismissed report brings the comment back and takes the strike away.
  INSERT INTO public.admins (user_id) VALUES (pg_temp.u(10)) ON CONFLICT DO NOTHING;
  UPDATE public.memberships SET access_until = now() - interval '10 days' WHERE user_id = pg_temp.u(10);
  v := pg_temp.sail(1, 3);
  k := (SELECT kayak_id FROM public.voyages WHERE id = v);
  vi := pg_temp.arrive(v);
  PERFORM public.leave_comment(vi, pg_temp.gem_of(v), 'A perfectly harmless comment.');
  c := (SELECT id FROM public.kayak_comments WHERE visit_id = vi);
  PERFORM public.apply_kayak_screen('kayak_comments', c, 'ok');
  PERFORM pg_temp.as_user(1);
  PERFORM public.report_comment(c, 'spam');
  PERFORM pg_temp.as_user(10);
  PERFORM public.admin_moderate((SELECT id FROM public.moderation_queue WHERE target_id = c), 'dismiss');
  IF (SELECT reported_at FROM public.kayak_comments WHERE id = c) IS NOT NULL THEN
    RAISE EXCEPTION 'BUG: a dismissed report still hides the comment';
  END IF;
  PERFORM pg_temp.as_user(1);
  IF jsonb_array_length(public.get_kayak(k) -> 'log' -> 0 -> 'notes' -> 0 -> 'comments') <> 1 THEN
    RAISE EXCEPTION 'BUG: the dismissed comment did not come back';
  END IF;

  -- A comment passing after the owner looked still counts as new.
  UPDATE public.kayaks SET log_seen_at = now() - interval '1 minute' WHERE id = k;
  UPDATE public.kayak_comments SET created_at = now() - interval '5 minutes', screened_at = now() WHERE id = c;
  IF (public.get_harbour() -> 'kayaks' -> 0 ->> 'new_comments')::int <> 1 THEN
    RAISE EXCEPTION 'BUG: a comment that passed after the last look was not counted';
  END IF;
  PERFORM pg_temp.clear();

  -- Restoring an old held edit can't replace a newer note.
  v := pg_temp.sail(1, 3);
  k := (SELECT kayak_id FROM public.voyages WHERE id = v);
  PERFORM pg_temp.as_user(1);
  PERFORM public.edit_note(k, 'Edit A, needs a human');
  n1 := (SELECT id FROM public.kayak_notes WHERE voyage_id = v AND screen IS NULL);
  PERFORM public.apply_kayak_screen('kayak_notes', n1, 'held', 'review');
  PERFORM public.edit_note(k, 'Edit B, the latest');
  n2 := (SELECT id FROM public.kayak_notes WHERE voyage_id = v AND screen IS NULL);
  UPDATE public.kayak_notes SET created_at = now() + interval '1 minute' WHERE id = n2;
  PERFORM public.apply_kayak_screen('kayak_notes', n2, 'ok');
  PERFORM pg_temp.as_user(10);
  PERFORM public.admin_moderate((SELECT id FROM public.moderation_queue WHERE target_id = n1), 'restore');
  IF public.kayak_current_note(v) <> n2 THEN
    RAISE EXCEPTION 'BUG: an old restored edit replaced the newer note';
  END IF;

  -- A held notice says whether a moderator has decided yet.
  PERFORM pg_temp.clear();
  v := pg_temp.sail(1, 3);
  vi := pg_temp.arrive(v);
  PERFORM public.leave_comment(vi, pg_temp.gem_of(v), 'Ambiguous, needs a human.');
  c := (SELECT id FROM public.kayak_comments WHERE visit_id = vi);
  PERFORM public.apply_kayak_screen('kayak_comments', c, 'held', 'review');
  PERFORM pg_temp.as_user(right((SELECT author_id FROM public.kayak_comments WHERE id = c)::text, 2)::int);
  IF NOT (public.get_harbour() -> 'notices' -> 0 ->> 'waiting')::boolean THEN
    RAISE EXCEPTION 'BUG: an undecided hold should say waiting';
  END IF;
  n1 := (SELECT author_id FROM public.kayak_comments WHERE id = c);
  PERFORM pg_temp.as_user(10);
  PERFORM public.admin_moderate((SELECT id FROM public.moderation_queue WHERE target_id = c), 'remove');
  PERFORM pg_temp.as_user(right(n1::text, 2)::int);
  IF (public.get_harbour() -> 'notices' -> 0 ->> 'waiting')::boolean THEN
    RAISE EXCEPTION 'BUG: a decided hold still says waiting';
  END IF;
  PERFORM pg_temp.clear();

  -- A moved Kayak ignores a late next leg, and keeps its course.
  v := pg_temp.sail(1, 3);
  vi := pg_temp.arrive(v);
  PERFORM pg_temp.as_user(1);
  PERFORM public.recall_kayak((SELECT kayak_id FROM public.voyages WHERE id = v));
  PERFORM public.kayak_next_leg(v);
  IF (SELECT state FROM public.voyages WHERE id = v) <> 'returning' THEN
    RAISE EXCEPTION 'BUG: a late next leg overrode a recall';
  END IF;
  PERFORM pg_temp.clear();

  -- No comments on a Kayak whose owner is out, even before the cron gets there.
  v := pg_temp.sail(1, 3);
  vi := pg_temp.arrive(v);
  UPDATE public.profiles SET suspended_at = now() WHERE id = pg_temp.u(1);
  BEGIN
    PERFORM public.leave_comment(vi, pg_temp.gem_of(v), 'Commenting on a suspended owner.');
    RAISE EXCEPTION 'BUG: commented on a suspended owner''s Kayak';
  EXCEPTION WHEN no_data_found THEN NULL;
  END;
  RAISE NOTICE 'ok: refill dates, look keys, dismiss, new comments, old edits, notices, late legs';
  PERFORM pg_temp.clear();
END $$;

-- ─── what a client can see ──────────────────────────────────────────────────
DO $$
DECLARE
  v    UUID;
  vi   UUID;
  who  UUID;
  k    UUID;
  dump TEXT;
BEGIN
  v := pg_temp.sail(1, 3);
  k := (SELECT kayak_id FROM public.voyages WHERE id = v);
  vi := pg_temp.arrive(v);
  who := (SELECT recipient_id FROM public.kayak_visits WHERE id = vi);
  UPDATE public.profiles SET city = 'Lisbon' WHERE id = who;
  PERFORM public.leave_comment(vi, pg_temp.gem_of(v), 'A perfectly fine comment here.');
  PERFORM public.apply_kayak_screen('kayak_comments', (SELECT id FROM public.kayak_comments WHERE visit_id = vi), 'ok');
  vi := pg_temp.arrive(v);
  who := (SELECT recipient_id FROM public.kayak_visits WHERE id = vi);

  dump := public.get_visit(vi)::text || public.get_harbour()::text || public.get_treasure()::text;
  IF dump LIKE '%' || pg_temp.u(1)::text || '%' THEN
    RAISE EXCEPTION 'BUG: a visitor can see the owner''s id';
  END IF;
  PERFORM pg_temp.as_user(1);
  dump := public.get_kayak(k)::text || public.get_harbour()::text;
  IF dump LIKE '%' || who::text || '%'
     OR EXISTS (SELECT 1 FROM public.kayak_comments c WHERE dump LIKE '%' || c.author_id::text || '%') THEN
    RAISE EXCEPTION 'BUG: the owner can see a commenter''s or recipient''s id';
  END IF;

  -- The city copied at arrival, shown only while it's there.
  UPDATE public.kayak_visits SET city = 'Lisbon' WHERE id = vi;
  IF (public.get_harbour() -> 'kayaks' -> 0 ->> 'city') <> 'Lisbon' THEN
    RAISE EXCEPTION 'BUG: the owner does not see the city';
  END IF;
  PERFORM public.recall_kayak(k);
  IF (public.get_harbour() -> 'kayaks' -> 0 ->> 'city') IS NOT NULL THEN
    RAISE EXCEPTION 'BUG: a city showed while it was not visiting';
  END IF;

  -- A free member gets the same answer shape, and it's empty.
  PERFORM pg_temp.as_user(11);
  IF (public.get_harbour() ->> 'keeper')::boolean
     OR jsonb_array_length(public.get_harbour() -> 'kayaks') <> 0
     OR jsonb_array_length(public.get_harbour() -> 'visitors') <> 0 THEN
    RAISE EXCEPTION 'BUG: a free member''s harbour is not empty';
  END IF;
  RAISE NOTICE 'ok: no ids leak, city only while visiting, free harbour empty';
END $$;

-- Tables are closed to clients, and internals uncallable.
SET LOCAL role authenticated;
DO $$
DECLARE
  t TEXT;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-000000006301', 'role', 'authenticated')::text, true);
  FOREACH t IN ARRAY ARRAY['kayaks', 'voyages', 'kayak_notes', 'kayak_visits', 'kayak_comments', 'gems', 'kayak_allowances'] LOOP
    BEGIN
      EXECUTE format('SELECT 1 FROM public.%I LIMIT 1', t);
      RAISE EXCEPTION 'BUG: a client read %', t;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
  END LOOP;
  BEGIN
    PERFORM public.advance_kayaks();
    RAISE EXCEPTION 'BUG: a client ran the sailing engine';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.apply_kayak_screen('kayak_notes', gen_random_uuid(), 'ok');
    RAISE EXCEPTION 'BUG: a client applied a screen verdict';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE public.profiles SET city = 'Atlantis' WHERE id = '00000000-0000-4000-8000-000000006301';
    RAISE EXCEPTION 'BUG: a client set their own city';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RAISE NOTICE 'ok: tables, engine, verdicts and city closed to clients';
END $$;
RESET role;

ROLLBACK;
