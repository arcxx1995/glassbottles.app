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
// so admin.deleteUser() would fail on the FK while those rows exist. Clear the
// references first (service role, bypasses RLS), then delete the auth user,
// which cascades the profile.
//
// The bottles are UNLINKED, not deleted. Deleting them took the counterparty's
// message with them: every bottle this user sent vanished from a stranger's
// inbox, and every bottle they received vanished from its sender's delivered
// history — a second, silent cause of "my old messages are gone". Nulling the
// id keeps the message where it landed and severs the identity, which is all
// the deletion actually has to guarantee. Unmatched bottles (nobody has read
// them) are deleted outright so they do not drift on behalf of a dead account.
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

  // 2a. Bottles this user sent that are still adrift: nobody has ever seen
  //     them, and with sender_id cleared the matcher could never place them
  //     (its "not the sender" test is NULL-poisoned). Delete outright.
  const { error: adriftErr } = await admin
    .from('bottles')
    .delete()
    .eq('sender_id', uid)
    .is('received_at', null)
  if (adriftErr) {
    console.error('[account/delete] adrift bottles:', adriftErr.code, adriftErr.message)
    return NextResponse.json({ error: 'Failed to delete account' }, { status: 500 })
  }

  // 2b. Delivered bottles they sent: keep the message in the receiver's inbox,
  //     drop the link back to this account.
  const { error: sentErr } = await admin
    .from('bottles')
    .update({ sender_id: null })
    .eq('sender_id', uid)
  if (sentErr) {
    console.error('[account/delete] sent bottles:', sentErr.code, sentErr.message)
    return NextResponse.json({ error: 'Failed to delete account' }, { status: 500 })
  }

  // 2c. Bottles they received: keep the sender's "found someone" record, drop
  //     the link. The message text goes with the inbox that no longer exists —
  //     receiver_id NULL makes it unreadable by anyone (get_received_bottles
  //     matches on receiver_id = auth.uid(), which never equals NULL).
  const { error: recvErr } = await admin
    .from('bottles')
    .update({ receiver_id: null })
    .eq('receiver_id', uid)
  if (recvErr) {
    console.error('[account/delete] received bottles:', recvErr.code, recvErr.message)
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
