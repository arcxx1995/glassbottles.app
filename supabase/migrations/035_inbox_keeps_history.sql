-- Migration 035: the inbox keeps every bottle it ever received
--
-- BUG:
--   Delivered bottles silently disappeared from the inbox after 30 days.
--   Three pieces combined into it:
--     1. migration 012 repurposed `daily-bottle-stale-cleanup` to set
--        is_stale = TRUE on bottles with received_at IS NOT NULL once
--        day_key < CURRENT_DATE - 30 days,
--     2. get_received_bottles() (migration 014) filters `is_stale = FALSE`,
--     3. the inbox page reads only that RPC.
--   Result on prod at the time of this fix: 55 of 84 delivered bottles
--   (65%) were invisible to their receivers. Every account with a bottle
--   older than 30 days saw an empty or truncated inbox.
--
-- FIX (three parts, all here):
--   1. unschedule the delivered-staling cron,
--   2. un-stale every already-hidden delivered bottle,
--   3. drop the is_stale filter from get_received_bottles().
--
-- WHY dropping the filter is safe:
--   is_stale exists to retire UNMATCHED bottles (received_at IS NULL) from
--   the sea. Every other consumer keys on received_at IS NULL alongside it —
--   get_today_bottle_status()'s sailing list, retry_unmatched_bottles(),
--   match_bottle(), the adrift trigger from migration 023 — so a delivered
--   bottle's is_stale value has no meaning left once this cron is gone.
--   get_saved_bottles() (migration 026) already ignored is_stale, which is
--   why saved bottles outlived inbox ones.

-- ── 1. Stop marking delivered bottles stale ─────────────────────────────────
-- Guarded: the job may already be absent on a fresh database.
DO $$
BEGIN
  PERFORM cron.unschedule('daily-bottle-stale-cleanup');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- ── 2. Restore the bottles the cron already hid ─────────────────────────────
-- Scoped to received_at IS NOT NULL, so no unmatched bottle re-enters the sea
-- and the adrift trigger (migration 023) sees no membership change: both the
-- OLD and NEW rows fail its `received_at IS NULL` test, leaving adrift_count
-- untouched.
UPDATE public.bottles
SET    is_stale = FALSE
WHERE  received_at IS NOT NULL
  AND  is_stale = TRUE;

-- ── 3. The inbox RPC returns full history ───────────────────────────────────
-- Identical to migration 014 minus the `AND b.is_stale = FALSE` predicate.
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
  ORDER BY b.received_at DESC;
$$;

REVOKE EXECUTE ON FUNCTION public.get_received_bottles() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_received_bottles() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_received_bottles() TO authenticated;

COMMENT ON FUNCTION public.get_received_bottles() IS
  'A user''s full inbox history, newest first, anonymity-safe columns only. '
  'No retention window — see migration 035.';

COMMENT ON TABLE public.bottles IS
  'Unmatched bottles (received_at IS NULL) persist until matched. '
  'Delivered bottles are kept forever and stay visible in the inbox.';
