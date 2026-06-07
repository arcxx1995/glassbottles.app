import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// PATCH /api/bottles/:id/read
// Marks a received bottle as read. Idempotent — no-op if already read.
// Only the receiver can mark their bottle; RLS enforces this.
export async function PATCH(
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

  // Idempotent: only update when is_read = false; skip silently if already read.
  // RLS "receiver marks read or reported" policy ensures receiver_id = auth.uid().
  const { error } = await supabase
    .from('bottles')
    .update({
      is_read: true,
      read_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('receiver_id', user.id)
    .eq('is_read', false) // IS NULL guard equivalent for boolean — idempotent

  if (error) {
    // RLS violation means user is not the receiver
    if (error.code === '42501') {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
    }
    console.error('[bottles/read] update error:', error.code, error.message)
    return NextResponse.json({ error: 'Failed to mark as read' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
