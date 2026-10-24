-- Migration 045: free polish — tides grace, keepsakes
--
-- tides grace — one missed day a month no longer resets a tide. Free for
--               everyone and silent: the count simply carries on. (Selling
--               streak protection is the loss-shaming the calm brand avoids.)
-- keepsakes  — the receiver can keep a bottle that mattered; the inbox can
--               show just those. Free and unlimited: the inbox already holds
--               every bottle (035), so a cap would only take something away.

-- ── 1. Keepsakes ────────────────────────────────────────────────────────────
ALTER TABLE public.bottles ADD COLUMN IF NOT EXISTS kept_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.keep_bottle(p_bottle_id UUID, p_keep BOOLEAN)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH u AS (
    UPDATE public.bottles
    SET kept_at = CASE WHEN p_keep THEN COALESCE(kept_at, now()) END
    WHERE id = p_bottle_id AND receiver_id = auth.uid() AND is_reported IS NOT TRUE
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM u);
$$;

REVOKE EXECUTE ON FUNCTION public.keep_bottle(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.keep_bottle(UUID, BOOLEAN) TO authenticated;

-- ── 2. get_received_bottles — verbatim 044 body plus kept_at ───────────────
DROP FUNCTION IF EXISTS public.get_received_bottles();

CREATE FUNCTION public.get_received_bottles()
RETURNS TABLE (
  id UUID,
  message TEXT,
  sent_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  day_key DATE,
  is_read BOOLEAN,
  is_reported BOOLEAN,
  is_stale BOOLEAN,
  style JSONB,
  weather TEXT,
  vibe TEXT,
  current TEXT,
  rippled_at TIMESTAMPTZ,
  kept_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT b.id, b.message, b.sent_at, b.received_at, b.read_at,
         b.day_key, b.is_read, b.is_reported, b.is_stale,
         b.style, b.weather, b.vibe, b.current, b.rippled_at, b.kept_at
  FROM public.bottles b
  WHERE b.receiver_id = auth.uid()
    AND b.is_reported IS NOT TRUE
  ORDER BY b.received_at DESC;
$$;

REVOKE EXECUTE ON FUNCTION public.get_received_bottles() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_received_bottles() TO authenticated;

-- ── 3. get_today_bottle_status — verbatim 044 body, tides with grace ───────
CREATE OR REPLACE FUNCTION public.get_today_bottle_status()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  uid UUID := auth.uid();
  v_tz TEXT;
  today DATE;
  v_quota JSONB;
  v_sent JSONB;
  v_received JSONB;
  v_sailing JSONB;
  v_unacked JSONB;
  v_tides INTEGER;
  v_held JSONB;
  v_ripples JSONB;
  v_days DATE[];
  v_day DATE;
  v_graced TEXT[] := '{}'; -- months (YYYY-MM) whose grace day is spent
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(timezone, 'UTC') INTO v_tz
  FROM public.profiles WHERE id = uid;
  v_tz := COALESCE(v_tz, 'UTC');
  today := (now() AT TIME ZONE v_tz)::date;

  SELECT to_jsonb(q) INTO v_quota
  FROM (
    SELECT user_id, date, has_sent, has_received
    FROM public.daily_quotas
    WHERE user_id = uid AND date = today
  ) q;

  -- Sent bottle: own sent metadata. receiver_id intentionally omitted.
  SELECT to_jsonb(s) INTO v_sent
  FROM (
    SELECT id, message, sent_at, received_at, day_key, is_stale,
           style, weather, vibe, current, screen
    FROM public.bottles
    WHERE sender_id = uid AND day_key = today
      AND screen IS DISTINCT FROM 'held'
    LIMIT 1
  ) s;

  -- Received bottle: sender_id intentionally omitted. Filtered by the
  -- RECEIVE time falling on the receiver's local day — day_key is the
  -- sender's throw date and (with the 1-hour rule + multi-day drift) almost
  -- never equals the receiver's "today".
  SELECT to_jsonb(r) INTO v_received
  FROM (
    SELECT id, message, sent_at, received_at, read_at, day_key,
           is_read, is_reported, is_stale, style, weather, vibe, current
    FROM public.bottles
    WHERE receiver_id = uid
      AND received_at IS NOT NULL
      AND is_stale = FALSE
      AND (received_at AT TIME ZONE v_tz)::date = today
    ORDER BY received_at DESC
    LIMIT 1
  ) r;

  -- Sailing bottles: unmatched, capped at 21.
  SELECT COALESCE(jsonb_agg(to_jsonb(x)), '[]'::jsonb) INTO v_sailing
  FROM (
    SELECT id, message, sent_at, day_key, style
    FROM public.bottles
    WHERE sender_id = uid
      AND received_at IS NULL
      AND is_stale = FALSE
    ORDER BY sent_at DESC
    LIMIT 21
  ) x;

  -- Delivered but not yet acknowledged. INTENTIONAL: NOT filtered by day_key —
  -- the toast must surface a delivery whenever it happened. Do not "fix".
  --
  -- 039: drift_band — how far the bottle travelled, as a coarse band of the
  -- UTC-offset gap between sender and receiver at the moment it landed. Only
  -- the band leaves this function; never a zone, an offset or the receiver.
  SELECT COALESCE(jsonb_agg(to_jsonb(u)), '[]'::jsonb) INTO v_unacked
  FROM (
    SELECT b.id, b.sent_at, b.received_at, b.day_key,
           CASE
             WHEN r.id IS NULL THEN NULL
             ELSE (
               WITH gap AS (
                 SELECT abs(extract(epoch FROM
                          (b.received_at AT TIME ZONE COALESCE(r.timezone, 'UTC'))
                        - (b.received_at AT TIME ZONE v_tz))) / 3600 AS h
               )
               SELECT CASE
                        WHEN h < 1 THEN 'same'
                        WHEN h <= 3 THEN 'near'
                        WHEN h <= 7 THEN 'far'
                        ELSE 'distant'
                      END
               FROM gap
             )
           END AS drift_band
    FROM public.bottles b
    LEFT JOIN public.profiles r ON r.id = b.receiver_id
    WHERE b.sender_id = uid
      AND b.received_at IS NOT NULL
      AND b.delivered_ack_at IS NULL
    ORDER BY b.received_at DESC
  ) u;

  -- 045: tides with grace — consecutive local days with a throw, walking back
  -- from today (or from yesterday while today is still open). One missed day
  -- per calendar month is quietly forgiven: it doesn't break the run and
  -- doesn't count toward it. Never sold, never announced.
  SELECT COALESCE(array_agg(DISTINCT day_key), '{}') INTO v_days
  FROM public.bottles
  WHERE sender_id = uid
    AND day_key <= today
    AND day_key > today - 400;

  v_tides := 0;
  v_day := CASE WHEN today = ANY (v_days) THEN today ELSE today - 1 END;
  LOOP
    IF v_day = ANY (v_days) THEN
      v_tides := v_tides + 1;
    ELSIF v_tides > 0 OR v_day = today - 1 THEN
      -- A single missed day, in a month with no grace used yet, bridged only
      -- if the run carries on right behind it.
      EXIT WHEN to_char(v_day, 'YYYY-MM') = ANY (v_graced)
             OR NOT ((v_day - 1) = ANY (v_days));
      v_graced := v_graced || to_char(v_day, 'YYYY-MM');
    ELSE
      EXIT;
    END IF;
    v_day := v_day - 1;
  END LOOP;

  -- 043: the latest bottle the safety screen kept ashore that the sender
  -- hasn't seen yet — its words come back so they can rewrite it.
  SELECT to_jsonb(h) INTO v_held
  FROM (
    SELECT id, message, screen_reason, day_key
    FROM public.bottles
    WHERE sender_id = uid AND screen = 'held' AND held_ack_at IS NULL
    ORDER BY sent_at DESC
    LIMIT 1
  ) h;

  -- 044: own bottles a stranger said reached them, not yet seen.
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'rippled_at', rippled_at)
                            ORDER BY rippled_at DESC), '[]'::jsonb)
  INTO v_ripples
  FROM public.bottles
  WHERE sender_id = uid AND rippled_at IS NOT NULL AND ripple_ack_at IS NULL;

  RETURN jsonb_build_object(
    'quota', COALESCE(v_quota, jsonb_build_object(
      'user_id', uid,
      'date', today,
      'has_sent', FALSE,
      'has_received', FALSE
    )),
    'sentBottle', v_sent,
    'receivedBottle', v_received,
    'sailingBottles', v_sailing,
    'unackedDelivered', v_unacked,
    'tides', v_tides,
    'heldBottle', v_held,
    'ripples', v_ripples
  );
END;
$$;
