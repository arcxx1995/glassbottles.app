-- Migration 014: client-read RPCs — move read-only queries off Vercel Functions
--
-- WHY:
--   /api/bottles/received, /api/bottles/status and /api/bottles/count each ran
--   as a Vercel Function invocation (BottomNav polled /received every 60s).
--   Every invocation paid two Supabase Auth round-trips (middleware + route)
--   of Fluid provisioned-memory wall-clock time. These functions let the
--   browser call Supabase directly — zero Vercel compute on the read path.
--
-- WHY SECURITY DEFINER (instead of plain client-side selects under RLS):
--   The RLS SELECT policies grant senders/receivers whole-row access,
--   including sender_id / receiver_id. A raw client-side .select() could read
--   those columns from devtools and break anonymity. These functions return
--   ONLY safe columns — sender_id / receiver_id never leave the database.
--
-- Each function:
--   - is STABLE (read-only) and pins search_path (SECURITY DEFINER hygiene)
--   - scopes rows by auth.uid(); a NULL uid matches no rows
--   - has EXECUTE revoked from PUBLIC and anon, granted to authenticated only

-- ── 1. Received bottles (inbox + unread badge) ──────────────────────────────
CREATE OR REPLACE FUNCTION public.get_received_bottles()
RETURNS TABLE (
  id UUID,
  message TEXT,
  sent_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  day_key DATE,
  is_read BOOLEAN,
  is_reported BOOLEAN,
  is_stale BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT b.id, b.message, b.sent_at, b.received_at, b.read_at,
         b.day_key, b.is_read, b.is_reported, b.is_stale
  FROM public.bottles b
  WHERE b.receiver_id = auth.uid()
    AND b.is_stale = FALSE
  ORDER BY b.received_at DESC;
$$;

REVOKE EXECUTE ON FUNCTION public.get_received_bottles() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_received_bottles() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_received_bottles() TO authenticated;

-- ── 2. Today's bottle status (home page) ────────────────────────────────────
-- Mirrors the old /api/bottles/status response shape exactly:
--   { quota, sentBottle, receivedBottle, sailingBottles }
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

  RETURN jsonb_build_object(
    'quota', COALESCE(v_quota, jsonb_build_object(
      'user_id', uid,
      'date', today,
      'has_sent', FALSE,
      'has_received', FALSE
    )),
    'sentBottle', v_sent,
    'receivedBottle', v_received,
    'sailingBottles', v_sailing
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_today_bottle_status() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_today_bottle_status() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_today_bottle_status() TO authenticated;

-- ── 3. Global ambient count ("X bottles in the ocean today") ────────────────
-- Replaces the service-role count in /api/bottles/count. SECURITY DEFINER
-- bypasses RLS so the count is global, but only a bare integer is exposed.
CREATE OR REPLACE FUNCTION public.get_todays_bottle_count()
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COUNT(*)::integer
  FROM public.bottles
  WHERE day_key = (now() AT TIME ZONE 'utc')::date
    AND is_stale = FALSE
    AND auth.uid() IS NOT NULL;
$$;

REVOKE EXECUTE ON FUNCTION public.get_todays_bottle_count() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_todays_bottle_count() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_todays_bottle_count() TO authenticated;
