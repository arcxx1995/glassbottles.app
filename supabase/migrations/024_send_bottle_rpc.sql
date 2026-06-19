-- Migration 024: send_bottle() RPC — move the write path off Vercel
--
-- WHY:
--   /api/bottles/send was the ONE remaining write on a Vercel Function. On the
--   throw critical path it ran ~5 sequential Vercel→Supabase round trips
--   (auth.getUser + user_local_today + quota select + bottle insert + quota
--   upsert) plus Fluid cold start — 1–3s before the UI could confirm the send,
--   which read as a freeze. This collapses the whole thing into ONE atomic
--   SECURITY DEFINER function the browser calls directly, exactly like the read
--   RPCs in migration 014. Zero Vercel compute, a single round trip.
--
-- ATOMICITY:
--   Runs in one transaction. The explicit quota check covers the common case;
--   the UNIQUE (sender_id, day_key) constraint (migration 004) is the true guard
--   against a concurrent double-send — a racing duplicate raises 23505, which
--   the client maps to "already sent today" (same mapping the route used).
--
-- SECURITY DEFINER:
--   Bypasses RLS (runs as owner), so it performs the quota check, the
--   service-role-only daily_quotas upsert, and the last_active stamp itself, and
--   returns ONLY anonymity-safe columns — sender_id never leaves the database.

CREATE OR REPLACE FUNCTION public.send_bottle(p_message TEXT)
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

  -- Server-side validation (mirrors the old route; client guards too).
  IF trimmed = '' THEN
    RAISE EXCEPTION 'Message is required' USING ERRCODE = '23514';
  END IF;
  IF char_length(trimmed) > 1000 THEN
    RAISE EXCEPTION 'Message too long — max 1000 characters' USING ERRCODE = '23514';
  END IF;

  -- Quota check (defense-in-depth; the UNIQUE constraint below is authoritative).
  IF EXISTS (
    SELECT 1 FROM public.daily_quotas
    WHERE user_id = uid AND date = today AND has_sent = TRUE
  ) THEN
    RAISE EXCEPTION 'Already sent a bottle today' USING ERRCODE = '23505';
  END IF;

  -- Insert. day_key DEFAULT = user_local_date(auth.uid()) (migration 019), the
  -- same expression the quota check and UNIQUE constraint reference. A concurrent
  -- duplicate trips UNIQUE (sender_id, day_key) → 23505, propagated as-is.
  INSERT INTO public.bottles (sender_id, message)
  VALUES (uid, trimmed)
  RETURNING jsonb_build_object(
    'id',          id,
    'message',     message,
    'sent_at',     sent_at,
    'received_at', received_at,
    'read_at',     read_at,
    'day_key',     day_key,
    'is_read',     is_read,
    'is_reported', is_reported,
    'is_stale',    is_stale
  ) INTO v_bottle;

  -- Mark the daily quota (no client INSERT policy on daily_quotas — the route
  -- used the service role; SECURITY DEFINER does it directly here).
  INSERT INTO public.daily_quotas (user_id, date, has_sent)
  VALUES (uid, today, TRUE)
  ON CONFLICT (user_id, date) DO UPDATE SET has_sent = TRUE;

  -- Liveness signal — sending is a reliable once-a-day authed interaction.
  UPDATE public.profiles SET last_active = now() WHERE id = uid;

  RETURN v_bottle;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.send_bottle(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.send_bottle(TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.send_bottle(TEXT) TO authenticated;

COMMENT ON FUNCTION public.send_bottle(TEXT) IS
  'Atomic throw: validate + quota-check + insert bottle + mark daily quota + '
  'stamp last_active, returning the new bottle (no sender_id). Replaces the '
  '/api/bottles/send Vercel route (migration 024). Matching is intentionally '
  'NOT triggered here — the 1-hour-adrift rule (migration 022) means the retry '
  'cron picks it up on the first tick after it crosses the hour.';
