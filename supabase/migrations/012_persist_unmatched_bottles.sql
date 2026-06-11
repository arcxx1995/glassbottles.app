-- Migration: 012_persist_unmatched_bottles
--
-- Change: unmatched bottles no longer go stale at midnight.
-- They persist indefinitely and the hourly retry cron (migration 006)
-- keeps attempting to find a receiver until one is available.
--
-- Users can throw a new bottle each day regardless of whether a previous
-- bottle is still unmatched — daily quota is per day_key, not per-bottle.
--
-- The stale cron is repurposed: it now only marks DELIVERED bottles as stale
-- after 30 days (inbox cleanup). Unmatched bottles are never marked stale
-- by this job.

SELECT cron.unschedule('daily-bottle-stale-cleanup');

SELECT cron.schedule(
  'daily-bottle-stale-cleanup',
  '0 0 * * *',
  $$
    UPDATE public.bottles
    SET    is_stale = TRUE
    WHERE  received_at IS NOT NULL
      AND  is_stale   = FALSE
      AND  day_key    < CURRENT_DATE - INTERVAL '30 days';
  $$
);

COMMENT ON TABLE public.bottles IS
  'Unmatched bottles (received_at IS NULL) persist until matched. '
  'Delivered bottles (received_at IS NOT NULL) are marked stale after 30 days by pg_cron.';
