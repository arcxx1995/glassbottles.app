-- Runnable check for migrations 052 and 053 (explicit terms, pulled-crisis strikes).
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/052_crisis_not_delivered.test.sql
-- Runs inside one transaction and rolls back.

BEGIN;

-- A: adult sender. B: adult receiver. C: suspended adult.
INSERT INTO auth.users (id, email, email_confirmed_at, raw_user_meta_data) VALUES
  ('00000000-0000-4000-8000-000000000520', 'crisis-a@example.invalid', now(), '{"age_confirmed": true}'),
  ('00000000-0000-4000-8000-000000000521', 'crisis-b@example.invalid', now(), '{"age_confirmed": true}'),
  ('00000000-0000-4000-8000-000000000522', 'crisis-c@example.invalid', now(), '{"age_confirmed": true}');
UPDATE public.profiles SET timezone = 'UTC'
WHERE id::text LIKE '00000000-0000-4000-8000-00000000052%';
UPDATE public.profiles SET suspended_at = now()
WHERE id = '00000000-0000-4000-8000-000000000522';
-- Keep the matcher's pool to this test's users.
UPDATE public.profiles SET age_confirmed_at = NULL
WHERE id::text NOT LIKE '00000000-0000-4000-8000-00000000052%';

-- A crisis bottle: ashore, day restored, words back with reason 'crisis',
-- never matched, no strike, no queue entry.
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000520","role":"authenticated"}', true);
DO $$
DECLARE
  b UUID := (public.send_bottle('i don''t want to be here anymore') ->> 'id')::uuid;
  s JSONB;
BEGIN
  RESET role;
  PERFORM set_config('request.jwt.claims', '', true);
  IF public.apply_screen(b, 'crisis') <> 'held' THEN
    RAISE EXCEPTION 'BUG: crisis verdict not held';
  END IF;
  IF (SELECT NOT is_stale OR screen <> 'held' OR screen_reason <> 'crisis' FROM public.bottles WHERE id = b) THEN
    RAISE EXCEPTION 'BUG: a crisis bottle is still in the water';
  END IF;
  UPDATE public.bottles SET sent_at = now() - interval '2 hours' WHERE id = b;
  IF (public.match_bottle(b) ->> 'matched')::boolean
     OR (SELECT received_at FROM public.bottles WHERE id = b) IS NOT NULL THEN
    RAISE EXCEPTION 'BUG: the matcher delivered a crisis bottle';
  END IF;
  IF EXISTS (SELECT 1 FROM public.moderation_queue WHERE target_id = b) THEN
    RAISE EXCEPTION 'BUG: a crisis bottle was queued as a violation';
  END IF;
  -- Two more crisis bottles in 30 days must not suspend (strikes are for violations).
  INSERT INTO public.bottles (sender_id, message, sent_at, day_key, screen, screen_reason, is_stale)
  SELECT '00000000-0000-4000-8000-000000000520', 'old', now() - make_interval(days => d), current_date - d, 'held', 'crisis', TRUE
  FROM generate_series(3, 4) d;
  PERFORM public.record_strike('00000000-0000-4000-8000-000000000520', 'harm');
  IF (SELECT suspended_at FROM public.profiles WHERE id = '00000000-0000-4000-8000-000000000520') IS NOT NULL THEN
    RAISE EXCEPTION 'BUG: crisis holds counted as strikes';
  END IF;

  SET LOCAL role authenticated;
  PERFORM set_config('request.jwt.claims',
    '{"sub":"00000000-0000-4000-8000-000000000520","role":"authenticated"}', true);
  s := public.get_today_bottle_status();
  IF (s -> 'quota' ->> 'has_sent')::boolean THEN
    RAISE EXCEPTION 'BUG: the day''s throw was not restored after a crisis hold';
  END IF;
  IF s -> 'heldBottle' ->> 'screen_reason' <> 'crisis' THEN
    RAISE EXCEPTION 'BUG: crisis bottle not handed back: %', s -> 'heldBottle';
  END IF;
  PERFORM public.ack_held_bottle(b);

  -- A pulled crisis bottle (is_reported, as 052 does to old deliveries) is
  -- not a strike either.
  RESET role;
  UPDATE public.bottles SET is_reported = TRUE WHERE sender_id = '00000000-0000-4000-8000-000000000520';
  PERFORM public.record_strike('00000000-0000-4000-8000-000000000520', 'harm');
  IF (SELECT suspended_at FROM public.profiles WHERE id = '00000000-0000-4000-8000-000000000520') IS NOT NULL THEN
    RAISE EXCEPTION 'BUG: pulled crisis bottles counted as strikes';
  END IF;
  SET LOCAL role authenticated;
  RAISE NOTICE 'ok: crisis → ashore, day restored, handed back, no strike, never matched';
END;
$$;

-- precheck_message: the blocklist for the signed-in writer, before submit.
DO $$
BEGIN
  IF NOT public.precheck_message('send me your nudes') THEN
    RAISE EXCEPTION 'BUG: precheck missed a blocklisted phrase';
  END IF;
  -- 052's explicit terms, incl. the review's exact message.
  IF NOT public.precheck_message('I want to commit suicide, I want to fuck your pussy')
     OR NOT public.precheck_message('so horny tonight')
     OR NOT public.precheck_message('send porn') THEN
    RAISE EXCEPTION 'BUG: precheck missed an explicit term from 052';
  END IF;
  IF public.precheck_message('a cocktail at the cumulative end of summer') THEN
    RAISE EXCEPTION 'BUG: word boundaries broke (cocktail / cumulative)';
  END IF;
  IF public.precheck_message('the tide came in slow today') THEN
    RAISE EXCEPTION 'BUG: precheck flagged an ordinary message';
  END IF;
  RAISE NOTICE 'ok: precheck matches the blocklist';
END;
$$;

SELECT set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000522","role":"authenticated"}', true);
DO $$
BEGIN
  PERFORM public.precheck_message('hello');
  RAISE EXCEPTION 'BUG: a suspended user passed the precheck';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'ok: precheck refuses suspended users';
END;
$$;

RESET role;
SET LOCAL role anon;
DO $$
BEGIN
  PERFORM public.precheck_message('hello');
  RAISE EXCEPTION 'BUG: anon can call precheck_message';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'ok: precheck is for signed-in users only';
END;
$$;

ROLLBACK;
