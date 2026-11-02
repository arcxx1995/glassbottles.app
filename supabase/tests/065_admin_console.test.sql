-- Runnable check for migration 065 (the admin console).
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/065_admin_console.test.sql
-- Runs inside one transaction and rolls back. now() is frozen for the whole run.

BEGIN;

ALTER TABLE public.profiles ALTER COLUMN age_confirmed_at SET DEFAULT now();
DELETE FROM public.memberships;

-- 01 admin · 02 sender · 03 receiver · 04 and 05 other members · 06 second admin to be
INSERT INTO auth.users (id, email, email_confirmed_at)
SELECT ('00000000-0000-4000-8000-0000000065' || lpad(g::text, 2, '0'))::uuid,
       'Admin.Test+' || g || '@gmail.com', now()
FROM generate_series(1, 6) g;
INSERT INTO public.admins (user_id) VALUES ('00000000-0000-4000-8000-000000006501');

CREATE FUNCTION pg_temp.u(n INT) RETURNS UUID LANGUAGE sql AS
  $$ SELECT ('00000000-0000-4000-8000-0000000065' || lpad(n::text, 2, '0'))::uuid $$;
CREATE FUNCTION pg_temp.as_user(n INT) RETURNS VOID LANGUAGE sql AS
  $$ SELECT set_config('request.jwt.claims', json_build_object('sub', pg_temp.u(n), 'role', 'authenticated')::text, true) $$;
CREATE FUNCTION pg_temp.server() RETURNS VOID LANGUAGE sql AS
  $$ SELECT set_config('request.jwt.claims', '', true) $$;
-- A bottle from 02, delivered to 03.
CREATE FUNCTION pg_temp.bottle(body TEXT DEFAULT 'A delivered bottle') RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE
  v UUID;
BEGIN
  PERFORM pg_temp.server();
  INSERT INTO public.bottles (sender_id, receiver_id, message, received_at, screen, day_key)
  VALUES (pg_temp.u(2), pg_temp.u(3), body, now(), 'ok', current_date - (random() * 5000)::int)
  RETURNING id INTO v;
  RETURN v;
END $$;
CREATE FUNCTION pg_temp.strikes(n INT) RETURNS INT LANGUAGE sql AS $$
  SELECT count(*)::int FROM public.bottles
  WHERE sender_id = pg_temp.u(n) AND is_reported
    AND NOT EXISTS (SELECT 1 FROM public.user_reports r WHERE r.kind = 'bottle' AND r.target_id = bottles.id
                    AND (r.status = 'dismissed' OR (r.status = 'open' AND NOT r.auto_applied)))
$$;
CREATE FUNCTION pg_temp.file(body TEXT DEFAULT 'A delivered bottle', reason TEXT DEFAULT 'harassment') RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE
  b UUID := pg_temp.bottle(body);
BEGIN
  PERFORM pg_temp.as_user(3);
  PERFORM public.report_bottle_for_review(b, reason);
  RETURN (SELECT id FROM public.user_reports WHERE kind = 'bottle' AND target_id = b);
END $$;

-- ─── filing ─────────────────────────────────────────────────────────────────
DO $$
DECLARE
  b UUID := pg_temp.bottle('Please read this');
  c UUID;
  r public.user_reports%ROWTYPE;
BEGIN
  PERFORM pg_temp.as_user(4);
  IF public.report_bottle_for_review(b, 'spam') THEN
    RAISE EXCEPTION 'BUG: someone reported a bottle that wasn''t theirs';
  END IF;

  PERFORM pg_temp.as_user(3);
  IF NOT public.report_bottle_for_review(b, 'harassment') THEN
    RAISE EXCEPTION 'BUG: the receiver could not report';
  END IF;
  PERFORM public.report_bottle_for_review(b, 'harassment'); -- a double tap
  SELECT * INTO r FROM public.user_reports WHERE kind = 'bottle' AND target_id = b;
  IF r.status <> 'open' OR r.evidence <> 'Please read this' OR r.subject_id <> pg_temp.u(2)
     OR r.reporter_id <> pg_temp.u(3) OR r.auto_applied OR r.urgent THEN
    RAISE EXCEPTION 'BUG: the report row is wrong: %', row_to_json(r);
  END IF;
  IF (SELECT count(*) FROM public.user_reports WHERE target_id = b) <> 1 THEN
    RAISE EXCEPTION 'BUG: a double tap filed twice';
  END IF;

  -- Off the reporter's shelf straight away, and nothing else yet.
  IF NOT (SELECT is_reported FROM public.bottles WHERE id = b) THEN
    RAISE EXCEPTION 'BUG: a report did not leave the shelf';
  END IF;
  IF pg_temp.strikes(2) <> 0 THEN
    RAISE EXCEPTION 'BUG: a report struck before an admin decided';
  END IF;
  IF EXISTS (SELECT 1 FROM public.moderation_queue WHERE target_id = b) THEN
    RAISE EXCEPTION 'BUG: a report landed in the AI queue';
  END IF;

  -- Urgent reasons are marked, and bad ones refused.
  c := pg_temp.file('Worrying', 'minor');
  IF NOT (SELECT urgent FROM public.user_reports WHERE id = c) THEN
    RAISE EXCEPTION 'BUG: "minor" was not urgent';
  END IF;
  c := pg_temp.file('Worrying too', 'danger');
  IF NOT (SELECT urgent FROM public.user_reports WHERE id = c) THEN
    RAISE EXCEPTION 'BUG: "danger" was not urgent';
  END IF;
  BEGIN
    PERFORM pg_temp.file('x', 'made_up');
    RAISE EXCEPTION 'BUG: an unknown reason was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- At most 20 a day (3 above, counting from here).
  FOR i IN 1..17 LOOP
    PERFORM pg_temp.file('Report ' || i);
  END LOOP;
  BEGIN
    PERFORM pg_temp.file('One too many');
    RAISE EXCEPTION 'BUG: the daily report limit did not hold';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  RAISE NOTICE 'ok: filing hides for the reporter only, no strike, urgent, limits';
  PERFORM pg_temp.server();
  DELETE FROM public.user_reports;
  DELETE FROM public.bottles WHERE sender_id = pg_temp.u(2);
END $$;

-- The live site's old path keeps working exactly as it did, and still shows.
DO $$
DECLARE
  b UUID := pg_temp.bottle('Old path');
BEGIN
  PERFORM pg_temp.as_user(3);
  IF NOT public.report_bottle(b, 'spam') THEN
    RAISE EXCEPTION 'BUG: report_bottle stopped working';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.moderation_queue WHERE kind = 'bottle' AND target_id = b AND source = 'report') THEN
    RAISE EXCEPTION 'BUG: the old path stopped queueing';
  END IF;
  IF NOT (SELECT auto_applied FROM public.user_reports WHERE target_id = b) THEN
    RAISE EXCEPTION 'BUG: the old path did not reach the console, marked as applied';
  END IF;
  IF pg_temp.strikes(2) <> 1 THEN
    RAISE EXCEPTION 'BUG: the old path lost its immediate strike';
  END IF;

  -- Deciding in the console closes the old queue's item, and dismissing takes back the strike.
  PERFORM pg_temp.as_user(1);
  PERFORM public.admin_decide_report((SELECT id FROM public.user_reports WHERE target_id = b), 'dismiss');
  IF pg_temp.strikes(2) <> 0 THEN
    RAISE EXCEPTION 'BUG: dismissing did not take back the strike';
  END IF;
  IF (SELECT resolved_at FROM public.moderation_queue WHERE target_id = b) IS NULL THEN
    RAISE EXCEPTION 'BUG: the old queue item stayed open';
  END IF;

  -- And deciding on the old page closes the console's case.
  b := pg_temp.bottle('Old path two');
  PERFORM pg_temp.as_user(3);
  PERFORM public.report_bottle(b, 'spam');
  PERFORM pg_temp.as_user(1);
  PERFORM public.admin_moderate((SELECT id FROM public.moderation_queue WHERE target_id = b), 'remove');
  IF (SELECT status FROM public.user_reports WHERE target_id = b) <> 'upheld' THEN
    RAISE EXCEPTION 'BUG: the old page left the console case open';
  END IF;
  RAISE NOTICE 'ok: the live site''s report_bottle is unchanged and stays in sync';
  PERFORM pg_temp.server();
  DELETE FROM public.user_reports;
  DELETE FROM public.bottles WHERE sender_id = pg_temp.u(2);
END $$;

-- ─── outcomes ───────────────────────────────────────────────────────────────
DO $$
DECLARE
  r UUID;
  b UUID;
  res JSONB;
BEGIN
  -- Dismiss: no strike, stays hidden for the reporter, reporter told.
  r := pg_temp.file('Harmless, really');
  b := (SELECT target_id FROM public.user_reports WHERE id = r);
  PERFORM pg_temp.as_user(1);
  res := public.admin_decide_report(r, 'dismiss');
  IF res ->> 'status' <> 'decided' OR (SELECT status FROM public.user_reports WHERE id = r) <> 'dismissed' THEN
    RAISE EXCEPTION 'BUG: dismiss did not decide';
  END IF;
  IF NOT (SELECT is_reported FROM public.bottles WHERE id = b) THEN
    RAISE EXCEPTION 'BUG: a dismissed bottle came back to the reporter';
  END IF;
  IF pg_temp.strikes(2) <> 0 THEN
    RAISE EXCEPTION 'BUG: dismiss struck';
  END IF;
  IF (SELECT body FROM public.account_notices WHERE user_id = pg_temp.u(3) ORDER BY created_at DESC LIMIT 1) NOT LIKE '%didn''t break our rules%' THEN
    RAISE EXCEPTION 'BUG: the reporter was not told';
  END IF;
  IF (public.admin_decide_report(r, 'ban', NULL, 'twice') ->> 'status') <> 'already_decided' THEN
    RAISE EXCEPTION 'BUG: a decided report was decided again';
  END IF;

  -- Every outcome but dismiss needs a reason.
  r := pg_temp.file('Needs a reason');
  PERFORM pg_temp.as_user(1);
  BEGIN
    PERFORM public.admin_decide_report(r, 'remove');
    RAISE EXCEPTION 'BUG: an outcome with no reason went through';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;

  -- Remove: gone for good, one strike, reporter told, nothing told to the sender.
  PERFORM public.admin_decide_report(r, 'remove', NULL, 'Abusive');
  b := (SELECT target_id FROM public.user_reports WHERE id = r);
  IF (SELECT screen FROM public.bottles WHERE id = b) <> 'held' OR pg_temp.strikes(2) <> 1 THEN
    RAISE EXCEPTION 'BUG: remove did not remove and strike';
  END IF;
  IF EXISTS (SELECT 1 FROM public.account_notices WHERE user_id = pg_temp.u(2)) THEN
    RAISE EXCEPTION 'BUG: plain remove told the sender';
  END IF;

  -- Warn: a notice, marked for email, with the rule but not the reporter.
  r := pg_temp.file('Warn this', 'contact');
  PERFORM pg_temp.as_user(1);
  PERFORM public.admin_decide_report(r, 'warn', NULL, 'Sharing details', 'Please keep it anonymous.');
  IF NOT EXISTS (SELECT 1 FROM public.account_notices
                 WHERE user_id = pg_temp.u(2) AND kind = 'warn' AND wants_email
                   AND body LIKE '%sharing contact details%' AND body LIKE '%Please keep it anonymous.%'
                   AND body LIKE '%hello@glassbottles.app%') THEN
    RAISE EXCEPTION 'BUG: the warning is wrong';
  END IF;

  -- Suspend: 7 or 30 days only, and it ends by itself.
  r := pg_temp.file('Suspend this');
  PERFORM pg_temp.as_user(1);
  BEGIN
    PERFORM public.admin_decide_report(r, 'suspend', 3, 'Bad');
    RAISE EXCEPTION 'BUG: a 3-day suspension was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  PERFORM public.admin_decide_report(r, 'suspend', 7, 'Repeated abuse');
  IF (SELECT suspended_at FROM public.profiles WHERE id = pg_temp.u(2)) IS NULL
     OR (SELECT suspended_until FROM public.profiles WHERE id = pg_temp.u(2)) <> now() + interval '7 days'
     OR public.person_status(pg_temp.u(2)) <> 'suspended' THEN
    RAISE EXCEPTION 'BUG: suspend did not suspend for 7 days';
  END IF;
  PERFORM public.admin_console_hourly();
  IF public.person_status(pg_temp.u(2)) <> 'suspended' THEN
    RAISE EXCEPTION 'BUG: a suspension ended early';
  END IF;
  UPDATE public.profiles SET suspended_until = now() - interval '1 minute' WHERE id = pg_temp.u(2);
  PERFORM public.admin_console_hourly();
  IF public.person_status(pg_temp.u(2)) <> 'active'
     OR NOT EXISTS (SELECT 1 FROM public.account_notices WHERE user_id = pg_temp.u(2) AND kind = 'lifted') THEN
    RAISE EXCEPTION 'BUG: an expired suspension did not end';
  END IF;

  RAISE NOTICE 'ok: dismiss, remove, warn, suspend and its expiry';
END $$;

-- ─── ban ────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  r UUID := pg_temp.file('Ban this');
BEGIN
  INSERT INTO auth.sessions (id, user_id) VALUES (gen_random_uuid(), pg_temp.u(2));
  PERFORM pg_temp.as_user(1);
  PERFORM public.admin_decide_report(r, 'ban', NULL, 'Serious abuse');
  IF public.person_status(pg_temp.u(2)) <> 'banned' THEN
    RAISE EXCEPTION 'BUG: not banned';
  END IF;
  IF (SELECT banned_until FROM auth.users WHERE id = pg_temp.u(2)) IS NULL THEN
    RAISE EXCEPTION 'BUG: sign-in was not blocked';
  END IF;
  IF (SELECT isfinite(banned_until) FROM auth.users WHERE id = pg_temp.u(2)) IS NOT TRUE THEN
    RAISE EXCEPTION 'BUG: the auth server can''t read an infinite banned_until';
  END IF;
  IF EXISTS (SELECT 1 FROM auth.sessions WHERE user_id = pg_temp.u(2)) THEN
    RAISE EXCEPTION 'BUG: their sessions survived';
  END IF;
  -- The expiry job leaves a ban alone.
  PERFORM public.admin_console_hourly();
  IF public.person_status(pg_temp.u(2)) <> 'banned' THEN
    RAISE EXCEPTION 'BUG: the hourly job lifted a ban';
  END IF;

  -- The address can't come back, spelled any way Gmail treats as the same inbox.
  PERFORM pg_temp.server();
  IF public.normalize_email('Ad.min.Te.st+anything@GoogleMail.com') <> 'admintest@gmail.com' THEN
    RAISE EXCEPTION 'BUG: email normalization: %', public.normalize_email('Ad.min.Te.st+anything@GoogleMail.com');
  END IF;
  IF public.normalize_email('some.one+x@example.org') <> 'some.one@example.org' THEN
    RAISE EXCEPTION 'BUG: normalization changed a non-Gmail local part';
  END IF;
  BEGIN
    INSERT INTO auth.users (id, email, email_confirmed_at)
    VALUES (gen_random_uuid(), 'admin.t.e.s.t+new@googlemail.com', now());
    RAISE EXCEPTION 'BUG: a banned email signed up again';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE auth.users SET email = 'admintest@gmail.com' WHERE id = pg_temp.u(5);
    RAISE EXCEPTION 'BUG: an account changed its email to a banned one';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  -- Nothing readable is kept.
  IF EXISTS (SELECT 1 FROM public.banned_emails WHERE email_hash LIKE '%@%') THEN
    RAISE EXCEPTION 'BUG: a readable email in the ban list';
  END IF;

  -- Lifting restores everything.
  PERFORM pg_temp.as_user(1);
  IF NOT public.admin_lift(pg_temp.u(2), 'Appeal accepted') THEN
    RAISE EXCEPTION 'BUG: lift failed';
  END IF;
  IF public.person_status(pg_temp.u(2)) <> 'active'
     OR (SELECT banned_until FROM auth.users WHERE id = pg_temp.u(2)) IS NOT NULL
     OR EXISTS (SELECT 1 FROM public.banned_emails) THEN
    RAISE EXCEPTION 'BUG: lifting did not restore the account';
  END IF;

  -- Nobody bans themselves.
  BEGIN
    PERFORM public.admin_act_on_person(pg_temp.u(1), 'ban', NULL, 'Oops');
    RAISE EXCEPTION 'BUG: an admin banned themselves';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  RAISE NOTICE 'ok: ban signs out, blocks sign-in and re-signup, lifting restores, no self-ban';
END $$;

-- ─── remove everything ──────────────────────────────────────────────────────
DO $$
DECLARE
  r UUID := pg_temp.file('The reported one');
  other UUID := pg_temp.bottle('An unreported one');
BEGIN
  PERFORM pg_temp.as_user(1);
  PERFORM public.admin_decide_report(r, 'remove', NULL, 'Reported only');
  IF (SELECT is_reported FROM public.bottles WHERE id = other) THEN
    RAISE EXCEPTION 'BUG: removing one took everything';
  END IF;
  r := pg_temp.file('Another reported one');
  PERFORM pg_temp.as_user(1);
  PERFORM public.admin_decide_report(r, 'remove', NULL, 'All of it', NULL, TRUE);
  IF NOT (SELECT is_reported FROM public.bottles WHERE id = other) THEN
    RAISE EXCEPTION 'BUG: remove-everything left a bottle';
  END IF;
  RAISE NOTICE 'ok: remove-everything is opt-in';
END $$;

-- ─── 3 strikes ──────────────────────────────────────────────────────────────
DO $$
DECLARE
  r UUID;
BEGIN
  -- The earlier sections' strikes suspended 02 with the switch on.
  UPDATE public.profiles SET suspended_at = NULL, suspended_until = NULL WHERE id IN (pg_temp.u(2), pg_temp.u(4));
  -- Off: a case, urgent, and no suspension.
  UPDATE public.app_settings SET auto_suspend_on_strikes = FALSE;
  DELETE FROM public.bottles WHERE sender_id = pg_temp.u(2);
  DELETE FROM public.user_reports;
  FOR i IN 1..3 LOOP
    r := pg_temp.file('Strike ' || i);
    PERFORM pg_temp.as_user(1);
    PERFORM public.admin_decide_report(r, 'remove', NULL, 'Upheld');
  END LOOP;
  IF public.person_status(pg_temp.u(2)) <> 'active' THEN
    RAISE EXCEPTION 'BUG: strikes suspended with the switch off';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_reports WHERE kind = 'strikes' AND subject_id = pg_temp.u(2) AND urgent AND status = 'open') THEN
    RAISE EXCEPTION 'BUG: 3 strikes did not reach the admin';
  END IF;
  -- Only one open at a time.
  PERFORM public.record_strike(pg_temp.u(2), 'report');
  IF (SELECT count(*) FROM public.user_reports WHERE kind = 'strikes' AND subject_id = pg_temp.u(2)) <> 1 THEN
    RAISE EXCEPTION 'BUG: a duplicate strikes case';
  END IF;
  -- Minor still suspends at once.
  PERFORM public.record_strike(pg_temp.u(4), 'minor');
  IF public.person_status(pg_temp.u(4)) <> 'suspended' THEN
    RAISE EXCEPTION 'BUG: a minor strike did not suspend';
  END IF;
  UPDATE public.profiles SET suspended_at = NULL WHERE id = pg_temp.u(4);

  -- On (today's setting): automatic, as the guidelines still say.
  UPDATE public.app_settings SET auto_suspend_on_strikes = TRUE;
  PERFORM public.record_strike(pg_temp.u(2), 'report');
  IF public.person_status(pg_temp.u(2)) <> 'suspended' THEN
    RAISE EXCEPTION 'BUG: strikes did not suspend with the switch on';
  END IF;
  PERFORM pg_temp.server();
  UPDATE public.profiles SET suspended_at = NULL, suspended_until = NULL WHERE id = pg_temp.u(2);
  DELETE FROM public.bottles WHERE sender_id = pg_temp.u(2);
  DELETE FROM public.user_reports;
  RAISE NOTICE 'ok: 3 strikes reach the admin, the switch works, minor always suspends';
END $$;

-- ─── blocks ─────────────────────────────────────────────────────────────────
DO $$
DECLARE
  b UUID := pg_temp.bottle('From someone unwelcome');
  r UUID;
BEGIN
  PERFORM pg_temp.as_user(4);
  IF public.block_bottle_sender(b) THEN
    RAISE EXCEPTION 'BUG: blocked from someone else''s bottle';
  END IF;
  PERFORM pg_temp.as_user(3);
  IF NOT public.block_bottle_sender(b) THEN
    RAISE EXCEPTION 'BUG: the receiver could not block';
  END IF;
  -- Instant.
  IF NOT EXISTS (SELECT 1 FROM public.kayak_blocks WHERE blocker_id = pg_temp.u(3) AND blocked_id = pg_temp.u(2)) THEN
    RAISE EXCEPTION 'BUG: the block wasn''t instant';
  END IF;
  r := (SELECT id FROM public.user_reports WHERE kind = 'block' AND reporter_id = pg_temp.u(3));
  IF r IS NULL THEN
    RAISE EXCEPTION 'BUG: the block didn''t reach the console';
  END IF;

  -- A new bottle from the sender skips the receiver who blocked them, both ways.
  PERFORM pg_temp.server();
  UPDATE public.profiles SET age_confirmed_at = NULL WHERE id NOT IN (pg_temp.u(2), pg_temp.u(3));
  DELETE FROM public.daily_quotas WHERE user_id IN (pg_temp.u(2), pg_temp.u(3));
  INSERT INTO public.bottles (id, sender_id, message, sent_at, screen, day_key)
  VALUES ('00000000-0000-4000-8000-0000000065b1', pg_temp.u(2), 'Try again', now() - interval '2 hours', 'ok', '2030-06-01');
  IF (public.match_bottle('00000000-0000-4000-8000-0000000065b1') ->> 'matched')::boolean THEN
    RAISE EXCEPTION 'BUG: a block didn''t stop a bottle';
  END IF;

  -- An admin keeps one, or removes it.
  PERFORM pg_temp.as_user(1);
  BEGIN
    PERFORM public.admin_decide_report(r, 'ban', NULL, 'Wrong tool');
    RAISE EXCEPTION 'BUG: decided a block as a report';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  IF NOT public.admin_remove_block(r, 'No reason for it') THEN
    RAISE EXCEPTION 'BUG: could not remove a block';
  END IF;
  IF EXISTS (SELECT 1 FROM public.kayak_blocks WHERE blocker_id = pg_temp.u(3) AND blocked_id = pg_temp.u(2)) THEN
    RAISE EXCEPTION 'BUG: the block is still there';
  END IF;

  -- With it gone, the same bottle reaches them.
  PERFORM pg_temp.server();
  IF NOT (public.match_bottle('00000000-0000-4000-8000-0000000065b1') ->> 'matched')::boolean THEN
    RAISE EXCEPTION 'BUG: a removed block still stopped a bottle';
  END IF;

  -- Blocking again reopens the same case; keeping closes it.
  PERFORM pg_temp.as_user(3);
  PERFORM public.block_bottle_sender(b);
  IF (SELECT status FROM public.user_reports WHERE id = r) <> 'open' THEN
    RAISE EXCEPTION 'BUG: a new block didn''t reopen review';
  END IF;
  PERFORM pg_temp.as_user(1);
  IF NOT public.admin_uphold_block(r, 'Fair enough') THEN
    RAISE EXCEPTION 'BUG: keeping a block failed';
  END IF;
  IF (SELECT outcome FROM public.user_reports WHERE id = r) <> 'block_kept' THEN
    RAISE EXCEPTION 'BUG: the kept block has the wrong outcome';
  END IF;
  RAISE NOTICE 'ok: blocks are instant, stop bottles both ways, and admins can review them';
  PERFORM pg_temp.server();
  UPDATE public.profiles SET age_confirmed_at = now();
  DELETE FROM public.kayak_blocks;
  DELETE FROM public.user_reports;
END $$;

-- ─── flags, identity, reads ─────────────────────────────────────────────────
DO $$
DECLARE
  r UUID := pg_temp.file('Reported words');
  f UUID;
  held UUID := pg_temp.bottle('Private words nobody reported');
  p JSONB;
  e TEXT;
BEGIN
  UPDATE public.bottles SET screen = 'held', screen_reason = 'harm' WHERE id = (SELECT id FROM public.bottles WHERE message = 'Reported words');
  PERFORM pg_temp.as_user(1);
  f := public.admin_flag(pg_temp.u(2), 'Watch this one');
  IF NOT (public.admin_reports() -> 0 ->> 'subject_flagged')::boolean THEN
    RAISE EXCEPTION 'BUG: a flag doesn''t show on the case';
  END IF;

  p := public.admin_person(pg_temp.u(2));
  e := (SELECT email FROM auth.users WHERE id = pg_temp.u(2));
  -- History yes; email no; unreported words no.
  IF p::text LIKE '%' || e || '%' THEN
    RAISE EXCEPTION 'BUG: a profile leaks the email without a reveal';
  END IF;
  IF p::text LIKE '%Private words nobody reported%' THEN
    RAISE EXCEPTION 'BUG: an unreported message reached the console';
  END IF;
  IF p::text NOT LIKE '%Reported words%' OR jsonb_array_length(p -> 'flags') <> 1 THEN
    RAISE EXCEPTION 'BUG: the profile is missing history';
  END IF;

  -- A reveal works, and leaves a mark. Searching by email too.
  IF public.admin_reveal_email(pg_temp.u(2), 'Appeal') <> e THEN
    RAISE EXCEPTION 'BUG: reveal returned the wrong email';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.admin_actions WHERE action = 'reveal_email' AND subject_id = pg_temp.u(2)) THEN
    RAISE EXCEPTION 'BUG: a reveal wasn''t logged';
  END IF;
  IF jsonb_array_length(public.admin_search(e)) <> 1 THEN
    RAISE EXCEPTION 'BUG: email search failed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.admin_actions WHERE action = 'search_email') THEN
    RAISE EXCEPTION 'BUG: an email search wasn''t logged';
  END IF;
  IF jsonb_array_length(public.admin_search(left(pg_temp.u(2)::text, 28))) < 1 THEN
    RAISE EXCEPTION 'BUG: id search failed';
  END IF;
  IF jsonb_array_length(public.admin_search('abc')) <> 0 THEN
    RAISE EXCEPTION 'BUG: a too-short search returned something';
  END IF;
  IF NOT public.admin_unflag(f) THEN
    RAISE EXCEPTION 'BUG: unflag failed';
  END IF;
  IF (public.admin_reports() -> 0 ->> 'subject_flagged')::boolean THEN
    RAISE EXCEPTION 'BUG: an unflagged person still shows flagged';
  END IF;

  -- What a user sees: only their own notices, and they can clear them.
  PERFORM public.add_account_notice(pg_temp.u(5), 'warn', 'For five', FALSE);
  PERFORM pg_temp.as_user(4);
  IF public.my_notices()::text LIKE '%For five%' THEN
    RAISE EXCEPTION 'BUG: read someone else''s notice';
  END IF;
  IF public.ack_notice((SELECT id FROM public.account_notices WHERE user_id = pg_temp.u(5))) THEN
    RAISE EXCEPTION 'BUG: cleared someone else''s notice';
  END IF;
  PERFORM pg_temp.as_user(5);
  IF NOT public.ack_notice((SELECT id FROM public.account_notices WHERE user_id = pg_temp.u(5))) THEN
    RAISE EXCEPTION 'BUG: couldn''t clear my own notice';
  END IF;
  IF jsonb_array_length(public.my_notices()) <> 0 THEN
    RAISE EXCEPTION 'BUG: a cleared notice came back';
  END IF;

  -- The subject's notice never names the reporter.
  IF EXISTS (SELECT 1 FROM public.account_notices WHERE user_id = pg_temp.u(2) AND body LIKE '%' || pg_temp.u(3)::text || '%') THEN
    RAISE EXCEPTION 'BUG: a notice names the reporter';
  END IF;

  -- Adding an admin.
  PERFORM pg_temp.as_user(1);
  IF public.admin_add_admin('nobody@example.invalid') THEN
    RAISE EXCEPTION 'BUG: added an admin who doesn''t exist';
  END IF;
  IF NOT public.admin_add_admin((SELECT email FROM auth.users WHERE id = pg_temp.u(6))) THEN
    RAISE EXCEPTION 'BUG: could not add an admin';
  END IF;
  RAISE NOTICE 'ok: flags, reveal and search are logged, unreported words stay private';
END $$;

-- ─── retention ──────────────────────────────────────────────────────────────
DO $$
DECLARE
  old_case UUID := pg_temp.file('Old words');
  minor_case UUID := pg_temp.file('Minor words', 'minor');
  recent UUID := pg_temp.file('Recent words');
BEGIN
  PERFORM pg_temp.as_user(1);
  PERFORM public.admin_decide_report(old_case, 'remove', NULL, 'x');
  PERFORM public.admin_decide_report(minor_case, 'remove', NULL, 'x');
  PERFORM public.admin_decide_report(recent, 'remove', NULL, 'x');
  UPDATE public.user_reports SET decided_at = now() - interval '13 months' WHERE id IN (old_case, minor_case);
  PERFORM public.erase_old_evidence();
  IF (SELECT evidence FROM public.user_reports WHERE id = old_case) IS NOT NULL THEN
    RAISE EXCEPTION 'BUG: old evidence wasn''t erased';
  END IF;
  IF (SELECT evidence FROM public.user_reports WHERE id = minor_case) IS NULL THEN
    RAISE EXCEPTION 'BUG: an upheld minor case lost its evidence';
  END IF;
  IF (SELECT evidence FROM public.user_reports WHERE id = recent) IS NULL THEN
    RAISE EXCEPTION 'BUG: recent evidence was erased';
  END IF;
  IF (SELECT status FROM public.user_reports WHERE id = old_case) <> 'upheld' THEN
    RAISE EXCEPTION 'BUG: erasing lost the decision';
  END IF;
  RAISE NOTICE 'ok: evidence erased after 12 months, decision kept, minor kept';
END $$;

-- ─── the log can't be rewritten ─────────────────────────────────────────────
DO $$
BEGIN
  BEGIN
    UPDATE public.admin_actions SET action = 'nothing';
    RAISE EXCEPTION 'BUG: the log was edited';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    DELETE FROM public.admin_actions;
    RAISE EXCEPTION 'BUG: the log was deleted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RAISE NOTICE 'ok: the log is append-only';
END $$;

-- ─── non-admins ─────────────────────────────────────────────────────────────
SET LOCAL role authenticated;
DO $$
DECLARE
  f TEXT;
  rid UUID := gen_random_uuid();
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-000000006504', 'role', 'authenticated')::text, true);
  FOREACH f IN ARRAY ARRAY[
    format('SELECT public.admin_reports()'),
    format('SELECT public.admin_person(%L)', rid),
    format('SELECT public.admin_search(%L)', 'x@example.com'),
    format('SELECT public.admin_log()'),
    format('SELECT public.admin_counts()'),
    format('SELECT public.admin_ai_queue()'),
    format('SELECT public.admin_decide_report(%L, %L)', rid, 'dismiss'),
    format('SELECT public.admin_act_on_person(%L, %L, NULL, %L)', rid, 'ban', 'x'),
    format('SELECT public.admin_lift(%L)', rid),
    format('SELECT public.admin_flag(%L, %L)', rid, 'x'),
    format('SELECT public.admin_unflag(%L)', rid),
    format('SELECT public.admin_reveal_email(%L)', rid),
    format('SELECT public.admin_uphold_block(%L)', rid),
    format('SELECT public.admin_remove_block(%L)', rid),
    format('SELECT public.admin_add_admin(%L)', 'x@example.com')
  ] LOOP
    BEGIN
      EXECUTE f;
      RAISE EXCEPTION 'BUG: a non-admin ran: %', f;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
  END LOOP;

  FOREACH f IN ARRAY ARRAY['user_reports', 'user_flags', 'admin_actions', 'banned_emails', 'account_notices', 'app_settings'] LOOP
    BEGIN
      EXECUTE format('SELECT 1 FROM public.%I LIMIT 1', f);
      RAISE EXCEPTION 'BUG: a client read %', f;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
  END LOOP;

  FOREACH f IN ARRAY ARRAY[
    format('SELECT public.apply_enforcement(%L, %L, NULL, %L, NULL, FALSE)', rid, 'ban', 'x'),
    format('SELECT public.clear_restriction(%L)', rid),
    format('SELECT public.file_user_report(%L, %L, %L, %L, %L, %L)', 'bottle', rid, rid, rid, 'spam', 'x'),
    format('SELECT public.add_account_notice(%L, %L, %L, FALSE)', rid, 'warn', 'x'),
    'SELECT public.erase_old_evidence()',
    'SELECT public.admin_console_hourly()'
  ] LOOP
    BEGIN
      EXECUTE f;
      RAISE EXCEPTION 'BUG: a client called an internal: %', f;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
  END LOOP;

  BEGIN
    UPDATE public.profiles SET banned_at = NULL, suspended_until = NULL WHERE id = '00000000-0000-4000-8000-000000006504';
    RAISE EXCEPTION 'BUG: a client changed their own ban columns';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RAISE NOTICE 'ok: non-admins are refused everywhere';
END $$;
RESET role;

ROLLBACK;
