-- Migration 044: Web Push + the ripple
--
-- Two quiet ways for the sea to answer back, neither of them a reply:
--
-- Web Push — "a bottle washed ashore" to the receiver, "your bottle was found"
--   to the sender, "your bottle reached someone" on a ripple. Free, opt-in per
--   device. push_subscriptions + save/delete RPCs are carried over from the
--   test branch's 027 (which 031 dropped). Delivery is a trigger on the
--   bottle transitions themselves — matched (received_at set) and rippled
--   (rippled_at set) — so each push fires exactly once per event. (The
--   notify-receiver path is retried for email and would repeat pushes.)
--
-- Ripple — the receiver may tap "this reached me" once per bottle. The sender
--   learns only that: no words, no identity, no thread. Locked decision "no
--   replies" stands.

-- ── 1. Push subscriptions ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  endpoint   TEXT PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx ON public.push_subscriptions (user_id);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "push: read own" ON public.push_subscriptions;
CREATE POLICY "push: read own" ON public.push_subscriptions
  FOR SELECT TO authenticated USING (user_id = auth.uid());
REVOKE ALL ON public.push_subscriptions FROM anon, authenticated;
GRANT SELECT ON public.push_subscriptions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_subscriptions TO service_role;

CREATE OR REPLACE FUNCTION public.save_push_subscription(p_endpoint TEXT, p_p256dh TEXT, p_auth TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  uid UUID := auth.uid();
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  -- Push services hand out https endpoints; anything else isn't one.
  IF p_endpoint !~ '^https://' OR btrim(COALESCE(p_p256dh, '')) = '' OR btrim(COALESCE(p_auth, '')) = '' THEN
    RAISE EXCEPTION 'invalid push subscription' USING ERRCODE = '23514';
  END IF;
  INSERT INTO public.push_subscriptions (endpoint, user_id, p256dh, auth)
  VALUES (p_endpoint, uid, p_p256dh, p_auth)
  ON CONFLICT (endpoint) DO UPDATE SET
    user_id = EXCLUDED.user_id, -- the device changed accounts
    p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, last_seen = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_push_subscription(p_endpoint TEXT)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  DELETE FROM public.push_subscriptions WHERE endpoint = p_endpoint AND user_id = auth.uid();
$$;

REVOKE EXECUTE ON FUNCTION public.save_push_subscription(TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.save_push_subscription(TEXT, TEXT, TEXT) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.delete_push_subscription(TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.delete_push_subscription(TEXT) TO authenticated;

-- ── 2. Ripple ───────────────────────────────────────────────────────────────
ALTER TABLE public.bottles
  ADD COLUMN IF NOT EXISTS rippled_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ripple_ack_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.ripple_bottle(p_bottle_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sender UUID;
BEGIN
  -- Only the receiver, only once, never on a reported bottle.
  UPDATE public.bottles
  SET rippled_at = now()
  WHERE id = p_bottle_id
    AND receiver_id = auth.uid()
    AND rippled_at IS NULL
    AND is_reported IS NOT TRUE
  RETURNING sender_id INTO v_sender;
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;
  IF v_sender IS NOT NULL THEN
    PERFORM realtime.send(jsonb_build_object('bottle_id', p_bottle_id),
                          'bottle_rippled', 'user:' || v_sender::text, true);
  END IF;
  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.ack_ripples()
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE public.bottles SET ripple_ack_at = now()
  WHERE sender_id = auth.uid() AND rippled_at IS NOT NULL AND ripple_ack_at IS NULL;
$$;

REVOKE EXECUTE ON FUNCTION public.ripple_bottle(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.ripple_bottle(UUID) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.ack_ripples() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.ack_ripples() TO authenticated;

-- ── 3. Push on the transitions ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.push_bottle_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_url   TEXT;
  v_key   TEXT;
  v_event TEXT;
BEGIN
  IF OLD.received_at IS NULL AND NEW.received_at IS NOT NULL THEN
    v_event := 'matched';
  ELSIF OLD.rippled_at IS NULL AND NEW.rippled_at IS NOT NULL THEN
    v_event := 'ripple';
  ELSE
    RETURN NULL;
  END IF;
  -- Nobody subscribed on either side: skip the call entirely.
  IF NOT EXISTS (SELECT 1 FROM public.push_subscriptions
                 WHERE user_id IN (NEW.sender_id, NEW.receiver_id)) THEN
    RETURN NULL;
  END IF;
  SELECT c.supabase_url, c.service_role_key INTO v_url, v_key FROM public._notify_config() c;
  IF v_url IS NOT NULL AND v_key IS NOT NULL THEN
    PERFORM net.http_post(
      url     := v_url || '/functions/v1/push-notify',
      headers := jsonb_build_object('Content-Type', 'application/json',
                                    'Authorization', 'Bearer ' || v_key),
      body    := jsonb_build_object('bottle_id', NEW.id, 'event', v_event)
    );
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  -- A push is a nicety; never fail a match or a ripple over it.
  RAISE WARNING 'push_bottle_event(%): %', NEW.id, SQLERRM;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS on_bottle_push ON public.bottles;
CREATE TRIGGER on_bottle_push
  AFTER UPDATE OF received_at, rippled_at ON public.bottles
  FOR EACH ROW
  EXECUTE FUNCTION public.push_bottle_event();

-- ── 4. get_received_bottles — verbatim 042 body plus rippled_at ────────────
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
  rippled_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT b.id, b.message, b.sent_at, b.received_at, b.read_at,
         b.day_key, b.is_read, b.is_reported, b.is_stale,
         b.style, b.weather, b.vibe, b.current, b.rippled_at
  FROM public.bottles b
  WHERE b.receiver_id = auth.uid()
    AND b.is_reported IS NOT TRUE
  ORDER BY b.received_at DESC;
$$;

REVOKE EXECUTE ON FUNCTION public.get_received_bottles() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_received_bottles() TO authenticated;

-- ── 5. get_today_bottle_status — verbatim 043 body plus ripples ────────────
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
