-- Migration 023: event-driven public_stats counters (drop the cron refreshers).
--
-- Both landing numbers now update from DB triggers — O(1) per event, no scans,
-- fully live, landing still reads one cached row:
--
--   total_count  = cumulative bottles thrown EVER. +1 on each throw, NEVER
--                  decremented (account deletion does not shrink it) → monotonic.
--   adrift_count = bottles waiting to be found RIGHT NOW
--                  (received_at IS NULL AND is_stale = FALSE). Maintained by a
--                  DELTA trigger so it stays exact across every transition:
--                  throw +1, match -1, go-stale -1, un-stale +1, delete-while-
--                  adrift -1. No drift, so no reconcile cron needed.
--
-- Replaces the hourly/daily COUNT-based cron from migration 021.

-- ── 1. Remove the old cron refreshers (guarded; ignore if not scheduled) ──────
DO $$
BEGIN
  PERFORM cron.unschedule('refresh-adrift-count');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
  PERFORM cron.unschedule('refresh-total-count');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DROP FUNCTION IF EXISTS public.refresh_adrift_count();
DROP FUNCTION IF EXISTS public.refresh_total_count();

-- ── 2. total_count: +1 per throw, monotonic ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.bump_total_count()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.public_stats SET total_count = total_count + 1 WHERE id;
  RETURN NULL; -- AFTER trigger
END;
$$;

DROP TRIGGER IF EXISTS trg_bump_total_count ON public.bottles;
CREATE TRIGGER trg_bump_total_count
  AFTER INSERT ON public.bottles
  FOR EACH ROW
  EXECUTE FUNCTION public.bump_total_count();

-- ── 3. adrift_count: exact delta on every state change ──────────────────────
-- "Adrift" membership = received_at IS NULL AND is_stale = FALSE. The trigger
-- compares OLD vs NEW membership and applies the difference, so it's correct
-- for INSERT (throw), UPDATE (match / stale / un-stale), and DELETE (account
-- deletion of an undelivered bottle) alike.
CREATE OR REPLACE FUNCTION public.adjust_adrift_count()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_old int := 0;
  v_new int := 0;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE')
     AND OLD.received_at IS NULL AND OLD.is_stale = FALSE THEN
    v_old := 1;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE')
     AND NEW.received_at IS NULL AND NEW.is_stale = FALSE THEN
    v_new := 1;
  END IF;
  IF v_new <> v_old THEN
    UPDATE public.public_stats
    SET adrift_count = adrift_count + (v_new - v_old)
    WHERE id;
  END IF;
  RETURN NULL; -- AFTER trigger
END;
$$;

DROP TRIGGER IF EXISTS trg_adjust_adrift_count ON public.bottles;
CREATE TRIGGER trg_adjust_adrift_count
  AFTER INSERT OR UPDATE OR DELETE ON public.bottles
  FOR EACH ROW
  EXECUTE FUNCTION public.adjust_adrift_count();

-- ── 4. Seed both counters from current truth ────────────────────────────────
UPDATE public.public_stats
SET total_count  = (SELECT COUNT(*)::int FROM public.bottles),
    adrift_count = (SELECT COUNT(*)::int FROM public.bottles
                    WHERE received_at IS NULL AND is_stale = FALSE),
    updated_at   = now()
WHERE id;
