-- Migration 042: bottle dressing — the Atelier, weather, vibe, currents
--
-- A bottle can now carry how it was dressed and the sky it was thrown under:
--   style   — {glass, seal, paper, ink} piece ids from atelier_pieces. The
--             receiver sees it: dressing a bottle is a gift to a stranger.
--             Keeper pieces need is_keeper() (041) at throw time; a bottle
--             keeps its look forever, whatever the membership does later.
--   weather — stormy | foggy | calm | sunny (free, optional)
--   vibe    — venting | small_win | wondering | grateful (free label only —
--             no routing; the pool is too small to split)
--   current — the sender's joined current at throw time (free, cosmetic).
--             Keepers also get that current's theme sea on their own screen.
--
-- Nothing here touches matching or delivery.

-- ── 1. Atelier catalog — the single source for validation and rendering ────
CREATE TABLE IF NOT EXISTS public.atelier_pieces (
  kind TEXT NOT NULL CHECK (kind IN ('glass', 'seal', 'paper', 'ink')),
  id   TEXT NOT NULL,
  name TEXT NOT NULL,
  tier TEXT NOT NULL CHECK (tier IN ('free', 'keeper')),
  look JSONB NOT NULL,
  sort INT  NOT NULL DEFAULT 0,
  PRIMARY KEY (kind, id)
);

ALTER TABLE public.atelier_pieces ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "atelier: everyone reads" ON public.atelier_pieces;
CREATE POLICY "atelier: everyone reads" ON public.atelier_pieces
  FOR SELECT TO authenticated USING (true);
REVOKE ALL ON public.atelier_pieces FROM anon, authenticated;
GRANT SELECT ON public.atelier_pieces TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.atelier_pieces TO service_role;

-- The first piece of each kind (sort 0) is the default look a bottle has
-- always had. Papers stay dark and inks light, so every pairing reads.
INSERT INTO public.atelier_pieces (kind, id, name, tier, look, sort) VALUES
  ('glass', 'clear',     'Clear',     'free',   '{"tint":"rgba(78,205,196,0.04)","edge":"rgba(255,255,255,0.18)"}', 0),
  ('glass', 'seafoam',   'Seafoam',   'free',   '{"tint":"rgba(78,205,196,0.16)","edge":"rgba(124,255,230,0.35)"}', 1),
  ('glass', 'amber',     'Amber',     'keeper', '{"tint":"rgba(214,150,60,0.22)","edge":"rgba(240,190,110,0.45)"}', 2),
  ('glass', 'cobalt',    'Cobalt',    'keeper', '{"tint":"rgba(60,100,220,0.24)","edge":"rgba(130,160,255,0.45)"}', 3),
  ('glass', 'rose',      'Rose',      'keeper', '{"tint":"rgba(230,120,150,0.20)","edge":"rgba(255,170,190,0.45)"}', 4),
  ('glass', 'sea_glass', 'Sea glass', 'keeper', '{"tint":"rgba(150,210,170,0.26)","edge":"rgba(200,240,210,0.50)"}', 5),
  ('seal',  'cork',      'Cork',      'free',   '{"wax":null}', 0),
  ('seal',  'red',       'Red wax',   'keeper', '{"wax":"#B23A3A"}', 1),
  ('seal',  'gold',      'Gold wax',  'keeper', '{"wax":"#D4A537"}', 2),
  ('seal',  'midnight',  'Midnight wax', 'keeper', '{"wax":"#34467A"}', 3),
  ('seal',  'tide',      'Tide wax',  'keeper', '{"wax":"#3BA99F"}', 4),
  ('paper', 'deep',      'Deep sea',  'free',   '{"bg":"#0D2137"}', 0),
  ('paper', 'driftwood', 'Driftwood', 'free',   '{"bg":"#2A2420"}', 1),
  ('paper', 'kelp',      'Kelp',      'keeper', '{"bg":"#13302B"}', 2),
  ('paper', 'dusk',      'Dusk',      'keeper', '{"bg":"#241E3A"}', 3),
  ('paper', 'moonlit',   'Moonlit',   'keeper', '{"bg":"#1C2735"}', 4),
  ('paper', 'ember',     'Ember',     'keeper', '{"bg":"#2E1A1C"}', 5),
  ('ink',   'sand',      'Sand',      'free',   '{"color":"#F7E7CE"}', 0),
  ('ink',   'sepia',     'Sepia',     'free',   '{"color":"#E8C9A0"}', 1),
  ('ink',   'seafoam',   'Seafoam',   'keeper', '{"color":"#8FE3DA"}', 2),
  ('ink',   'rose',      'Rose',      'keeper', '{"color":"#F2B8C4"}', 3),
  ('ink',   'gold',      'Gold',      'keeper', '{"color":"#F0D58A"}', 4),
  ('ink',   'pearl',     'Pearl',     'keeper', '{"color":"#FFFFFF"}', 5)
ON CONFLICT (kind, id) DO NOTHING;

-- ── 2. Columns ──────────────────────────────────────────────────────────────
ALTER TABLE public.bottles
  ADD COLUMN IF NOT EXISTS style   JSONB,
  ADD COLUMN IF NOT EXISTS weather TEXT CHECK (weather IN ('stormy', 'foggy', 'calm', 'sunny')),
  ADD COLUMN IF NOT EXISTS vibe    TEXT CHECK (vibe IN ('venting', 'small_win', 'wondering', 'grateful')),
  ADD COLUMN IF NOT EXISTS current TEXT CHECK (current IN ('night_owl', 'quiet_wins', 'heavy_water', 'busy_minds'));

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS current TEXT CHECK (current IN ('night_owl', 'quiet_wins', 'heavy_water', 'busy_minds'));

-- Joining a current is free and the user's own choice (PATCH /api/profile).
GRANT UPDATE (current) ON public.profiles TO authenticated;

-- ── 3. send_bottle(message, style, weather, vibe) ───────────────────────────
-- Verbatim migration 038 body plus the dressing. The old one-argument
-- signature is dropped; the new arguments default to NULL, so a client still
-- sending only p_message keeps working through the deploy.
DROP FUNCTION IF EXISTS public.send_bottle(TEXT);

CREATE OR REPLACE FUNCTION public.send_bottle(
  p_message TEXT,
  p_style   JSONB DEFAULT NULL,
  p_weather TEXT  DEFAULT NULL,
  p_vibe    TEXT  DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  uid      UUID := auth.uid();
  today    DATE := public.user_local_date(auth.uid());
  trimmed  TEXT := btrim(COALESCE(p_message, ''));
  v_bottle JSONB;
  v_piece  RECORD;
  v_tier   TEXT;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  IF trimmed = '' THEN
    RAISE EXCEPTION 'Message is required' USING ERRCODE = '23514';
  END IF;
  IF char_length(trimmed) > 1000 THEN
    RAISE EXCEPTION 'Message too long — max 1000 characters' USING ERRCODE = '23514';
  END IF;

  -- 042: every style entry must be a real piece of that kind; Keeper pieces
  -- need a Keeper. Unknown keys, nested values, or wrong kinds all miss the
  -- catalog and are rejected.
  IF p_style IS NOT NULL THEN
    IF jsonb_typeof(p_style) <> 'object' THEN
      RAISE EXCEPTION 'Invalid bottle style' USING ERRCODE = '23514';
    END IF;
    FOR v_piece IN SELECT key, value FROM jsonb_each_text(p_style) LOOP
      SELECT tier INTO v_tier FROM public.atelier_pieces
      WHERE kind = v_piece.key AND id = v_piece.value;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Unknown % piece', v_piece.key USING ERRCODE = '23514';
      END IF;
      IF v_tier = 'keeper' AND NOT public.is_keeper(uid) THEN
        RAISE EXCEPTION 'keeper_only' USING ERRCODE = '42501';
      END IF;
    END LOOP;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.daily_quotas
    WHERE user_id = uid AND date = today AND has_sent = TRUE
  ) THEN
    RAISE EXCEPTION 'Already sent a bottle today' USING ERRCODE = '23505';
  END IF;

  -- 038: the home screen stops at 21 drifting bottles; so does the server.
  IF (SELECT count(*) FROM public.bottles
      WHERE sender_id = uid AND received_at IS NULL) >= 21 THEN
    RAISE EXCEPTION '21 bottles are still drifting' USING ERRCODE = '23514';
  END IF;

  -- weather / vibe are checked by the column constraints (23514).
  INSERT INTO public.bottles (sender_id, message, style, weather, vibe, current)
  VALUES (uid, trimmed, NULLIF(p_style, '{}'::jsonb), p_weather, p_vibe,
          (SELECT current FROM public.profiles WHERE id = uid))
  RETURNING jsonb_build_object(
    'id',          id,
    'message',     message,
    'sent_at',     sent_at,
    'received_at', received_at,
    'read_at',     read_at,
    'day_key',     day_key,
    'is_read',     is_read,
    'is_reported', is_reported,
    'is_stale',    is_stale,
    'style',       style,
    'weather',     weather,
    'vibe',        vibe,
    'current',     current
  ) INTO v_bottle;

  INSERT INTO public.daily_quotas (user_id, date, has_sent)
  VALUES (uid, today, TRUE)
  ON CONFLICT (user_id, date) DO UPDATE SET has_sent = TRUE;

  UPDATE public.profiles SET last_active = now() WHERE id = uid;

  RETURN v_bottle;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.send_bottle(TEXT, JSONB, TEXT, TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.send_bottle(TEXT, JSONB, TEXT, TEXT) TO authenticated;

-- ── 4. get_received_bottles: the dressing travels to the receiver ──────────
-- Verbatim migration 038 body plus style/weather/vibe/current. A new return
-- shape needs DROP + CREATE, so the 035 grants are restated.
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
  current TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT b.id, b.message, b.sent_at, b.received_at, b.read_at,
         b.day_key, b.is_read, b.is_reported, b.is_stale,
         b.style, b.weather, b.vibe, b.current
  FROM public.bottles b
  WHERE b.receiver_id = auth.uid()
    AND b.is_reported IS NOT TRUE
  ORDER BY b.received_at DESC;
$$;

REVOKE EXECUTE ON FUNCTION public.get_received_bottles() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_received_bottles() TO authenticated;

-- ── 5. get_today_bottle_status: dressing on sent, received and sailing ─────
-- Verbatim migration 039 body; the three bottle selects add the new columns.

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
           style, weather, vibe, current
    FROM public.bottles
    WHERE sender_id = uid AND day_key = today
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

  -- 039: tides — consecutive local days with a throw, ending today (or
  -- yesterday, so the count doesn't vanish before today's throw).
  -- Gaps-and-islands: walking back from the anchor, day n must be anchor - n.
  WITH days AS (
    SELECT DISTINCT day_key
    FROM public.bottles
    WHERE sender_id = uid
      AND day_key <= today
      AND day_key > today - 400
  ), anchor AS (
    SELECT CASE WHEN EXISTS (SELECT 1 FROM days WHERE day_key = today)
                THEN today ELSE today - 1 END AS d
  )
  SELECT count(*) INTO v_tides
  FROM (
    SELECT day_key, row_number() OVER (ORDER BY day_key DESC) AS rn
    FROM days, anchor
    WHERE day_key <= anchor.d
  ) t, anchor
  WHERE t.day_key = anchor.d - (t.rn - 1)::int;

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
    'tides', v_tides
  );
END;
$$;
