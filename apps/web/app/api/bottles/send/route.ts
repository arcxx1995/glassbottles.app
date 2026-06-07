import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

// POST /api/bottles/send
// Validates quota → inserts bottle → updates daily_quotas → triggers match-bottle edge function.
// Idempotent: RLS INSERT policy + server-side quota check both guard against double-send.
// NOTE: a UNIQUE (sender_id, day_key) constraint (migration 004) is needed for full atomicity.
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

  const { message } = body as { message?: string }
  const trimmed = message?.trim()

  // ── 3. Validate message ────────────────────────────────────────────────────
  if (!trimmed) {
    return NextResponse.json({ error: 'Message is required' }, { status: 400 })
  }
  if (trimmed.length > 1000) {
    return NextResponse.json(
      { error: 'Message too long — max 1000 characters' },
      { status: 400 }
    )
  }

  const today = new Date().toISOString().split('T')[0] // YYYY-MM-DD UTC

  // ── 4. Server-side quota check (defense-in-depth on top of RLS) ───────────
  const { data: quota } = await supabase
    .from('daily_quotas')
    .select('has_sent')
    .eq('user_id', user.id)
    .eq('date', today)
    .maybeSingle()

  if (quota?.has_sent === true) {
    return NextResponse.json(
      { error: 'Already sent a bottle today. Come back tomorrow.' },
      { status: 429 }
    )
  }

  // ── 5. Insert bottle ───────────────────────────────────────────────────────
  // RLS INSERT policy also enforces quota — double guard.
  const { data: bottle, error: insertError } = await supabase
    .from('bottles')
    .insert({
      sender_id: user.id,
      message: trimmed,
      day_key: today,
    })
    .select(
      'id, message, sent_at, received_at, read_at, day_key, is_read, is_reported, is_stale'
    )
    .single()

  if (insertError) {
    // RLS policy violation (quota exceeded, race condition) or check constraint
    if (
      insertError.code === '42501' || // RLS violation
      insertError.code === '23514'    // CHECK constraint violation
    ) {
      return NextResponse.json(
        { error: 'Already sent a bottle today. Come back tomorrow.' },
        { status: 429 }
      )
    }
    console.error('[bottles/send] insert error:', insertError.code, insertError.message)
    return NextResponse.json({ error: 'Failed to send bottle' }, { status: 500 })
  }

  // ── 6. Upsert daily quota via service role (no client INSERT policy) ───────
  const service = createServiceClient()

  const { error: quotaError } = await service.from('daily_quotas').upsert(
    { user_id: user.id, date: today, has_sent: true },
    { onConflict: 'user_id,date' }
  )

  if (quotaError) {
    // Non-fatal — quota row may already exist; log and continue
    console.error('[bottles/send] quota upsert error:', quotaError.code)
  }

  // ── 7. Fire-and-forget: trigger match-bottle edge function ─────────────────
  service.functions
    .invoke('match-bottle', { body: { bottle_id: bottle.id } })
    .catch(() => {
      // Swallow — matching is also attempted by pg_cron on failed bottles
    })

  // Never return sender_id (not needed by client, and receiver must not see it)
  return NextResponse.json(bottle, { status: 201 })
}
