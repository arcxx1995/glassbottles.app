-- Migration 065: the admin console (vvs.glassbottles.app).
--
-- Reports and blocks from users now wait for a human. A report hides the item
-- from its reporter at once and does nothing else until an admin decides:
-- dismiss, remove, remove + warn, remove + suspend, or remove + ban. Blocks work
-- instantly and are reviewed afterward. AI screening is untouched and separate.
--
-- Test first: the test site calls the new functions. The live site keeps the old
-- report_bottle, with its immediate strike, until a later cutover. Its reports
-- show here as auto_applied. auto_suspend_on_strikes is one switch for the whole
-- shared database, so it stays TRUE until that cutover.
--
-- Clients get no table grants. Admin identity is is_admin(), checked in every
-- function. A person is an id here; their email appears only through
-- admin_reveal_email and admin_search, and both are logged.

-- ─── tables ─────────────────────────────────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS suspended_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS banned_at       TIMESTAMPTZ;

CREATE TABLE public.user_reports (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind          TEXT NOT NULL CHECK (kind IN ('bottle', 'kayak_note', 'kayak_comment', 'block', 'strikes')),
  target_id     UUID NOT NULL,
  subject_id    UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  reporter_id   UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  reason        TEXT NOT NULL CHECK (reason IN ('sexual', 'harassment', 'spam', 'contact', 'other',
                                                'minor', 'danger', 'unspecified', 'block', 'strikes')),
  urgent        BOOLEAN NOT NULL DEFAULT FALSE,
  status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'upheld', 'dismissed')),
  outcome       TEXT CHECK (outcome IN ('dismiss', 'remove', 'warn', 'suspend', 'ban',
                                        'block_kept', 'block_removed', 'block_undone')),
  decided_by    UUID,
  decided_at    TIMESTAMPTZ,
  decision_note TEXT CHECK (char_length(decision_note) <= 1000),
  -- The reported words, as they were. Erased 12 months after a decision.
  evidence      TEXT,
  -- Filed through the live site's old report_bottle: its strike already applied.
  auto_applied  BOOLEAN NOT NULL DEFAULT FALSE,
  alerted_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX user_reports_once ON public.user_reports (reporter_id, kind, target_id)
  WHERE reporter_id IS NOT NULL;
CREATE INDEX user_reports_queue_idx ON public.user_reports (urgent DESC, created_at) WHERE status = 'open';
CREATE INDEX user_reports_subject_idx ON public.user_reports (subject_id);
CREATE INDEX user_reports_target_idx ON public.user_reports (kind, target_id);

CREATE TABLE public.user_flags (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  note       TEXT NOT NULL CHECK (char_length(note) BETWEEN 1 AND 1000),
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  cleared_at TIMESTAMPTZ
);
CREATE INDEX user_flags_subject_idx ON public.user_flags (subject_id) WHERE cleared_at IS NULL;

-- Plain ids, no foreign keys: a deleted account must not rewrite the log.
CREATE TABLE public.admin_actions (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  admin_id   UUID NOT NULL,
  action     TEXT NOT NULL,
  subject_id UUID,
  report_id  UUID,
  detail     JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX admin_actions_subject_idx ON public.admin_actions (subject_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.admin_actions_append_only()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'the admin log is append-only' USING ERRCODE = '42501';
END;
$$;
CREATE TRIGGER admin_actions_no_change BEFORE UPDATE OR DELETE ON public.admin_actions
  FOR EACH ROW EXECUTE FUNCTION public.admin_actions_append_only();

-- sha256 of the normalized email. Outlives the account, keeps nothing readable.
CREATE TABLE public.banned_emails (
  email_hash TEXT PRIMARY KEY,
  subject_id UUID,
  banned_by  UUID NOT NULL,
  banned_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Warnings, restrictions and report outcomes, shown once in the app.
CREATE TABLE public.account_notices (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL CHECK (kind IN ('warn', 'suspended', 'banned', 'lifted', 'report_outcome')),
  body           TEXT NOT NULL,
  wants_email    BOOLEAN NOT NULL DEFAULT FALSE,
  emailed_at     TIMESTAMPTZ,
  email_attempts SMALLINT NOT NULL DEFAULT 0,
  acked_at       TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX account_notices_open_idx ON public.account_notices (user_id) WHERE acked_at IS NULL;

CREATE TABLE public.app_settings (
  id                      BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  auto_suspend_on_strikes BOOLEAN NOT NULL DEFAULT TRUE
);
INSERT INTO public.app_settings (id) VALUES (TRUE);

ALTER TABLE public.user_reports    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_flags      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_actions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.banned_emails   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_notices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_settings    ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_reports, public.user_flags, public.admin_actions, public.banned_emails,
  public.account_notices, public.app_settings FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.account_notices TO service_role;
GRANT SELECT, INSERT ON public.admin_actions TO service_role;
GRANT SELECT ON public.user_reports TO service_role;

ALTER TABLE public.kayak_reports DROP CONSTRAINT IF EXISTS kayak_reports_reason_check;
ALTER TABLE public.kayak_reports ADD CONSTRAINT kayak_reports_reason_check
  CHECK (reason IN ('sexual', 'harassment', 'spam', 'contact', 'other', 'minor', 'danger'));

-- ─── internal helpers ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_require()
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not an admin' USING ERRCODE = '42501';
  END IF;
  RETURN auth.uid();
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_note(p_action TEXT, p_subject UUID, p_report UUID, p_detail JSONB DEFAULT '{}')
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  INSERT INTO public.admin_actions (admin_id, action, subject_id, report_id, detail)
  VALUES (auth.uid(), p_action, p_subject, p_report, p_detail);
$$;

-- Dots and +tags in a Gmail address reach the same inbox, so a ban covers them.
-- Other providers: only +tags, which nearly all treat the same way.
CREATE OR REPLACE FUNCTION public.normalize_email(p_email TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_local  TEXT := split_part(lower(btrim(p_email)), '@', 1);
  v_domain TEXT := split_part(lower(btrim(p_email)), '@', 2);
BEGIN
  v_local := split_part(v_local, '+', 1);
  IF v_domain IN ('gmail.com', 'googlemail.com') THEN
    v_local := replace(v_local, '.', '');
    v_domain := 'gmail.com';
  END IF;
  RETURN v_local || '@' || v_domain;
END;
$$;

CREATE OR REPLACE FUNCTION public.email_ban_hash(p_email TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT encode(sha256(convert_to(public.normalize_email(p_email), 'UTF8')), 'hex');
$$;

-- Refuses a banned email at the door, for password and Google sign-up alike,
-- and for an existing account changing its address to one.
CREATE OR REPLACE FUNCTION public.refuse_banned_email()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.email IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.banned_emails WHERE email_hash = public.email_ban_hash(NEW.email)) THEN
    RAISE EXCEPTION 'account_disabled' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER refuse_banned_email BEFORE INSERT OR UPDATE OF email ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.refuse_banned_email();

CREATE OR REPLACE FUNCTION public.post_edge_function(p_name TEXT, p_body JSONB)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_url TEXT;
  v_key TEXT;
BEGIN
  SELECT c.supabase_url, c.service_role_key INTO v_url, v_key FROM public._notify_config() c;
  IF v_url IS NOT NULL AND v_key IS NOT NULL THEN
    PERFORM net.http_post(
      url     := v_url || '/functions/v1/' || p_name,
      headers := jsonb_build_object('Content-Type', 'application/json',
                                    'Authorization', 'Bearer ' || v_key),
      body    := p_body);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.add_account_notice(p_user UUID, p_kind TEXT, p_body TEXT, p_email BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO public.account_notices (user_id, kind, body, wants_email)
  VALUES (p_user, p_kind, p_body, p_email)
  RETURNING id INTO v_id;
  PERFORM realtime.send('{}'::jsonb, 'notices', 'user:' || p_user::text, true);
  IF p_email THEN
    PERFORM public.post_edge_function('notify-account', jsonb_build_object('notice_id', v_id));
  END IF;
END;
$$;

-- One email within minutes for anything urgent. The 30-minute digest skips it.
CREATE OR REPLACE FUNCTION public.alert_urgent_report(p_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.user_reports SET alerted_at = now() WHERE id = p_id;
  PERFORM public.post_edge_function('moderation-alert', jsonb_build_object(
    'urgent', TRUE,
    'new', 1,
    'open', (SELECT count(*) FROM public.user_reports WHERE status = 'open')
  ));
END;
$$;

-- Every way a report enters the queue. Returns FALSE on a repeat.
CREATE OR REPLACE FUNCTION public.file_user_report(
  p_kind TEXT, p_target UUID, p_subject UUID, p_reporter UUID, p_reason TEXT,
  p_evidence TEXT, p_auto BOOLEAN DEFAULT FALSE
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF p_reason NOT IN ('sexual', 'harassment', 'spam', 'contact', 'other', 'minor', 'danger', 'unspecified', 'block') THEN
    RAISE EXCEPTION 'unknown report reason' USING ERRCODE = '23514';
  END IF;
  IF NOT p_auto AND p_kind <> 'block' AND p_reporter IS NOT NULL
     AND (SELECT count(*) FROM public.user_reports
          WHERE reporter_id = p_reporter AND kind <> 'block'
            AND created_at > now() - interval '24 hours') >= 20 THEN
    RAISE EXCEPTION 'too_many_reports' USING ERRCODE = '23514';
  END IF;
  INSERT INTO public.user_reports (kind, target_id, subject_id, reporter_id, reason, urgent, evidence, auto_applied)
  VALUES (p_kind, p_target, p_subject, p_reporter, p_reason, p_reason IN ('minor', 'danger'), p_evidence, p_auto)
  ON CONFLICT (reporter_id, kind, target_id) WHERE reporter_id IS NOT NULL DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    RETURN FALSE;
  END IF;
  IF p_reason IN ('minor', 'danger') THEN
    PERFORM public.alert_urgent_report(v_id);
  END IF;
  RETURN TRUE;
END;
$$;

-- A block works at once; this is the case that lets an admin review it.
CREATE OR REPLACE FUNCTION public.place_block(p_blocker UUID, p_blocked UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.kayak_blocks (blocker_id, blocked_id) VALUES (p_blocker, p_blocked)
  ON CONFLICT DO NOTHING;
  INSERT INTO public.user_reports (kind, target_id, subject_id, reporter_id, reason)
  VALUES ('block', p_blocked, p_blocked, p_blocker, 'block')
  ON CONFLICT (reporter_id, kind, target_id) WHERE reporter_id IS NOT NULL
  DO UPDATE SET status = 'open', outcome = NULL, decided_by = NULL, decided_at = NULL,
                decision_note = NULL, alerted_at = NULL, created_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.report_rule(p_reason TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_reason
    WHEN 'sexual'     THEN 'sexual content'
    WHEN 'harassment' THEN 'abusive or hurtful messages'
    WHEN 'spam'       THEN 'spam and advertising'
    WHEN 'contact'    THEN 'sharing contact details'
    WHEN 'minor'      THEN 'content involving a minor'
    WHEN 'danger'     THEN 'keeping people safe'
    ELSE 'our community guidelines'
  END;
$$;

CREATE OR REPLACE FUNCTION public.kayak_recall_all(p_uid UUID, p_reason TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id UUID;
BEGIN
  FOR v_id IN SELECT id FROM public.voyages WHERE owner_id = p_uid AND state <> 'home' LOOP
    PERFORM public.kayak_stay_ashore(v_id, p_reason);
    PERFORM public.kayak_send_home(v_id, p_reason);
  END LOOP;
END;
$$;

-- Takes one reported item down, for everyone.
CREATE OR REPLACE FUNCTION public.admin_remove_content(p_kind TEXT, p_target UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_voyage UUID;
BEGIN
  IF p_kind = 'bottle' THEN
    UPDATE public.bottles
    SET screen = 'held', screen_reason = COALESCE(screen_reason, 'review'), is_stale = TRUE, is_reported = TRUE
    WHERE id = p_target;
  ELSIF p_kind = 'kayak_note' THEN
    UPDATE public.kayak_notes
    SET screen = 'held', screen_reason = COALESCE(screen_reason, 'review'), reported_at = now(),
        superseded_at = COALESCE(superseded_at, now())
    WHERE id = p_target
    RETURNING voyage_id INTO v_voyage;
    IF v_voyage IS NOT NULL AND public.kayak_current_note(v_voyage) IS NULL THEN
      PERFORM public.kayak_send_home(v_voyage, 'removed');
    END IF;
  ELSIF p_kind = 'kayak_comment' THEN
    UPDATE public.kayak_comments
    SET screen = 'held', screen_reason = COALESCE(screen_reason, 'review'), reported_at = now()
    WHERE id = p_target;
    PERFORM public.kayak_release_gem(p_target);
  END IF;
END;
$$;

-- "Remove everything from this person". Their Kayaks come home regardless.
CREATE OR REPLACE FUNCTION public.admin_remove_all_content(p_uid UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id UUID;
BEGIN
  UPDATE public.bottles
  SET screen = 'held', screen_reason = COALESCE(screen_reason, 'review'), is_stale = TRUE, is_reported = TRUE
  WHERE sender_id = p_uid;
  FOR v_id IN SELECT id FROM public.kayak_comments WHERE author_id = p_uid AND screen IS DISTINCT FROM 'held' LOOP
    PERFORM public.admin_remove_content('kayak_comment', v_id);
  END LOOP;
  -- Hidden and final: they mustn't resurface as "your comment was held" notices.
  UPDATE public.kayak_comments SET acked_at = COALESCE(acked_at, now()) WHERE author_id = p_uid;
  UPDATE public.kayak_notes SET acked_at = COALESCE(acked_at, now()) WHERE owner_id = p_uid;
END;
$$;

-- The one place an account's standing changes.
CREATE OR REPLACE FUNCTION public.apply_enforcement(
  p_uid UUID, p_outcome TEXT, p_days INT, p_rule TEXT, p_message TEXT, p_remove_all BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_email TEXT;
  v_extra TEXT := CASE WHEN NULLIF(btrim(p_message), '') IS NULL THEN '' ELSE E'\n\n' || btrim(p_message) END;
  v_help  CONSTANT TEXT := ' If you think this is a mistake, write to hello@glassbottles.app.';
  v_until TIMESTAMPTZ;
BEGIN
  IF p_uid IS NULL THEN
    RETURN; -- their account is already gone
  END IF;
  IF p_outcome IN ('suspend', 'ban') AND p_uid = auth.uid() THEN
    RAISE EXCEPTION 'cannot_act_on_self' USING ERRCODE = '23514';
  END IF;

  IF p_outcome = 'warn' THEN
    PERFORM public.add_account_notice(p_uid, 'warn',
      'A message of yours broke our rules on ' || p_rule || ' and was removed. Another could limit your account.'
      || v_help || v_extra, TRUE);

  ELSIF p_outcome = 'suspend' THEN
    IF p_days NOT IN (7, 30) THEN
      RAISE EXCEPTION 'bad_days' USING ERRCODE = '22023';
    END IF;
    v_until := now() + make_interval(days => p_days);
    PERFORM public.suspend_user(p_uid, 'moderator', FALSE);
    UPDATE public.profiles SET suspended_until = v_until WHERE id = p_uid;
    PERFORM public.kayak_recall_all(p_uid, 'suspended');
    PERFORM public.add_account_notice(p_uid, 'suspended',
      'Your account is suspended for ' || p_days || ' days, until ' || to_char(v_until, 'FMDD Mon YYYY')
      || ', because of our rules on ' || p_rule || '. You can still sign in and read, but can''t send or receive anything.'
      || v_help || v_extra, TRUE);

  ELSIF p_outcome = 'ban' THEN
    SELECT email INTO v_email FROM auth.users WHERE id = p_uid;
    PERFORM public.suspend_user(p_uid, 'banned', FALSE);
    UPDATE public.profiles SET banned_at = now(), suspended_until = NULL WHERE id = p_uid;
    PERFORM public.kayak_recall_all(p_uid, 'suspended');
    IF v_email IS NOT NULL THEN
      INSERT INTO public.banned_emails (email_hash, subject_id, banned_by)
      VALUES (public.email_ban_hash(v_email), p_uid, auth.uid())
      ON CONFLICT (email_hash) DO NOTHING;
    END IF;
    -- A real date: the auth server can't parse 'infinity', and every sign-in and
    -- account lookup for this user would fail with a database error.
    UPDATE auth.users SET banned_until = now() + interval '100 years' WHERE id = p_uid;
    DELETE FROM auth.sessions WHERE user_id = p_uid;
    PERFORM public.add_account_notice(p_uid, 'banned',
      'Your glassbottles account has been closed because of our rules on ' || p_rule || '. You won''t be able to sign in or create a new account with this email.'
      || v_help || v_extra, TRUE);

  ELSE
    RAISE EXCEPTION 'bad_outcome' USING ERRCODE = '22023';
  END IF;

  IF p_remove_all THEN
    PERFORM public.admin_remove_all_content(p_uid);
  END IF;
END;
$$;

-- ─── what users do ──────────────────────────────────────────────────────────
-- The test site's report. Leaves the reporter's shelf; no strike until upheld.
CREATE OR REPLACE FUNCTION public.report_bottle_for_review(p_bottle_id UUID, p_reason TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  uid UUID := auth.uid();
  b   public.bottles%ROWTYPE;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO b FROM public.bottles WHERE id = p_bottle_id AND receiver_id = uid;
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;
  -- File first: is_reported counts as a strike unless this row says otherwise.
  PERFORM public.file_user_report('bottle', b.id, b.sender_id, uid, p_reason, b.message);
  UPDATE public.bottles
  SET is_reported = TRUE, is_read = TRUE, read_at = COALESCE(read_at, now())
  WHERE id = b.id;
  RETURN TRUE;
END;
$$;

-- Never told to the sender. Bottles and Kayaks share one list.
CREATE OR REPLACE FUNCTION public.block_bottle_sender(p_bottle_id UUID)
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
  SELECT sender_id INTO v_sender FROM public.bottles WHERE id = p_bottle_id AND receiver_id = uid;
  IF v_sender IS NULL OR v_sender = uid THEN
    RETURN FALSE;
  END IF;
  PERFORM public.place_block(uid, v_sender);
  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.my_notices()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'body', body, 'at', created_at)
                            ORDER BY created_at), '[]'::jsonb)
  FROM public.account_notices
  WHERE user_id = auth.uid() AND acked_at IS NULL;
$$;

CREATE OR REPLACE FUNCTION public.ack_notice(p_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.account_notices SET acked_at = now() WHERE id = p_id AND user_id = auth.uid();
  RETURN FOUND;
END;
$$;

-- 051 body, plus its row in the console. Live site only, until cutover.
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

  -- Kept for the live site until cutover. Also shown in the console.
  PERFORM public.file_user_report('bottle', p_bottle_id, v_sender, uid, COALESCE(p_reason, 'unspecified'),
    (SELECT message FROM public.bottles WHERE id = p_bottle_id), TRUE);
  PERFORM public.enqueue_moderation('bottle', p_bottle_id, 'report', COALESCE(p_reason, 'unspecified'), TRUE);
  PERFORM public.record_strike(v_sender, 'report');
  RETURN TRUE;
END;
$$;

-- Leaves the reporter's harbour and won't return. The rest waits for an admin.
CREATE OR REPLACE FUNCTION public.report_note(p_visit UUID, p_reason TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  uid    UUID := auth.uid();
  v      public.kayak_visits%ROWTYPE;
  v_note UUID;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_reason NOT IN ('sexual', 'harassment', 'spam', 'contact', 'other', 'minor', 'danger') THEN
    RAISE EXCEPTION 'unknown report reason' USING ERRCODE = '23514';
  END IF;
  v := public.kayak_my_visit(p_visit, uid);
  v_note := public.kayak_current_note(v.voyage_id);

  INSERT INTO public.kayak_reports (reporter_id, target_id, reason)
  VALUES (uid, v.owner_id, p_reason)
  ON CONFLICT DO NOTHING;
  PERFORM public.file_user_report('kayak_note', v_note, v.owner_id, uid, p_reason,
    (SELECT body FROM public.kayak_notes WHERE id = v_note));
  UPDATE public.kayak_visits SET left_at = now(), left_reason = 'reported' WHERE id = p_visit;
  PERFORM public.kayak_next_leg(v.voyage_id);
  PERFORM public.kayak_ping(uid);
  RETURN TRUE;
END;
$$;

-- Hidden from this reporter only, until an admin decides.
CREATE OR REPLACE FUNCTION public.report_comment(p_comment UUID, p_reason TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  uid     UUID := auth.uid();
  c       public.kayak_comments%ROWTYPE;
  v_owner UUID;
  v_voy   UUID;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_reason NOT IN ('sexual', 'harassment', 'spam', 'contact', 'other', 'minor', 'danger') THEN
    RAISE EXCEPTION 'unknown report reason' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO c FROM public.kayak_comments WHERE id = p_comment AND screen = 'ok' FOR UPDATE;
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;
  SELECT n.owner_id, n.voyage_id INTO v_owner, v_voy FROM public.kayak_notes n WHERE n.id = c.note_id;
  IF uid IS DISTINCT FROM v_owner AND NOT EXISTS (
    SELECT 1 FROM public.kayak_visits vi
    WHERE vi.voyage_id = v_voy AND vi.recipient_id = uid AND vi.left_at IS NULL
  ) THEN
    RETURN FALSE;
  END IF;
  PERFORM public.file_user_report('kayak_comment', p_comment, c.author_id, uid, p_reason, c.body);
  IF uid = v_owner AND c.author_id IS NOT NULL AND c.author_id <> uid THEN
    PERFORM public.place_block(uid, c.author_id);
  END IF;
  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.block_visit(p_visit UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  uid UUID := auth.uid();
  v   public.kayak_visits%ROWTYPE;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  v := public.kayak_my_visit(p_visit, uid);
  PERFORM public.place_block(uid, v.owner_id);
  UPDATE public.kayak_visits SET left_at = now(), left_reason = 'blocked' WHERE id = p_visit;
  PERFORM public.kayak_next_leg(v.voyage_id);
  PERFORM public.kayak_ping(uid);
  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.unblock_all_kayaks()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_n INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.kayak_blocks WHERE blocker_id = auth.uid();
  GET DIAGNOSTICS v_n = ROW_COUNT;
  UPDATE public.user_reports
  SET status = 'dismissed', outcome = 'block_undone', decided_at = now()
  WHERE reporter_id = auth.uid() AND kind = 'block' AND status = 'open';
  RETURN v_n;
END;
$$;

-- 063 bodies; a comment you reported stays hidden from you.
CREATE OR REPLACE FUNCTION public.get_visit(p_visit UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  uid    UUID := public.kayak_require_member();
  v      public.kayak_visits%ROWTYPE;
  v_k    UUID;
  v_note UUID;
BEGIN
  SELECT * INTO v FROM public.kayak_visits
  WHERE id = p_visit AND recipient_id = uid AND left_at IS NULL;
  IF NOT FOUND OR NOT public.owner_may_sail(v.owner_id) THEN
    RAISE EXCEPTION 'visit_over' USING ERRCODE = 'P0002';
  END IF;
  SELECT kayak_id INTO v_k FROM public.voyages WHERE id = v.voyage_id;
  v_note := public.kayak_current_note(v.voyage_id);
  RETURN jsonb_build_object(
    'id',         v.id,
    'arrived_at', v.arrived_at,
    'leaves_at',  v.arrived_at + interval '24 hours',
    'look',       (SELECT look FROM public.kayaks WHERE id = v_k),
    'note',       (SELECT body FROM public.kayak_notes WHERE id = v_note),
    'guestbook',  COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', c.id, 'body', c.body, 'at', c.created_at) ORDER BY c.created_at)
      FROM public.kayak_comments c
      WHERE c.note_id = v_note AND c.screen = 'ok' AND c.reported_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM public.user_reports r
                        WHERE r.reporter_id = uid AND r.kind = 'kayak_comment' AND r.target_id = c.id)
    ), '[]'::jsonb),
    'gems',       COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', g.id, 'engine', g.engine, 'seed', g.seed) ORDER BY g.created_at)
      FROM public.gems g WHERE g.kayak_id = v_k AND g.state = 'aboard'
    ), '[]'::jsonb));
END;
$$;

CREATE OR REPLACE FUNCTION public.get_kayak(p_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  uid UUID := auth.uid();
  k   public.kayaks%ROWTYPE;
  v   public.voyages%ROWTYPE;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO k FROM public.kayaks WHERE id = p_id AND owner_id = uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v FROM public.voyages WHERE kayak_id = p_id AND state <> 'home';
  UPDATE public.kayaks SET log_seen_at = now() WHERE id = p_id;

  RETURN jsonb_build_object(
    'id',    k.id,
    'look',  k.look,
    'state', COALESCE(v.state, 'home'),
    'city',  (SELECT vi.city FROM public.kayak_visits vi WHERE vi.voyage_id = v.id AND vi.left_at IS NULL),
    'edits_left', CASE WHEN v.id IS NULL THEN NULL ELSE 3 - v.edits END,
    'edit_pending', v.id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.kayak_notes n
      WHERE n.voyage_id = v.id AND n.screen IS NULL AND v.state IN ('sailing', 'visiting')),
    'note',  CASE WHEN v.id IS NULL THEN NULL ELSE COALESCE(
      (SELECT body FROM public.kayak_notes WHERE id = public.kayak_current_note(v.id)),
      (SELECT body FROM public.kayak_notes WHERE voyage_id = v.id ORDER BY created_at DESC LIMIT 1)) END,
    'gems',  COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', g.id, 'engine', g.engine, 'seed', g.seed) ORDER BY g.created_at)
      FROM public.gems g WHERE g.kayak_id = p_id AND g.state = 'aboard'
    ), '[]'::jsonb),
    'log',   COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
          'id',         vy.id,
          'state',      vy.state,
          'started_at', vy.started_at,
          'ended_at',   vy.ended_at,
          'end_reason', vy.end_reason,
          'notes', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'id',   n.id,
                'body', n.body,
                'at',   n.created_at,
                'comments', COALESCE((
                  SELECT jsonb_agg(jsonb_build_object('id', c.id, 'body', c.body, 'at', c.created_at) ORDER BY c.created_at)
                  FROM public.kayak_comments c
                  WHERE c.note_id = n.id AND c.screen = 'ok' AND c.reported_at IS NULL
                    AND NOT EXISTS (SELECT 1 FROM public.user_reports r
                                    WHERE r.reporter_id = uid AND r.kind = 'kayak_comment' AND r.target_id = c.id)
                ), '[]'::jsonb))
              ORDER BY n.created_at)
            FROM public.kayak_notes n WHERE n.voyage_id = vy.id AND n.screen = 'ok'
          ), '[]'::jsonb))
        ORDER BY vy.started_at DESC)
      FROM public.voyages vy WHERE vy.kayak_id = p_id
    ), '[]'::jsonb));
END;
$$;

-- 051 body, plus blocks.
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
      AND  NOT EXISTS (                        -- 065: blocks hide both ways
             SELECT 1 FROM public.kayak_blocks kb
             WHERE (kb.blocker_id = p.id AND kb.blocked_id = v_bottle.sender_id)
                OR (kb.blocker_id = v_bottle.sender_id AND kb.blocked_id = p.id)
           )
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

CREATE OR REPLACE FUNCTION public.record_strike(p_uid UUID, p_reason TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_n    INT;
  v_case UUID;
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
         AND ((screen = 'held' AND screen_reason IN ('sexual', 'harm', 'minor'))
              OR (is_reported AND screen_reason IS DISTINCT FROM 'crisis'
                  -- 065: a report counts once upheld, or once it took effect on
                  -- the live site, and never after a dismissal.
                  AND NOT EXISTS (SELECT 1 FROM public.user_reports r
                                  WHERE r.kind = 'bottle' AND r.target_id = bottles.id
                                    AND (r.status = 'dismissed' OR (r.status = 'open' AND NOT r.auto_applied))))))
    + (SELECT count(*) FROM public.kayak_notes
       WHERE owner_id = p_uid AND created_at > now() - interval '30 days'
         AND ((screen = 'held' AND screen_reason IN ('sexual', 'harm', 'minor'))
              OR reported_at IS NOT NULL))
    + (SELECT count(*) FROM public.kayak_comments
       WHERE author_id = p_uid AND created_at > now() - interval '30 days'
         AND ((screen = 'held' AND screen_reason IN ('sexual', 'harm', 'minor'))
              OR reported_at IS NOT NULL))
  INTO v_n;
  IF v_n >= 3 THEN
    IF (SELECT auto_suspend_on_strikes FROM public.app_settings) THEN
      PERFORM public.suspend_user(p_uid, 'repeated ' || p_reason);
    -- 065: the admin decides. Nobody's words reach anyone meanwhile; the AI holds them.
    ELSIF NOT EXISTS (SELECT 1 FROM public.user_reports
                      WHERE kind = 'strikes' AND subject_id = p_uid AND status = 'open')
          AND EXISTS (SELECT 1 FROM public.profiles WHERE id = p_uid AND suspended_at IS NULL) THEN
      INSERT INTO public.user_reports (kind, target_id, subject_id, reason, urgent)
      VALUES ('strikes', p_uid, p_uid, 'strikes', TRUE)
      RETURNING id INTO v_case;
      PERFORM public.alert_urgent_report(v_case);
    END IF;
  END IF;
END;
$$;

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
  SELECT q.fresh + r.fresh, q.open + r.open INTO v_new, v_open
  FROM (SELECT count(*) FILTER (WHERE alerted_at IS NULL) AS fresh, count(*) AS open
        FROM public.moderation_queue WHERE resolved_at IS NULL AND source <> 'report') q,
       (SELECT count(*) FILTER (WHERE alerted_at IS NULL) AS fresh, count(*) AS open
        FROM public.user_reports WHERE status = 'open') r;
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
  UPDATE public.user_reports SET alerted_at = now()
  WHERE status = 'open' AND alerted_at IS NULL;
  RETURN v_new;
END;
$$;

-- The console's AI holds tab: everything except user reports.
CREATE OR REPLACE FUNCTION public.admin_ai_queue()
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
        WHEN 'bottle'        THEN (SELECT message FROM public.bottles WHERE id = q.target_id)
        WHEN 'kayak_note'    THEN (SELECT body FROM public.kayak_notes WHERE id = q.target_id)
        WHEN 'kayak_comment' THEN (SELECT body FROM public.kayak_comments WHERE id = q.target_id)
        WHEN 'user'          THEN (SELECT 'Suspended: ' || COALESCE(suspension_reason, '?')
                                   FROM public.profiles WHERE id = q.target_id)
      END,
      'state', CASE q.kind
        WHEN 'bottle'        THEN (SELECT COALESCE(screen, 'unscreened') FROM public.bottles WHERE id = q.target_id)
        WHEN 'kayak_note'    THEN (SELECT COALESCE(screen, 'unscreened') FROM public.kayak_notes WHERE id = q.target_id)
        WHEN 'kayak_comment' THEN (SELECT COALESCE(screen, 'unscreened') FROM public.kayak_comments WHERE id = q.target_id)
        WHEN 'user'          THEN (SELECT CASE WHEN suspended_at IS NULL THEN 'active' ELSE 'suspended' END
                                   FROM public.profiles WHERE id = q.target_id)
      END
    ) ORDER BY q.created_at)
    FROM public.moderation_queue q
    WHERE q.resolved_at IS NULL AND q.source <> 'report'
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_moderate(p_item UUID, p_action TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  q        public.moderation_queue%ROWTYPE;
  v_result TEXT;
  v_voyage UUID;
  v_live   BOOLEAN;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not an admin' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO q FROM public.moderation_queue WHERE id = p_item AND resolved_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'not_found';
  END IF;

  IF p_action IN ('remove', 'suspend') THEN
    CASE q.kind
      -- is_reported pulls a delivered bottle from the receiver's inbox,
      -- logbook, ripple and keep (all filter on it).
      WHEN 'bottle' THEN UPDATE public.bottles
        SET screen = 'held', screen_reason = COALESCE(screen_reason, 'review'),
            is_stale = TRUE, is_reported = TRUE WHERE id = q.target_id;
      WHEN 'kayak_note' THEN
        UPDATE public.kayak_notes
        SET screen = 'held', screen_reason = COALESCE(screen_reason, 'review'),
            superseded_at = COALESCE(superseded_at, now())
        WHERE id = q.target_id
        RETURNING voyage_id INTO v_voyage;
        -- Live when removed: the Kayak can't carry on without its note.
        IF v_voyage IS NOT NULL AND public.kayak_current_note(v_voyage) IS NULL THEN
          PERFORM public.kayak_send_home(v_voyage, 'removed');
        END IF;
      WHEN 'kayak_comment' THEN
        UPDATE public.kayak_comments
        SET screen = 'held', screen_reason = COALESCE(screen_reason, 'review')
        WHERE id = q.target_id;
        PERFORM public.kayak_release_gem(q.target_id);
      ELSE RAISE EXCEPTION 'cannot remove a %', q.kind USING ERRCODE = '22023';
    END CASE;
    v_result := 'removed';
    IF p_action = 'suspend' THEN
      PERFORM public.suspend_user(public.moderation_author(q.kind, q.target_id), 'moderator', FALSE);
      v_result := 'suspended';
    END IF;

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
      -- A restored note is cleared, not relaunched. Only the owner's latest edit,
      -- on a Kayak still at sea, takes over; a newer note always wins.
      WHEN 'kayak_note' THEN
        SELECT n.voyage_id,
               EXISTS (SELECT 1 FROM public.voyages v WHERE v.id = n.voyage_id AND v.state IN ('sailing', 'visiting'))
               AND NOT EXISTS (SELECT 1 FROM public.kayak_notes o
                               WHERE o.voyage_id = n.voyage_id AND o.id <> n.id
                                 AND o.created_at > n.created_at
                                 AND o.screen IS DISTINCT FROM 'held')
        INTO v_voyage, v_live
        FROM public.kayak_notes n WHERE n.id = q.target_id;
        UPDATE public.kayak_notes
        SET screen = 'ok', screen_reason = NULL, reported_at = NULL,
            superseded_at = CASE WHEN v_live THEN NULL ELSE COALESCE(superseded_at, now()) END
        WHERE id = q.target_id;
        IF v_live THEN
          PERFORM public.kayak_promote_note(q.target_id);
        END IF;
      WHEN 'kayak_comment' THEN
        UPDATE public.kayak_comments
        SET screen = 'ok', screen_reason = NULL, reported_at = NULL, screened_at = now()
        WHERE id = q.target_id;
        PERFORM public.kayak_keep_gem(q.target_id);
      WHEN 'user' THEN UPDATE public.profiles SET suspended_at = NULL, suspension_reason = NULL WHERE id = q.target_id;
    END CASE;
    v_result := 'restored';

  ELSIF p_action = 'dismiss' THEN
    -- A dismissed report isn't upheld: its comment comes back and the strike goes.
    -- A comment the screen held stays held, but its gem can't wait forever.
    IF q.kind = 'kayak_comment' THEN
      UPDATE public.kayak_comments SET reported_at = NULL WHERE id = q.target_id;
      PERFORM public.kayak_release_gem(q.target_id);
    ELSIF q.kind = 'kayak_note' THEN
      UPDATE public.kayak_notes SET reported_at = NULL WHERE id = q.target_id;
    END IF;
    v_result := 'dismissed';

  ELSE
    RAISE EXCEPTION 'unknown action %', p_action USING ERRCODE = '22023';
  END IF;

  UPDATE public.moderation_queue SET resolved_at = now(), resolution = v_result WHERE id = q.id;
  -- A decision on one screen can't leave the same case open on the other.
  UPDATE public.user_reports
  SET status = CASE WHEN v_result IN ('removed', 'suspended') THEN 'upheld' ELSE 'dismissed' END,
      outcome = CASE WHEN v_result = 'suspended' THEN 'suspend'
                     WHEN v_result = 'removed' THEN 'remove' ELSE 'dismiss' END,
      decided_by = auth.uid(), decided_at = now()
  WHERE kind = q.kind AND target_id = q.target_id AND status = 'open';
  PERFORM public.admin_note('moderate_' || p_action, public.moderation_author(q.kind, q.target_id), NULL,
    jsonb_build_object('kind', q.kind, 'source', q.source, 'reason', q.reason));
  RETURN v_result;
END;
$$;


-- ─── what admins do ─────────────────────────────────────────────────────────
-- One decision on one reported item, for everyone who reported it.
CREATE OR REPLACE FUNCTION public.admin_decide_report(
  p_id         UUID,
  p_outcome    TEXT,
  p_days       INT     DEFAULT NULL,
  p_note       TEXT    DEFAULT NULL,
  p_message    TEXT    DEFAULT NULL,
  p_remove_all BOOLEAN DEFAULT FALSE,
  p_flag_note  TEXT    DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin UUID := public.admin_require();
  r       public.user_reports%ROWTYPE;
  v_rep   UUID;
BEGIN
  IF p_outcome NOT IN ('dismiss', 'remove', 'warn', 'suspend', 'ban') THEN
    RAISE EXCEPTION 'bad_outcome' USING ERRCODE = '22023';
  END IF;
  IF p_outcome <> 'dismiss' AND NULLIF(btrim(p_note), '') IS NULL THEN
    RAISE EXCEPTION 'note_required' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO r FROM public.user_reports WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;
  IF r.kind = 'block' THEN
    RAISE EXCEPTION 'use_block_review' USING ERRCODE = '22023';
  END IF;
  IF r.status <> 'open' THEN
    RETURN jsonb_build_object('status', 'already_decided', 'outcome', r.outcome);
  END IF;

  IF p_outcome = 'dismiss' THEN
    -- The item stays hidden from those who reported it. On the live site's old
    -- path, this is also what takes back the strike.
    FOR v_rep IN
      UPDATE public.user_reports
      SET status = 'dismissed', outcome = 'dismiss', decided_by = v_admin, decided_at = now(), decision_note = p_note
      WHERE kind = r.kind AND target_id = r.target_id AND status = 'open'
      RETURNING reporter_id
    LOOP
      IF v_rep IS NOT NULL THEN
        PERFORM public.add_account_notice(v_rep, 'report_outcome',
          'We reviewed your report, and it didn''t break our rules. It stays hidden from you.', FALSE);
      END IF;
    END LOOP;
  ELSE
    PERFORM public.admin_remove_content(r.kind, r.target_id);
    FOR v_rep IN
      UPDATE public.user_reports
      SET status = 'upheld', outcome = p_outcome, decided_by = v_admin, decided_at = now(), decision_note = p_note
      WHERE kind = r.kind AND target_id = r.target_id AND status = 'open'
      RETURNING reporter_id
    LOOP
      IF v_rep IS NOT NULL THEN
        PERFORM public.add_account_notice(v_rep, 'report_outcome',
          'We reviewed your report and took action. Thank you for telling us.', FALSE);
      END IF;
    END LOOP;
    IF r.kind <> 'strikes' THEN
      PERFORM public.record_strike(r.subject_id, 'report');
    END IF;
    IF p_outcome <> 'remove' THEN
      PERFORM public.apply_enforcement(r.subject_id, p_outcome, p_days, public.report_rule(r.reason), p_message, p_remove_all);
    ELSIF p_remove_all AND r.subject_id IS NOT NULL THEN
      PERFORM public.admin_remove_all_content(r.subject_id);
    END IF;
  END IF;

  UPDATE public.moderation_queue
  SET resolved_at = now(),
      resolution = CASE p_outcome WHEN 'dismiss' THEN 'dismissed'
                                  WHEN 'remove' THEN 'removed' WHEN 'warn' THEN 'removed' ELSE 'suspended' END
  WHERE kind = r.kind AND target_id = r.target_id AND resolved_at IS NULL;

  IF NULLIF(btrim(p_flag_note), '') IS NOT NULL AND r.subject_id IS NOT NULL THEN
    INSERT INTO public.user_flags (subject_id, note, created_by) VALUES (r.subject_id, btrim(p_flag_note), v_admin);
  END IF;
  PERFORM public.admin_note('decide_' || p_outcome, r.subject_id, r.id, jsonb_build_object(
    'kind', r.kind, 'reason', r.reason, 'days', p_days, 'remove_all', p_remove_all, 'note', p_note,
    'flagged', NULLIF(btrim(p_flag_note), '') IS NOT NULL));
  RETURN jsonb_build_object('status', 'decided', 'outcome', p_outcome, 'subject_id', r.subject_id);
END;
$$;

-- Direct actions from a person's profile, with no report behind them.
CREATE OR REPLACE FUNCTION public.admin_act_on_person(
  p_subject    UUID,
  p_outcome    TEXT,
  p_days       INT     DEFAULT NULL,
  p_note       TEXT    DEFAULT NULL,
  p_message    TEXT    DEFAULT NULL,
  p_remove_all BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin UUID := public.admin_require();
BEGIN
  IF NULLIF(btrim(p_note), '') IS NULL THEN
    RAISE EXCEPTION 'note_required' USING ERRCODE = '22023';
  END IF;
  PERFORM public.apply_enforcement(p_subject, p_outcome, p_days, 'our community guidelines', p_message, p_remove_all);
  PERFORM public.admin_note('person_' || p_outcome, p_subject, NULL, jsonb_build_object(
    'days', p_days, 'remove_all', p_remove_all, 'note', p_note));
  RETURN jsonb_build_object('status', 'done', 'subject_id', p_subject);
END;
$$;

-- Ends a suspension or a ban, for an appeal or a change of mind.
CREATE OR REPLACE FUNCTION public.clear_restriction(p_uid UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_email TEXT;
BEGIN
  SELECT email INTO v_email FROM auth.users WHERE id = p_uid;
  UPDATE public.profiles
  SET suspended_at = NULL, suspension_reason = NULL, suspended_until = NULL, banned_at = NULL
  WHERE id = p_uid AND (suspended_at IS NOT NULL OR banned_at IS NOT NULL);
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;
  UPDATE auth.users SET banned_until = NULL WHERE id = p_uid;
  IF v_email IS NOT NULL THEN
    DELETE FROM public.banned_emails WHERE email_hash = public.email_ban_hash(v_email);
  END IF;
  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_lift(p_subject UUID, p_note TEXT DEFAULT NULL)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin UUID := public.admin_require();
BEGIN
  IF NOT public.clear_restriction(p_subject) THEN
    RETURN FALSE;
  END IF;
  PERFORM public.add_account_notice(p_subject, 'lifted',
    'The restriction on your glassbottles account has been lifted. Welcome back.', TRUE);
  PERFORM public.admin_note('lift', p_subject, NULL, jsonb_build_object('note', p_note));
  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_flag(p_subject UUID, p_note TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin UUID := public.admin_require();
  v_id    UUID;
BEGIN
  INSERT INTO public.user_flags (subject_id, note, created_by) VALUES (p_subject, btrim(p_note), v_admin)
  RETURNING id INTO v_id;
  PERFORM public.admin_note('flag', p_subject, NULL, jsonb_build_object('note', btrim(p_note)));
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_unflag(p_flag UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin   UUID := public.admin_require();
  v_subject UUID;
BEGIN
  UPDATE public.user_flags SET cleared_at = now() WHERE id = p_flag AND cleared_at IS NULL
  RETURNING subject_id INTO v_subject;
  IF v_subject IS NULL THEN
    RETURN FALSE;
  END IF;
  PERFORM public.admin_note('unflag', v_subject, NULL);
  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_reveal_email(p_subject UUID, p_why TEXT DEFAULT NULL)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin UUID := public.admin_require();
  v_email TEXT;
BEGIN
  SELECT email INTO v_email FROM auth.users WHERE id = p_subject;
  PERFORM public.admin_note('reveal_email', p_subject, NULL, jsonb_build_object('why', p_why));
  RETURN v_email;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_uphold_block(p_report UUID, p_note TEXT DEFAULT NULL)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin UUID := public.admin_require();
  v_sub   UUID;
BEGIN
  UPDATE public.user_reports
  SET status = 'upheld', outcome = 'block_kept', decided_by = v_admin, decided_at = now(), decision_note = p_note
  WHERE id = p_report AND kind = 'block' AND status = 'open'
  RETURNING subject_id INTO v_sub;
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;
  PERFORM public.admin_note('block_kept', v_sub, p_report, jsonb_build_object('note', p_note));
  RETURN TRUE;
END;
$$;

-- The blocker isn't told. The person can block again, which opens a new review.
CREATE OR REPLACE FUNCTION public.admin_remove_block(p_report UUID, p_note TEXT DEFAULT NULL)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin UUID := public.admin_require();
  r       public.user_reports%ROWTYPE;
BEGIN
  UPDATE public.user_reports
  SET status = 'dismissed', outcome = 'block_removed', decided_by = v_admin, decided_at = now(), decision_note = p_note
  WHERE id = p_report AND kind = 'block' AND status = 'open'
  RETURNING * INTO r;
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;
  DELETE FROM public.kayak_blocks WHERE blocker_id = r.reporter_id AND blocked_id = r.target_id;
  PERFORM public.admin_note('block_removed', r.subject_id, p_report, jsonb_build_object('note', p_note));
  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_add_admin(p_email TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin UUID := public.admin_require();
  v_id    UUID;
BEGIN
  SELECT id INTO v_id FROM auth.users WHERE lower(email) = lower(btrim(p_email));
  IF v_id IS NULL THEN
    RETURN FALSE;
  END IF;
  INSERT INTO public.admins (user_id) VALUES (v_id) ON CONFLICT DO NOTHING;
  PERFORM public.admin_note('add_admin', v_id, NULL);
  RETURN TRUE;
END;
$$;

-- ─── what admins read ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.person_status(p_uid UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE WHEN banned_at IS NOT NULL THEN 'banned'
              WHEN suspended_at IS NOT NULL THEN 'suspended'
              ELSE 'active' END
  FROM public.profiles WHERE id = p_uid;
$$;

CREATE OR REPLACE FUNCTION public.admin_reports(p_open BOOLEAN DEFAULT TRUE)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin UUID := public.admin_require();
BEGIN
  RETURN COALESCE((
    SELECT jsonb_agg(x)
    FROM (
      SELECT jsonb_build_object(
        'id', r.id, 'kind', r.kind, 'reason', r.reason, 'urgent', r.urgent, 'status', r.status,
        'outcome', r.outcome, 'evidence', r.evidence, 'auto_applied', r.auto_applied,
        'created_at', r.created_at, 'decided_at', r.decided_at, 'decision_note', r.decision_note,
        'subject_id', r.subject_id, 'reporter_id', r.reporter_id,
        'subject_status', public.person_status(r.subject_id),
        'subject_flagged', EXISTS (SELECT 1 FROM public.user_flags f WHERE f.subject_id = r.subject_id AND f.cleared_at IS NULL),
        'reports_on_item', (SELECT count(*) FROM public.user_reports o WHERE o.kind = r.kind AND o.target_id = r.target_id)
      ) AS x
      FROM public.user_reports r
      WHERE (r.status = 'open') = p_open
      ORDER BY r.urgent DESC, CASE WHEN p_open THEN r.created_at END ASC, r.decided_at DESC NULLS LAST
      LIMIT 200
    ) rows
  ), '[]'::jsonb);
END;
$$;

-- Reported and AI-held words, and counts of everything else. Never anyone's
-- unreported messages, and no email: that's admin_reveal_email, which is logged.
CREATE OR REPLACE FUNCTION public.admin_person(p_subject UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin UUID := public.admin_require();
  p       public.profiles%ROWTYPE;
BEGIN
  SELECT * INTO p FROM public.profiles WHERE id = p_subject;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;
  RETURN jsonb_build_object(
    'id', p.id,
    'status', public.person_status(p.id),
    'suspended_until', p.suspended_until,
    'suspension_reason', p.suspension_reason,
    'joined', p.created_at,
    'last_active', p.last_active,
    'age_confirmed', p.age_confirmed_at IS NOT NULL,
    'is_admin', EXISTS (SELECT 1 FROM public.admins a WHERE a.user_id = p.id),
    'membership', (SELECT jsonb_build_object('plan', m.plan, 'status', m.status, 'access_until', m.access_until, 'live', m.access_until > now())
                   FROM public.memberships m WHERE m.user_id = p.id),
    'counts', jsonb_build_object(
      'bottles', (SELECT count(*) FROM public.bottles WHERE sender_id = p.id),
      'notes', (SELECT count(*) FROM public.kayak_notes WHERE owner_id = p.id),
      'comments', (SELECT count(*) FROM public.kayak_comments WHERE author_id = p.id),
      'blocks_made', (SELECT count(*) FROM public.kayak_blocks WHERE blocker_id = p.id),
      'blocked_by', (SELECT count(*) FROM public.kayak_blocks WHERE blocked_id = p.id)),
    'as_reporter', (SELECT jsonb_build_object(
        'filed', count(*),
        'upheld', count(*) FILTER (WHERE status = 'upheld'),
        'dismissed', count(*) FILTER (WHERE status = 'dismissed'))
      FROM public.user_reports WHERE reporter_id = p.id AND kind NOT IN ('block', 'strikes')),
    'flags', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', f.id, 'note', f.note, 'at', f.created_at) ORDER BY f.created_at DESC)
      FROM public.user_flags f WHERE f.subject_id = p.id AND f.cleared_at IS NULL), '[]'::jsonb),
    'reports', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', r.id, 'kind', r.kind, 'reason', r.reason, 'status', r.status, 'outcome', r.outcome,
        'evidence', r.evidence, 'at', r.created_at) ORDER BY r.created_at DESC)
      FROM public.user_reports r WHERE r.subject_id = p.id AND r.kind <> 'strikes'), '[]'::jsonb),
    'ai_holds', COALESCE((SELECT jsonb_agg(h ORDER BY h ->> 'at' DESC) FROM (
        SELECT jsonb_build_object('kind', 'bottle', 'reason', screen_reason, 'text', message, 'at', sent_at) AS h
        FROM public.bottles WHERE sender_id = p.id AND screen = 'held' AND screen_reason IS DISTINCT FROM 'crisis'
        UNION ALL
        SELECT jsonb_build_object('kind', 'kayak_note', 'reason', screen_reason, 'text', body, 'at', created_at)
        FROM public.kayak_notes WHERE owner_id = p.id AND screen = 'held' AND screen_reason IS DISTINCT FROM 'crisis'
        UNION ALL
        SELECT jsonb_build_object('kind', 'kayak_comment', 'reason', screen_reason, 'text', body, 'at', created_at)
        FROM public.kayak_comments WHERE author_id = p.id AND screen = 'held' AND screen_reason IS DISTINCT FROM 'crisis'
      ) held), '[]'::jsonb),
    'log', COALESCE((SELECT jsonb_agg(jsonb_build_object('action', a.action, 'detail', a.detail, 'at', a.created_at) ORDER BY a.created_at DESC)
      FROM public.admin_actions a WHERE a.subject_id = p.id), '[]'::jsonb));
END;
$$;

-- By id, or by exact email, which is logged like a reveal.
CREATE OR REPLACE FUNCTION public.admin_search(p_query TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin UUID := public.admin_require();
  v_q     TEXT := lower(btrim(p_query));
BEGIN
  IF v_q LIKE '%@%' THEN
    PERFORM public.admin_note('search_email', (SELECT id FROM auth.users WHERE lower(email) = v_q), NULL);
    RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('id', u.id, 'status', public.person_status(u.id)))
      FROM auth.users u WHERE lower(u.email) = v_q), '[]'::jsonb);
  END IF;
  IF char_length(v_q) < 6 OR v_q !~ '^[0-9a-f-]+$' THEN
    RETURN '[]'::jsonb;
  END IF;
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'status', public.person_status(p.id)))
    FROM (SELECT id FROM public.profiles WHERE id::text LIKE v_q || '%' LIMIT 20) p), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_log(p_limit INT DEFAULT 200)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin UUID := public.admin_require();
BEGIN
  RETURN COALESCE((SELECT jsonb_agg(row_to_json(l)) FROM (
    SELECT id, admin_id, action, subject_id, report_id, detail, created_at
    FROM public.admin_actions ORDER BY id DESC LIMIT LEAST(p_limit, 1000)
  ) l), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_counts()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin UUID := public.admin_require();
BEGIN
  RETURN jsonb_build_object(
    'open', (SELECT count(*) FROM public.user_reports WHERE status = 'open'),
    'urgent', (SELECT count(*) FROM public.user_reports WHERE status = 'open' AND urgent),
    'ai', (SELECT count(*) FROM public.moderation_queue WHERE resolved_at IS NULL AND source <> 'report'),
    'admins', (SELECT count(*) FROM public.admins));
END;
$$;

-- ─── reports already waiting ────────────────────────────────────────────────
-- Open reports from before this migration move to the Reports tab. Their effects
-- already happened, and who filed them was never recorded as one row, so they
-- carry no reporter, and deciding them works as it does for the live site's.
INSERT INTO public.user_reports (kind, target_id, subject_id, reason, evidence, auto_applied, created_at)
SELECT q.kind, q.target_id, public.moderation_author(q.kind, q.target_id),
       CASE WHEN q.reason IN ('sexual', 'harassment', 'spam', 'contact', 'other') THEN q.reason ELSE 'unspecified' END,
       CASE q.kind
         WHEN 'bottle'        THEN (SELECT message FROM public.bottles WHERE id = q.target_id)
         WHEN 'kayak_note'    THEN (SELECT body FROM public.kayak_notes WHERE id = q.target_id)
         WHEN 'kayak_comment' THEN (SELECT body FROM public.kayak_comments WHERE id = q.target_id)
       END,
       TRUE, q.created_at
FROM public.moderation_queue q
WHERE q.resolved_at IS NULL AND q.source = 'report' AND q.kind IN ('bottle', 'kayak_note', 'kayak_comment');

-- ─── housekeeping ───────────────────────────────────────────────────────────
-- Hourly. Time-limited suspensions end, and enforcement emails that didn't land
-- try again, 8 times at most.
CREATE OR REPLACE FUNCTION public.admin_console_hourly()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r   RECORD;
  v_n INTEGER := 0;
BEGIN
  FOR r IN
    SELECT id FROM public.profiles
    WHERE suspended_until IS NOT NULL AND suspended_until <= now() AND banned_at IS NULL
  LOOP
    PERFORM public.clear_restriction(r.id);
    PERFORM public.add_account_notice(r.id, 'lifted', 'Your suspension has ended. Welcome back.', TRUE);
    v_n := v_n + 1;
  END LOOP;
  FOR r IN
    SELECT id FROM public.account_notices
    WHERE wants_email AND emailed_at IS NULL AND email_attempts < 8
      AND created_at < now() - interval '10 minutes'
    ORDER BY email_attempts, created_at
    LIMIT 20
  LOOP
    UPDATE public.account_notices SET email_attempts = email_attempts + 1 WHERE id = r.id;
    PERFORM public.post_edge_function('notify-account', jsonb_build_object('notice_id', r.id));
  END LOOP;
  RETURN v_n;
END;
$$;

-- Daily. The words go 12 months after a decision; the decision itself stays.
-- Upheld reports involving a minor are kept, as the law may require.
CREATE OR REPLACE FUNCTION public.erase_old_evidence()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_n INTEGER;
BEGIN
  UPDATE public.user_reports SET evidence = NULL
  WHERE evidence IS NOT NULL AND decided_at < now() - interval '12 months'
    AND NOT (reason = 'minor' AND status = 'upheld');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

SELECT cron.schedule('admin-console-hourly', '7 * * * *', $$ SELECT public.admin_console_hourly(); $$);
SELECT cron.schedule('erase-old-evidence', '23 3 * * *', $$ SELECT public.erase_old_evidence(); $$);

-- ─── grants ─────────────────────────────────────────────────────────────────
DO $$
DECLARE
  f TEXT;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'admin_require()', 'admin_note(text, uuid, uuid, jsonb)', 'normalize_email(text)', 'email_ban_hash(text)',
    'refuse_banned_email()', 'post_edge_function(text, jsonb)', 'add_account_notice(uuid, text, text, boolean)',
    'alert_urgent_report(uuid)', 'file_user_report(text, uuid, uuid, uuid, text, text, boolean)',
    'place_block(uuid, uuid)', 'report_rule(text)', 'kayak_recall_all(uuid, text)',
    'admin_remove_content(text, uuid)', 'admin_remove_all_content(uuid)',
    'apply_enforcement(uuid, text, integer, text, text, boolean)', 'clear_restriction(uuid)',
    'person_status(uuid)', 'admin_console_hourly()', 'erase_old_evidence()', 'admin_actions_append_only()'
  ] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', f);
  END LOOP;
  -- Each checks auth.uid() or is_admin() itself.
  FOREACH f IN ARRAY ARRAY[
    'report_bottle_for_review(uuid, text)', 'block_bottle_sender(uuid)', 'my_notices()', 'ack_notice(uuid)',
    'admin_ai_queue()', 'admin_decide_report(uuid, text, integer, text, text, boolean, text)',
    'admin_act_on_person(uuid, text, integer, text, text, boolean)', 'admin_lift(uuid, text)',
    'admin_flag(uuid, text)', 'admin_unflag(uuid)', 'admin_reveal_email(uuid, text)',
    'admin_uphold_block(uuid, text)', 'admin_remove_block(uuid, text)', 'admin_add_admin(text)',
    'admin_reports(boolean)', 'admin_person(uuid)', 'admin_search(text)', 'admin_log(integer)', 'admin_counts()'
  ] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION public.admin_console_hourly() TO service_role;
GRANT EXECUTE ON FUNCTION public.erase_old_evidence() TO service_role;
