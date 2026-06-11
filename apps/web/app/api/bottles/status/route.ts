import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// GET /api/bottles/status
// Returns today's quota + sent bottle + received bottle for the authenticated user.
// SECURITY: receiver_id and sender_id are never included in the response.
// User identity comes from session — userId query param is ignored.
export async function GET(_req: NextRequest) {
  const supabase = createClient()

  // ── Auth ───────────────────────────────────────────────────────────────────
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const today = new Date().toISOString().split('T')[0] // YYYY-MM-DD UTC

  // Run all four queries in parallel
  const [quotaResult, sentResult, receivedResult, sailingResult] = await Promise.all([
    supabase
      .from('daily_quotas')
      .select('user_id, date, has_sent, has_received')
      .eq('user_id', user.id)
      .eq('date', today)
      .maybeSingle(),

    // Sent bottle: owned by user — safe to see own sent metadata
    // SECURITY: receiver_id intentionally omitted (anonymity)
    supabase
      .from('bottles')
      .select('id, message, sent_at, received_at, day_key, is_stale')
      .eq('sender_id', user.id)
      .eq('day_key', today)
      .maybeSingle(),

    // Received bottle: user is receiver
    // SECURITY: sender_id intentionally omitted (anonymity)
    supabase
      .from('bottles')
      .select(
        'id, message, sent_at, received_at, read_at, day_key, is_read, is_reported, is_stale'
      )
      .eq('receiver_id', user.id)
      .eq('day_key', today)
      .maybeSingle(),

    // Sailing bottles: ALL of this user's unmatched bottles, any day.
    // Unmatched bottles persist indefinitely (migration 012) — they accumulate
    // across days and float together in the sea on the home screen until matched.
    // SECURITY: receiver_id intentionally omitted.
    supabase
      .from('bottles')
      .select('id, message, sent_at, day_key')
      .eq('sender_id', user.id)
      .is('received_at', null)
      .eq('is_stale', false)
      .order('sent_at', { ascending: false }),
  ])

  const defaultQuota = {
    user_id: user.id,
    date: today,
    has_sent: false,
    has_received: false,
  }

  return NextResponse.json({
    quota: quotaResult.data ?? defaultQuota,
    sentBottle: sentResult.data ?? null,
    receivedBottle: receivedResult.data ?? null,
    sailingBottles: sailingResult.data ?? [],
  })
}
