-- Migration 049: coins and the calm whale
--
-- Coins are earned, never bought and never cashed: a ripple on your bottle
-- (+3), every seventh tide (+5), spotting the whale (+2, once a day). They
-- unlock coin pieces in the Atelier — beauty a free user can earn. Keepers
-- have every piece already. No coin packs: no money in, no refunds, no
-- balance anyone could owe.
--
-- The ledger is the whole story: balance = sum(delta); a piece is owned when
-- its 'unlock' row exists. UNIQUE (user_id, reason, ref) makes every reward
-- and every unlock happen once.
--
-- The whale surfaces for 90 minutes a day at a local hour drawn from the
-- date. It's only seen on the home sea — no push, no countdown, no FOMO.

-- ── 1. Ledger ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.coin_ledger (
  id         BIGSERIAL PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  delta      INT  NOT NULL,
  reason     TEXT NOT NULL CHECK (reason IN ('ripple', 'tide', 'whale', 'unlock')),
  ref        TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, reason, ref)
);
ALTER TABLE public.coin_ledger ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.coin_ledger FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.coin_ledger TO service_role;
GRANT USAGE ON SEQUENCE public.coin_ledger_id_seq TO service_role;

-- ── 2. Coin pieces ──────────────────────────────────────────────────────────
ALTER TABLE public.atelier_pieces DROP CONSTRAINT IF EXISTS atelier_pieces_tier_check;
ALTER TABLE public.atelier_pieces ADD CONSTRAINT atelier_pieces_tier_check
  CHECK (tier IN ('free', 'coin', 'keeper'));
ALTER TABLE public.atelier_pieces ADD COLUMN IF NOT EXISTS coin_cost INT;

INSERT INTO public.atelier_pieces (kind, id, name, tier, look, sort, coin_cost) VALUES
  ('glass', 'moonstone', 'Moonstone',   'coin', '{"tint":"rgba(200,210,255,0.22)","edge":"rgba(230,235,255,0.55)"}', 6, 30),
  ('seal',  'pearl',     'Pearl wax',   'coin', '{"wax":"#E9E2D0"}', 5, 20),
  ('paper', 'tidepool',  'Tide pool',   'coin', '{"bg":"#12343A"}', 6, 25),
  ('ink',   'lavender',  'Lavender',    'coin', '{"color":"#CDB8F5"}', 6, 15)
ON CONFLICT (kind, id) DO NOTHING;

-- ── 3. Shared tides (045's walk, unchanged) ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.tides_for(p_uid UUID, p_today DATE)
RETURNS INT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tides  INT;
  v_days   DATE[];
  v_day    DATE;
  v_graced TEXT[] := '{}'; -- months (YYYY-MM) whose grace day is spent
BEGIN
  SELECT COALESCE(array_agg(DISTINCT day_key), '{}') INTO v_days
  FROM public.bottles
  WHERE sender_id = p_uid
    AND day_key <= p_today
    AND day_key > p_today - 400;

  v_tides := 0;
  v_day := CASE WHEN p_today = ANY (v_days) THEN p_today ELSE p_today - 1 END;
  LOOP
    IF v_day = ANY (v_days) THEN
      v_tides := v_tides + 1;
    ELSIF v_tides > 0 OR v_day = p_today - 1 THEN
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

  RETURN v_tides;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.tides_for(UUID, DATE) FROM PUBLIC, anon, authenticated;

-- ── 4. Earning ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.award_bottle_coins()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_t INT;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.sender_id IS NOT NULL THEN
    -- Every seventh day of a tide.
    v_t := public.tides_for(NEW.sender_id, NEW.day_key);
    IF v_t > 0 AND v_t % 7 = 0 THEN
      INSERT INTO public.coin_ledger (user_id, delta, reason, ref)
      VALUES (NEW.sender_id, 5, 'tide', NEW.day_key::text)
      ON CONFLICT DO NOTHING;
    END IF;
  ELSIF TG_OP = 'UPDATE' AND OLD.rippled_at IS NULL AND NEW.rippled_at IS NOT NULL
        AND NEW.sender_id IS NOT NULL THEN
    INSERT INTO public.coin_ledger (user_id, delta, reason, ref)
    VALUES (NEW.sender_id, 3, 'ripple', NEW.id::text)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  -- Coins are a nicety; never fail a throw or a ripple over them.
  RAISE WARNING 'award_bottle_coins(%): %', NEW.id, SQLERRM;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS on_bottle_coins ON public.bottles;
CREATE TRIGGER on_bottle_coins
  AFTER INSERT OR UPDATE OF rippled_at ON public.bottles
  FOR EACH ROW
  EXECUTE FUNCTION public.award_bottle_coins();

CREATE OR REPLACE FUNCTION public.spot_whale()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  uid   UUID := auth.uid();
  v_tz  TEXT;
  today DATE;
  v_start TIMESTAMPTZ;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(timezone, 'UTC') INTO v_tz FROM public.profiles WHERE id = uid;
  today := (now() AT TIME ZONE v_tz)::date;
  v_start := ((today + make_interval(hours => 9 + abs(hashtext(today::text)) % 11))::timestamp)
             AT TIME ZONE v_tz;
  IF now() < v_start OR now() > v_start + interval '90 minutes' THEN
    RETURN FALSE; -- not surfaced right now
  END IF;
  INSERT INTO public.coin_ledger (user_id, delta, reason, ref)
  VALUES (uid, 2, 'whale', today::text)
  ON CONFLICT DO NOTHING;
  RETURN FOUND;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.spot_whale() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.spot_whale() TO authenticated;

-- ── 5. Balance + owned pieces, and spending ────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_coins()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'balance', COALESCE((SELECT sum(delta) FROM public.coin_ledger WHERE user_id = auth.uid()), 0),
    'unlocked', COALESCE((SELECT jsonb_agg(ref) FROM public.coin_ledger
                          WHERE user_id = auth.uid() AND reason = 'unlock'), '[]'::jsonb)
  );
$$;
REVOKE EXECUTE ON FUNCTION public.get_coins() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_coins() TO authenticated;

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

-- ── 6. Style check: coin pieces need an unlock (or a Keeper) ───────────────
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
BEGIN
  IF p_style IS NULL THEN
    RETURN;
  END IF;
  IF jsonb_typeof(p_style) <> 'object' THEN
    RAISE EXCEPTION 'Invalid bottle style' USING ERRCODE = '23514';
  END IF;
  FOR v_piece IN SELECT key, value FROM jsonb_each_text(p_style) LOOP
    SELECT tier INTO v_tier FROM public.atelier_pieces
    WHERE kind = v_piece.key AND id = v_piece.value;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Unknown % piece', v_piece.key USING ERRCODE = '23514';
    END IF;
    IF v_tier = 'keeper' AND NOT public.is_keeper(p_uid) THEN
      RAISE EXCEPTION 'keeper_only' USING ERRCODE = '42501';
    END IF;
    IF v_tier = 'coin' AND NOT public.is_keeper(p_uid) AND NOT EXISTS (
         SELECT 1 FROM public.coin_ledger
         WHERE user_id = p_uid AND reason = 'unlock' AND ref = v_piece.key || ':' || v_piece.value) THEN
      RAISE EXCEPTION 'piece_locked' USING ERRCODE = '42501';
    END IF;
  END LOOP;
END;
$$;

-- ── 7. send_bottle — verbatim 043 body; the style check is now shared ──────
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

  -- 049: one style check for every writer path (pieces, Keeper, coins).
  PERFORM public.check_bottle_style(uid, p_style);

  IF EXISTS (
    SELECT 1 FROM public.daily_quotas
    WHERE user_id = uid AND date = today AND has_sent = TRUE
  ) THEN
    RAISE EXCEPTION 'Already sent a bottle today' USING ERRCODE = '23505';
  END IF;

  -- 038: the home screen stops at 21 drifting bottles; so does the server.
  -- 043: held bottles (is_stale) are out of the water and don't count.
  IF (SELECT count(*) FROM public.bottles
      WHERE sender_id = uid AND received_at IS NULL AND is_stale = FALSE) >= 21 THEN
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
    'current',     current,
    'screen',      screen
  ) INTO v_bottle;

  INSERT INTO public.daily_quotas (user_id, date, has_sent)
  VALUES (uid, today, TRUE)
  ON CONFLICT (user_id, date) DO UPDATE SET has_sent = TRUE;

  UPDATE public.profiles SET last_active = now() WHERE id = uid;

  RETURN v_bottle;
END;
$$;

-- ── 8. get_today_bottle_status — verbatim 045 body; tides via tides_for,
--      plus today's whale window ───────────────────────────────────────────
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
