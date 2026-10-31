-- Migration 059: coins and vibes are gone
--
-- Apply only once the client from 058's release is live: the previous client
-- still calls get_coins and unlock_piece, and passes p_vibe to send_bottle.

-- ── 1. Coins ────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS on_bottle_coins ON public.bottles;
DROP FUNCTION IF EXISTS public.award_bottle_coins();
DROP FUNCTION IF EXISTS public.get_coins();
DROP FUNCTION IF EXISTS public.unlock_piece(TEXT, TEXT);
DROP TABLE IF EXISTS public.coin_ledger;

ALTER TABLE public.atelier_pieces DROP COLUMN IF EXISTS coin_cost;
ALTER TABLE public.atelier_pieces DROP CONSTRAINT IF EXISTS atelier_pieces_tier_check;
ALTER TABLE public.atelier_pieces ADD CONSTRAINT atelier_pieces_tier_check
  CHECK (tier IN ('free', 'keeper'));

-- ── 2. send_bottle — verbatim 049 body, minus vibe ──────────────────────────
DROP FUNCTION IF EXISTS public.send_bottle(TEXT, JSONB, TEXT, TEXT);

CREATE FUNCTION public.send_bottle(
  p_message TEXT,
  p_style   JSONB DEFAULT NULL,
  p_weather TEXT  DEFAULT NULL
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

  -- 049: one style check for every writer path.
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

  -- weather is checked by the column constraint (23514).
  INSERT INTO public.bottles (sender_id, message, style, weather, current)
  VALUES (uid, trimmed, NULLIF(p_style, '{}'::jsonb), p_weather,
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
REVOKE EXECUTE ON FUNCTION public.send_bottle(TEXT, JSONB, TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.send_bottle(TEXT, JSONB, TEXT) TO authenticated;

-- ── 3. Vibe ─────────────────────────────────────────────────────────────────
ALTER TABLE public.bottles DROP COLUMN IF EXISTS vibe;
