-- Migration 051: moderation hardening
--
-- Nothing a user writes reaches another person unless it passes two checks:
--   1. a blocklist at submission (synchronous, inside the insert), and
--   2. a verdict from the safety screen (043/050), now FAIL-CLOSED:
--      * bottles are never matched while screen IS NULL;
--      * posts, comments, scraps and communities are visible only to their
--        author until the verdict lands (usually seconds);
--      * a cron re-sends anything the screen missed, and after 6 tries
--        (~30 min) holds it for a human instead of letting it through.
-- Behind that:
--   * a moderation queue (screen escalations, reports, suspensions) that
--     admins work from /admin/moderation, with an email alert;
--   * strikes: a 'minor' verdict suspends at once; 3 strikes in 30 days
--     (sexual / harm holds, or reports against you) suspend;
--   * 18+ age confirmation + terms acceptance, stored server-side, required
--     to write anything and to be picked as a receiver;
--   * removing a delivered bottle pulls it from the receiver (is_reported is
--     already filtered by the inbox, logbook, ripple and keep RPCs).

-- ── 1. Columns ──────────────────────────────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS age_confirmed_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS suspended_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS suspension_reason TEXT;

-- New held reasons: 'minor' (sexual content involving a minor) and 'review'
-- (the screen never answered, or enough reports: a human decides).
ALTER TABLE public.bottles  DROP CONSTRAINT IF EXISTS bottles_screen_reason_check;
ALTER TABLE public.posts    DROP CONSTRAINT IF EXISTS posts_screen_reason_check;
ALTER TABLE public.comments DROP CONSTRAINT IF EXISTS comments_screen_reason_check;
ALTER TABLE public.scraps   DROP CONSTRAINT IF EXISTS scraps_screen_reason_check;
ALTER TABLE public.bottles  ADD CONSTRAINT bottles_screen_reason_check
  CHECK (screen_reason IN ('contact', 'harm', 'sexual', 'spam', 'minor', 'review'));
ALTER TABLE public.posts    ADD CONSTRAINT posts_screen_reason_check
  CHECK (screen_reason IN ('contact', 'harm', 'sexual', 'spam', 'minor', 'review'));
ALTER TABLE public.comments ADD CONSTRAINT comments_screen_reason_check
  CHECK (screen_reason IN ('contact', 'harm', 'sexual', 'spam', 'minor', 'review'));
ALTER TABLE public.scraps   ADD CONSTRAINT scraps_screen_reason_check
  CHECK (screen_reason IN ('contact', 'harm', 'sexual', 'spam', 'minor', 'review'));

ALTER TABLE public.communities
  ADD COLUMN IF NOT EXISTS screen        TEXT CHECK (screen IN ('ok', 'crisis', 'held')),
  ADD COLUMN IF NOT EXISTS screen_reason TEXT CHECK (screen_reason IN ('contact', 'harm', 'sexual', 'spam', 'minor', 'review'));
-- A bio is short and post-moderated: shown until screened, cleared if held.
-- ponytail: pre-moderating it needs a bio_pending column + column-level
-- SELECT grants on social_profiles; do that if bios ever get abused.
ALTER TABLE public.social_profiles
  ADD COLUMN IF NOT EXISTS bio_screen TEXT CHECK (bio_screen IN ('ok', 'crisis', 'held'));

ALTER TABLE public.bottles         ADD COLUMN IF NOT EXISTS screen_attempts INT NOT NULL DEFAULT 0;
ALTER TABLE public.posts           ADD COLUMN IF NOT EXISTS screen_attempts INT NOT NULL DEFAULT 0;
ALTER TABLE public.comments        ADD COLUMN IF NOT EXISTS screen_attempts INT NOT NULL DEFAULT 0;
ALTER TABLE public.scraps          ADD COLUMN IF NOT EXISTS screen_attempts INT NOT NULL DEFAULT 0;
ALTER TABLE public.communities     ADD COLUMN IF NOT EXISTS screen_attempts INT NOT NULL DEFAULT 0;
ALTER TABLE public.social_profiles ADD COLUMN IF NOT EXISTS screen_attempts INT NOT NULL DEFAULT 0;

-- ── 2. Blocklist at submission ──────────────────────────────────────────────
-- Case-insensitive POSIX regexes with word boundaries (\m \M). Kept to the
-- unambiguous: explicit acts and solicitation, CSAM terms, severe slurs and
-- "kill yourself". Context-dependent words (porn, horny, …) are left to the
-- classifier, so a confession or a vent is never bounced at the door.
-- ponytail: a wordlist is beaten by creative spelling; the classifier is the
-- real check, this only stops the blatant at submission. Common digit/symbol
-- swaps are folded before matching.
CREATE TABLE IF NOT EXISTS public.blocked_terms (
  pattern TEXT PRIMARY KEY
);
ALTER TABLE public.blocked_terms ENABLE ROW LEVEL SECURITY;

INSERT INTO public.blocked_terms (pattern) VALUES
  -- sexual solicitation / explicit acts
  ('\msend (me )?(your |ur |some |a )?(nudes?|noods|nude pics?|naked pics?)\M'),
  ('\m(dick|cock|tit|titty|boob|nude|naked) ?pics?\M'),
  ('\m(blow|hand|rim|foot) ?jobs?\M'),
  ('\m(cumshots?|creampies?|deepthroat\w*|gangbangs?|bukkake|camgirls?|sexcams?)\M'),
  ('\monly ?fans\M'),
  ('\m(suck|lick|ride|touch) my (dick|cock|pussy|clit|tits|balls)\M'),
  ('\m(wanna|want to|let''?s|gonna|going to) (fuck|bang|screw) (you|u|me)\M'),
  ('\msit on my (face|dick|cock)\M'),
  ('\msexting\M'),
  -- sexual content involving minors
  ('\mchild ?porn\w*\M'),
  ('\mkiddie ?porn\w*\M'),
  ('\mpedo(phile)? ?(porn|pics|videos?|content|links?)\M'),
  ('\mloli(con)?s?\M'),
  ('\mpthc\M'),
  ('\m(preteen|underage|minor) ?(sex|nudes?|pics|porn)\M'),
  -- severe slurs
  ('\mnigg(er|a|ers|as|uh|az)\M'),
  ('\mfaggots?\M'),
  ('\mkikes?\M'),
  ('\mtrann(y|ies)\M'),
  ('\mwetbacks?\M'),
  -- self-harm incitement
  ('\mkill (your ?self|urself|yo ?self)\M'),
  ('\mkys\M')
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.violates_blocklist(p_text TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p_text IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.blocked_terms t
    WHERE p_text ~* t.pattern
       OR translate(lower(p_text), '013457@$!', 'oieastasi') ~* t.pattern
       OR translate(lower(p_text), '013457@$!', 'oleastasl') ~* t.pattern
  );
$$;

-- ── 3. One guard on every client write that reaches other people ───────────
-- BEFORE INSERT (and bio UPDATE). Args: the text columns to check. The
-- account checks apply only to client requests (auth.uid() set); server
-- paths and fixtures write as the owner with no JWT.
CREATE OR REPLACE FUNCTION public.guard_user_content()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  uid   UUID := auth.uid();
  v_row JSONB := to_jsonb(NEW);
  v_col TEXT;
  v_p   RECORD;
BEGIN
  IF uid IS NOT NULL THEN
    SELECT suspended_at, age_confirmed_at INTO v_p FROM public.profiles WHERE id = uid;
    IF v_p.suspended_at IS NOT NULL THEN
      RAISE EXCEPTION 'account_suspended' USING ERRCODE = '42501';
    END IF;
    IF v_p.age_confirmed_at IS NULL THEN
      RAISE EXCEPTION 'age_unconfirmed' USING ERRCODE = '42501';
    END IF;
  END IF;
  FOREACH v_col IN ARRAY TG_ARGV LOOP
    IF public.violates_blocklist(v_row ->> v_col) THEN
      RAISE EXCEPTION 'content_not_allowed' USING ERRCODE = '23514';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bottles_guard ON public.bottles;
CREATE TRIGGER bottles_guard BEFORE INSERT ON public.bottles
  FOR EACH ROW EXECUTE FUNCTION public.guard_user_content('message');
DROP TRIGGER IF EXISTS posts_guard ON public.posts;
CREATE TRIGGER posts_guard BEFORE INSERT ON public.posts
  FOR EACH ROW EXECUTE FUNCTION public.guard_user_content('body');
DROP TRIGGER IF EXISTS comments_guard ON public.comments;
CREATE TRIGGER comments_guard BEFORE INSERT ON public.comments
  FOR EACH ROW EXECUTE FUNCTION public.guard_user_content('body');
DROP TRIGGER IF EXISTS scraps_guard ON public.scraps;
CREATE TRIGGER scraps_guard BEFORE INSERT ON public.scraps
  FOR EACH ROW EXECUTE FUNCTION public.guard_user_content('body');
DROP TRIGGER IF EXISTS communities_guard ON public.communities;
CREATE TRIGGER communities_guard BEFORE INSERT ON public.communities
  FOR EACH ROW EXECUTE FUNCTION public.guard_user_content('name', 'description');
DROP TRIGGER IF EXISTS social_profiles_guard ON public.social_profiles;
CREATE TRIGGER social_profiles_guard BEFORE INSERT OR UPDATE OF bio ON public.social_profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_user_content('handle', 'bio');

-- A changed bio is screened afresh.
CREATE OR REPLACE FUNCTION public.reset_bio_screen()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.bio IS DISTINCT FROM OLD.bio THEN
    NEW.bio_screen := NULL;
    NEW.screen_attempts := 0;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS social_profiles_bio_reset ON public.social_profiles;
CREATE TRIGGER social_profiles_bio_reset BEFORE UPDATE OF bio ON public.social_profiles
  FOR EACH ROW EXECUTE FUNCTION public.reset_bio_screen();

-- ── 4. Screen communities and bios too ─────────────────────────────────────
-- 050 body, keyed by id or user_id (social_profiles has no id).
CREATE OR REPLACE FUNCTION public.screen_new_social() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_url TEXT;
  v_key TEXT;
  v_id  TEXT := COALESCE(to_jsonb(NEW) ->> 'id', to_jsonb(NEW) ->> 'user_id');
BEGIN
  SELECT c.supabase_url, c.service_role_key INTO v_url, v_key
  FROM public._notify_config() c;
  IF v_url IS NOT NULL AND v_key IS NOT NULL THEN
    PERFORM net.http_post(
      url     := v_url || '/functions/v1/screen-bottle',
      headers := jsonb_build_object('Content-Type', 'application/json',
                                    'Authorization', 'Bearer ' || v_key),
      body    := jsonb_build_object('table', TG_TABLE_NAME, 'id', v_id)
    );
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'screen_new_social(%, %): %', TG_TABLE_NAME, v_id, SQLERRM;
  RETURN NULL;
END $$;
REVOKE EXECUTE ON FUNCTION public.screen_new_social() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS communities_screen ON public.communities;
CREATE TRIGGER communities_screen AFTER INSERT ON public.communities
  FOR EACH ROW EXECUTE FUNCTION public.screen_new_social();
DROP TRIGGER IF EXISTS social_profiles_screen ON public.social_profiles;
CREATE TRIGGER social_profiles_screen AFTER INSERT OR UPDATE OF bio ON public.social_profiles
  FOR EACH ROW WHEN (NEW.bio IS NOT NULL) EXECUTE FUNCTION public.screen_new_social();

-- ── 5. Social pre-moderation: others see a row only once it's screened ─────
DROP POLICY IF EXISTS "p: read" ON public.posts;
CREATE POLICY "p: read" ON public.posts FOR SELECT TO authenticated
  USING (screen IN ('ok', 'crisis') OR author_id = auth.uid());
DROP POLICY IF EXISTS "cmt: read" ON public.comments;
CREATE POLICY "cmt: read" ON public.comments FOR SELECT TO authenticated
  USING (screen IN ('ok', 'crisis') OR author_id = auth.uid());
DROP POLICY IF EXISTS "s: read" ON public.scraps;
CREATE POLICY "s: read" ON public.scraps FOR SELECT TO authenticated USING (
  author_id = auth.uid()
  OR (screen IN ('ok', 'crisis') AND (approved OR wall_id = auth.uid()))
);
DROP POLICY IF EXISTS "c: read" ON public.communities;
CREATE POLICY "c: read" ON public.communities FOR SELECT TO authenticated
  USING (screen IN ('ok', 'crisis') OR created_by = auth.uid());

-- ── 6. Moderation queue ─────────────────────────────────────────────────────
-- One open item per target. Rows come from the screen (minor / review),
-- reports, and automatic suspensions. Reviewed at /admin/moderation.
CREATE TABLE IF NOT EXISTS public.moderation_queue (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        TEXT NOT NULL CHECK (kind IN ('bottle', 'post', 'comment', 'scrap', 'profile', 'community', 'user')),
  target_id   UUID NOT NULL,
  source      TEXT NOT NULL CHECK (source IN ('screen', 'report', 'suspension')),
  reason      TEXT CHECK (char_length(reason) <= 300),
  reports     INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  alerted_at  TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  resolution  TEXT CHECK (resolution IN ('removed', 'restored', 'suspended', 'dismissed'))
);
CREATE UNIQUE INDEX IF NOT EXISTS moderation_queue_open
  ON public.moderation_queue (kind, target_id) WHERE resolved_at IS NULL;
ALTER TABLE public.moderation_queue ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.enqueue_moderation(
  p_kind TEXT, p_target UUID, p_source TEXT, p_reason TEXT, p_report BOOLEAN DEFAULT FALSE
)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  INSERT INTO public.moderation_queue (kind, target_id, source, reason, reports)
  VALUES (p_kind, p_target, p_source, left(p_reason, 300), CASE WHEN p_report THEN 1 ELSE 0 END)
  ON CONFLICT (kind, target_id) WHERE resolved_at IS NULL
  DO UPDATE SET reports = moderation_queue.reports + EXCLUDED.reports,
                reason  = COALESCE(EXCLUDED.reason, moderation_queue.reason);
$$;

-- Author of any moderated target.
CREATE OR REPLACE FUNCTION public.moderation_author(p_kind TEXT, p_target UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE p_kind
    WHEN 'bottle'    THEN (SELECT sender_id  FROM public.bottles     WHERE id = p_target)
    WHEN 'post'      THEN (SELECT author_id  FROM public.posts       WHERE id = p_target)
    WHEN 'comment'   THEN (SELECT author_id  FROM public.comments    WHERE id = p_target)
    WHEN 'scrap'     THEN (SELECT author_id  FROM public.scraps      WHERE id = p_target)
    WHEN 'community' THEN (SELECT created_by FROM public.communities WHERE id = p_target)
    WHEN 'profile'   THEN p_target
    WHEN 'user'      THEN p_target
  END;
$$;

-- ── 7. Suspension and strikes ───────────────────────────────────────────────
-- Suspending pulls the user's undelivered bottles out of the water.
-- ponytail: unsuspending doesn't put them back; the user can throw again.
CREATE OR REPLACE FUNCTION public.suspend_user(p_uid UUID, p_reason TEXT, p_enqueue BOOLEAN DEFAULT TRUE)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.profiles SET suspended_at = now(), suspension_reason = p_reason
  WHERE id = p_uid AND suspended_at IS NULL;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  UPDATE public.bottles SET is_stale = TRUE
  WHERE sender_id = p_uid AND received_at IS NULL AND is_stale = FALSE;
  IF p_enqueue THEN
    PERFORM public.enqueue_moderation('user', p_uid, 'suspension', p_reason);
  END IF;
END;
$$;

-- A strike is a sexual / harm / minor hold, or a report against the user.
-- 'minor' suspends at once; otherwise 3 strikes inside 30 days do.
CREATE OR REPLACE FUNCTION public.record_strike(p_uid UUID, p_reason TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_n INT;
BEGIN
  IF p_uid IS NULL THEN
    RETURN;
  END IF;
  IF p_reason = 'minor' THEN
    PERFORM public.suspend_user(p_uid, 'minor');
    RETURN;
  END IF;
  SELECT
      (SELECT count(*) FROM public.bottles
       WHERE sender_id = p_uid AND sent_at > now() - interval '30 days'
         AND ((screen = 'held' AND screen_reason IN ('sexual', 'harm', 'minor')) OR is_reported))
    + (SELECT count(*) FROM public.posts
       WHERE author_id = p_uid AND created_at > now() - interval '30 days'
         AND screen = 'held' AND screen_reason IN ('sexual', 'harm', 'minor'))
    + (SELECT count(*) FROM public.comments
       WHERE author_id = p_uid AND created_at > now() - interval '30 days'
         AND screen = 'held' AND screen_reason IN ('sexual', 'harm', 'minor'))
    + (SELECT count(*) FROM public.scraps
       WHERE author_id = p_uid AND created_at > now() - interval '30 days'
         AND screen = 'held' AND screen_reason IN ('sexual', 'harm', 'minor'))
    + (SELECT count(*) FROM public.moderation_queue
       WHERE kind IN ('post', 'comment', 'scrap', 'profile') AND source = 'report'
         AND reports >= 3 AND created_at > now() - interval '30 days'
         AND public.moderation_author(kind, target_id) = p_uid)
  INTO v_n;
  IF v_n >= 3 THEN
    PERFORM public.suspend_user(p_uid, 'repeated ' || p_reason);
  END IF;
END;
$$;

-- ── 8. apply_screen — 043 body plus strikes and escalation ─────────────────
CREATE OR REPLACE FUNCTION public.apply_screen(
  p_bottle_id UUID,
  p_verdict   TEXT,
  p_reason    TEXT DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_b public.bottles%ROWTYPE;
BEGIN
  SELECT * INTO v_b FROM public.bottles WHERE id = p_bottle_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'not_found';
  END IF;
  IF v_b.screen IS NOT NULL THEN
    RETURN 'already_screened'; -- pg_net may deliver twice
  END IF;

  -- 051: fail-closed matching makes this unreachable for new bottles; kept
  -- for bottles delivered before 051.
  IF p_verdict = 'held' AND v_b.received_at IS NOT NULL THEN
    UPDATE public.bottles SET screen = 'held', screen_reason = p_reason WHERE id = p_bottle_id;
    RETURN 'held_too_late';
  END IF;

  IF p_verdict = 'held' THEN
    -- The day's throw comes back, unless a bottle was already held today.
    IF NOT EXISTS (
      SELECT 1 FROM public.bottles
      WHERE sender_id = v_b.sender_id AND day_key = v_b.day_key
        AND screen = 'held' AND id <> p_bottle_id
    ) THEN
      UPDATE public.daily_quotas SET has_sent = FALSE
      WHERE user_id = v_b.sender_id AND date = v_b.day_key;
    END IF;
    UPDATE public.bottles
    SET screen = 'held', screen_reason = p_reason, is_stale = TRUE
    WHERE id = p_bottle_id;
    PERFORM realtime.send(jsonb_build_object('bottle_id', p_bottle_id),
                          'bottle_held', 'user:' || v_b.sender_id::text, true);
    IF p_reason IN ('minor', 'review') THEN
      PERFORM public.enqueue_moderation('bottle', p_bottle_id, 'screen', p_reason);
    END IF;
    IF p_reason IN ('sexual', 'harm', 'minor') THEN
      PERFORM public.record_strike(v_b.sender_id, p_reason);
    END IF;
    RETURN 'held';
  END IF;

  UPDATE public.bottles SET screen = p_verdict WHERE id = p_bottle_id;
  IF p_verdict = 'crisis' THEN
    PERFORM realtime.send(jsonb_build_object('bottle_id', p_bottle_id),
                          'bottle_care', 'user:' || v_b.sender_id::text, true);
  END IF;
  RETURN p_verdict;
END;
$$;

-- ── 9. apply_social_screen — 050 body for every screened social table ──────
CREATE OR REPLACE FUNCTION public.apply_social_screen(
  p_table   TEXT,
  p_id      UUID,
  p_verdict TEXT,
  p_reason  TEXT DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_author UUID;
  v_reason TEXT := CASE WHEN p_verdict = 'held' THEN p_reason END;
  v_kind   TEXT := CASE p_table
    WHEN 'posts' THEN 'post' WHEN 'comments' THEN 'comment' WHEN 'scraps' THEN 'scrap'
    WHEN 'communities' THEN 'community' WHEN 'social_profiles' THEN 'profile' END;
BEGIN
  IF v_kind IS NULL THEN
    RAISE EXCEPTION 'bad table %', p_table;
  END IF;
  IF p_table = 'social_profiles' THEN
    -- A held bio is cleared; the handle stays (it passed the blocklist).
    UPDATE public.social_profiles
    SET bio_screen = p_verdict,
        bio        = CASE WHEN p_verdict = 'held' THEN NULL ELSE bio END
    WHERE user_id = p_id AND bio_screen IS NULL
    RETURNING user_id INTO v_author;
  ELSIF p_table = 'communities' THEN
    UPDATE public.communities SET screen = p_verdict, screen_reason = v_reason
    WHERE id = p_id AND screen IS NULL
    RETURNING created_by INTO v_author;
  ELSE
    EXECUTE format(
      'UPDATE public.%I SET screen = $1, screen_reason = $2 WHERE id = $3 AND screen IS NULL RETURNING author_id',
      p_table)
      INTO v_author USING p_verdict, v_reason, p_id;
  END IF;
  IF v_author IS NULL THEN
    RETURN 'already_screened_or_missing';
  END IF;
  IF p_verdict = 'held' THEN
    PERFORM realtime.send(jsonb_build_object('table', p_table, 'id', p_id),
                          'social_held', 'user:' || v_author::text, true);
    IF p_reason IN ('minor', 'review') THEN
      PERFORM public.enqueue_moderation(v_kind, p_id, 'screen', p_reason);
    END IF;
    IF p_reason IN ('sexual', 'harm', 'minor') THEN
      PERFORM public.record_strike(v_author, p_reason);
    END IF;
  END IF;
  RETURN p_verdict;
END $$;

-- ── 10. Fail-closed matching, adult receivers only ──────────────────────────
-- Verbatim 043 body plus: no verdict → wait; receiver must be a confirmed
-- adult who isn't suspended. retry_unmatched_bottles still offers unscreened
-- bottles; they are turned away here under the row lock.
CREATE OR REPLACE FUNCTION public.match_bottle(p_bottle_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_bottle        RECORD;
  v_receiver_id   UUID;
  v_receiver_date DATE;
  v_claimed       UUID;
  v_attempts      INTEGER := 0;
BEGIN
  SELECT id, sender_id, received_at, sent_at, is_stale, screen
  INTO   v_bottle
  FROM   public.bottles
  WHERE  id = p_bottle_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('matched', false, 'reason', 'not found');
  END IF;

  IF v_bottle.received_at IS NOT NULL THEN
    RETURN jsonb_build_object('matched', true, 'reason', 'already matched');
  END IF;

  -- 043: re-checked under the row lock — a hold can land after the cron
  -- picked its candidates.
  IF v_bottle.is_stale THEN
    RETURN jsonb_build_object('matched', false, 'reason', 'out of the water');
  END IF;

  -- 051: fail-closed — nothing sails without a verdict.
  IF v_bottle.screen IS NULL THEN
    RETURN jsonb_build_object('matched', false, 'queued', true, 'reason', 'awaiting screen');
  END IF;

  IF v_bottle.sent_at > now() - interval '1 hour' THEN
    RETURN jsonb_build_object('matched', false, 'queued', true, 'reason', 'too early');
  END IF;

  LOOP
    v_attempts := v_attempts + 1;
    IF v_attempts > 20 THEN
      RETURN jsonb_build_object(
        'matched', false, 'queued', true, 'reason', 'claim contention'
      );
    END IF;

    SELECT p.id,
           (now() AT TIME ZONE COALESCE(p.timezone, 'UTC'))::date
    INTO   v_receiver_id, v_receiver_date
    FROM   public.profiles p
    JOIN   auth.users u ON u.id = p.id
    WHERE  p.id <> v_bottle.sender_id
      AND  u.email_confirmed_at IS NOT NULL    -- 038: no dead / unverified inboxes
      AND  p.age_confirmed_at IS NOT NULL      -- 051: confirmed adults only
      AND  p.suspended_at IS NULL
      AND  NOT EXISTS (
             SELECT 1
             FROM   public.daily_quotas dq
             WHERE  dq.user_id      = p.id
               AND  dq.date         = (now() AT TIME ZONE COALESCE(p.timezone, 'UTC'))::date
               AND  dq.has_received = TRUE
           )
    ORDER BY (COALESCE(p.last_active, p.created_at) > now() - interval '30 days') IS TRUE DESC,
             random()
    LIMIT 1;

    IF v_receiver_id IS NULL THEN
      RETURN jsonb_build_object(
        'matched', false, 'queued', true, 'reason', 'no eligible receiver'
      );
    END IF;

    v_claimed := NULL;
    INSERT INTO public.daily_quotas (user_id, date, has_sent, has_received)
    VALUES (v_receiver_id, v_receiver_date, FALSE, TRUE)
    ON CONFLICT (user_id, date)
    DO UPDATE SET has_received = TRUE
    WHERE daily_quotas.has_received = FALSE
    RETURNING user_id INTO v_claimed;

    IF v_claimed IS NOT NULL THEN
      EXIT;
    END IF;
  END LOOP;

  UPDATE public.bottles
  SET    receiver_id = v_receiver_id,
         received_at = now()
  WHERE  id = p_bottle_id;

  RETURN jsonb_build_object(
    'matched', true,
    'receiver_id', v_receiver_id,
    'bottle_id', p_bottle_id
  );
END;
$$;

-- ── 11. Re-screen whatever the screen missed ────────────────────────────────
-- Every 5 min: re-send unscreened rows (older than 2 min) to screen-bottle.
-- After 6 tries the row is held for a human ('review'), never let through.
-- Attempts count even with no notify config, so a misconfigured project
-- fills the queue instead of silently holding everything forever.
CREATE OR REPLACE FUNCTION public.rescreen_pending()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_url  TEXT;
  v_key  TEXT;
  v_n    INTEGER := 0;
  r      RECORD;
  t      RECORD;
  v_ids  UUID[];
  v_id   UUID;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtext('rescreen_pending')) THEN
    RETURN 0;
  END IF;
  SELECT c.supabase_url, c.service_role_key INTO v_url, v_key FROM public._notify_config() c;

  FOR r IN
    SELECT id, screen_attempts FROM public.bottles
    WHERE screen IS NULL AND received_at IS NULL AND is_stale = FALSE
      AND sent_at < now() - interval '2 minutes'
    ORDER BY sent_at
    LIMIT 100
  LOOP
    IF r.screen_attempts >= 6 THEN
      PERFORM public.apply_screen(r.id, 'held', 'review');
    ELSE
      UPDATE public.bottles SET screen_attempts = screen_attempts + 1 WHERE id = r.id;
      IF v_url IS NOT NULL AND v_key IS NOT NULL THEN
        PERFORM net.http_post(
          url     := v_url || '/functions/v1/screen-bottle',
          headers := jsonb_build_object('Content-Type', 'application/json',
                                        'Authorization', 'Bearer ' || v_key),
          body    := jsonb_build_object('bottle_id', r.id));
      END IF;
    END IF;
    v_n := v_n + 1;
  END LOOP;

  FOR t IN
    SELECT * FROM (VALUES
      ('posts', 'id', 'screen', 'TRUE'),
      ('comments', 'id', 'screen', 'TRUE'),
      ('scraps', 'id', 'screen', 'TRUE'),
      ('communities', 'id', 'screen', 'TRUE'),
      ('social_profiles', 'user_id', 'bio_screen', 'bio IS NOT NULL')
    ) AS x(tbl, key, col, extra)
  LOOP
    -- Exhausted → held for review.
    EXECUTE format(
      'SELECT array_agg(%1$I) FROM (SELECT %1$I FROM public.%2$I
         WHERE %3$I IS NULL AND %4$s AND screen_attempts >= 6 LIMIT 100) s',
      t.key, t.tbl, t.col, t.extra) INTO v_ids;
    FOREACH v_id IN ARRAY COALESCE(v_ids, '{}') LOOP
      PERFORM public.apply_social_screen(t.tbl, v_id, 'held', 'review');
      v_n := v_n + 1;
    END LOOP;
    -- The rest → one more try.
    EXECUTE format(
      'WITH u AS (
         UPDATE public.%2$I SET screen_attempts = screen_attempts + 1
         WHERE %1$I IN (SELECT %1$I FROM public.%2$I
           WHERE %3$I IS NULL AND %4$s AND screen_attempts < 6
             AND created_at < now() - interval ''2 minutes'' LIMIT 100)
         RETURNING %1$I)
       SELECT array_agg(%1$I) FROM u',
      t.key, t.tbl, t.col, t.extra) INTO v_ids;
    IF v_url IS NOT NULL AND v_key IS NOT NULL THEN
      FOREACH v_id IN ARRAY COALESCE(v_ids, '{}') LOOP
        PERFORM net.http_post(
          url     := v_url || '/functions/v1/screen-bottle',
          headers := jsonb_build_object('Content-Type', 'application/json',
                                        'Authorization', 'Bearer ' || v_key),
          body    := jsonb_build_object('table', t.tbl, 'id', v_id));
      END LOOP;
    END IF;
    v_n := v_n + COALESCE(array_length(v_ids, 1), 0);
  END LOOP;

  RETURN v_n;
END;
$$;

-- ── 12. Reports ─────────────────────────────────────────────────────────────
-- Bottles: 038 body plus a reason, a queue item and a strike for the sender.
-- The old 1-arg version is dropped so a 1-arg call resolves to this one.
DROP FUNCTION IF EXISTS public.report_bottle(UUID);
CREATE OR REPLACE FUNCTION public.report_bottle(p_bottle_id UUID, p_reason TEXT DEFAULT NULL)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  uid      UUID := auth.uid();
  v_sender UUID;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_reason IS NOT NULL AND p_reason NOT IN ('sexual', 'harassment', 'spam', 'contact', 'other') THEN
    RAISE EXCEPTION 'unknown report reason' USING ERRCODE = '23514';
  END IF;

  UPDATE public.bottles
  SET    is_reported = TRUE,
         is_read     = TRUE,                 -- leaving the inbox clears the badge too
         read_at     = COALESCE(read_at, now())
  WHERE  id = p_bottle_id
    AND  receiver_id = uid
    AND  is_reported IS NOT TRUE
  RETURNING sender_id INTO v_sender;
  IF v_sender IS NULL THEN
    -- Already reported (a double tap) still reads as success.
    RETURN EXISTS (SELECT 1 FROM public.bottles WHERE id = p_bottle_id AND receiver_id = uid);
  END IF;

  PERFORM public.enqueue_moderation('bottle', p_bottle_id, 'report', COALESCE(p_reason, 'unspecified'), TRUE);
  PERFORM public.record_strike(v_sender, 'report');
  RETURN TRUE;
END;
$$;

-- Social: every report lands in the queue; 3 distinct reporters hide the
-- target until a human looks.
CREATE OR REPLACE FUNCTION public.on_social_report()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_n INT;
BEGIN
  PERFORM public.enqueue_moderation(NEW.target_type, NEW.target_id, 'report',
                                    COALESCE(NEW.reason, 'unspecified'), TRUE);
  SELECT count(*) INTO v_n FROM public.social_reports
  WHERE target_type = NEW.target_type AND target_id = NEW.target_id;
  IF v_n = 3 THEN
    CASE NEW.target_type
      WHEN 'post'    THEN UPDATE public.posts    SET screen = 'held', screen_reason = 'review' WHERE id = NEW.target_id;
      WHEN 'comment' THEN UPDATE public.comments SET screen = 'held', screen_reason = 'review' WHERE id = NEW.target_id;
      WHEN 'scrap'   THEN UPDATE public.scraps   SET screen = 'held', screen_reason = 'review' WHERE id = NEW.target_id;
      WHEN 'profile' THEN UPDATE public.social_profiles SET bio = NULL, bio_screen = 'held' WHERE user_id = NEW.target_id;
    END CASE;
    PERFORM public.record_strike(public.moderation_author(NEW.target_type, NEW.target_id), 'report');
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS social_reports_queue ON public.social_reports;
CREATE TRIGGER social_reports_queue AFTER INSERT ON public.social_reports
  FOR EACH ROW EXECUTE FUNCTION public.on_social_report();

-- ── 13. Age + terms ─────────────────────────────────────────────────────────
-- Email sign-up ticks "I'm 18+ and agree" and passes age_confirmed in user
-- metadata; Google sign-ups and existing users confirm in-app (accept_terms).
-- 001 body plus the metadata copy; search_path '' as pinned by 038.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (id)
  VALUES (NEW.id)
  ON CONFLICT (id) DO NOTHING;
  IF NEW.raw_user_meta_data ->> 'age_confirmed' = 'true' THEN
    UPDATE public.profiles
    SET age_confirmed_at = now(), terms_accepted_at = now()
    WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.accept_terms()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  UPDATE public.profiles
  SET age_confirmed_at  = COALESCE(age_confirmed_at, now()),
      terms_accepted_at = now()
  WHERE id = auth.uid();
END;
$$;

-- ── 14. Admin ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.admins (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE
);
ALTER TABLE public.admins ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (SELECT 1 FROM public.admins WHERE user_id = auth.uid());
$$;

-- Open items with the words under review. No sender identity: a moderator
-- judges the content, and actions resolve the author server-side.
CREATE OR REPLACE FUNCTION public.admin_queue()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not an admin' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id',         q.id,
      'kind',       q.kind,
      'source',     q.source,
      'reason',     q.reason,
      'reports',    q.reports,
      'created_at', q.created_at,
      'text', CASE q.kind
        WHEN 'bottle'    THEN (SELECT message FROM public.bottles  WHERE id = q.target_id)
        WHEN 'post'      THEN (SELECT body    FROM public.posts    WHERE id = q.target_id)
        WHEN 'comment'   THEN (SELECT body    FROM public.comments WHERE id = q.target_id)
        WHEN 'scrap'     THEN (SELECT body    FROM public.scraps   WHERE id = q.target_id)
        WHEN 'profile'   THEN (SELECT '@' || handle || COALESCE(' — ' || bio, '')
                               FROM public.social_profiles WHERE user_id = q.target_id)
        WHEN 'community' THEN (SELECT name || COALESCE(' — ' || description, '')
                               FROM public.communities WHERE id = q.target_id)
        WHEN 'user'      THEN (SELECT 'Suspended: ' || COALESCE(suspension_reason, '?')
                               FROM public.profiles WHERE id = q.target_id)
      END,
      'state', CASE q.kind
        WHEN 'bottle'    THEN (SELECT COALESCE(screen, 'unscreened') FROM public.bottles  WHERE id = q.target_id)
        WHEN 'post'      THEN (SELECT COALESCE(screen, 'unscreened') FROM public.posts    WHERE id = q.target_id)
        WHEN 'comment'   THEN (SELECT COALESCE(screen, 'unscreened') FROM public.comments WHERE id = q.target_id)
        WHEN 'scrap'     THEN (SELECT COALESCE(screen, 'unscreened') FROM public.scraps   WHERE id = q.target_id)
        WHEN 'community' THEN (SELECT COALESCE(screen, 'unscreened') FROM public.communities WHERE id = q.target_id)
        WHEN 'profile'   THEN (SELECT COALESCE(bio_screen, 'unscreened') FROM public.social_profiles WHERE user_id = q.target_id)
        WHEN 'user'      THEN (SELECT CASE WHEN suspended_at IS NULL THEN 'active' ELSE 'suspended' END
                               FROM public.profiles WHERE id = q.target_id)
      END
    ) ORDER BY q.created_at)
    FROM public.moderation_queue q
    WHERE q.resolved_at IS NULL
  ), '[]'::jsonb);
END;
$$;

-- Actions: remove (hide / pull the content), restore (put it back, or lift a
-- suspension), suspend (the author), dismiss (no change).
CREATE OR REPLACE FUNCTION public.admin_moderate(p_item UUID, p_action TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  q        public.moderation_queue%ROWTYPE;
  v_result TEXT;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not an admin' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO q FROM public.moderation_queue WHERE id = p_item AND resolved_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'not_found';
  END IF;

  IF p_action = 'remove' THEN
    CASE q.kind
      -- is_reported pulls a delivered bottle from the receiver's inbox,
      -- logbook, ripple and keep (all filter on it).
      WHEN 'bottle' THEN UPDATE public.bottles
        SET screen = 'held', screen_reason = COALESCE(screen_reason, 'review'),
            is_stale = TRUE, is_reported = TRUE WHERE id = q.target_id;
      WHEN 'post' THEN UPDATE public.posts
        SET screen = 'held', screen_reason = COALESCE(screen_reason, 'review') WHERE id = q.target_id;
      WHEN 'comment' THEN UPDATE public.comments
        SET screen = 'held', screen_reason = COALESCE(screen_reason, 'review') WHERE id = q.target_id;
      WHEN 'scrap' THEN UPDATE public.scraps
        SET screen = 'held', screen_reason = COALESCE(screen_reason, 'review') WHERE id = q.target_id;
      WHEN 'community' THEN UPDATE public.communities
        SET screen = 'held', screen_reason = COALESCE(screen_reason, 'review') WHERE id = q.target_id;
      WHEN 'profile' THEN UPDATE public.social_profiles
        SET bio = NULL, bio_screen = 'held' WHERE user_id = q.target_id;
      ELSE RAISE EXCEPTION 'cannot remove a %', q.kind USING ERRCODE = '22023';
    END CASE;
    v_result := 'removed';

  ELSIF p_action = 'restore' THEN
    CASE q.kind
      WHEN 'bottle' THEN
        BEGIN
          UPDATE public.bottles
          SET screen = 'ok', screen_reason = NULL,
              is_stale = CASE WHEN received_at IS NULL THEN FALSE ELSE is_stale END
          WHERE id = q.target_id;
        EXCEPTION WHEN unique_violation THEN
          -- The sender already threw a rewrite that day; keep this one ashore.
          RETURN 'rewrite_exists';
        END;
      WHEN 'post' THEN UPDATE public.posts SET screen = 'ok', screen_reason = NULL WHERE id = q.target_id;
      WHEN 'comment' THEN UPDATE public.comments SET screen = 'ok', screen_reason = NULL WHERE id = q.target_id;
      WHEN 'scrap' THEN UPDATE public.scraps SET screen = 'ok', screen_reason = NULL WHERE id = q.target_id;
      WHEN 'community' THEN UPDATE public.communities SET screen = 'ok', screen_reason = NULL WHERE id = q.target_id;
      WHEN 'profile' THEN UPDATE public.social_profiles SET bio_screen = 'ok' WHERE user_id = q.target_id;
      WHEN 'user' THEN UPDATE public.profiles SET suspended_at = NULL, suspension_reason = NULL WHERE id = q.target_id;
    END CASE;
    v_result := 'restored';

  ELSIF p_action = 'suspend' THEN
    PERFORM public.suspend_user(public.moderation_author(q.kind, q.target_id), 'moderator', FALSE);
    v_result := 'suspended';

  ELSIF p_action = 'dismiss' THEN
    v_result := 'dismissed';

  ELSE
    RAISE EXCEPTION 'unknown action %', p_action USING ERRCODE = '22023';
  END IF;

  UPDATE public.moderation_queue SET resolved_at = now(), resolution = v_result WHERE id = q.id;
  RETURN v_result;
END;
$$;

-- ── 15. Alert ───────────────────────────────────────────────────────────────
-- Every 30 min: if new items arrived since the last alert, one email.
CREATE OR REPLACE FUNCTION public.moderation_alert()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_url  TEXT;
  v_key  TEXT;
  v_new  INTEGER;
  v_open INTEGER;
BEGIN
  SELECT count(*) FILTER (WHERE alerted_at IS NULL), count(*)
  INTO v_new, v_open
  FROM public.moderation_queue WHERE resolved_at IS NULL;
  IF v_new = 0 THEN
    RETURN 0;
  END IF;
  SELECT c.supabase_url, c.service_role_key INTO v_url, v_key FROM public._notify_config() c;
  IF v_url IS NULL OR v_key IS NULL THEN
    RETURN 0;
  END IF;
  PERFORM net.http_post(
    url     := v_url || '/functions/v1/moderation-alert',
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'Authorization', 'Bearer ' || v_key),
    body    := jsonb_build_object('new', v_new, 'open', v_open));
  UPDATE public.moderation_queue SET alerted_at = now()
  WHERE resolved_at IS NULL AND alerted_at IS NULL;
  RETURN v_new;
END;
$$;

SELECT cron.schedule('rescreen-pending',  '*/5 * * * *',  $$ SELECT public.rescreen_pending(); $$);
SELECT cron.schedule('moderation-alert',  '*/30 * * * *', $$ SELECT public.moderation_alert(); $$);

-- ── 16. Grants (stated, as in 040/050) ──────────────────────────────────────
REVOKE ALL ON public.blocked_terms, public.moderation_queue, public.admins FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.blocked_terms, public.moderation_queue, public.admins TO service_role;

REVOKE EXECUTE ON FUNCTION public.violates_blocklist(TEXT)                      FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.guard_user_content()                          FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reset_bio_screen()                            FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enqueue_moderation(TEXT, UUID, TEXT, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.moderation_author(TEXT, UUID)                 FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.suspend_user(UUID, TEXT, BOOLEAN)             FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.record_strike(UUID, TEXT)                     FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.apply_screen(UUID, TEXT, TEXT)                FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.apply_social_screen(TEXT, UUID, TEXT, TEXT)   FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.match_bottle(UUID)                            FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.rescreen_pending()                            FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.on_social_report()                            FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.moderation_alert()                            FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.report_bottle(UUID, TEXT)                     FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.accept_terms()                                FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_admin()                                    FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_queue()                                 FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_moderate(UUID, TEXT)                    FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.report_bottle(UUID, TEXT)  TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_terms()             TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin()                 TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_queue()              TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_moderate(UUID, TEXT) TO authenticated;

GRANT EXECUTE ON FUNCTION public.apply_screen(UUID, TEXT, TEXT)              TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_social_screen(TEXT, UUID, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.match_bottle(UUID)                          TO service_role;
GRANT EXECUTE ON FUNCTION public.rescreen_pending()                          TO service_role;
GRANT EXECUTE ON FUNCTION public.moderation_alert()                          TO service_role;
GRANT EXECUTE ON FUNCTION public.suspend_user(UUID, TEXT, BOOLEAN)           TO service_role;
