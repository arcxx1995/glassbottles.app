-- Migration: 009_whatsapp_otp
-- Infrastructure for WhatsApp number OTP verification (v2).
--
-- WHY:
--   v1 sets whatsapp_verified=TRUE immediately on number save — no confirmation
--   that the user owns the number. This allows a user to register someone else's
--   number and have that person receive WhatsApp messages they didn't opt in to.
--
--   v2 fix: before setting whatsapp_verified=TRUE, send a 6-digit OTP to the
--   supplied number and require the user to enter it. Only on correct OTP entry
--   do we mark verified=TRUE.
--
-- FLOW (v2):
--   1. POST /api/whatsapp/register → save number (unverified), generate OTP,
--      send OTP via WhatsApp, insert pending_otp row.
--   2. POST /api/whatsapp/verify-otp { code } → look up pending OTP for user,
--      compare hash, mark whatsapp_verified=TRUE, delete OTP row.
--   3. OTP expires after 10 minutes (enforced by expires_at + pg_cron cleanup).
--
-- SECURITY:
--   - OTP is stored as a bcrypt hash, never plaintext.
--   - OTP has a 6-digit numeric value (10^6 space) — brute-force protected by
--     a 5-attempt limit enforced in the API route (attempts column).
--   - Row deleted after successful verification or expiry.
--   - RLS: user can only see/delete their own OTP row (verify API uses service role).
--   - Only one pending OTP per user at a time (UNIQUE on user_id).
--
-- NOTE:
--   This migration creates the table and cleans up expired OTPs via pg_cron.
--   The actual OTP generation and verification is in the API routes:
--     POST /api/whatsapp/register  (updated in v2 to hash+store OTP)
--     POST /api/whatsapp/verify-otp (new in v2)

CREATE TABLE public.whatsapp_otp_pending (
  user_id      UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  -- Number being verified (not yet written to profiles.whatsapp_number)
  -- Stored here so we can re-send or confirm it matches on verify.
  number_hash  TEXT NOT NULL,   -- bcrypt hash of the phone number
  otp_hash     TEXT NOT NULL,   -- bcrypt hash of the 6-digit OTP code
  attempts     INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at   TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '10 minutes')
);

COMMENT ON TABLE public.whatsapp_otp_pending IS
  'Ephemeral: one row per user during WhatsApp number verification. '
  'Deleted after success or expiry. OTP and number stored as bcrypt hashes — never plaintext.';

-- Index for cleanup cron
CREATE INDEX idx_whatsapp_otp_expires_at ON public.whatsapp_otp_pending(expires_at);

-- ── RLS ───────────────────────────────────────────────────────────────────────
ALTER TABLE public.whatsapp_otp_pending ENABLE ROW LEVEL SECURITY;

-- Clients cannot directly read OTP rows (the verify-otp API route uses service role)
-- No client-readable policy: deny all SELECT to authenticated role.
-- Service role bypasses RLS — API routes use service role for OTP operations.

-- ── pg_cron: hourly cleanup of expired OTPs ───────────────────────────────────
SELECT cron.schedule(
  'cleanup-expired-whatsapp-otps',
  '15 * * * *',  -- :15 past every hour (offset from other cron jobs)
  $$
    DELETE FROM public.whatsapp_otp_pending
    WHERE expires_at < NOW();
  $$
);
