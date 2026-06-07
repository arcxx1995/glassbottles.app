-- Migration: 003_cron_jobs
-- pg_cron setup for daily maintenance tasks

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Daily cleanup at 00:00 UTC: mark unmatched bottles from yesterday as stale
-- Quota reset is implicit — new date = new daily_quotas row
SELECT cron.schedule(
  'daily-bottle-stale-cleanup',
  '0 0 * * *',
  $$
    UPDATE public.bottles
    SET is_stale = TRUE
    WHERE received_at IS NULL
      AND is_stale = FALSE
      AND day_key < CURRENT_DATE;
  $$
);
