-- The Shelf (057): seeing and using bottle dressing become Keeper-only.
--
-- Reverses 042's "the receiver sees it" and "a bottle keeps its look after a
-- lapse". What's stored doesn't change, only who gets it: read RPCs hand `style`
-- to current Keepers alone, so a free user can't read it off the network.
-- `dressed` lets the client say a bottle was dressed without saying how.

-- ── 1. Every piece beyond the plain defaults needs Keeper ──────────────────
-- sort 0 is the look a bottle has always had; those stay free.
UPDATE public.atelier_pieces SET tier = 'keeper' WHERE tier = 'free' AND sort > 0;

-- ── 2. Style check: Keeper first, then coin pieces need their unlock too ───
CREATE OR REPLACE FUNCTION public.check_bottle_style(p_uid UUID, p_style JSONB)
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_piece RECORD;
  v_tier  TEXT;
  v_sort  INT;
BEGIN
  IF p_style IS NULL THEN
    RETURN;
  END IF;
  IF jsonb_typeof(p_style) <> 'object' THEN
    RAISE EXCEPTION 'Invalid bottle style' USING ERRCODE = '23514';
  END IF;
  FOR v_piece IN SELECT key, value FROM jsonb_each_text(p_style) LOOP
    SELECT tier, sort INTO v_tier, v_sort FROM public.atelier_pieces
    WHERE kind = v_piece.key AND id = v_piece.value;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Unknown % piece', v_piece.key USING ERRCODE = '23514';
    END IF;
    IF v_sort > 0 AND NOT public.is_keeper(p_uid) THEN
      RAISE EXCEPTION 'keeper_only' USING ERRCODE = '42501';
    END IF;
    IF v_tier = 'coin' AND NOT EXISTS (
         SELECT 1 FROM public.coin_ledger
         WHERE user_id = p_uid AND reason = 'unlock' AND ref = v_piece.key || ':' || v_piece.value) THEN
      RAISE EXCEPTION 'piece_locked' USING ERRCODE = '42501';
    END IF;
  END LOOP;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.check_bottle_style(UUID, JSONB) FROM PUBLIC, anon, authenticated;

-- ── 3. unlock_piece — verbatim 049 body; anyone earns, only Keepers spend ──
CREATE OR REPLACE FUNCTION public.unlock_piece(p_kind TEXT, p_id TEXT)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  uid     UUID := auth.uid();
  v_cost  INT;
  v_bal   INT;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_keeper(uid) THEN
    RAISE EXCEPTION 'keeper_only' USING ERRCODE = '42501';
  END IF;
  SELECT coin_cost INTO v_cost FROM public.atelier_pieces
  WHERE kind = p_kind AND id = p_id AND tier = 'coin';
  IF v_cost IS NULL THEN
    RAISE EXCEPTION 'Not a coin piece' USING ERRCODE = '23514';
  END IF;
  -- One spender at a time per user, so two taps can't both spend the balance.
  PERFORM pg_advisory_xact_lock(hashtext('coins:' || uid::text));
  IF EXISTS (SELECT 1 FROM public.coin_ledger
             WHERE user_id = uid AND reason = 'unlock' AND ref = p_kind || ':' || p_id) THEN
    RETURN (SELECT COALESCE(sum(delta), 0) FROM public.coin_ledger WHERE user_id = uid)::int;
  END IF;
  SELECT COALESCE(sum(delta), 0) INTO v_bal FROM public.coin_ledger WHERE user_id = uid;
  IF v_bal < v_cost THEN
    RAISE EXCEPTION 'Not enough coins' USING ERRCODE = '23514';
  END IF;
  INSERT INTO public.coin_ledger (user_id, delta, reason, ref)
  VALUES (uid, -v_cost, 'unlock', p_kind || ':' || p_id);
  RETURN v_bal - v_cost;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.unlock_piece(TEXT, TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.unlock_piece(TEXT, TEXT) TO authenticated;

-- ── 4. get_received_bottles — verbatim 045 body; style for Keepers, + dressed
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
  dressed BOOLEAN,
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
         -- The subquery runs once, not per row: a shelf can hold hundreds.
         CASE WHEN (SELECT public.is_keeper(auth.uid())) THEN NULLIF(b.style, '{}'::jsonb) END,
         COALESCE(b.style <> '{}'::jsonb, FALSE),
         b.weather, b.vibe, b.current, b.rippled_at, b.kept_at
  FROM public.bottles b
  WHERE b.receiver_id = auth.uid()
    AND b.is_reported IS NOT TRUE
  ORDER BY b.received_at DESC;
$$;

REVOKE EXECUTE ON FUNCTION public.get_received_bottles() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_received_bottles() TO authenticated;

-- ── 5. get_future_bottles — verbatim 047 body; a lapsed writer's letters plain
CREATE OR REPLACE FUNCTION public.get_future_bottles()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'arrived', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', id, 'message', message,
               'style', CASE WHEN (SELECT public.is_keeper(auth.uid())) THEN NULLIF(style, '{}'::jsonb) END,
               'weather', weather,
               'created_at', created_at, 'delivered_at', delivered_at, 'read_at', read_at)
             ORDER BY delivered_at DESC)
      FROM public.future_bottles
      WHERE user_id = auth.uid() AND delivered_at IS NOT NULL), '[]'::jsonb),
    'waiting', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', id, 'deliver_on', deliver_on) ORDER BY deliver_on)
      FROM public.future_bottles
      WHERE user_id = auth.uid() AND delivered_at IS NULL), '[]'::jsonb),
    'can_send_after', (
      SELECT max(created_at) + interval '7 days' FROM public.future_bottles
      WHERE user_id = auth.uid() AND created_at > now() - interval '7 days')
  );
$$;
REVOKE EXECUTE ON FUNCTION public.get_future_bottles() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_future_bottles() TO authenticated;

-- ── 6. get_today_bottle_status — verbatim 049 body; receivedBottle as above ─
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
  v_whale_start TIMESTAMPTZ;
  v_keeper BOOLEAN := public.is_keeper(uid);
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
           is_read, is_reported, is_stale,
           CASE WHEN v_keeper THEN NULLIF(style, '{}'::jsonb) END AS style,
           COALESCE(style <> '{}'::jsonb, FALSE) AS dressed,
           weather, vibe, current
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

  -- 045 tides with grace, now shared with the coin rewards (049).
  v_tides := public.tides_for(uid, today);

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

  -- 049: today's whale window, in the user's local time — the same local hour
  -- for everyone on a given date, between 09:00 and 20:30.
  v_whale_start := ((today + make_interval(hours => 9 + abs(hashtext(today::text)) % 11))::timestamp)
                   AT TIME ZONE v_tz;

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
    'ripples', v_ripples,
    'whale', jsonb_build_object(
      'start', v_whale_start,
      'end', v_whale_start + interval '90 minutes',
      'spotted', EXISTS (SELECT 1 FROM public.coin_ledger
                         WHERE user_id = uid AND reason = 'whale' AND ref = today::text)
    )
  );
END;
$$;
