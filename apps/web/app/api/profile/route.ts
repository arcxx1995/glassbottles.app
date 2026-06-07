import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { validateE164 } from '@/lib/whatsapp/client'

// GET /api/profile
// Returns the authenticated user's profile.
// NOTE: whatsapp_number IS returned to the profile owner for settings display.
// It is never logged server-side. Never exposed to other users (RLS enforces).
export async function GET(_req: NextRequest) {
  const supabase = createClient()

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('id, whatsapp_number, whatsapp_verified, timezone, created_at, last_active')
    .eq('id', user.id)
    .single()

  if (error || !profile) {
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
  }

  // whatsapp_number returned to owner only (RLS guarantees isolation).
  // Never log this value.
  return NextResponse.json(profile)
}

// PATCH /api/profile
// Updates timezone and/or whatsapp_number for the authenticated user.
// WhatsApp number: validated as E.164 before save; sets whatsapp_verified = true (v1 simplified).
// For OTP-based verification, use POST /api/whatsapp/register instead.
export async function PATCH(req: NextRequest) {
  const supabase = createClient()

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { whatsapp_number, timezone } = body as {
    whatsapp_number?: string | null
    timezone?: string
  }

  const update: Record<string, unknown> = {
    last_active: new Date().toISOString(),
  }

  // Timezone update
  if (timezone !== undefined) {
    if (typeof timezone !== 'string' || timezone.length > 64) {
      return NextResponse.json({ error: 'Invalid timezone' }, { status: 400 })
    }
    update.timezone = timezone
  }

  // WhatsApp number update — validate E.164 format
  if (whatsapp_number !== undefined) {
    if (whatsapp_number === null || whatsapp_number === '') {
      // Clear the number
      update.whatsapp_number = null
      update.whatsapp_verified = false
    } else {
      const trimmed = whatsapp_number.trim()
      if (!validateE164(trimmed)) {
        return NextResponse.json(
          { error: 'WhatsApp number must be in E.164 format (e.g. +919XXXXXXXXX)' },
          { status: 400 }
        )
      }
      // v1: mark verified immediately. Real flow → POST /api/whatsapp/register + OTP.
      update.whatsapp_number = trimmed
      update.whatsapp_verified = true
    }
  }

  const { data: profile, error } = await supabase
    .from('profiles')
    .update(update)
    .eq('id', user.id)
    .select('id, whatsapp_number, whatsapp_verified, timezone, created_at, last_active')
    .single()

  if (error) {
    console.error('[profile] update error:', error.code, error.message)
    return NextResponse.json({ error: 'Failed to update profile' }, { status: 500 })
  }

  // whatsapp_number returned to owner only — never log it
  return NextResponse.json(profile)
}
