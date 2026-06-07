-- Migration: 008_realtime_replica_identity
-- Enable REPLICA IDENTITY FULL on the bottles table.
--
-- WHY THIS IS REQUIRED:
--   Supabase Realtime filters UPDATE events using the filter clause supplied
--   by the client (e.g., `receiver_id=eq.<uuid>`). For Realtime to correctly
--   route UPDATE events to subscribers, the WAL (Write-Ahead Log) diff must
--   include the OLD values of all columns — not just the columns that changed.
--
--   PostgreSQL's default REPLICA IDENTITY is DEFAULT, which includes only the
--   primary key in the OLD row image. This means an UPDATE that sets
--   `receiver_id` on a bottle (from NULL → <uuid>) does NOT include
--   `receiver_id` in the OLD image — Realtime cannot filter correctly.
--
--   REPLICA IDENTITY FULL writes the entire old row to the WAL for every UPDATE.
--   This is the approach Supabase recommends for Realtime filtered subscriptions.
--
-- PERFORMANCE NOTE:
--   FULL increases WAL write amplification proportional to row width.
--   The bottles table has ~12 narrow columns (mostly UUIDs, booleans, timestamps)
--   and expected volume is O(users/day), not high-frequency writes.
--   The trade-off is acceptable.
--
-- SECURITY NOTE:
--   The WAL is only accessible to Supabase's internal Realtime service via the
--   replication slot. The authenticated client only sees columns that the
--   Realtime publication filter allows (which respects RLS on SELECT).
--
-- DEPENDENCY:
--   Component: RealtimeBottleListener (apps/web/components/shared/RealtimeBottleListener.tsx)
--   Without this migration, the Realtime subscription in RealtimeBottleListener
--   will never fire for bottle assignment events (receiver_id going NULL → uuid).

ALTER TABLE public.bottles REPLICA IDENTITY FULL;

-- Also enable Realtime publication for the bottles table.
-- If the publication already includes all tables, this is a no-op.
-- On Supabase managed infra, `supabase_realtime` publication is pre-configured,
-- but we add bottles explicitly to ensure it is included even on custom setups.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM   pg_publication_tables
    WHERE  pubname   = 'supabase_realtime'
      AND  schemaname = 'public'
      AND  tablename  = 'bottles'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.bottles;
  END IF;
END;
$$;

COMMENT ON TABLE public.bottles IS
  'One bottle per sender per day. receiver_id assigned by edge function only. '
  'REPLICA IDENTITY FULL required for Supabase Realtime filtered UPDATE subscriptions.';
