-- Migration 055: the social feed is gone; The Harbour replaces it.
--
-- Drops everything 050 added except social_profiles (handle + bio), which
-- becomes a kayak's identity. Every table dropped here was empty in prod
-- (checked 2026-10-25). 051's moderation functions are redefined without the
-- dropped tables; their bottle / profile / user behaviour is unchanged.

-- ─── tables (their triggers, policies and realtime membership go with them) ──
DROP TABLE IF EXISTS public.post_votes, public.comments, public.posts,
  public.community_members, public.communities,
  public.friendships, public.scraps, public.social_reports CASCADE;

DROP FUNCTION IF EXISTS public.post_votes_score();
DROP FUNCTION IF EXISTS public.comments_count();
DROP FUNCTION IF EXISTS public.community_owner_member();
DROP FUNCTION IF EXISTS public.social_rate_limit();
DROP FUNCTION IF EXISTS public.on_social_report();

-- ─── moderation queue: only bottles, profiles and users remain ──────────────
DELETE FROM public.moderation_queue WHERE kind IN ('post', 'comment', 'scrap', 'community');
ALTER TABLE public.moderation_queue DROP CONSTRAINT IF EXISTS moderation_queue_kind_check;
ALTER TABLE public.moderation_queue ADD CONSTRAINT moderation_queue_kind_check
  CHECK (kind IN ('bottle', 'profile', 'user'));

CREATE OR REPLACE FUNCTION public.moderation_author(p_kind TEXT, p_target UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE p_kind
    WHEN 'bottle'  THEN (SELECT sender_id FROM public.bottles WHERE id = p_target)
    WHEN 'profile' THEN p_target
    WHEN 'user'    THEN p_target
  END;
$$;

-- 053 body minus posts / comments / scraps.
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
         AND ((screen = 'held' AND screen_reason IN ('sexual', 'harm', 'minor'))
              OR (is_reported AND screen_reason IS DISTINCT FROM 'crisis')))
    + (SELECT count(*) FROM public.moderation_queue
       WHERE kind = 'profile' AND source = 'report'
         AND reports >= 3 AND created_at > now() - interval '30 days'
         AND target_id = p_uid)
  INTO v_n;
  IF v_n >= 3 THEN
    PERFORM public.suspend_user(p_uid, 'repeated ' || p_reason);
  END IF;
END;
$$;

-- 051 body, bios only.
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
BEGIN
  IF p_table <> 'social_profiles' THEN
    RAISE EXCEPTION 'bad table %', p_table;
  END IF;
  -- A held bio is cleared; the handle stays (it passed the blocklist).
  UPDATE public.social_profiles
  SET bio_screen = p_verdict,
      bio        = CASE WHEN p_verdict = 'held' THEN NULL ELSE bio END
  WHERE user_id = p_id AND bio_screen IS NULL
  RETURNING user_id INTO v_author;
  IF v_author IS NULL THEN
    RETURN 'already_screened_or_missing';
  END IF;
  IF p_verdict = 'held' THEN
    PERFORM realtime.send(jsonb_build_object('table', p_table, 'id', p_id),
                          'social_held', 'user:' || v_author::text, true);
    IF p_reason IN ('minor', 'review') THEN
      PERFORM public.enqueue_moderation('profile', p_id, 'screen', p_reason);
    END IF;
    IF p_reason IN ('sexual', 'harm', 'minor') THEN
      PERFORM public.record_strike(v_author, p_reason);
    END IF;
  END IF;
  RETURN p_verdict;
END $$;

-- 051 body; the social loop now covers bios only.
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

  -- Bios: exhausted → held for review; the rest → one more try.
  FOR v_id IN
    SELECT user_id FROM public.social_profiles
    WHERE bio_screen IS NULL AND bio IS NOT NULL AND screen_attempts >= 6 LIMIT 100
  LOOP
    PERFORM public.apply_social_screen('social_profiles', v_id, 'held', 'review');
    v_n := v_n + 1;
  END LOOP;
  WITH u AS (
    UPDATE public.social_profiles SET screen_attempts = screen_attempts + 1
    WHERE user_id IN (SELECT user_id FROM public.social_profiles
      WHERE bio_screen IS NULL AND bio IS NOT NULL AND screen_attempts < 6
        AND created_at < now() - interval '2 minutes' LIMIT 100)
    RETURNING user_id)
  SELECT array_agg(user_id) INTO v_ids FROM u;
  IF v_url IS NOT NULL AND v_key IS NOT NULL THEN
    FOREACH v_id IN ARRAY COALESCE(v_ids, '{}') LOOP
      PERFORM net.http_post(
        url     := v_url || '/functions/v1/screen-bottle',
        headers := jsonb_build_object('Content-Type', 'application/json',
                                      'Authorization', 'Bearer ' || v_key),
        body    := jsonb_build_object('table', 'social_profiles', 'id', v_id));
    END LOOP;
  END IF;
  v_n := v_n + COALESCE(array_length(v_ids, 1), 0);

  RETURN v_n;
END;
$$;

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
        WHEN 'bottle'  THEN (SELECT message FROM public.bottles WHERE id = q.target_id)
        WHEN 'profile' THEN (SELECT '@' || handle || COALESCE(' — ' || bio, '')
                             FROM public.social_profiles WHERE user_id = q.target_id)
        WHEN 'user'    THEN (SELECT 'Suspended: ' || COALESCE(suspension_reason, '?')
                             FROM public.profiles WHERE id = q.target_id)
      END,
      'state', CASE q.kind
        WHEN 'bottle'  THEN (SELECT COALESCE(screen, 'unscreened') FROM public.bottles WHERE id = q.target_id)
        WHEN 'profile' THEN (SELECT COALESCE(bio_screen, 'unscreened') FROM public.social_profiles WHERE user_id = q.target_id)
        WHEN 'user'    THEN (SELECT CASE WHEN suspended_at IS NULL THEN 'active' ELSE 'suspended' END
                             FROM public.profiles WHERE id = q.target_id)
      END
    ) ORDER BY q.created_at)
    FROM public.moderation_queue q
    WHERE q.resolved_at IS NULL
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
      WHEN 'profile' THEN UPDATE public.social_profiles
        SET bio = NULL, bio_screen = 'held' WHERE user_id = q.target_id;
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
      WHEN 'profile' THEN UPDATE public.social_profiles SET bio_screen = 'ok' WHERE user_id = q.target_id;
      WHEN 'user' THEN UPDATE public.profiles SET suspended_at = NULL, suspension_reason = NULL WHERE id = q.target_id;
    END CASE;
    v_result := 'restored';

  ELSIF p_action = 'dismiss' THEN
    v_result := 'dismissed';

  ELSE
    RAISE EXCEPTION 'unknown action %', p_action USING ERRCODE = '22023';
  END IF;

  UPDATE public.moderation_queue SET resolved_at = now(), resolution = v_result WHERE id = q.id;
  RETURN v_result;
END;
$$;
