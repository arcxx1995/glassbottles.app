import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { validateE164, sendOtpTemplate } from '@/lib/whatsapp/client'

// POST /api/whatsapp/register
// Saves and validates a WhatsApp number for the authenticated user.
//
// MODES (controlled by WHATSAPP_OTP_ENABLED env var):
//
//   v1 (WHATSAPP_OTP_ENABLED != 'true'):
//     Validates E.164 format, saves, marks whatsapp_verified=true immediately.
//     Simple. No OTP sent. Used during initial launch.
//     Response: { registered: true, verified: true, otp_required: false }
//
//   v2 (WHATSAPP_OTP_ENABLED == 'true'):
//     Validates E.164 format, stores number in pending OTP table (unverified),
//     sends 6-digit OTP via WhatsApp. Profile is NOT updated yet.
//     User must then call POST /api/whatsapp/verify-otp to confirm ownership.
//     Response: { registered: false, verified: false, otp_required: true }
//
// SECURITY:
//   - Number never logged
//   - E.164 validated server-side
//   - OTP code never logged (generated in DB function, sent directly to WhatsApp)
//   - Idempotent: re-calling re-sends a fresh OTP (replaces old pending row)
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

  const { whatsapp_number } = body as { whatsapp_number?: string }

  if (!whatsapp_number) {
    return NextResponse.json({ error: 'whatsapp_number required' }, { status: 400 })
  }

  const trimmed = whatsapp_number.trim()

  // ── 3. Validate E.164 ──────────────────────────────────────────────────────
  if (!validateE164(trimmed)) {
    return NextResponse.json(
      { error: 'Number must be in E.164 format (e.g. +919XXXXXXXXX)' },
      { status: 400 }
    )
  }

  // ── 4. Mode switch: OTP required? ─────────────────────────────────────────
  const otpEnabled = process.env.WHATSAPP_OTP_ENABLED === 'true'

  if (!otpEnabled) {
    // ── v1: immediate verification ─────────────────────────────────────────
    const { error: updateError } = await supabase
      .from('profiles')
      .update({
        whatsapp_number: trimmed,
        whatsapp_verified: true,
        last_active: new Date().toISOString(),
      })
      .eq('id', user.id)

    if (updateError) {
      console.error('[whatsapp/register] update error:', updateError.code, updateError.message)
      return NextResponse.json({ error: 'Failed to register WhatsApp number' }, { status: 500 })
    }

    return NextResponse.json({ registered: true, verified: true, otp_required: false })
  }

  // ── v2: OTP flow ──────────────────────────────────────────────────────────

  const service = createServiceClient()

  // ── 4a. Rate limit ────────────────────────────────────────────────────────
  // 60s cooldown per user AND per number (prevents targeting a stranger's number).
  // pending_number stores the E.164 number plaintext (short-lived row, RLS locked).
  const rateLimitCutoff = new Date(Date.now() - 60_000).toISOString()
  const { data: recentRows } = await service
    .from('whatsapp_otp_pending')
    .select('user_id')
    .or(`user_id.eq.${user.id},pending_number.eq.${trimmed}`)
    .gte('created_at', rateLimitCutoff)
    .limit(1)

  if (recentRows && recentRows.length > 0) {
    return NextResponse.json(
      { error: 'Please wait before requesting another code' },
      { status: 429 }
    )
  }

  // Generate OTP via SQL function (code is bcrypt-hashed in DB; plaintext returned once)
  // SECURITY: Do NOT log `otpCode`
  const { data: otpCode, error: genError } = await service.rpc('generate_whatsapp_otp', {
    p_user_id: user.id,
    p_phone_number: trimmed,
  })

  if (genError || !otpCode) {
    console.error('[whatsapp/register] OTP generation error:', genError?.code)
    return NextResponse.json({ error: 'Failed to generate verification code' }, { status: 500 })
  }

  // Send OTP via WhatsApp — dedicated glassbottle_otp template.
  // OTP code is a body text variable ({{1}}), never embedded in a URL.
  // Template must be registered in Meta Business Manager before enabling v2.
  const result = await sendOtpTemplate(trimmed, otpCode)

  if (!result.ok) {
    // OTP send failed — delete the pending row (user can retry)
    await service
      .from('whatsapp_otp_pending')
      .delete()
      .eq('user_id', user.id)

    console.error('[whatsapp/register] WhatsApp send error:', result.error)
    return NextResponse.json(
      { error: 'Failed to send verification code via WhatsApp' },
      { status: 502 }
    )
  }

  // OTP sent — user must now call POST /api/whatsapp/verify-otp
  return NextResponse.json({
    registered: false,
    verified: false,
    otp_required: true,
  })
}
