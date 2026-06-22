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
    .select('id, timezone, email_notifications, is_plus, created_at, last_active')
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
    // Validate format before length: only IANA timezone characters allowed.
    // Pattern: letters, digits, underscores, forward-slashes, plus, hyphens.
    // Rejects any HTML/script payload — stored XSS mitigation. Also guards the
    // per-user day model: an invalid tz would make user_local_date() throw.
    if (typeof timezone !== 'string' || !/^[A-Za-z_/+\-]{1,64}$/.test(timezone)) {
      return NextResponse.json({ error: 'Invalid timezone format' }, { status: 400 })
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
    .select('id, timezone, email_notifications, is_plus, created_at, last_active')
    .single()

  if (error) {
    console.error('[profile] update error:', error.code, error.message)
    return NextResponse.json({ error: 'Failed to update profile' }, { status: 500 })
  }

  return NextResponse.json(profile)
}
