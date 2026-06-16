-- Public landing-page stats, PRECOMPUTED so anonymous visitors read one cached
-- row instead of triggering a COUNT(*) scan per page load.
--
--   adrift_count = undelivered bottles currently at sea
--                  (received_at IS NULL AND is_stale = FALSE) — refreshed HOURLY.
--   total_count  = all bottles ever thrown (cumulative; monotonic because stale
--                  bottles are flagged, not deleted)            — refreshed DAILY.
--
-- Cost: the COUNT scans run on the cron cadence (~25/day total), NEVER per
-- visitor. Each landing visit is a single-row read via get_public_stats(),
-- which is granted to anon. Scales to unlimited landing traffic at ~zero cost.

-- Partial index keeps the hourly adrift COUNT cheap as the table grows.
CREATE INDEX IF NOT EXISTS idx_bottles_adrift
  ON public.bottles (id)
  WHERE received_at IS NULL AND is_stale = FALSE;

-- Single-row stats table (id is a TRUE-only singleton).
CREATE TABLE IF NOT EXISTS public.public_stats (
  id           BOOLEAN PRIMARY KEY DEFAULT TRUE,
  adrift_count INTEGER NOT NULL DEFAULT 0,
  total_count  INTEGER NOT NULL DEFAULT 0,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT public_stats_singleton CHECK (id)
);

INSERT INTO public.public_stats (id) VALUES (TRUE) ON CONFLICT (id) DO NOTHING;

-- Lock the table: only the SECURITY DEFINER functions below touch it.
ALTER TABLE public.public_stats ENABLE ROW LEVEL SECURITY;
-- (intentionally no policies → no direct client access)

-- ── Refreshers (run by cron, owned by the migration role → bypass RLS) ────────
CREATE OR REPLACE FUNCTION public.refresh_adrift_count()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE public.public_stats
  SET adrift_count = (
        SELECT COUNT(*)::int FROM public.bottles
        WHERE received_at IS NULL AND is_stale = FALSE
      ),
      updated_at = now()
  WHERE id;
$$;

CREATE OR REPLACE FUNCTION public.refresh_total_count()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE public.public_stats
  SET total_count = (SELECT COUNT(*)::int FROM public.bottles),
      updated_at = now()
  WHERE id;
$$;

-- ── Public read API (bare integers, no PII) ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_public_stats()
RETURNS TABLE (adrift_count INTEGER, total_count INTEGER, updated_at TIMESTAMPTZ)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT adrift_count, total_count, updated_at FROM public.public_stats WHERE id;
$$;

REVOKE EXECUTE ON FUNCTION public.refresh_adrift_count() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.refresh_total_count()  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_public_stats()     FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_public_stats()     TO anon, authenticated;

-- Seed real values now so the row isn't 0 on first deploy.
SELECT public.refresh_adrift_count();
SELECT public.refresh_total_count();

-- Cron: adrift hourly (on the hour), total daily (00:10 UTC).
SELECT cron.schedule('refresh-adrift-count', '0 * * * *',  $$ SELECT public.refresh_adrift_count(); $$);
SELECT cron.schedule('refresh-total-count',  '10 0 * * *', $$ SELECT public.refresh_total_count();  $$);
