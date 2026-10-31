-- Migration 058: Moby Dick, and the end of what coins bought
--
-- The whale stays, for everyone, but pays nothing: spotting it adds to a
-- lifetime sighting count. It surfaces one day a week, not daily.
-- Coin pieces join the Keeper tier, so Keeper unlocks every piece.
--
-- Safe alongside the previous client: coin RPCs and send_bottle's p_vibe still
-- exist, and that client tolerates vibe missing from reads. 059 removes them
-- once the new client is live.

-- ── 1. Sightings ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.whale_sightings (
  user_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  day        DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, day)
);
ALTER TABLE public.whale_sightings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.whale_sightings FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.whale_sightings TO service_role;

-- Whales already spotted count as sightings.
INSERT INTO public.whale_sightings (user_id, day, created_at)
SELECT user_id, ref::date, created_at
FROM public.coin_ledger
WHERE reason = 'whale' AND ref ~ '^\d{4}-\d{2}-\d{2}$'
ON CONFLICT DO NOTHING;

-- ── 2. When it surfaces ─────────────────────────────────────────────────────
-- One day in each ISO week, on a weekday drawn from the week, so everyone shares
-- the same days and it never goes quiet for long (longest gap 13 days). On those
-- days the same local hour for everyone, between 09:00 and 20:30. NULL on every
-- other day. Still no push and no countdown.
CREATE OR REPLACE FUNCTION public.moby_start(p_day DATE, p_tz TEXT)
RETURNS TIMESTAMPTZ
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT ((p_day + make_interval(hours => 9 + (abs(hashtext(p_day::text)::bigint) % 11)::int))::timestamp)
         AT TIME ZONE p_tz
  WHERE extract(isodow FROM p_day) = 1 + abs(hashtext('moby:' || to_char(p_day, 'IYYY-IW'))::bigint) % 7;
$$;
REVOKE EXECUTE ON FUNCTION public.moby_start(DATE, TEXT) FROM PUBLIC, anon, authenticated;

-- ── 3. Spotting it ──────────────────────────────────────────────────────────
-- Returns the lifetime count after a new sighting, or 0 when nothing happened
-- (not surfaced, or already spotted today).
DROP FUNCTION IF EXISTS public.spot_whale();

CREATE FUNCTION public.spot_whale()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  uid     UUID := auth.uid();
  v_tz    TEXT;
  today   DATE;
  v_start TIMESTAMPTZ;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT timezone INTO v_tz FROM public.profiles WHERE id = uid;
  v_tz := COALESCE(v_tz, 'UTC');
  today := (now() AT TIME ZONE v_tz)::date;
  v_start := public.moby_start(today, v_tz);
  IF v_start IS NULL OR now() < v_start OR now() > v_start + interval '90 minutes' THEN
    RETURN 0;
  END IF;
  INSERT INTO public.whale_sightings (user_id, day)
  VALUES (uid, today)
  ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN
    RETURN 0;
  END IF;
  RETURN (SELECT count(*) FROM public.whale_sightings WHERE user_id = uid)::int;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.spot_whale() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.spot_whale() TO authenticated;

-- ── 4. Keeper unlocks every piece ───────────────────────────────────────────
UPDATE public.atelier_pieces SET tier = 'keeper' WHERE tier = 'coin';

CREATE OR REPLACE FUNCTION public.check_bottle_style(p_uid UUID, p_style JSONB)
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_piece RECORD;
  v_sort  INT;
BEGIN
  IF p_style IS NULL THEN
    RETURN;
  END IF;
  IF jsonb_typeof(p_style) <> 'object' THEN
    RAISE EXCEPTION 'Invalid bottle style' USING ERRCODE = '23514';
  END IF;
  FOR v_piece IN SELECT key, value FROM jsonb_each_text(p_style) LOOP
    SELECT sort INTO v_sort FROM public.atelier_pieces
    WHERE kind = v_piece.key AND id = v_piece.value;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Unknown % piece', v_piece.key USING ERRCODE = '23514';
    END IF;
    IF v_sort > 0 AND NOT public.is_keeper(p_uid) THEN
      RAISE EXCEPTION 'keeper_only' USING ERRCODE = '42501';
    END IF;
  END LOOP;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.check_bottle_style(UUID, JSONB) FROM PUBLIC, anon, authenticated;

-- ── 5. get_received_bottles — verbatim 057 body, minus vibe ─────────────────
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
         b.weather, b.current, b.rippled_at, b.kept_at
  FROM public.bottles b
  WHERE b.receiver_id = auth.uid()
    AND b.is_reported IS NOT TRUE
  ORDER BY b.received_at DESC;
$$;

REVOKE EXECUTE ON FUNCTION public.get_received_bottles() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_received_bottles() TO authenticated;

-- ── 6. get_logbook — verbatim 048 body, minus vibe ──────────────────────────
CREATE OR REPLACE FUNCTION public.get_logbook()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  uid UUID := auth.uid();
BEGIN
  IF uid IS NULL OR NOT EXISTS (SELECT 1 FROM public.memberships WHERE user_id = uid) THEN
    RAISE EXCEPTION 'keeper_only' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'sent', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'message', message, 'at', sent_at, 'found', received_at IS NOT NULL,
               'rippled', rippled_at IS NOT NULL, 'style', style,
               'weather', weather, 'current', current)
             ORDER BY sent_at)
      FROM public.bottles
      WHERE sender_id = uid AND screen IS DISTINCT FROM 'held'), '[]'::jsonb),
    'received', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'message', message, 'at', received_at, 'kept', kept_at IS NOT NULL,
               'style', style, 'weather', weather, 'current', current)
             ORDER BY received_at)
      FROM public.bottles
      WHERE receiver_id = uid AND received_at IS NOT NULL AND is_reported IS NOT TRUE), '[]'::jsonb),
    'future', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'message', message, 'at', delivered_at, 'written', created_at,
               'style', style, 'weather', weather)
             ORDER BY delivered_at)
      FROM public.future_bottles
      WHERE user_id = uid AND delivered_at IS NOT NULL), '[]'::jsonb)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_logbook() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_logbook() TO authenticated;

-- ── 7. get_today_bottle_status — verbatim 057 body, minus vibe; whale as above
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
           style, weather, current, screen
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
           weather, current
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

  -- 045 tides with grace.
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

  -- 058: Moby Dick's window today, or NULL when it isn't a Moby day.
  v_whale_start := public.moby_start(today, v_tz);

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
    'whale', CASE WHEN v_whale_start IS NOT NULL THEN jsonb_build_object(
      'start', v_whale_start,
      'end', v_whale_start + interval '90 minutes',
      'spotted', EXISTS (SELECT 1 FROM public.whale_sightings
                         WHERE user_id = uid AND day = today)
    ) END
  );
END;
$$;
