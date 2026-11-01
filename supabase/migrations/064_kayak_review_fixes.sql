-- Migration 064: fixes from the code review of Kayak voyages (063).
--
-- 1. Monthly refill: age() undercounts on a clamped month end, which left
--    next_refill_at in the past, so every read refilled the allowance.
-- 2. The sailing engine locks the voyage first, in the same order as every other
--    path, and re-checks state, so a recall or comment can't be overwritten or
--    deadlock with it. One bad row no longer rolls back a whole run.
-- 3. A look accepts only known keys. Extra keys were an unscreened channel to
--    every harbour the Kayak visited.
-- 4. Dismissing a report clears it: the comment returns and the strike goes.
-- 5. Restoring an old held edit can't replace a newer note.
-- 6. "New comments" counts from when a comment passed, and its owner is told.
-- 7. A recipient is told when a Kayak leaves them.
-- 8. Notices can tell "still waiting" from "a moderator has decided".
-- 9. No comments on a Kayak whose owner can no longer sail.

ALTER TABLE public.kayak_comments ADD COLUMN IF NOT EXISTS screened_at TIMESTAMPTZ;
UPDATE public.kayak_comments SET screened_at = created_at WHERE screen = 'ok' AND screened_at IS NULL;

-- ─── 1. refill date ─────────────────────────────────────────────────────────
-- The first anniversary of p_since after p_now. Counted, because month ends
-- clamp (Jan 31 → Feb 28 → Mar 31) and age() disagrees about them.
-- ponytail: walks every month since joining; a few hundred steps at the very most.
CREATE OR REPLACE FUNCTION public.kayak_next_refill(p_since TIMESTAMPTZ, p_now TIMESTAMPTZ)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  n INT := 1;
BEGIN
  WHILE p_since + make_interval(months => n) <= p_now LOOP
    n := n + 1;
  END LOOP;
  RETURN p_since + make_interval(months => n);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.kayak_next_refill(TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.kayak_topup(p_uid UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_m    public.memberships%ROWTYPE;
  v_a    public.kayak_allowances%ROWTYPE;
  v_cap  SMALLINT;
  v_next TIMESTAMPTZ;
BEGIN
  SELECT * INTO v_a FROM public.kayak_allowances WHERE user_id = p_uid FOR UPDATE;
  SELECT * INTO v_m FROM public.memberships WHERE user_id = p_uid;
  IF NOT FOUND OR v_m.access_until <= now() THEN
    RETURN COALESCE(v_a.remaining, 0);
  END IF;

  v_cap := CASE WHEN v_m.plan = 'lifetime' OR now() >= v_m.keeper_since + interval '7 days'
                THEN 30 ELSE 5 END;
  v_next := public.kayak_next_refill(v_m.keeper_since, now());

  INSERT INTO public.kayak_allowances AS a (user_id, remaining, cap, next_refill_at)
  VALUES (p_uid, v_cap, v_cap, v_next)
  ON CONFLICT (user_id) DO UPDATE SET
    remaining = CASE WHEN now() >= a.next_refill_at OR EXCLUDED.cap > a.cap
                     THEN EXCLUDED.cap ELSE a.remaining END,
    cap = EXCLUDED.cap,
    next_refill_at = EXCLUDED.next_refill_at
  RETURNING remaining INTO v_cap;
  RETURN v_cap;
END;
$$;

-- ─── 2 and 7. moving a Kayak ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.kayak_send_home(p_voyage UUID, p_reason TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v     public.voyages%ROWTYPE;
  v_who UUID;
BEGIN
  SELECT * INTO v FROM public.voyages WHERE id = p_voyage FOR UPDATE;
  IF NOT FOUND OR v.state IN ('returning', 'home') THEN
    RETURN;
  END IF;
  UPDATE public.kayak_visits SET left_at = now(), left_reason = p_reason
  WHERE voyage_id = p_voyage AND left_at IS NULL
  RETURNING recipient_id INTO v_who;
  IF v_who IS NOT NULL THEN
    PERFORM public.kayak_ping(v_who);
  END IF;
  UPDATE public.gems SET state = 'stock', kayak_id = NULL
  WHERE kayak_id = v.kayak_id AND state = 'aboard';
  UPDATE public.voyages
  SET state = 'returning', sail_until = now() + interval '1 hour', end_reason = p_reason
  WHERE id = p_voyage;
  PERFORM public.kayak_ping(v.owner_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.kayak_next_leg(p_voyage UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v public.voyages%ROWTYPE;
BEGIN
  SELECT * INTO v FROM public.voyages WHERE id = p_voyage FOR UPDATE;
  -- Only a visit ends in a next leg; a Kayak already moving keeps its course.
  IF NOT FOUND OR v.state <> 'visiting' THEN
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM public.gems WHERE kayak_id = v.kayak_id AND state = 'aboard') THEN
    UPDATE public.voyages SET state = 'sailing', sail_until = now() + interval '1 hour'
    WHERE id = p_voyage;
    PERFORM public.kayak_ping(v.owner_id);
  ELSE
    PERFORM public.kayak_send_home(p_voyage, 'empty');
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.advance_kayaks()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r      RECORD;
  v_who  UUID;
  v_city TEXT;
  v_id   UUID;
  v_n    INTEGER := 0;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtext('advance_kayaks')) THEN
    RETURN 0;
  END IF;

  -- Every move locks the voyage first, then re-checks it: the lists below are
  -- only candidates, and a recall or a comment may have got there first. Each
  -- is its own subtransaction, so one bad row can't roll back the whole run.

  -- 1. Owners who lost the right to sail. The 3-day grace is in owner_may_sail.
  FOR r IN
    SELECT v.id, p.suspended_at IS NOT NULL AS suspended
    FROM public.voyages v JOIN public.profiles p ON p.id = v.owner_id
    WHERE v.state IN ('screening', 'sailing', 'visiting')
      AND NOT public.owner_may_sail(v.owner_id)
  LOOP
    BEGIN
      -- Each no-ops unless the voyage is still in a state it applies to.
      PERFORM public.kayak_stay_ashore(r.id, CASE WHEN r.suspended THEN 'suspended' ELSE 'lapsed' END);
      PERFORM public.kayak_send_home(r.id, CASE WHEN r.suspended THEN 'suspended' ELSE 'lapsed' END);
      v_n := v_n + 1;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'advance_kayaks: sending voyage % home failed: %', r.id, SQLERRM;
    END;
  END LOOP;

  -- 2. Visits that are over: 24h up, or the recipient can no longer have it.
  -- Recipients get no grace, and a block made since arrival counts.
  FOR r IN
    SELECT vi.id, vi.voyage_id, vi.recipient_id,
           CASE WHEN vi.arrived_at <= now() - interval '24 hours' THEN 'expired' ELSE 'ineligible' END AS why
    FROM public.kayak_visits vi
    JOIN public.profiles p ON p.id = vi.recipient_id
    WHERE vi.left_at IS NULL
      AND (vi.arrived_at <= now() - interval '24 hours'
           OR NOT public.is_keeper(vi.recipient_id)
           OR p.suspended_at IS NOT NULL
           OR EXISTS (SELECT 1 FROM public.kayak_blocks b
             WHERE (b.blocker_id = vi.recipient_id AND b.blocked_id = vi.owner_id)
                OR (b.blocker_id = vi.owner_id AND b.blocked_id = vi.recipient_id)))
  LOOP
    BEGIN
      PERFORM 1 FROM public.voyages WHERE id = r.voyage_id FOR UPDATE;
      UPDATE public.kayak_visits SET left_at = now(), left_reason = r.why
      WHERE id = r.id AND left_at IS NULL;
      IF FOUND THEN
        PERFORM public.kayak_next_leg(r.voyage_id);
        PERFORM public.kayak_ping(r.recipient_id);
        v_n := v_n + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'advance_kayaks: ending visit % failed: %', r.id, SQLERRM;
    END;
  END LOOP;

  -- A recipient who deleted their account took the visit row with them.
  FOR r IN
    SELECT v.id FROM public.voyages v
    WHERE v.state = 'visiting'
      AND NOT EXISTS (SELECT 1 FROM public.kayak_visits vi WHERE vi.voyage_id = v.id AND vi.left_at IS NULL)
  LOOP
    BEGIN
      PERFORM 1 FROM public.voyages WHERE id = r.id FOR UPDATE;
      IF NOT EXISTS (SELECT 1 FROM public.kayak_visits vi WHERE vi.voyage_id = r.id AND vi.left_at IS NULL) THEN
        PERFORM public.kayak_next_leg(r.id);
        v_n := v_n + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'advance_kayaks: repairing voyage % failed: %', r.id, SQLERRM;
    END;
  END LOOP;

  -- 3. Home at the mast.
  FOR r IN
    SELECT id, owner_id FROM public.voyages WHERE state = 'returning' AND sail_until <= now()
  LOOP
    BEGIN
      UPDATE public.voyages SET state = 'home', sail_until = NULL, ended_at = now()
      WHERE id = r.id AND state = 'returning';
      IF FOUND THEN
        PERFORM public.kayak_ping(r.owner_id);
        PERFORM public.kayak_post_email(jsonb_build_object('voyage_id', r.id));
        v_n := v_n + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'advance_kayaks: voyage % home failed: %', r.id, SQLERRM;
    END;
  END LOOP;

  -- 4. Arrivals. No fitting harbour: it keeps sailing and tries next run.
  FOR r IN
    SELECT id, owner_id FROM public.voyages
    WHERE state = 'sailing' AND sail_until <= now()
    ORDER BY sail_until
  LOOP
    BEGIN
      PERFORM 1 FROM public.voyages
      WHERE id = r.id AND state = 'sailing' AND sail_until <= now() FOR UPDATE;
      IF NOT FOUND OR public.kayak_current_note(r.id) IS NULL THEN
        CONTINUE;
      END IF;
      v_who := public.kayak_pick_recipient(r.id, r.owner_id);
      IF v_who IS NULL THEN
        CONTINUE;
      END IF;
      SELECT city INTO v_city FROM public.profiles WHERE id = v_who;
      INSERT INTO public.kayak_visits (voyage_id, owner_id, recipient_id, city)
      VALUES (r.id, r.owner_id, v_who, v_city)
      RETURNING id INTO v_id;
      UPDATE public.voyages SET state = 'visiting', sail_until = NULL WHERE id = r.id;
      PERFORM public.kayak_ping(v_who);
      PERFORM public.kayak_ping(r.owner_id);
      PERFORM public.kayak_post_email(jsonb_build_object('visit_id', v_id));
      v_n := v_n + 1;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'advance_kayaks: arrival for voyage % failed: %', r.id, SQLERRM;
    END;
  END LOOP;

  -- 5. Emails that never landed. Same limits as bottles (038): 20 a run, 8 tries.
  FOR r IN
    SELECT vi.id FROM public.kayak_visits vi
    JOIN public.profiles p ON p.id = vi.recipient_id
    WHERE vi.left_at IS NULL AND vi.email_notified_at IS NULL AND vi.email_attempts < 8
      AND p.email_notifications = TRUE AND vi.arrived_at < now() - interval '10 minutes'
    ORDER BY vi.email_attempts, vi.arrived_at
    LIMIT 20
  LOOP
    UPDATE public.kayak_visits SET email_attempts = email_attempts + 1 WHERE id = r.id;
    PERFORM public.kayak_post_email(jsonb_build_object('visit_id', r.id));
  END LOOP;
  FOR r IN
    SELECT v.id FROM public.voyages v
    JOIN public.profiles p ON p.id = v.owner_id
    WHERE v.state = 'home' AND v.email_notified_at IS NULL AND v.email_attempts < 8
      AND p.email_notifications = TRUE AND v.ended_at < now() - interval '10 minutes'
    ORDER BY v.email_attempts, v.ended_at
    LIMIT 20
  LOOP
    UPDATE public.voyages SET email_attempts = email_attempts + 1 WHERE id = r.id;
    PERFORM public.kayak_post_email(jsonb_build_object('voyage_id', r.id));
  END LOOP;

  RETURN v_n;
END;
$$;

-- ─── 3. looks ───────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.check_kayak_look(p_look JSONB)
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_slot TEXT;
  v_item TEXT;
BEGIN
  IF jsonb_typeof(p_look) <> 'object'
     OR (p_look ->> 'vessel') IS NULL
     OR (p_look ->> 'vessel') NOT IN ('sit_on_top', 'sea_kayak', 'canoe', 'rowing_boat', 'dinghy',
                                      'sailboat', 'punt', 'coracle', 'pirogue', 'outrigger')
     OR COALESCE(p_look ->> 'pattern', 'none') NOT IN ('none', 'stripes', 'waves', 'scales', 'stars', 'woodgrain', 'faded')
     OR (p_look ->> 'paddle') IS NULL
     OR (p_look ->> 'paddle') NOT IN ('double_blade', 'canoe_paddle', 'wooden_oars', 'painted_tips')
     OR NOT EXISTS (SELECT 1 FROM public.atelier_pieces a
                    WHERE a.kind = 'glass' AND a.id = p_look ->> 'color' AND NOT a.retired) THEN
    RAISE EXCEPTION 'bad_look' USING ERRCODE = '22023';
  END IF;
  -- Nothing here is screened, and strangers receive it, so nothing unknown gets in.
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_look) k
             WHERE k NOT IN ('vessel', 'color', 'pattern', 'paddle', 'deck')) THEN
    RAISE EXCEPTION 'bad_look' USING ERRCODE = '22023';
  END IF;
  IF p_look ? 'deck' THEN
    IF jsonb_typeof(p_look -> 'deck') <> 'object' THEN
      RAISE EXCEPTION 'bad_look' USING ERRCODE = '22023';
    END IF;
    FOR v_slot, v_item IN SELECT key, value FROM jsonb_each_text(p_look -> 'deck') LOOP
      IF v_slot NOT IN ('bow', 'mid', 'stern')
         OR (v_item IS NOT NULL AND v_item NOT IN ('lantern', 'flag', 'plant', 'cat', 'dog', 'books', 'gull', 'fishing_rod',
                                               'crate', 'rope', 'teapot', 'parasol', 'guitar', 'blanket', 'shells', 'radio')) THEN
        RAISE EXCEPTION 'bad_look' USING ERRCODE = '22023';
      END IF;
    END LOOP;
  END IF;
END;
$$;

-- ─── 6. verdicts ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.apply_kayak_screen(
  p_table   TEXT,
  p_id      UUID,
  p_verdict TEXT,
  p_reason  TEXT DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_author UUID;
  v_voyage public.voyages%ROWTYPE;
  v_note   UUID;
  v_kind   TEXT;
BEGIN
  IF p_verdict = 'crisis' THEN
    p_verdict := 'held';
    p_reason  := 'crisis';
  END IF;
  IF p_verdict NOT IN ('ok', 'held') THEN
    RAISE EXCEPTION 'bad verdict %', p_verdict;
  END IF;

  IF p_table = 'kayak_notes' THEN
    v_kind := 'kayak_note';
    SELECT n.owner_id, n.voyage_id INTO v_author, v_note FROM public.kayak_notes n WHERE n.id = p_id;
    IF NOT FOUND THEN
      RETURN 'not_found';
    END IF;
    SELECT * INTO v_voyage FROM public.voyages WHERE id = v_note FOR UPDATE;
    UPDATE public.kayak_notes
    SET screen = p_verdict,
        screen_reason = CASE WHEN p_verdict = 'held' THEN p_reason END,
        superseded_at = CASE WHEN p_verdict = 'held' THEN now() ELSE superseded_at END
    WHERE id = p_id AND screen IS NULL;
    IF NOT FOUND THEN
      RETURN 'already_screened'; -- pg_net may deliver twice
    END IF;

    IF p_verdict = 'ok' THEN
      IF v_voyage.state = 'screening' THEN
        -- The first leg counts from launch, like a bottle from its throw.
        UPDATE public.voyages
        SET state = 'sailing', sail_until = GREATEST(now(), started_at + interval '1 hour')
        WHERE id = v_voyage.id;
      ELSIF v_voyage.state IN ('sailing', 'visiting') THEN
        PERFORM public.kayak_promote_note(p_id);
      ELSE
        -- Called home while the edit was being checked; it never goes live.
        UPDATE public.kayak_notes SET superseded_at = now() WHERE id = p_id;
      END IF;
    ELSIF v_voyage.state = 'screening' THEN
      PERFORM public.kayak_stay_ashore(v_voyage.id, 'note_held');
    END IF;

  ELSIF p_table = 'kayak_comments' THEN
    v_kind := 'kayak_comment';
    SELECT c.author_id INTO v_author FROM public.kayak_comments c WHERE c.id = p_id;
    IF NOT FOUND THEN
      RETURN 'not_found';
    END IF;
    UPDATE public.kayak_comments
    SET screen = p_verdict,
        screen_reason = CASE WHEN p_verdict = 'held' THEN p_reason END,
        screened_at = now()
    WHERE id = p_id AND screen IS NULL;
    IF NOT FOUND THEN
      RETURN 'already_screened';
    END IF;
    IF p_verdict = 'ok' THEN
      PERFORM public.kayak_keep_gem(p_id);
      -- The owner has a new comment to read.
      SELECT n.owner_id INTO v_note
      FROM public.kayak_comments c JOIN public.kayak_notes n ON n.id = c.note_id WHERE c.id = p_id;
      IF v_note IS NOT NULL THEN
        PERFORM public.kayak_ping(v_note);
      END IF;
    ELSIF p_reason NOT IN ('minor', 'review') THEN
      -- Queued holds keep the gem reserved until an admin rules.
      PERFORM public.kayak_release_gem(p_id);
    END IF;

  ELSE
    RAISE EXCEPTION 'bad table %', p_table;
  END IF;

  IF v_author IS NOT NULL THEN
    PERFORM public.kayak_ping(v_author);
  END IF;
  IF p_verdict = 'held' THEN
    IF p_reason IN ('minor', 'review') THEN
      PERFORM public.enqueue_moderation(v_kind, p_id, 'screen', p_reason);
    END IF;
    IF p_reason IN ('sexual', 'harm', 'minor') THEN
      PERFORM public.record_strike(v_author, p_reason);
    END IF;
  END IF;
  RETURN p_verdict;
END;
$$;

-- ─── 9. commenting ──────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.leave_comment(p_visit UUID, p_gem UUID, p_body TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  uid   UUID := public.kayak_require_member();
  v     public.kayak_visits%ROWTYPE := public.kayak_my_visit(p_visit, uid);
  v_k   UUID;
  v_id  UUID;
BEGIN
  IF NOT public.owner_may_sail(v.owner_id) THEN
    RAISE EXCEPTION 'visit_over' USING ERRCODE = 'P0002';
  END IF;
  SELECT kayak_id INTO v_k FROM public.voyages WHERE id = v.voyage_id;
  PERFORM 1 FROM public.gems WHERE id = p_gem AND kayak_id = v_k AND state = 'aboard' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'gem_gone' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.kayak_comments (note_id, visit_id, author_id, body)
  VALUES (public.kayak_current_note(v.voyage_id), p_visit, uid, btrim(p_body))
  RETURNING id INTO v_id;

  UPDATE public.gems SET state = 'reserved', holder_id = uid, comment_id = v_id WHERE id = p_gem;
  UPDATE public.kayak_visits SET left_at = now(), left_reason = 'commented' WHERE id = p_visit;
  PERFORM public.kayak_next_leg(v.voyage_id);
  PERFORM public.kayak_ping(uid);
  RETURN TRUE;
END;
$$;

-- ─── 4 and 5. moderators ────────────────────────────────────────────────────

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
  RETURN v_result;
END;
$$;

-- ─── 6 and 8. the Harbour read ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_harbour()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  uid    UUID := auth.uid();
  v_left INTEGER;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  UPDATE public.profiles SET last_active = now()
  WHERE id = uid AND (last_active IS NULL OR last_active < now() - interval '1 hour');
  v_left := public.kayak_topup(uid);

  RETURN jsonb_build_object(
    'keeper',  public.is_keeper(uid),
    'gems',    jsonb_build_object(
      'remaining', v_left,
      'stock',     (SELECT count(*) FROM public.gems WHERE owner_id = uid AND state = 'stock'),
      'refill_at', (SELECT next_refill_at FROM public.kayak_allowances WHERE user_id = uid)),
    'treasure', (SELECT count(*) FROM public.gems WHERE holder_id = uid AND state IN ('kept', 'reserved')),
    'kayaks',  COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
          'id',     k.id,
          'look',   k.look,
          'aboard', (SELECT count(*) FROM public.gems g WHERE g.kayak_id = k.id AND g.state = 'aboard'),
          'state',  COALESCE(v.state, 'home'),
          -- Only while it's actually there, and never who.
          'city',   (SELECT vi.city FROM public.kayak_visits vi WHERE vi.voyage_id = v.id AND vi.left_at IS NULL),
          'new_comments', (
            SELECT count(*) FROM public.kayak_comments c
            JOIN public.kayak_notes n ON n.id = c.note_id
            JOIN public.voyages vv ON vv.id = n.voyage_id
            WHERE vv.kayak_id = k.id AND c.screen = 'ok' AND c.reported_at IS NULL
              AND COALESCE(c.screened_at, c.created_at) > k.log_seen_at))
        ORDER BY k.created_at)
      FROM public.kayaks k
      LEFT JOIN public.voyages v ON v.kayak_id = k.id AND v.state <> 'home'
      WHERE k.owner_id = uid
    ), '[]'::jsonb),
    -- Filter on the recipient's membership too: lapsed with the cron yet to run.
    'visitors', CASE WHEN public.is_keeper(uid) THEN COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
          'visit_id', vi.id,
          'look',     k.look,
          'aboard',   (SELECT count(*) FROM public.gems g WHERE g.kayak_id = k.id AND g.state = 'aboard'))
        ORDER BY vi.arrived_at)
      FROM public.kayak_visits vi
      JOIN public.voyages v ON v.id = vi.voyage_id
      JOIN public.kayaks k ON k.id = v.kayak_id
      WHERE vi.recipient_id = uid AND vi.left_at IS NULL AND public.owner_may_sail(vi.owner_id)
    ), '[]'::jsonb) ELSE '[]'::jsonb END,
    -- Held notes and comments, so the writer sees why and can rewrite.
    'notices', COALESCE((
      SELECT jsonb_agg(x ORDER BY x ->> 'at') FROM (
        SELECT jsonb_build_object('kind', 'note', 'id', n.id, 'reason', n.screen_reason,
                                  'body', n.body, 'at', n.created_at,
                                  'waiting', EXISTS (SELECT 1 FROM public.moderation_queue q
                                    WHERE q.kind = 'kayak_note' AND q.target_id = n.id AND q.resolved_at IS NULL),
                                  'kayak_id', (SELECT kayak_id FROM public.voyages WHERE id = n.voyage_id)) AS x
        FROM public.kayak_notes n
        WHERE n.owner_id = uid AND n.screen = 'held' AND n.acked_at IS NULL AND n.reported_at IS NULL
        UNION ALL
        SELECT jsonb_build_object('kind', 'comment', 'id', c.id, 'reason', c.screen_reason,
                                  'body', c.body, 'at', c.created_at,
                                  'waiting', EXISTS (SELECT 1 FROM public.moderation_queue q
                                    WHERE q.kind = 'kayak_comment' AND q.target_id = c.id AND q.resolved_at IS NULL))
        FROM public.kayak_comments c
        WHERE c.author_id = uid AND c.screen = 'held' AND c.acked_at IS NULL AND c.reported_at IS NULL
      ) notices
    ), '[]'::jsonb));
END;
$$;
