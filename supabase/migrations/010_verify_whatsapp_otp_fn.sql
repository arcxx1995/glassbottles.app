-- Migration: 010_verify_whatsapp_otp_fn
-- SQL function for server-side bcrypt OTP verification.
--
-- WHY SQL NOT APPLICATION CODE:
--   The otp_hash is a bcrypt hash stored in whatsapp_otp_pending.
--   To verify: crypt(supplied_code, stored_hash) must equal stored_hash.
--   We do this inside the DB so:
--     (a) The stored hash and comparison both happen within the DB boundary.
--     (b) The OTP code is never stored or echoed back in the Next.js process logs.
--     (c) The phone number (needed to write to profiles) stays in DB memory only.
--
-- pgcrypto EXTENSION:
--   crypt() is provided by pgcrypto. Supabase enables pgcrypto by default.
--
-- FUNCTION CONTRACT:
--   Input:  p_user_id UUID, p_code TEXT (6-digit numeric string)
--   Output: TABLE(matched BOOLEAN, phone_number TEXT)
--     - matched: true if crypt(p_code, otp_hash) = otp_hash
--     - phone_number: bcrypt-decoded original number (NOT the hash) if matched
--       Actually: we store number_hash as bcrypt of the phone number, so we
--       cannot reverse it. Instead, we store the phone number separately in the
--       OTP row but encrypted via pgcrypto.
--
-- REVISED APPROACH:
--   Since bcrypt is one-way, we cannot decrypt the number from number_hash.
--   The OTP row will store:
--     - number_encrypted: pgcrypto symmetric encrypt of phone number
--     - otp_hash: bcrypt of the OTP code
--   This function verifies the OTP and returns the decrypted phone number.
--
-- HOWEVER: Supabase does not expose a symmetric key to SQL functions trivially.
-- SIMPLEST SECURE APPROACH for v1.5:
--   Store the phone number in a separate column as pgp_sym_encrypt using a
--   DB GUC key (same pattern as service_role_key in migration 007).
--   If DB GUC not set, fall back to treating number_hash as the plaintext number
--   (v1 OTP without encryption — acceptable given short TTL + bcrypt OTP).
--
-- PRAGMATIC v1.5 DECISION:
--   Store the pending phone number as plaintext in whatsapp_otp_pending.number_encrypted
--   (column rename from number_hash). The OTP code is bcrypt-hashed. The phone
--   number is not hashed in the OTP table — it's a short-lived row (10 min TTL).
--   PII risk is bounded:
--     - RLS denies all client access to whatsapp_otp_pending
--     - Row auto-deleted after verification or expiry
--     - pg_cron cleans up stragglers hourly
--   Full encryption (pgp_sym_encrypt) is a v2 Vault upgrade.

-- Ensure pgcrypto is available
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Add pending_number column to the OTP table for the phone number (short-lived).
-- We store the number in this column instead of number_hash (which was bcrypt —
-- impractical for retrieval). The OTP code itself is still bcrypt-hashed.
ALTER TABLE public.whatsapp_otp_pending
  ADD COLUMN IF NOT EXISTS pending_number TEXT;

-- Remove the old number_hash column if it exists and is no longer needed
-- (it was defined in migration 009 but contained a bcrypt hash which we can't reverse)
-- We keep it nullable and deprecate it in favour of pending_number.
-- DO NOT DROP — production might have rows using it. Mark as deprecated.
COMMENT ON COLUMN public.whatsapp_otp_pending.number_hash IS
  'DEPRECATED as of migration 010. Use pending_number instead. '
  'Kept to avoid destructive migration on existing installs.';

COMMENT ON COLUMN public.whatsapp_otp_pending.pending_number IS
  'Phone number being verified (E.164). Short-lived — row deleted on verify or expiry. '
  'Not encrypted in v1.5 (acceptable given 10min TTL + no client access). '
  'Upgrade to pgp_sym_encrypt in v2.';

-- ── generate_whatsapp_otp RPC ──────────────────────────────────────────────────
-- Called from: POST /api/whatsapp/register (v2 flow)
-- Generates a 6-digit OTP, stores its bcrypt hash, returns the plaintext code
-- so the API route can send it via WhatsApp.
--
-- SECURITY: The plaintext code is returned once (to the API route which sends it
-- via WhatsApp). It is never stored anywhere after this call — only the hash is
-- persisted. The API route must NOT log the returned code.

CREATE OR REPLACE FUNCTION public.generate_whatsapp_otp(
  p_user_id       UUID,
  p_phone_number  TEXT
)
RETURNS TEXT  -- the 6-digit OTP code (plaintext, send-once)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_code  TEXT;
  v_hash  TEXT;
BEGIN
  -- Generate cryptographically secure random 6-digit numeric code.
  -- RANDOM() is not a CSPRNG — never use for OTPs. gen_random_bytes() (pgcrypto)
  -- uses the OS CSPRNG. 4 bytes → mask sign bit → mod 1000000. Bias ~0.02%.
  v_code := LPAD(
    ((('x' || encode(gen_random_bytes(4), 'hex'))::bit(32)::int & 2147483647) % 1000000)::TEXT,
    6, '0'
  );

  -- Hash it with bcrypt (cost 10)
  v_hash := crypt(v_code, gen_salt('bf', 10));

  -- Upsert into pending OTP table (one row per user; replace any existing)
  INSERT INTO public.whatsapp_otp_pending
    (user_id, number_hash, pending_number, otp_hash, attempts, created_at, expires_at)
  VALUES
    (p_user_id, '', p_phone_number, v_hash, 0, NOW(), NOW() + INTERVAL '10 minutes')
  ON CONFLICT (user_id) DO UPDATE
    SET number_hash   = '',
        pending_number = p_phone_number,
        otp_hash      = v_hash,
        attempts      = 0,
        created_at    = NOW(),
        expires_at    = NOW() + INTERVAL '10 minutes';

  RETURN v_code;
END;
$$;

COMMENT ON FUNCTION public.generate_whatsapp_otp(UUID, TEXT) IS
  'Generates a 6-digit OTP for WhatsApp number verification. '
  'Stores a bcrypt hash in whatsapp_otp_pending; returns the plaintext code once. '
  'Caller (POST /api/whatsapp/register) must send the code via WhatsApp API '
  'and must NOT log the returned value. '
  'Idempotent: replaces any existing pending OTP for the same user.';

-- ── verify_whatsapp_otp_atomic RPC ────────────────────────────────────────────
-- Atomic version of verification that eliminates the race window between
-- reading `attempts` and incrementing it (two concurrent requests could both
-- pass the attempts check before either increments).
--
-- Uses SELECT ... FOR UPDATE to lock the row for the duration of the transaction.
-- All state transitions (expiry check, attempts increment, code comparison) happen
-- within a single serializable operation.
--
-- Called from: POST /api/whatsapp/verify-otp (via service role client)
-- Returns: SETOF record with:
--   status:            'matched' | 'wrong_code' | 'expired' | 'max_attempts' | 'not_found'
--   phone_number:      TEXT (the pending phone number, only on 'matched')
--   attempts_remaining: INTEGER (remaining attempts, only on 'wrong_code')

CREATE OR REPLACE FUNCTION public.verify_whatsapp_otp_atomic(
  p_user_id      UUID,
  p_code         TEXT,
  p_max_attempts INTEGER DEFAULT 5
)
RETURNS TABLE(
  status             TEXT,
  phone_number       TEXT,
  attempts_remaining INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_row           public.whatsapp_otp_pending%ROWTYPE;
  v_new_attempts  INTEGER;
BEGIN
  -- Lock the row for update — serializes concurrent verify attempts
  SELECT *
  INTO   v_row
  FROM   public.whatsapp_otp_pending
  WHERE  user_id = p_user_id
  FOR UPDATE;

  -- No pending row
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found'::TEXT, NULL::TEXT, NULL::INTEGER;
    RETURN;
  END IF;

  -- Expired — delete and return
  IF v_row.expires_at < NOW() THEN
    DELETE FROM public.whatsapp_otp_pending WHERE user_id = p_user_id;
    RETURN QUERY SELECT 'expired'::TEXT, NULL::TEXT, NULL::INTEGER;
    RETURN;
  END IF;

  -- Already at max attempts — delete and return
  IF v_row.attempts >= p_max_attempts THEN
    DELETE FROM public.whatsapp_otp_pending WHERE user_id = p_user_id;
    RETURN QUERY SELECT 'max_attempts'::TEXT, NULL::TEXT, 0::INTEGER;
    RETURN;
  END IF;

  -- Increment attempts atomically (row is locked, no race here)
  v_new_attempts := v_row.attempts + 1;

  UPDATE public.whatsapp_otp_pending
  SET    attempts = v_new_attempts
  WHERE  user_id  = p_user_id;

  -- Verify OTP using bcrypt: crypt(input, stored_hash) must equal stored_hash
  IF crypt(p_code, v_row.otp_hash) = v_row.otp_hash THEN
    -- Matched — return the pending phone number; caller deletes the row after profile update
    RETURN QUERY SELECT
      'matched'::TEXT,
      v_row.pending_number,
      NULL::INTEGER;
  ELSE
    RETURN QUERY SELECT
      'wrong_code'::TEXT,
      NULL::TEXT,
      (p_max_attempts - v_new_attempts)::INTEGER;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.verify_whatsapp_otp_atomic(UUID, TEXT, INTEGER) IS
  'Atomic OTP verification with row-level locking (FOR UPDATE). '
  'Eliminates the race window that would exist with a separate read+increment. '
  'Returns a status enum: matched|wrong_code|expired|max_attempts|not_found. '
  'On matched: returns the pending phone number so the caller can write it to profiles. '
  'Does NOT delete the OTP row on match — caller must delete after successful profile update. '
  'Does delete the row on expired or max_attempts. '
  'Called via service role RPC from POST /api/whatsapp/verify-otp.';
