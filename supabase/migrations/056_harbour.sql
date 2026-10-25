-- Migration 056: The Harbour — kayaks, the daily twelve, blocks and reports.
--
-- A kayak is a Keeper's pseudonymous profile (social_profiles handle + bio)
-- with a hull and paddle colour. Opted-in ("parked") kayaks form one global
-- harbour of up to 12 per UTC day, picked shuffle-deck style: everyone in the
-- pool shows once before anyone repeats. Keepers only, both to look and to
-- park. A kayak never links to its owner's bottles.
--
-- Clients get no table grants; every read and write is an RPC keyed by
-- handle, so user ids never reach the browser.

-- ─── profile screening covers the handle too ────────────────────────────────
-- bio_screen (051) is now the verdict on handle + bio together; screen-bottle
-- reads both. Every profile is screened, not only those with a bio.
DROP TRIGGER IF EXISTS social_profiles_screen ON public.social_profiles;
CREATE TRIGGER social_profiles_screen AFTER INSERT OR UPDATE OF bio ON public.social_profiles
  FOR EACH ROW EXECUTE FUNCTION public.screen_new_social();

-- 055 body; bios loop no longer skips profiles without a bio.
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

  -- Profiles: exhausted → held for review; the rest → one more try.
  FOR v_id IN
    SELECT user_id FROM public.social_profiles
    WHERE bio_screen IS NULL AND screen_attempts >= 6 LIMIT 100
  LOOP
    PERFORM public.apply_social_screen('social_profiles', v_id, 'held', 'review');
    v_n := v_n + 1;
  END LOOP;
  WITH u AS (
    UPDATE public.social_profiles SET screen_attempts = screen_attempts + 1
    WHERE user_id IN (SELECT user_id FROM public.social_profiles
      WHERE bio_screen IS NULL AND screen_attempts < 6
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

-- ─── tables ─────────────────────────────────────────────────────────────────
-- ponytail: palettes mirror apps/web/lib/harbour.ts; widen both together.
CREATE TABLE public.kayaks (
  user_id    UUID PRIMARY KEY REFERENCES public.social_profiles(user_id) ON DELETE CASCADE,
  hull       TEXT NOT NULL DEFAULT 'yellow'
             CHECK (hull IN ('yellow', 'white', 'coral', 'teal', 'navy', 'lime')),
  paddle     TEXT NOT NULL DEFAULT 'red'
             CHECK (paddle IN ('red', 'black', 'white', 'yellow', 'blue')),
  parked     BOOLEAN NOT NULL DEFAULT FALSE,
  -- Shuffle-deck position: how many times this kayak has been in the twelve.
  round      INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX kayaks_pool_idx ON public.kayaks (round) WHERE parked;

-- The day's twelve, written once per UTC day.
CREATE TABLE public.harbour_days (
  day     DATE     NOT NULL,
  slot    SMALLINT NOT NULL CHECK (slot BETWEEN 1 AND 12),
  user_id UUID     NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  PRIMARY KEY (day, slot),
  UNIQUE (day, user_id)
);

-- Blocks hide both ways.
CREATE TABLE public.kayak_blocks (
  blocker_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  blocked_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);
CREATE INDEX kayak_blocks_blocked_idx ON public.kayak_blocks (blocked_id);

-- One report per reporter per kayak; a reported kayak is hidden from its reporter.
CREATE TABLE public.kayak_reports (
  reporter_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  target_id   UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reason      TEXT NOT NULL CHECK (reason IN ('sexual', 'harassment', 'spam', 'contact', 'other')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (reporter_id, target_id),
  CHECK (reporter_id <> target_id)
);
CREATE INDEX kayak_reports_target_idx ON public.kayak_reports (target_id);

ALTER TABLE public.kayaks        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.harbour_days  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kayak_blocks  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kayak_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.kayaks, public.harbour_days, public.kayak_blocks, public.kayak_reports
  FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.kayaks, public.harbour_days, public.kayak_blocks, public.kayak_reports TO service_role;

-- ─── who may float ──────────────────────────────────────────────────────────
-- Shown today: parked, a live Keeper, an adult in good standing, and a profile
-- that passed the screen (a held or reported-away profile is 'held').
CREATE OR REPLACE FUNCTION public.kayak_afloat(p_uid UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.kayaks k
    JOIN public.social_profiles sp ON sp.user_id = k.user_id
    JOIN public.profiles p ON p.id = k.user_id
    WHERE k.user_id = p_uid
      AND k.parked
      AND sp.bio_screen = 'ok'
      AND p.suspended_at IS NULL
      AND p.age_confirmed_at IS NOT NULL
      AND public.is_keeper(p_uid)
  );
$$;

-- The pick's pool: afloat and active in the last 14 days.
CREATE OR REPLACE FUNCTION public.kayak_in_pool(p_uid UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.kayak_afloat(p_uid)
     AND EXISTS (SELECT 1 FROM public.profiles
                 WHERE id = p_uid AND last_active > now() - interval '14 days');
$$;

-- ─── the daily pick ─────────────────────────────────────────────────────────
-- Lowest round first, random within it, so everyone shows once before anyone
-- repeats. Idempotent per day; cron runs it at 00:00 UTC and get_harbour()
-- runs it lazily if the cron hasn't. A day picked from an empty pool stays
-- unpicked, so the first kayak launched that day still sails.
CREATE OR REPLACE FUNCTION public.pick_harbour(p_day DATE)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_n INTEGER;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('pick_harbour'));
  IF EXISTS (SELECT 1 FROM public.harbour_days WHERE day = p_day) THEN
    RETURN 0;
  END IF;

  WITH picked AS (
    SELECT k.user_id
    FROM public.kayaks k
    WHERE k.parked AND public.kayak_in_pool(k.user_id)
    ORDER BY k.round, random()
    LIMIT 12
  )
  INSERT INTO public.harbour_days (day, slot, user_id)
  SELECT p_day, row_number() OVER (ORDER BY random()), user_id FROM picked;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  UPDATE public.kayaks SET round = round + 1
  WHERE user_id IN (SELECT user_id FROM public.harbour_days WHERE day = p_day);
  RETURN v_n;
END;
$$;

SELECT cron.schedule('pick-harbour', '0 0 * * *',
  $$ SELECT public.pick_harbour((now() AT TIME ZONE 'UTC')::date); $$);

-- ─── reads ──────────────────────────────────────────────────────────────────
-- Today's harbour for the caller. Non-Keepers get { keeper: false } and no
-- kayaks (the app shows a preview instead). Your own kayak always comes back
-- as `mine`, with whether it is in today's ring and why it might not float.
CREATE OR REPLACE FUNCTION public.get_harbour()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  uid    UUID := auth.uid();
  v_day  DATE := (now() AT TIME ZONE 'UTC')::date;
  v_mine JSONB;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
      'handle',  sp.handle,
      'bio',     sp.bio,
      'screen',  sp.bio_screen,
      'hull',    k.hull,
      'paddle',  k.paddle,
      'parked',  COALESCE(k.parked, FALSE),
      'launched', k.user_id IS NOT NULL,
      'afloat',  public.kayak_afloat(uid),
      'in_ring', EXISTS (SELECT 1 FROM public.harbour_days d WHERE d.day = v_day AND d.user_id = uid))
  INTO v_mine
  FROM public.social_profiles sp
  LEFT JOIN public.kayaks k ON k.user_id = sp.user_id
  WHERE sp.user_id = uid;

  IF NOT public.is_keeper(uid) THEN
    RETURN jsonb_build_object('keeper', FALSE, 'day', v_day, 'kayaks', '[]'::jsonb, 'mine', v_mine);
  END IF;

  -- Counts toward "active in the last 14 days"; at most one write an hour.
  UPDATE public.profiles SET last_active = now()
  WHERE id = uid AND (last_active IS NULL OR last_active < now() - interval '1 hour');

  IF NOT EXISTS (SELECT 1 FROM public.harbour_days WHERE day = v_day) THEN
    PERFORM public.pick_harbour(v_day);
  END IF;

  RETURN jsonb_build_object(
    'keeper', TRUE,
    'day',    v_day,
    'mine',   v_mine,
    'kayaks', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
          'slot',   d.slot,
          'handle', sp.handle,
          'bio',    sp.bio,
          'hull',   k.hull,
          'paddle', k.paddle,
          'mine',   d.user_id = uid)
        ORDER BY d.slot)
      FROM public.harbour_days d
      JOIN public.kayaks k ON k.user_id = d.user_id
      JOIN public.social_profiles sp ON sp.user_id = d.user_id
      WHERE d.day = v_day
        AND public.kayak_afloat(d.user_id)
        AND NOT EXISTS (SELECT 1 FROM public.kayak_blocks b
          WHERE (b.blocker_id = uid AND b.blocked_id = d.user_id)
             OR (b.blocker_id = d.user_id AND b.blocked_id = uid))
        AND NOT EXISTS (SELECT 1 FROM public.kayak_reports r
          WHERE r.reporter_id = uid AND r.target_id = d.user_id)
    ), '[]'::jsonb)
  );
END;
$$;

-- Handles you've blocked, for undoing a block in settings.
CREATE OR REPLACE FUNCTION public.get_kayak_blocks()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(jsonb_agg(sp.handle ORDER BY b.created_at DESC), '[]'::jsonb)
  FROM public.kayak_blocks b
  JOIN public.social_profiles sp ON sp.user_id = b.blocked_id
  WHERE b.blocker_id = auth.uid();
$$;

-- ─── writes ─────────────────────────────────────────────────────────────────
-- Launch / recolour / pull ashore. Needs a claimed handle; parking needs a
-- live Keeper in good standing. A newly parked kayak joins the deck at the
-- lowest round in the pool, so it neither jumps the queue nor waits behind it.
CREATE OR REPLACE FUNCTION public.save_kayak(p_hull TEXT, p_paddle TEXT, p_parked BOOLEAN)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  uid   UUID := auth.uid();
  v_p   RECORD;
  v_was BOOLEAN;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.social_profiles WHERE user_id = uid) THEN
    RAISE EXCEPTION 'no_handle' USING ERRCODE = 'P0002';
  END IF;
  SELECT suspended_at, age_confirmed_at INTO v_p FROM public.profiles WHERE id = uid;
  IF v_p.suspended_at IS NOT NULL THEN
    RAISE EXCEPTION 'account_suspended' USING ERRCODE = '42501';
  END IF;
  IF v_p.age_confirmed_at IS NULL THEN
    RAISE EXCEPTION 'age_unconfirmed' USING ERRCODE = '42501';
  END IF;
  IF p_parked AND NOT public.is_keeper(uid) THEN
    RAISE EXCEPTION 'keeper_only' USING ERRCODE = '42501';
  END IF;

  SELECT parked INTO v_was FROM public.kayaks WHERE user_id = uid;
  INSERT INTO public.kayaks (user_id, hull, paddle, parked, round)
  VALUES (uid, p_hull, p_paddle, p_parked,
          COALESCE((SELECT min(round) FROM public.kayaks WHERE parked AND public.kayak_in_pool(user_id)), 0))
  ON CONFLICT (user_id) DO UPDATE
  SET hull = EXCLUDED.hull,
      paddle = EXCLUDED.paddle,
      parked = EXCLUDED.parked,
      round = CASE WHEN EXCLUDED.parked AND NOT kayaks.parked
                   THEN GREATEST(kayaks.round, EXCLUDED.round) ELSE kayaks.round END,
      updated_at = now();
  RETURN jsonb_build_object('hull', p_hull, 'paddle', p_paddle, 'parked', p_parked,
                            'afloat', public.kayak_afloat(uid));
END;
$$;

CREATE OR REPLACE FUNCTION public.block_kayak(p_handle TEXT, p_block BOOLEAN DEFAULT TRUE)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  uid      UUID := auth.uid();
  v_target UUID;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT user_id INTO v_target FROM public.social_profiles WHERE handle = lower(p_handle);
  IF v_target IS NULL OR v_target = uid THEN
    RETURN FALSE;
  END IF;
  IF p_block THEN
    INSERT INTO public.kayak_blocks (blocker_id, blocked_id) VALUES (uid, v_target)
    ON CONFLICT DO NOTHING;
  ELSE
    DELETE FROM public.kayak_blocks WHERE blocker_id = uid AND blocked_id = v_target;
  END IF;
  RETURN TRUE;
END;
$$;

-- Every report reaches the moderation queue; the third distinct reporter
-- takes the kayak out of the harbour (profile held) until a human looks,
-- and counts as a strike — 051's rule for profiles.
CREATE OR REPLACE FUNCTION public.report_kayak(p_handle TEXT, p_reason TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  uid      UUID := auth.uid();
  v_target UUID;
  v_n      INT;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT user_id INTO v_target FROM public.social_profiles WHERE handle = lower(p_handle);
  IF v_target IS NULL OR v_target = uid THEN
    RETURN FALSE;
  END IF;
  INSERT INTO public.kayak_reports (reporter_id, target_id, reason) VALUES (uid, v_target, p_reason)
  ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN
    RETURN TRUE; -- already reported by you; already hidden from you
  END IF;
  PERFORM public.enqueue_moderation('profile', v_target, 'report', p_reason, TRUE);
  SELECT count(*) INTO v_n FROM public.kayak_reports WHERE target_id = v_target;
  IF v_n = 3 THEN
    UPDATE public.social_profiles SET bio = NULL, bio_screen = 'held' WHERE user_id = v_target;
    PERFORM public.record_strike(v_target, 'report');
  END IF;
  RETURN TRUE;
END;
$$;

-- ─── grants ─────────────────────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.kayak_afloat(UUID)               FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.pick_harbour(DATE)               FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.kayak_in_pool(UUID)              FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_harbour()                    FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_kayak_blocks()               FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.save_kayak(TEXT, TEXT, BOOLEAN)  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.block_kayak(TEXT, BOOLEAN)       FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.report_kayak(TEXT, TEXT)         FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_harbour()                     TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_kayak_blocks()                TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_kayak(TEXT, TEXT, BOOLEAN)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.block_kayak(TEXT, BOOLEAN)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.report_kayak(TEXT, TEXT)          TO authenticated;
GRANT EXECUTE ON FUNCTION public.pick_harbour(DATE)                TO service_role;
