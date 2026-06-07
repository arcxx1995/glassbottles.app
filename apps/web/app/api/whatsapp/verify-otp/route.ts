import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

// POST /api/whatsapp/verify-otp
// v2 OTP verification for WhatsApp number registration.
//
// FLOW:
//   1. User calls POST /api/whatsapp/register → receives WhatsApp OTP
//   2. User calls this endpoint with { code: "123456" }
//   3. We atomically increment attempts AND verify in a single DB round-trip
//      via the verify_whatsapp_otp SQL function (SECURITY DEFINER, no race).
//   4. On match: write phone number to profiles, set whatsapp_verified=true, delete OTP row
//   5. On failure: attempts already incremented; lock out after 5 failed attempts
//
// SECURITY:
//   - OTP verified server-side only — code never stored plaintext
//   - Attempt counter incremented atomically inside the DB function (no race window)
//   - 5-attempt limit before lockout (OTP deleted, user must re-register)
//   - OTP expires after 10 minutes (enforced by expires_at inside DB function)
//   - WhatsApp number never logged
//   - Service role used for OTP row operations (no client RLS on whatsapp_otp_pending)
//
// NOTE: This endpoint is v2. In v1, POST /api/whatsapp/register sets
//       whatsapp_verified=true immediately. When v2 OTP flow is activated,
//       /api/whatsapp/register sets whatsapp_verified=false and sends an OTP.
//       This endpoint handles the confirmation step.

const MAX_ATTEMPTS = 5

export async function POST(req: NextRequest) {
  const supabase = createClient()

  // ── 1. Auth ────────────────────────────────────────────────────────────────
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // ── 2. Parse body ──────────────────────────────────────────────────────────
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { code } = body as { code?: string }

  if (!code || typeof code !== 'string') {
    return NextResponse.json({ error: 'code required' }, { status: 400 })
  }

  // Validate shape: 6-digit numeric code only
  if (!/^\d{6}$/.test(code)) {
    return NextResponse.json(
      { error: 'Invalid code format — must be 6 digits' },
      { status: 400 }
    )
  }

  // ── 3. Verify via atomic DB function ──────────────────────────────────────
  //
  // verify_whatsapp_otp_atomic() does the following in a single transaction:
  //   a. Fetch the pending OTP row with FOR UPDATE (advisory lock on the row)
  //   b. Check expiry and attempt count
  //   c. Atomically increment attempts
  //   d. Compare crypt(code, otp_hash) === otp_hash
  //   e. Return { status, phone_number }
  //
  // Using the atomic function eliminates the read-then-update race window that
  // would exist if we fetched attempts in the API route and updated separately.
  const service = createServiceClient()

  const { data: rpcResult, error: rpcError } = await service.rpc(
    'verify_whatsapp_otp_atomic',
    {
      p_user_id: user.id,
      p_code: code,
      p_max_attempts: MAX_ATTEMPTS,
    }
  )

  if (rpcError) {
    console.error('[whatsapp/verify-otp] rpc error:', rpcError.code, rpcError.message)
    return NextResponse.json({ error: 'Verification failed' }, { status: 500 })
  }

  // Function returns SETOF TABLE — Supabase client wraps it as an array.
  const rows = rpcResult as Array<{
    status: 'matched' | 'wrong_code' | 'expired' | 'max_attempts' | 'not_found'
    phone_number: string | null
    attempts_remaining: number | null
  }>

  if (!rows || rows.length === 0) {
    return NextResponse.json({ error: 'Verification failed' }, { status: 500 })
  }

  const { status, phone_number, attempts_remaining } = rows[0]

  // ── 4. Handle all outcomes from the DB function ───────────────────────────
  switch (status) {
    case 'not_found':
      return NextResponse.json(
        { error: 'No pending verification — use POST /api/whatsapp/register first' },
        { status: 404 }
      )

    case 'expired':
      return NextResponse.json(
        { error: 'OTP expired — request a new one via POST /api/whatsapp/register' },
        { status: 410 }
      )

    case 'max_attempts':
      return NextResponse.json(
        { error: 'Too many attempts — request a new OTP via POST /api/whatsapp/register' },
        { status: 429 }
      )

    case 'wrong_code':
      return NextResponse.json(
        {
          error: 'Invalid code',
          attempts_remaining: attempts_remaining ?? 0,
        },
        { status: 400 }
      )

    case 'matched':
      break // continue to write profile

    default:
      return NextResponse.json({ error: 'Unexpected verification state' }, { status: 500 })
  }

  // ── 5. OTP matched — write verified number to profiles ────────────────────
  if (!phone_number) {
    // Defensive — should never happen if RPC is correct
    console.error('[whatsapp/verify-otp] OTP matched but phone_number null for user', user.id)
    return NextResponse.json({ error: 'Verification data corrupt' }, { status: 500 })
  }

  // Write the verified number — never log phone_number
  const { error: profileError } = await supabase
    .from('profiles')
    .update({
      whatsapp_number: phone_number,
      whatsapp_verified: true,
      last_active: new Date().toISOString(),
    })
    .eq('id', user.id)

  if (profileError) {
    console.error('[whatsapp/verify-otp] profile update error:', profileError.code)
    return NextResponse.json({ error: 'Failed to save verified number' }, { status: 500 })
  }

  // ── 6. Delete the OTP row — verification complete ─────────────────────────
  await service
    .from('whatsapp_otp_pending')
    .delete()
    .eq('user_id', user.id)

  return NextResponse.json({ verified: true })
}
