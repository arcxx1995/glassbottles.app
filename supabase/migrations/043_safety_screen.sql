-- Migration 043: the safety screen
--
-- Every new bottle is read by a classifier during its first hour adrift (the
-- matcher never delivers a bottle younger than an hour, so screening costs the
-- sender nothing). A trigger posts the bottle id to the screen-bottle Edge
-- Function through pg_net, the same Vault-configured path notify-receiver
-- uses (034). The function calls apply_screen() with one verdict:
--
--   ok     — nothing to do.
--   crisis — the writer may be in danger. The bottle STILL sails (never block
--            silently); the sender is shown gentle, region-aware help.
--   held   — contact details or links, cruelty toward someone, sexual content,
--            or spam. The bottle stays ashore: is_stale = TRUE, which already
--            means "out of the water" everywhere — the matcher, the sea, the
--            adrift counter and the sailing ceiling all skip it; match_bottle
--            only gains a re-check under its row lock. Its words go back to
--            the sender to rewrite, and the day's throw is restored — once per
--            day, so the screen can't be used to throw over and over.
--
-- Fail-open: a bottle the screen never reached (function down, no API key)
-- has screen IS NULL and sails as before after its hour. Report (038) remains
-- the backstop.
-- ponytail: no re-screen of NULL bottles; add a cron pass if outages get long.

-- ── 1. Columns ──────────────────────────────────────────────────────────────
ALTER TABLE public.bottles
  ADD COLUMN IF NOT EXISTS screen        TEXT CHECK (screen IN ('ok', 'crisis', 'held')),
  ADD COLUMN IF NOT EXISTS screen_reason TEXT CHECK (screen_reason IN ('contact', 'harm', 'sexual', 'spam')),
  ADD COLUMN IF NOT EXISTS held_ack_at   TIMESTAMPTZ;

-- One sailing bottle per sender per day still holds; a held bottle no longer
-- occupies the day, so its rewrite can be thrown.
ALTER TABLE public.bottles DROP CONSTRAINT IF EXISTS bottles_sender_day_unique;
CREATE UNIQUE INDEX IF NOT EXISTS bottles_sender_day_unique
  ON public.bottles (sender_id, day_key)
  WHERE screen IS DISTINCT FROM 'held';

-- ── 2. Hand every new bottle to the screen ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.screen_new_bottle()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_url TEXT;
  v_key TEXT;
BEGIN
  SELECT c.supabase_url, c.service_role_key INTO v_url, v_key
  FROM public._notify_config() c;
  IF v_url IS NOT NULL AND v_key IS NOT NULL THEN
    -- pg_net is fire-and-forget: the throw never waits on the classifier.
    PERFORM net.http_post(
      url     := v_url || '/functions/v1/screen-bottle',
      headers := jsonb_build_object('Content-Type', 'application/json',
                                    'Authorization', 'Bearer ' || v_key),
      body    := jsonb_build_object('bottle_id', NEW.id)
    );
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  -- Never fail a throw over the screen; the bottle simply sails unscreened.
  RAISE WARNING 'screen_new_bottle(%): %', NEW.id, SQLERRM;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS on_bottle_screen ON public.bottles;
CREATE TRIGGER on_bottle_screen
  AFTER INSERT ON public.bottles
  FOR EACH ROW
  EXECUTE FUNCTION public.screen_new_bottle();

-- ── 3. apply_screen — the Edge Function's only write ───────────────────────
CREATE OR REPLACE FUNCTION public.apply_screen(
  p_bottle_id UUID,
  p_verdict   TEXT,
  p_reason    TEXT DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_b public.bottles%ROWTYPE;
BEGIN
  SELECT * INTO v_b FROM public.bottles WHERE id = p_bottle_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'not_found';
  END IF;
  IF v_b.screen IS NOT NULL THEN
    RETURN 'already_screened'; -- pg_net may deliver twice
  END IF;

  -- Already delivered (the screen ran very late): record, never claw back.
  IF p_verdict = 'held' AND v_b.received_at IS NOT NULL THEN
    UPDATE public.bottles SET screen = 'held', screen_reason = p_reason WHERE id = p_bottle_id;
    RETURN 'held_too_late';
  END IF;

  IF p_verdict = 'held' THEN
    -- The day's throw comes back, unless a bottle was already held today.
    IF NOT EXISTS (
      SELECT 1 FROM public.bottles
      WHERE sender_id = v_b.sender_id AND day_key = v_b.day_key
        AND screen = 'held' AND id <> p_bottle_id
    ) THEN
      UPDATE public.daily_quotas SET has_sent = FALSE
      WHERE user_id = v_b.sender_id AND date = v_b.day_key;
    END IF;
    UPDATE public.bottles
    SET screen = 'held', screen_reason = p_reason, is_stale = TRUE
    WHERE id = p_bottle_id;
    PERFORM realtime.send(jsonb_build_object('bottle_id', p_bottle_id),
                          'bottle_held', 'user:' || v_b.sender_id::text, true);
    RETURN 'held';
  END IF;

  UPDATE public.bottles SET screen = p_verdict WHERE id = p_bottle_id;
  IF p_verdict = 'crisis' THEN
    PERFORM realtime.send(jsonb_build_object('bottle_id', p_bottle_id),
                          'bottle_care', 'user:' || v_b.sender_id::text, true);
  END IF;
  RETURN p_verdict;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.apply_screen(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.apply_screen(UUID, TEXT, TEXT) TO service_role;

-- ── 4. ack_held_bottle — the sender has seen (or rewritten) it ─────────────
CREATE OR REPLACE FUNCTION public.ack_held_bottle(p_bottle_id UUID)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE public.bottles SET held_ack_at = now()
  WHERE id = p_bottle_id AND sender_id = auth.uid() AND screen = 'held';
$$;

REVOKE EXECUTE ON FUNCTION public.ack_held_bottle(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.ack_held_bottle(UUID) TO authenticated;

-- ── 5. send_bottle — verbatim 042 body; held bottles leave the ceiling ─────
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

-- ── 6. get_today_bottle_status — verbatim 042 body plus screen + heldBottle ─
-- sentBottle skips a held bottle (its rewrite is today's bottle).
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
    'heldBottle', v_held
  );
END;
$$;

-- ── 7. match_bottle — verbatim 038 body plus the out-of-the-water re-check ─
CREATE OR REPLACE FUNCTION public.match_bottle(p_bottle_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_bottle        RECORD;
  v_receiver_id   UUID;
  v_receiver_date DATE;
  v_claimed       UUID;
  v_attempts      INTEGER := 0;
BEGIN
  SELECT id, sender_id, received_at, sent_at, is_stale
  INTO   v_bottle
  FROM   public.bottles
  WHERE  id = p_bottle_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('matched', false, 'reason', 'not found');
  END IF;

  IF v_bottle.received_at IS NOT NULL THEN
    RETURN jsonb_build_object('matched', true, 'reason', 'already matched');
  END IF;

  -- 043: re-checked under the row lock — a hold can land after the cron
  -- picked its candidates.
  IF v_bottle.is_stale THEN
    RETURN jsonb_build_object('matched', false, 'reason', 'out of the water');
  END IF;

  IF v_bottle.sent_at > now() - interval '1 hour' THEN
    RETURN jsonb_build_object('matched', false, 'queued', true, 'reason', 'too early');
  END IF;

  -- Candidate → claim loop (029). A lost claim means another bottle took this
  -- receiver between our SELECT and INSERT, so the next SELECT excludes them.
  -- The cap is a backstop: if candidate and claim ever disagree again (038:
  -- NULL has_received did), the bottle waits a tick instead of spinning the
  -- cron forever.
  LOOP
    v_attempts := v_attempts + 1;
    IF v_attempts > 20 THEN
      RETURN jsonb_build_object(
        'matched', false, 'queued', true, 'reason', 'claim contention'
      );
    END IF;

    SELECT p.id,
           (now() AT TIME ZONE COALESCE(p.timezone, 'UTC'))::date
    INTO   v_receiver_id, v_receiver_date
    FROM   public.profiles p
    JOIN   auth.users u ON u.id = p.id
    WHERE  p.id <> v_bottle.sender_id
      AND  u.email_confirmed_at IS NOT NULL    -- 038: no dead / unverified inboxes
      AND  NOT EXISTS (
             SELECT 1
             FROM   public.daily_quotas dq
             WHERE  dq.user_id      = p.id
               AND  dq.date         = (now() AT TIME ZONE COALESCE(p.timezone, 'UTC'))::date
               AND  dq.has_received = TRUE
           )
    ORDER BY (COALESCE(p.last_active, p.created_at) > now() - interval '30 days') IS TRUE DESC,
             random()
    LIMIT 1;

    IF v_receiver_id IS NULL THEN
      RETURN jsonb_build_object(
        'matched', false, 'queued', true, 'reason', 'no eligible receiver'
      );
    END IF;

    v_claimed := NULL;
    INSERT INTO public.daily_quotas (user_id, date, has_sent, has_received)
    VALUES (v_receiver_id, v_receiver_date, FALSE, TRUE)
    ON CONFLICT (user_id, date)
    DO UPDATE SET has_received = TRUE
    WHERE daily_quotas.has_received = FALSE
    RETURNING user_id INTO v_claimed;

    IF v_claimed IS NOT NULL THEN
      EXIT;
    END IF;
  END LOOP;

  UPDATE public.bottles
  SET    receiver_id = v_receiver_id,
         received_at = now()
  WHERE  id = p_bottle_id;

  RETURN jsonb_build_object(
    'matched', true,
    'receiver_id', v_receiver_id,
    'bottle_id', p_bottle_id
  );
END;
$$;
