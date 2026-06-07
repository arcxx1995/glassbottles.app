-- Migration: 005_rls_column_restriction
-- Tighten bottles UPDATE: restrict receiver to only is_read, read_at, is_reported.
--
-- Problem (flagged by Felix, Session 1):
--   The RLS policy "bottles: receiver marks read or reported" guards the row via
--   USING/WITH CHECK (auth.uid() = receiver_id), but PostgreSQL RLS does not
--   restrict *which columns* a matching UPDATE may touch. A malicious client
--   could PATCH receiver_id, sender_id, message, etc. on their own received bottle.
--
-- Fix: column-level privileges.
--   1. Revoke the blanket UPDATE grant on bottles from the authenticated role.
--   2. Re-grant UPDATE only on the three columns receivers are allowed to touch.
--   3. The service role (used by edge functions) bypasses RLS entirely and retains
--      full UPDATE access — no change needed there.
--
-- Note: sender_id, receiver_id, message, sent_at, received_at, day_key, is_stale
--       are now non-updatable by any authenticated client. Mutations to those
--       columns must go through service-role edge functions only.

-- Step 1: Revoke full UPDATE from authenticated role
REVOKE UPDATE ON public.bottles FROM authenticated;

-- Step 2: Grant column-level UPDATE for receiver-writable columns only
GRANT UPDATE (is_read, read_at, is_reported) ON public.bottles TO authenticated;

-- The existing RLS policy "bottles: receiver marks read or reported" continues to
-- enforce row-level ownership (auth.uid() = receiver_id). Together with the
-- column-level grant above, this is a two-layer defence:
--   Layer 1 (column): can only write is_read / read_at / is_reported
--   Layer 2 (row):    can only write to bottles where you are the receiver
