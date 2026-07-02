-- Migration 025: daily mood check-in + ADHD-safe streak
--
-- WHY:
--   Phase 1 of the product spec — the retention spine. The throw is a once-a-day
--   action a user can "fail" silently (nothing to say today). The mood check-in
--   is a lower-bar daily ritual: one tap on a weather metaphor (stormy / foggy /
--   calm / sunny). It seeds the bottle flow ("Stormy today? Throw a bottle about
--   it") and anchors the streak, giving a gentle reason to return even on days
--   the user does not throw.
--
-- ADHD-SAFE STREAK:
--   Normal streaks PUNISH this audience — miss one day, lose a 300-day streak,
--   never return. So the streak forgives: up to GRACE_PER_MONTH missed days per
--   calendar month are auto-absorbed ("we held your place") instead of resetting.
--   No shame state is stored; the streak only ever advances or resets to 1.
--
-- ARCHITECTURE (matches send_bottle / migration 024):
--   - Per-user LOCAL day via user_local_date(uid) (migration 019), so the ritual
--     resets at the user's midnight, exactly like the daily quota.
--   - One atomic SECURITY DEFINER RPC the browser calls directly — zero Vercel
--     compute, one round trip.
--   - RLS enabled, owner-SELECT only; all writes go through the RPC.

-- ── Tables ──────────────────────────────────────────────────────────────────

-- One mood per user per local day. Re-checking the same day UPDATEs the mood
-- (people's read of their day changes); it does not advance the streak again.
CREATE TABLE public.mood_check_ins (
  user_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  local_date DATE NOT NULL,
  mood       TEXT NOT NULL CHECK (mood IN ('stormy', 'foggy', 'calm', 'sunny')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, local_date)
);
COMMENT ON TABLE public.mood_check_ins IS
  'One mood per user per local day (weather metaphor). Re-check updates the mood '
  'without re-advancing the streak. Drives the private mood history / save shelf.';

CREATE INDEX idx_mood_check_ins_user_date ON public.mood_check_ins(user_id, local_date DESC);

-- Denormalised streak state — one row per user. Derived from mood_check_ins but
-- materialised so the home screen reads it in one cheap lookup and the
-- grace/monthly-budget bookkeeping is explicit.
CREATE TABLE public.user_streaks (
  user_id            UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  current_streak     INTEGER NOT NULL DEFAULT 0,
  longest_streak     INTEGER NOT NULL DEFAULT 0,
  last_check_in_date DATE,
  grace_used         INTEGER NOT NULL DEFAULT 0,   -- missed days forgiven this grace_month
  grace_month        DATE,                          -- first-of-month this budget applies to
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.user_streaks IS
  'Materialised per-user streak. Advanced only by check_in_mood(); forgives up to '
  '2 missed days per calendar month (ADHD-safe) before resetting to 1.';

-- ── RLS: owner-read, RPC-only writes ────────────────────────────────────────
ALTER TABLE public.mood_check_ins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_streaks   ENABLE ROW LEVEL SECURITY;

CREATE POLICY mood_check_ins_select_own ON public.mood_check_ins
  FOR SELECT USING (user_id = auth.uid());
CREATE POLICY user_streaks_select_own ON public.user_streaks
  FOR SELECT USING (user_id = auth.uid());
-- No INSERT/UPDATE policies: only the SECURITY DEFINER RPCs below write.

-- ── check_in_mood(): upsert today's mood + advance the streak atomically ─────
CREATE OR REPLACE FUNCTION public.check_in_mood(p_mood TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  uid             UUID := auth.uid();
  v_today         DATE := public.user_local_date(auth.uid());
  GRACE_PER_MONTH CONSTANT INTEGER := 2;
  v_already       BOOLEAN;
  rec             public.user_streaks;
  v_gap           INTEGER;
  v_missed        INTEGER;
  v_new_streak    INTEGER;
  v_grace_used    INTEGER;
  v_grace_month   DATE := date_trunc('month', v_today)::date;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_mood NOT IN ('stormy', 'foggy', 'calm', 'sunny') THEN
    RAISE EXCEPTION 'Invalid mood' USING ERRCODE = '23514';
  END IF;

  -- Did the user already check in today? (Re-check only updates the mood.)
  v_already := EXISTS (
    SELECT 1 FROM public.mood_check_ins
    WHERE user_id = uid AND local_date = v_today
  );

  INSERT INTO public.mood_check_ins (user_id, local_date, mood)
  VALUES (uid, v_today, p_mood)
  ON CONFLICT (user_id, local_date)
    DO UPDATE SET mood = EXCLUDED.mood, updated_at = now();

  -- Lock (or create) the streak row for this user.
  INSERT INTO public.user_streaks (user_id) VALUES (uid)
    ON CONFLICT (user_id) DO NOTHING;
  SELECT * INTO rec FROM public.user_streaks WHERE user_id = uid FOR UPDATE;

  IF v_already THEN
    -- Mood updated, streak untouched.
    RETURN jsonb_build_object(
      'mood', p_mood,
      'current_streak', rec.current_streak,
      'longest_streak', rec.longest_streak,
      'checked_in_today', TRUE,
      'advanced', FALSE
    );
  END IF;

  -- New monthly budget if we've rolled into a different month.
  v_grace_used := rec.grace_used;
  IF rec.grace_month IS DISTINCT FROM v_grace_month THEN
    v_grace_used := 0;
  END IF;

  IF rec.last_check_in_date IS NULL THEN
    v_new_streak := 1;
  ELSE
    v_gap := v_today - rec.last_check_in_date;   -- whole days since last check-in
    IF v_gap = 1 THEN
      v_new_streak := rec.current_streak + 1;     -- consecutive day
    ELSIF v_gap <= 0 THEN
      v_new_streak := GREATEST(rec.current_streak, 1);  -- defensive (shouldn't occur)
    ELSE
      v_missed := v_gap - 1;                       -- days with no check-in
      IF v_missed <= (GRACE_PER_MONTH - v_grace_used) THEN
        v_grace_used := v_grace_used + v_missed;   -- forgive — hold the streak
        v_new_streak := rec.current_streak + 1;
      ELSE
        v_new_streak := 1;                         -- too many missed → fresh start
      END IF;
    END IF;
  END IF;

  UPDATE public.user_streaks SET
    current_streak     = v_new_streak,
    longest_streak     = GREATEST(rec.longest_streak, v_new_streak),
    last_check_in_date = v_today,
    grace_used         = v_grace_used,
    grace_month        = v_grace_month,
    updated_at         = now()
  WHERE user_id = uid;

  -- Liveness signal (same as send_bottle).
  UPDATE public.profiles SET last_active = now() WHERE id = uid;

  RETURN jsonb_build_object(
    'mood', p_mood,
    'current_streak', v_new_streak,
    'longest_streak', GREATEST(rec.longest_streak, v_new_streak),
    'checked_in_today', TRUE,
    'advanced', TRUE
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.check_in_mood(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.check_in_mood(TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.check_in_mood(TEXT) TO authenticated;

COMMENT ON FUNCTION public.check_in_mood(TEXT) IS
  'Atomic daily mood check-in: upsert today''s mood + advance the ADHD-safe '
  'streak (forgives up to 2 missed days/month). Re-checking the same day only '
  'updates the mood. Returns mood + streak state.';

-- ── get_mood_streak_status(): one-shot read for the home screen ─────────────
CREATE OR REPLACE FUNCTION public.get_mood_streak_status()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  uid       UUID := auth.uid();
  v_today   DATE := public.user_local_date(auth.uid());
  v_mood    TEXT;
  v_checked BOOLEAN;
  rec       public.user_streaks;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT mood INTO v_mood
  FROM public.mood_check_ins
  WHERE user_id = uid AND local_date = v_today;
  v_checked := v_mood IS NOT NULL;

  SELECT * INTO rec FROM public.user_streaks WHERE user_id = uid;

  RETURN jsonb_build_object(
    'today_mood', v_mood,
    'checked_in_today', v_checked,
    'current_streak', COALESCE(rec.current_streak, 0),
    'longest_streak', COALESCE(rec.longest_streak, 0),
    -- At risk = has a live streak but hasn't checked in yet today. Drives the
    -- gentle nudge, never a punishing "you'll lose it" countdown.
    'at_risk', COALESCE(rec.current_streak, 0) > 0 AND NOT v_checked
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_mood_streak_status() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_mood_streak_status() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_mood_streak_status() TO authenticated;

COMMENT ON FUNCTION public.get_mood_streak_status() IS
  'Home-screen read: today''s mood, whether checked in, current/longest streak, '
  'and an at_risk flag (live streak + not yet checked in today).';
