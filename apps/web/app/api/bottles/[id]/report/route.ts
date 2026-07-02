import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// POST /api/bottles/:id/report
// Flags a received bottle as reported. Idempotent — safe to call multiple times.
// Only the receiver can report their bottle; RLS enforces this.
// Reported bottles are auto-flagged for admin review (no auto-ban in v1).
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient()

  // ── Auth ───────────────────────────────────────────────────────────────────
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = params

  if (!id) {
    return NextResponse.json({ error: 'Missing bottle id' }, { status: 400 })
  }

  // Validate UUID format before touching the DB — rejects path traversal attempts,
  // oversized inputs, and non-UUID strings without an unnecessary Supabase round-trip.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) {
    return NextResponse.json({ error: 'Invalid bottle id' }, { status: 400 })
  }

  // Idempotent: ON CONFLICT is implicit since UPDATE is a no-op if is_reported already true.
  // Row scoping comes from the RLS policy "receiver marks read or reported"
  // (receiver_id = auth.uid()). No explicit .eq('receiver_id') — the column is
  // not SELECT-granted to authenticated (migration 015), so filtering on it
  // would fail the column ACL; the policy expression is exempt and authoritative.
  const { data, error } = await supabase
    .from('bottles')
    .update({ is_reported: true })
    .eq('id', id)
    .select('id')

  if (error) {
    if (error.code === '42501') {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
    }
    console.error('[bottles/report] update error:', error.code, error.message)
    return NextResponse.json({ error: 'Failed to report bottle' }, { status: 500 })
  }

  // RLS filtering the row to zero (not the caller's bottle, or no such id)
  // produces no error — without this check the route claimed success for a
  // report that never happened.
  if (!data || data.length === 0) {
    return NextResponse.json({ error: 'Bottle not found' }, { status: 404 })
  }

  return NextResponse.json({ ok: true })
}
