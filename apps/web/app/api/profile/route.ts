import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// GET /api/profile
// Returns the authenticated user's profile.
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
    .select('id, timezone, email_notifications, created_at, last_active')
    .eq('id', user.id)
    .single()

  if (error || !profile) {
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
  }

  return NextResponse.json(profile)
}

// PATCH /api/profile
// Updates timezone for the authenticated user.
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

  const { timezone, email_notifications } = body as {
    timezone?: string
    email_notifications?: boolean
  }

  const update: Record<string, unknown> = {
    last_active: new Date().toISOString(),
  }

  if (timezone !== undefined) {
    // Character allowlist (letters, digits, underscores, slashes, plus, hyphens)
    // rejects HTML/script payloads — stored XSS mitigation.
    if (typeof timezone !== 'string' || !/^[A-Za-z0-9_/+\-]{1,64}$/.test(timezone)) {
      return NextResponse.json({ error: 'Invalid timezone format' }, { status: 400 })
    }
    // Must also be a REAL IANA zone: user_local_date() runs
    // `now() AT TIME ZONE <tz>` inside the day_key default, the send quota
    // check and the status RPC — a stored bogus zone bricks the account
    // (every send and home load throws) until a valid tz is PATCHed back.
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: timezone })
    } catch {
      return NextResponse.json({ error: 'Unknown timezone' }, { status: 400 })
    }
    update.timezone = timezone
  }

  if (email_notifications !== undefined) {
    if (typeof email_notifications !== 'boolean') {
      return NextResponse.json({ error: 'Invalid email_notifications' }, { status: 400 })
    }
    update.email_notifications = email_notifications
  }

  const { data: profile, error } = await supabase
    .from('profiles')
    .update(update)
    .eq('id', user.id)
    .select('id, timezone, email_notifications, created_at, last_active')
    .single()

  if (error) {
    console.error('[profile] update error:', error.code, error.message)
    return NextResponse.json({ error: 'Failed to update profile' }, { status: 500 })
  }

  return NextResponse.json(profile)
}
