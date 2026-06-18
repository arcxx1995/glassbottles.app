-- Migration 022: the "1 hour adrift" rule.
--
-- A thrown bottle must FLOAT for at least one hour before it can be found —
-- regardless of how many eligible receivers exist the instant it's thrown. This
-- is the essence of the app ("a message in a bottle, waiting to be found"):
-- instant matching denied that. We delay the MATCH itself (not just the
-- notification), so received_at remains the real found-time and every downstream
-- effect that already keys off it — the receiver email + in-app notification,
-- the sender's "delivered" banner, and the bottle leaving the sender's sea
-- (sailing query filters received_at IS NULL) — naturally fires at the 1h mark
-- with no read-path changes.
--
-- match_bottle() is the single chokepoint for BOTH the (now removed) instant
-- send-time path and the pg_cron retry path, so one guard here covers everything.
-- The retry cron runs every 15 min (migration 020), so a bottle is found on the
-- first tick after it crosses one hour — i.e. ~1h00–1h15 after the throw.
--
-- Only the SELECT (now also reading sent_at) and the new guard differ from
-- migration 017; the rest of the body is unchanged.

CREATE OR REPLACE FUNCTION public.match_bottle(p_bottle_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_bottle      RECORD;
  v_receiver_id UUID;
BEGIN
  -- Lock the bottle row for the duration of the transaction. Concurrent
  -- match attempts (cron ticks, or a double-send) serialize here.
  SELECT id, sender_id, received_at, sent_at
  INTO   v_bottle
  FROM   public.bottles
  WHERE  id = p_bottle_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('matched', false, 'reason', 'not found');
  END IF;

  -- Idempotent: already matched (by a previous tick / concurrent caller that
  -- won the row lock). Never touches quota — fixes the lost-race burn.
  IF v_bottle.received_at IS NOT NULL THEN
    RETURN jsonb_build_object('matched', true, 'reason', 'already matched');
  END IF;

  -- THE 1-HOUR ADRIFT RULE: refuse to match a bottle younger than one hour.
  -- It stays queued and the retry cron re-attempts on its next tick, so the
  -- bottle keeps floating in the sender's sea until it has drifted an hour.
  IF v_bottle.sent_at > now() - interval '1 hour' THEN
    RETURN jsonb_build_object('matched', false, 'queued', true, 'reason', 'too early');
  END IF;

  -- Eligible receiver: not the sender, and has not already received a bottle
  -- on THEIR OWN local day (per-user timezone). Random order over the full set;
  -- NOT EXISTS keeps query size constant under load.
  SELECT p.id
  INTO   v_receiver_id
  FROM   public.profiles p
  WHERE  p.id <> v_bottle.sender_id
    AND  NOT EXISTS (
           SELECT 1
           FROM   public.daily_quotas dq
           WHERE  dq.user_id      = p.id
             AND  dq.date         = public.user_local_date(p.id)
             AND  dq.has_received = TRUE
         )
  ORDER BY random()
  LIMIT 1;

  IF v_receiver_id IS NULL THEN
    RETURN jsonb_build_object(
      'matched', false, 'queued', true, 'reason', 'no eligible receiver'
    );
  END IF;

  -- Commit point. The FOR UPDATE lock guarantees received_at is still NULL.
  UPDATE public.bottles
  SET    receiver_id = v_receiver_id,
         received_at = now()
  WHERE  id = p_bottle_id;

  -- Receiver quota keyed to the RECEIVER's local day — NOT the sender's
  -- bottle.day_key. Same transaction as the match: both or neither.
  INSERT INTO public.daily_quotas (user_id, date, has_sent, has_received)
  VALUES (v_receiver_id, public.user_local_date(v_receiver_id), FALSE, TRUE)
  ON CONFLICT (user_id, date)
  DO UPDATE SET has_received = TRUE;

  RETURN jsonb_build_object(
    'matched', true,
    'receiver_id', v_receiver_id,
    'bottle_id', p_bottle_id
  );
END;
$$;

-- Grants unchanged (CREATE OR REPLACE preserves them, restated for clarity).
REVOKE EXECUTE ON FUNCTION public.match_bottle(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.match_bottle(UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION public.match_bottle(UUID) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.match_bottle(UUID) TO service_role;
