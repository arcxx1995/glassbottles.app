-- Migration 047: future-self bottles
--
-- A Keeper can write a bottle to themselves; it washes back in 1, 6 or 12
-- months. One a week, separate from the daily stranger bottle — it never
-- enters the sea, the matcher or the quota. A bottle already written always
-- arrives, membership or not (the lapse rule: what exists stays).
--
-- Delivery is an hourly cron step on each writer's local date; the arrival is
-- broadcast to their open tabs and pushed (push-notify, event 'future').

CREATE TABLE IF NOT EXISTS public.future_bottles (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  message      TEXT NOT NULL CHECK (char_length(message) BETWEEN 1 AND 1000),
  style        JSONB,
  weather      TEXT CHECK (weather IN ('stormy', 'foggy', 'calm', 'sunny')),
  deliver_on   DATE NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at TIMESTAMPTZ,
  read_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS future_bottles_due_idx
  ON public.future_bottles (deliver_on) WHERE delivered_at IS NULL;
CREATE INDEX IF NOT EXISTS future_bottles_user_idx ON public.future_bottles (user_id);

-- Reads and writes go through the RPCs below; no direct client access, so a
-- waiting bottle's words stay sealed until it arrives.
ALTER TABLE public.future_bottles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.future_bottles FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.future_bottles TO service_role;

-- ── Shared style check (same rules as send_bottle, migration 042) ──────────
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
  END LOOP;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.check_bottle_style(UUID, JSONB) FROM PUBLIC, anon, authenticated;

-- ── Write one ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.send_future_bottle(
  p_message TEXT,
  p_months  INT,
  p_style   JSONB DEFAULT NULL,
  p_weather TEXT  DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  uid     UUID := auth.uid();
  trimmed TEXT := btrim(COALESCE(p_message, ''));
  v_row   public.future_bottles%ROWTYPE;
BEGIN
  IF uid IS NULL OR NOT public.is_keeper(uid) THEN
    RAISE EXCEPTION 'keeper_only' USING ERRCODE = '42501';
  END IF;
  IF p_months NOT IN (1, 6, 12) THEN
    RAISE EXCEPTION 'Choose 1, 6 or 12 months' USING ERRCODE = '23514';
  END IF;
  IF trimmed = '' OR char_length(trimmed) > 1000 THEN
    RAISE EXCEPTION 'Message is required (max 1000 characters)' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM public.future_bottles
             WHERE user_id = uid AND created_at > now() - interval '7 days') THEN
    RAISE EXCEPTION 'One letter to yourself a week' USING ERRCODE = '23505';
  END IF;
  PERFORM public.check_bottle_style(uid, p_style);

  INSERT INTO public.future_bottles (user_id, message, style, weather, deliver_on)
  VALUES (uid, trimmed, NULLIF(p_style, '{}'::jsonb), p_weather,
          (public.user_local_date(uid) + make_interval(months => p_months))::date)
  RETURNING * INTO v_row;
  RETURN jsonb_build_object('id', v_row.id, 'deliver_on', v_row.deliver_on);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.send_future_bottle(TEXT, INT, JSONB, TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.send_future_bottle(TEXT, INT, JSONB, TEXT) TO authenticated;

-- ── Read mine: arrived ones whole, waiting ones sealed ─────────────────────
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
               'id', id, 'message', message, 'style', style, 'weather', weather,
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

CREATE OR REPLACE FUNCTION public.mark_future_read(p_id UUID)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE public.future_bottles SET read_at = COALESCE(read_at, now())
  WHERE id = p_id AND user_id = auth.uid() AND delivered_at IS NOT NULL;
$$;
REVOKE EXECUTE ON FUNCTION public.mark_future_read(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.mark_future_read(UUID) TO authenticated;

-- ── Delivery (hourly, on each writer's local date) ─────────────────────────
CREATE OR REPLACE FUNCTION public.deliver_future_bottles()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count INT := 0;
  r RECORD;
BEGIN
  FOR r IN
    UPDATE public.future_bottles f
    SET delivered_at = now()
    FROM public.profiles p
    WHERE p.id = f.user_id
      AND f.delivered_at IS NULL
      AND f.deliver_on <= (now() AT TIME ZONE COALESCE(p.timezone, 'UTC'))::date
    RETURNING f.id, f.user_id
  LOOP
    v_count := v_count + 1;
    PERFORM realtime.send(jsonb_build_object('future_id', r.id), 'future_arrived',
                          'user:' || r.user_id::text, true);
  END LOOP;
  RETURN v_count;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.deliver_future_bottles() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.deliver_future_bottles() TO service_role;

SELECT cron.schedule('deliver-future-bottles', '5 * * * *', $$ SELECT public.deliver_future_bottles(); $$);

-- ── Push on arrival ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.push_future_arrival()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_url TEXT;
  v_key TEXT;
BEGIN
  IF OLD.delivered_at IS NOT NULL OR NEW.delivered_at IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.push_subscriptions WHERE user_id = NEW.user_id) THEN
    RETURN NULL;
  END IF;
  SELECT c.supabase_url, c.service_role_key INTO v_url, v_key FROM public._notify_config() c;
  IF v_url IS NOT NULL AND v_key IS NOT NULL THEN
    PERFORM net.http_post(
      url     := v_url || '/functions/v1/push-notify',
      headers := jsonb_build_object('Content-Type', 'application/json',
                                    'Authorization', 'Bearer ' || v_key),
      body    := jsonb_build_object('future_id', NEW.id, 'event', 'future')
    );
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'push_future_arrival(%): %', NEW.id, SQLERRM;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS on_future_push ON public.future_bottles;
CREATE TRIGGER on_future_push
  AFTER UPDATE OF delivered_at ON public.future_bottles
  FOR EACH ROW
  EXECUTE FUNCTION public.push_future_arrival();
