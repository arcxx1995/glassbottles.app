import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// GET /api/bottles/received
// Returns all bottles received by the authenticated user, newest first.
// SECURITY: sender_id is never selected — anonymous sender enforced at query level.
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

  // SECURITY: sender_id intentionally not selected — preserves sender anonymity.
  // RLS policy also enforces receiver_id = auth.uid() on SELECT.
  const { data: bottles, error } = await supabase
    .from('bottles')
    .select(
      'id, message, sent_at, received_at, read_at, day_key, is_read, is_reported, is_stale'
    )
    .eq('receiver_id', user.id)
    .eq('is_stale', false)
    .order('received_at', { ascending: false })

  if (error) {
    console.error('[bottles/received] query error:', error.code, error.message)
    return NextResponse.json({ error: 'Failed to fetch bottles' }, { status: 500 })
  }

  return NextResponse.json(bottles ?? [])
}
