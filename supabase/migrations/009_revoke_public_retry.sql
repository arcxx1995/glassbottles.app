-- Migration 009: Revoke public EXECUTE on retry_unmatched_bottles()
--
-- Postgres grants EXECUTE to PUBLIC by default for functions created without
-- an explicit GRANT/REVOKE. Any authenticated user could call this SECURITY
-- DEFINER function via RPC and trigger arbitrary receiver assignment outside
-- the normal quota-controlled send flow.
--
-- This migration closes that surface. The function is only invoked by:
--   - pg_cron jobs (run as superuser / postgres role — not affected)
--   - Migration 007's pg_net retry path (same)
-- Neither caller uses the `authenticated` or `public` role.

REVOKE EXECUTE ON FUNCTION public.retry_unmatched_bottles() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.retry_unmatched_bottles() FROM authenticated;
