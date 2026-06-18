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

  // The "day" is the sender's LOCAL date (migration 019), derived in the DB
  // from profiles.timezone so the quota check, the bottle day_key default, and
  // the RLS INSERT policy all reference one identical expression. user_local_today()
  // resolves auth.uid() server-side — no client-supplied date to drift.
  const { data: today, error: dateError } = await supabase.rpc('user_local_today')

  if (dateError || !today) {
    console.error('[bottles/send] user_local_today failed:', dateError?.message)
    return NextResponse.json({ error: 'Failed to send bottle' }, { status: 500 })
  }

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
      // day_key omitted — its DB DEFAULT is user_local_date(auth.uid())
      // (migration 019), the same expression the RLS quota check uses.
    })
    .select(
      'id, message, sent_at, received_at, read_at, day_key, is_read, is_reported, is_stale'
    )
    .single()

  if (insertError) {
    // RLS policy violation (quota exceeded, race condition), check constraint,
    // or UNIQUE (sender_id, day_key) violation from a concurrent duplicate send.
    // All three map to "already sent today" from the client's perspective.
    if (
      insertError.code === '42501' || // RLS violation
      insertError.code === '23514' || // CHECK constraint violation
      insertError.code === '23505'    // UNIQUE violation (concurrent duplicate send)
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

  // Stamp last activity. profiles.last_active was previously dead (never
  // written); sending is a reliable once-a-day authed interaction, so it is a
  // cheap, meaningful liveness signal. Fire-and-forget — never blocks the send.
  void service
    .from('profiles')
    .update({ last_active: new Date().toISOString() })
    .eq('id', user.id)

  // ── 7. Matching is intentionally NOT triggered at send time. ──────────────
  // The "1 hour adrift" rule (migration 022) means a bottle cannot be matched
  // until it has floated for at least an hour; match_bottle() would just return
  // 'too early' here. The retry cron (every 15 min) finds it on the first tick
  // after it crosses the hour, so it drifts in the sender's sea until then.

  // Never return sender_id (not needed by client, and receiver must not see it)
  return NextResponse.json(bottle, { status: 201 })
}
