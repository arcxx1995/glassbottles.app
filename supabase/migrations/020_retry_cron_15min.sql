-- Reschedule the unmatched-bottle retry from hourly (:30) to every 15 minutes.
--
-- Why: a bottle thrown when no eligible receiver is online stays sailing until
-- the retry job next runs. At '30 * * * *' that was up to ~1 hour. '*/15 * * * *'
-- caps the wait at ~15 minutes so queued bottles find a stranger sooner.
--
-- cron.schedule() upserts by job name, so re-scheduling 'retry-unmatched-bottles'
-- here updates the existing job in place (no unschedule needed). The function
-- body is unchanged — only the cadence.
SELECT cron.schedule(
  'retry-unmatched-bottles',
  '*/15 * * * *',
  $$ SELECT public.retry_unmatched_bottles(); $$
);
