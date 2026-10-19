-- Migration 040: state the grants the app relies on, instead of inheriting them
--
-- Prod still carries Supabase's legacy default privileges (every new table and
-- function GRANT ALL to anon/authenticated/service_role). Newer projects, the
-- local CLI stack after 2026-10-30, CI and any branch DB start with none of
-- that — and there this schema breaks quietly:
--   - authenticated could not SELECT profiles → GET/PATCH /api/profile fail,
--   - service_role had no table access → notify-receiver (the email
--     pipeline) and every admin script fail,
--   - nobody but the owner could run retry_unmatched_bottles().
-- On prod every statement below is a no-op (the privileges already exist);
-- elsewhere it is exactly what the code uses, nothing more. RLS still decides
-- which rows a client sees.

-- Clients: read own profile (RLS "profiles: read own"); column-limited UPDATE
-- was granted in 038.
GRANT SELECT ON public.profiles TO authenticated;

-- Server side: notify-receiver (bottles + profiles), account deletion and
-- ops tooling run as service_role and bypass RLS by design.
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.bottles, public.profiles, public.daily_quotas, public.public_stats
  TO service_role;
GRANT EXECUTE ON FUNCTION public.retry_unmatched_bottles() TO service_role;
