-- Migration 016: state-derived notification banners
--
-- WHY:
--   Banners were ephemeral Redux flags set by Realtime broadcast events.
--   Broadcast is fire-and-forget: a dead websocket, a backgrounded phone, or a
--   page reload meant the toast never appeared (or vanished). Product decision:
--   instant delivery is NOT required — but when a toast shows it must persist
--   and reflect database truth.
--
--   Received banner truth:  an unread received bottle exists (is_read = false)
--                           — already derivable, no schema change needed.
--   Delivered banner truth: a sent bottle was matched but the sender has not
--                           acknowledged it — needs a durable ack marker.
--
-- delivered_ack_at: set when the sender dismisses the "Your bottle found
-- someone" toast. NULL + received_at NOT NULL = show the toast (any device,
-- any reload, regardless of whether the broadcast event was ever seen).

ALTER TABLE public.bottles ADD COLUMN delivered_ack_at TIMESTAMPTZ;

-- Backfill: bottles delivered before this migration were already announced
-- under the old event system — don't storm existing users with toasts.
UPDATE public.bottles
SET delivered_ack_at = received_at
WHERE received_at IS NOT NULL;

-- Additive to the column-level grant from migration 015 (safe column: it
-- reveals nothing about identities).
GRANT SELECT (delivered_ack_at) ON public.bottles TO authenticated;

-- ── ack_delivered_bottles(): sender dismisses the delivered toast ────────────
-- Acks ALL of the caller's unacked delivered bottles (the toast is singular).
-- SECURITY DEFINER because the sender has no UPDATE grant on bottles (the RLS
-- UPDATE policy is receiver-only); scoping to auth.uid() is done here instead.
CREATE OR REPLACE FUNCTION public.ack_delivered_bottles()
RETURNS VOID
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE public.bottles
  SET delivered_ack_at = now()
  WHERE sender_id = auth.uid()
    AND received_at IS NOT NULL
    AND delivered_ack_at IS NULL;
$$;

REVOKE EXECUTE ON FUNCTION public.ack_delivered_bottles() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.ack_delivered_bottles() FROM anon;
GRANT EXECUTE ON FUNCTION public.ack_delivered_bottles() TO authenticated;

-- ── get_today_bottle_status(): add unackedDelivered ─────────────────────────
-- Same shape as migration 014 plus 'unackedDelivered' — the sender's matched
-- but unacknowledged bottles (safe columns only; no receiver information).
CREATE OR REPLACE FUNCTION public.get_today_bottle_status()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  uid UUID := auth.uid();
  today DATE := (now() AT TIME ZONE 'utc')::date;
  v_quota JSONB;
  v_sent JSONB;
  v_received JSONB;
  v_sailing JSONB;
  v_unacked JSONB;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

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

  -- Received bottle: sender_id intentionally omitted.
  SELECT to_jsonb(r) INTO v_received
  FROM (
    SELECT id, message, sent_at, received_at, read_at, day_key,
           is_read, is_reported, is_stale
    FROM public.bottles
    WHERE receiver_id = uid AND day_key = today
    LIMIT 1
  ) r;

  -- Sailing bottles: unmatched, capped at 21 (cap gates the throw entry —
  -- see migration 012 / home page logic).
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

  -- Delivered but not yet acknowledged — drives the persistent
  -- "Your bottle found someone" toast. No receiver information.
  SELECT COALESCE(jsonb_agg(to_jsonb(u)), '[]'::jsonb) INTO v_unacked
  FROM (
    SELECT id, sent_at, received_at, day_key
    FROM public.bottles
    WHERE sender_id = uid
      AND received_at IS NOT NULL
      AND delivered_ack_at IS NULL
    ORDER BY received_at DESC
  ) u;

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
    'unackedDelivered', v_unacked
  );
END;
$$;
