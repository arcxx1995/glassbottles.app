-- Runnable check for migration 051.
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/051_moderation_hardening.test.sql
-- Runs inside one transaction and rolls back.

BEGIN;

-- A: adult sender (confirmed via sign-up metadata). B: adult receiver.
-- C: never confirmed 18+. D: admin.
INSERT INTO auth.users (id, email, email_confirmed_at, raw_user_meta_data) VALUES
  ('00000000-0000-4000-8000-000000000510', 'mod-a@example.invalid', now(), '{"age_confirmed": true}'),
  ('00000000-0000-4000-8000-000000000511', 'mod-b@example.invalid', now(), '{"age_confirmed": true}'),
  ('00000000-0000-4000-8000-000000000512', 'mod-c@example.invalid', now(), '{}'),
  ('00000000-0000-4000-8000-000000000513', 'mod-d@example.invalid', now(), '{"age_confirmed": true}');
UPDATE public.profiles SET timezone = 'UTC'
WHERE id::text LIKE '00000000-0000-4000-8000-00000000051%';
-- Keep the matcher's pool to this test's users.
UPDATE public.profiles SET age_confirmed_at = NULL
WHERE id::text NOT LIKE '00000000-0000-4000-8000-00000000051%';
INSERT INTO public.admins (user_id) VALUES ('00000000-0000-4000-8000-000000000513');

DO $$
BEGIN
  IF (SELECT age_confirmed_at FROM public.profiles WHERE id = '00000000-0000-4000-8000-000000000510') IS NULL THEN
    RAISE EXCEPTION 'BUG: sign-up metadata age_confirmed did not stamp the profile';
  END IF;
  IF (SELECT age_confirmed_at FROM public.profiles WHERE id = '00000000-0000-4000-8000-000000000512') IS NOT NULL THEN
    RAISE EXCEPTION 'BUG: a sign-up without the 18+ box got confirmed';
  END IF;
  RAISE NOTICE 'ok: sign-up metadata stamps age + terms';
END $$;

-- ── Age gate ────────────────────────────────────────────────────────────────
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000512","role":"authenticated"}', true);
DO $$
BEGIN
  BEGIN
    PERFORM public.send_bottle('hello sea');
    RAISE EXCEPTION 'BUG: an unconfirmed user threw a bottle';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM <> 'age_unconfirmed' THEN RAISE; END IF;
  END;
  PERFORM public.accept_terms();
  IF (SELECT age_confirmed_at FROM public.profiles WHERE id = auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'BUG: accept_terms did not confirm';
  END IF;
  RAISE NOTICE 'ok: unconfirmed users cannot write; accept_terms confirms';
END $$;
RESET role;
UPDATE public.profiles SET age_confirmed_at = NULL WHERE id = '00000000-0000-4000-8000-000000000512';

-- ── Blocklist at submission ─────────────────────────────────────────────────
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000510","role":"authenticated"}', true);
DO $$
BEGIN
  BEGIN
    PERFORM public.send_bottle('send me your NUDES');
    RAISE EXCEPTION 'BUG: blocklisted bottle was accepted';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'content_not_allowed' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.send_bottle('just k y s lol, kys');
    RAISE EXCEPTION 'BUG: "kys" was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  RESET role; -- the helper itself is server-only
  -- Digit swaps are folded.
  IF NOT public.violates_blocklist('ch1ld p0rn') THEN
    RAISE EXCEPTION 'BUG: leetspeak got past the blocklist';
  END IF;
  -- Ordinary heavy words are not blocked at the door.
  IF public.violates_blocklist('I feel so lonely and I hate my job, damn it')
     OR public.violates_blocklist('my cat knocked over the rooster figurine') THEN
    RAISE EXCEPTION 'BUG: blocklist false positive';
  END IF;
  SET LOCAL role authenticated;
  RAISE NOTICE 'ok: blocklist rejects at submission, spares ordinary words';
END $$;

-- ── Fail-closed: no verdict, no delivery ───────────────────────────────────
DO $$
DECLARE
  b   JSONB := public.send_bottle('a quiet note for a stranger');
  bid UUID  := (b ->> 'id')::uuid;
  r   JSONB;
BEGIN
  RESET role;
  UPDATE public.bottles SET sent_at = now() - interval '2 hours' WHERE id = bid;
  r := public.match_bottle(bid);
  IF r ->> 'reason' <> 'awaiting screen' THEN
    RAISE EXCEPTION 'BUG: an unscreened bottle was matched: %', r;
  END IF;

  -- The cron re-sends it, then holds it for review after 6 tries.
  PERFORM public.rescreen_pending();
  IF (SELECT screen_attempts FROM public.bottles WHERE id = bid) <> 1 THEN
    RAISE EXCEPTION 'BUG: rescreen did not count an attempt';
  END IF;
  UPDATE public.bottles SET screen_attempts = 6 WHERE id = bid;
  PERFORM public.rescreen_pending();
  IF (SELECT screen || '/' || screen_reason FROM public.bottles WHERE id = bid) <> 'held/review' THEN
    RAISE EXCEPTION 'BUG: an exhausted bottle was not held for review';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.moderation_queue
                 WHERE kind = 'bottle' AND target_id = bid AND resolved_at IS NULL) THEN
    RAISE EXCEPTION 'BUG: held-for-review bottle missing from the queue';
  END IF;
  RAISE NOTICE 'ok: unscreened bottles wait; 6 misses → held for a human';
END $$;

SELECT set_config('request.jwt.claims', '', true); -- server-side from here
-- ── An ok verdict sails, only to a confirmed adult ─────────────────────────
DO $$
DECLARE
  bid UUID;
  r   JSONB;
BEGIN
  -- Server-side insert (no JWT): the account checks are for client writes.
  INSERT INTO public.bottles (sender_id, message, sent_at, day_key)
  VALUES ('00000000-0000-4000-8000-000000000510', 'ok verdict note', now() - interval '2 hours', current_date - 1)
  RETURNING id INTO bid;
  PERFORM public.apply_screen(bid, 'ok');
  r := public.match_bottle(bid);
  IF NOT (r ->> 'matched')::boolean
     OR r ->> 'receiver_id' NOT IN ('00000000-0000-4000-8000-000000000511', '00000000-0000-4000-8000-000000000513') THEN
    RAISE EXCEPTION 'BUG: screened bottle not delivered to a confirmed adult: %', r;
  END IF;
  RAISE NOTICE 'ok: screened bottle delivered; unconfirmed C never picked';
END $$;

-- ── Report → queue + strike; admin remove pulls it from the receiver ───────
DO $$
DECLARE
  bid UUID;
  rcv UUID;
  qid UUID;
BEGIN
  SELECT id, receiver_id INTO bid, rcv FROM public.bottles WHERE message = 'ok verdict note';
  PERFORM set_config('request.jwt.claims',
    format('{"sub":"%s","role":"authenticated"}', rcv), true);
  SET LOCAL role authenticated;
  BEGIN
    PERFORM public.report_bottle(bid, 'bogus');
    RAISE EXCEPTION 'BUG: unknown report reason accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  IF NOT public.report_bottle(bid, 'sexual') THEN
    RAISE EXCEPTION 'BUG: report failed';
  END IF;
  IF NOT public.report_bottle(bid) THEN
    RAISE EXCEPTION 'BUG: a repeat 1-arg report should still read as success';
  END IF;
  -- Non-admins can't see or act on the queue.
  BEGIN
    PERFORM public.admin_queue();
    RAISE EXCEPTION 'BUG: a non-admin read the queue';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET role;

  SELECT id INTO qid FROM public.moderation_queue
  WHERE kind = 'bottle' AND target_id = bid AND resolved_at IS NULL;
  IF qid IS NULL OR (SELECT reason FROM public.moderation_queue WHERE id = qid) <> 'sexual' THEN
    RAISE EXCEPTION 'BUG: report not queued with its reason';
  END IF;

  PERFORM set_config('request.jwt.claims',
    '{"sub":"00000000-0000-4000-8000-000000000513","role":"authenticated"}', true);
  SET LOCAL role authenticated;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(public.admin_queue()) e
                 WHERE e ->> 'id' = qid::text AND e ->> 'text' = 'ok verdict note'
                   AND NOT (e ? 'sender_id')) THEN
    RAISE EXCEPTION 'BUG: admin queue missing the item, or leaks the sender';
  END IF;
  IF public.admin_moderate(qid, 'remove') <> 'removed' THEN
    RAISE EXCEPTION 'BUG: admin remove failed';
  END IF;
  RESET role;
  IF (SELECT screen FROM public.bottles WHERE id = bid) <> 'held'
     OR NOT (SELECT is_reported FROM public.bottles WHERE id = bid) THEN
    RAISE EXCEPTION 'BUG: removed bottle still visible to its receiver';
  END IF;
  RAISE NOTICE 'ok: report queued with reason; admin-only queue; remove pulls it';
END $$;

SELECT set_config('request.jwt.claims', '', true); -- server-side from here
-- ── Strikes: 'minor' suspends at once; suspended users can't write ─────────
DO $$
DECLARE
  bid UUID;
BEGIN
  INSERT INTO public.bottles (sender_id, message, sent_at, day_key)
  VALUES ('00000000-0000-4000-8000-000000000511', 'drifting one', now(), current_date - 2),
         ('00000000-0000-4000-8000-000000000511', 'the bad one',  now(), current_date - 3);
  SELECT id INTO bid FROM public.bottles WHERE message = 'the bad one';
  PERFORM public.apply_screen(bid, 'held', 'minor');
  IF (SELECT suspended_at FROM public.profiles WHERE id = '00000000-0000-4000-8000-000000000511') IS NULL THEN
    RAISE EXCEPTION 'BUG: a minor verdict did not suspend';
  END IF;
  IF NOT (SELECT is_stale FROM public.bottles WHERE message = 'drifting one') THEN
    RAISE EXCEPTION 'BUG: a suspended user''s drifting bottle is still in the water';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.moderation_queue WHERE kind = 'user'
                 AND target_id = '00000000-0000-4000-8000-000000000511' AND resolved_at IS NULL) THEN
    RAISE EXCEPTION 'BUG: suspension not queued for review';
  END IF;
  RAISE NOTICE 'ok: minor → suspended, bottles pulled, queued';
END $$;

SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000511","role":"authenticated"}', true);
DO $$
BEGIN
  BEGIN
    PERFORM public.send_bottle('let me back in');
    RAISE EXCEPTION 'BUG: a suspended user threw a bottle';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM <> 'account_suspended' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'ok: suspended users cannot write';
END $$;
RESET role;

SELECT set_config('request.jwt.claims', '', true); -- server-side from here
-- Three sexual / harm holds inside 30 days suspend A.
DO $$
DECLARE
  i   INT;
  bid UUID;
BEGIN
  -- Start A from zero strikes (the report above counted one).
  UPDATE public.bottles SET is_reported = FALSE WHERE message = 'ok verdict note';
  FOR i IN 1..3 LOOP
    IF (SELECT suspended_at FROM public.profiles WHERE id = '00000000-0000-4000-8000-000000000510') IS NOT NULL THEN
      RAISE EXCEPTION 'BUG: suspended before the third strike (strike %)', i;
    END IF;
    INSERT INTO public.bottles (sender_id, message, sent_at, day_key)
    VALUES ('00000000-0000-4000-8000-000000000510', 'strike ' || i, now(), current_date - 10 - i)
    RETURNING id INTO bid;
    PERFORM public.apply_screen(bid, 'held', CASE WHEN i = 2 THEN 'harm' ELSE 'sexual' END);
  END LOOP;
  IF (SELECT suspended_at FROM public.profiles WHERE id = '00000000-0000-4000-8000-000000000510') IS NULL THEN
    RAISE EXCEPTION 'BUG: three strikes did not suspend';
  END IF;
  RAISE NOTICE 'ok: three strikes suspend';
END $$;

SELECT set_config('request.jwt.claims', '', true); -- server-side from here
-- ── Social: pre-moderated, blocklisted, 3 reports hide ─────────────────────
UPDATE public.profiles SET suspended_at = NULL
WHERE id IN ('00000000-0000-4000-8000-000000000510', '00000000-0000-4000-8000-000000000511');
INSERT INTO public.social_profiles (user_id, handle) VALUES
  ('00000000-0000-4000-8000-000000000510', 'mod_a'),
  ('00000000-0000-4000-8000-000000000511', 'mod_b'),
  ('00000000-0000-4000-8000-000000000512', 'mod_c'),
  ('00000000-0000-4000-8000-000000000513', 'mod_d');
UPDATE public.profiles SET age_confirmed_at = now() WHERE id = '00000000-0000-4000-8000-000000000512';

SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000510","role":"authenticated"}', true);
DO $$
BEGIN
  BEGIN
    INSERT INTO public.posts (author_id, body) VALUES (auth.uid(), 'who wants to sext? sexting anyone');
    RAISE EXCEPTION 'BUG: blocklisted post accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.social_profiles SET bio = 'kys' WHERE user_id = auth.uid();
    RAISE EXCEPTION 'BUG: blocklisted bio accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  INSERT INTO public.posts (author_id, body) VALUES (auth.uid(), 'first post, hello');
  IF NOT EXISTS (SELECT 1 FROM public.posts WHERE body = 'first post, hello') THEN
    RAISE EXCEPTION 'BUG: author cannot see their own unscreened post';
  END IF;
  RAISE NOTICE 'ok: social blocklist; author sees own pending post';
END $$;

SELECT set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000511","role":"authenticated"}', true);
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.posts WHERE body = 'first post, hello') THEN
    RAISE EXCEPTION 'BUG: an unscreened post is visible to others';
  END IF;
  RAISE NOTICE 'ok: unscreened posts hidden from others';
END $$;
RESET role;

DO $$
DECLARE
  pid UUID := (SELECT id FROM public.posts WHERE body = 'first post, hello');
  sid UUID;
BEGIN
  -- Social re-screen: a pending post counts an attempt; an exhausted one is
  -- held for review.
  UPDATE public.posts SET created_at = now() - interval '10 minutes' WHERE id = pid;
  PERFORM public.rescreen_pending();
  IF (SELECT screen_attempts FROM public.posts WHERE id = pid) <> 1 THEN
    RAISE EXCEPTION 'BUG: social rescreen did not count an attempt';
  END IF;
  INSERT INTO public.posts (author_id, body) VALUES ('00000000-0000-4000-8000-000000000510', 'never screened')
  RETURNING id INTO sid;
  UPDATE public.posts SET screen_attempts = 6 WHERE id = sid;
  PERFORM public.rescreen_pending();
  IF (SELECT screen || '/' || screen_reason FROM public.posts WHERE id = sid) <> 'held/review' THEN
    RAISE EXCEPTION 'BUG: exhausted post not held for review';
  END IF;

  PERFORM public.apply_social_screen('posts', pid, 'ok');
  INSERT INTO public.social_reports (reporter_id, target_type, target_id) VALUES
    ('00000000-0000-4000-8000-000000000511', 'post', pid),
    ('00000000-0000-4000-8000-000000000512', 'post', pid);
  IF (SELECT screen FROM public.posts WHERE id = pid) <> 'ok' THEN
    RAISE EXCEPTION 'BUG: two reports hid a post';
  END IF;
  INSERT INTO public.social_reports (reporter_id, target_type, target_id) VALUES
    ('00000000-0000-4000-8000-000000000513', 'post', pid);
  IF (SELECT screen || '/' || screen_reason FROM public.posts WHERE id = pid) <> 'held/review' THEN
    RAISE EXCEPTION 'BUG: three reports did not hide the post';
  END IF;
  IF (SELECT reports FROM public.moderation_queue WHERE kind = 'post' AND target_id = pid) <> 3 THEN
    RAISE EXCEPTION 'BUG: report count not tracked on the queue item';
  END IF;

  -- Bios and communities are screened; a held bio is cleared.
  UPDATE public.social_profiles SET bio = 'something rude' WHERE user_id = '00000000-0000-4000-8000-000000000511';
  PERFORM public.apply_social_screen('social_profiles', '00000000-0000-4000-8000-000000000511', 'held', 'harm');
  IF (SELECT bio FROM public.social_profiles WHERE user_id = '00000000-0000-4000-8000-000000000511') IS NOT NULL THEN
    RAISE EXCEPTION 'BUG: a held bio was not cleared';
  END IF;
  RAISE NOTICE 'ok: 3 reports hide; held bio cleared';
END $$;

-- Grants: the new tables are invisible to clients.
SET LOCAL role authenticated;
DO $$
BEGIN
  BEGIN
    PERFORM 1 FROM public.moderation_queue;
    RAISE EXCEPTION 'BUG: clients can read the moderation queue';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.admins (user_id) VALUES (auth.uid());
    RAISE EXCEPTION 'BUG: a client made themselves admin';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE public.profiles SET suspended_at = NULL, age_confirmed_at = now() WHERE id = auth.uid();
    RAISE EXCEPTION 'BUG: a client wrote its own moderation columns';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RAISE NOTICE 'ok: queue, admins and moderation columns are server-only';
END $$;
RESET role;

ROLLBACK;
