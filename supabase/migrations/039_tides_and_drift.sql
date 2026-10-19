-- Migration 039: two small delights in the home status RPC
--
-- tides       — the sender's run of consecutive days with a throw. Shown as a
--               quiet pill; missing a day simply resets it.
-- drift_band  — per delivered-but-unacknowledged bottle: 'same' | 'near' |
--               'far' | 'distant', from the UTC-offset gap between sender and
--               receiver when it landed (<1h, ≤3h, ≤7h, more). Coarse on
--               purpose: anonymity is the product, so the sender learns how far
--               it drifted, never where.
--
-- Verbatim migration 029 body otherwise.

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
    SELECT id, message, sent_at, received_at, day_key, is_stale
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
           is_read, is_reported, is_stale
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
    SELECT id, message, sent_at, day_key
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
