import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

// POST /api/account/delete
// Hard-deletes the AUTHENTICATED user's account. Irreversible.
//
// The target is ALWAYS the session user (user.id from the verified cookie) —
// never a value from the request body — so a caller can only ever delete
// themselves, regardless of what they send.
//
// Cascade is manual on purpose: profiles.id CASCADEs from auth.users, but the
// rows that reference profiles(id) — bottles.sender_id, bottles.receiver_id,
// daily_quotas.user_id — were created with NO ON DELETE action (migration 001),
// so admin.deleteUser() would fail on the FK while those rows exist. Remove the
// children first (service role, bypasses RLS), then delete the auth user, which
// cascades the profile.
export async function POST(_req: NextRequest) {
  const supabase = createClient()

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const uid = user.id
  const admin = createServiceClient()

  // 1. daily_quotas (user_id → profiles.id)
  const { error: quotaErr } = await admin
    .from('daily_quotas')
    .delete()
    .eq('user_id', uid)
  if (quotaErr) {
    console.error('[account/delete] daily_quotas:', quotaErr.code, quotaErr.message)
    return NextResponse.json({ error: 'Failed to delete account' }, { status: 500 })
  }

  // 2. bottles this user sent OR received (sender_id / receiver_id → profiles.id)
  const { error: bottleErr } = await admin
    .from('bottles')
    .delete()
    .or(`sender_id.eq.${uid},receiver_id.eq.${uid}`)
  if (bottleErr) {
    console.error('[account/delete] bottles:', bottleErr.code, bottleErr.message)
    return NextResponse.json({ error: 'Failed to delete account' }, { status: 500 })
  }

  // 3. auth user → cascades the profile row
  const { error: delErr } = await admin.auth.admin.deleteUser(uid)
  if (delErr) {
    console.error('[account/delete] auth user:', delErr.message)
    return NextResponse.json({ error: 'Failed to delete account' }, { status: 500 })
  }

  // The session is now invalid (user gone). Clear local cookies best-effort.
  await supabase.auth.signOut({ scope: 'local' }).catch(() => {})

  return NextResponse.json({ deleted: true })
}
