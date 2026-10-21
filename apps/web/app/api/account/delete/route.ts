import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { dodo } from '@/lib/dodo'
import { hasLiveSubscription } from '@/lib/keeper'

// POST /api/account/delete
// Hard-deletes the AUTHENTICATED user's account. Irreversible.
//
// The target is ALWAYS the session user (user.id from the verified cookie) —
// never a value from the request body — so a caller can only ever delete
// themselves, regardless of what they send.
//
// One call, one cascade (migration 038): auth.users → profiles CASCADEs, and
// the rows referencing profiles follow it in the same transaction —
//   - daily_quotas: deleted (ON DELETE CASCADE),
//   - bottles they sent that are still adrift: deleted (BEFORE DELETE trigger;
//     nobody has seen them, and a sender-less bottle could never match),
//   - bottles they sent that were delivered: kept in the receiver's inbox,
//     sender_id nulled (ON DELETE SET NULL),
//   - bottles they received: receiver_id nulled — unreadable by anyone.
// It used to be five separate service-role calls; a failure between them left
// inboxes unlinked on a live account, and the cron could match a new bottle to
// the user mid-way and fail the final delete on the FK.
export async function POST(_req: NextRequest) {
  const supabase = createClient()

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // A Keeper subscription Dodo can still charge would bill a deleted account, so
  // it is cancelled first — and if that fails, nothing is deleted.
  const { data: membership } = await supabase
    .from('memberships')
    .select('plan, status, dodo_subscription_id')
    .maybeSingle()
  if (hasLiveSubscription(membership) && membership?.dodo_subscription_id) {
    try {
      await dodo().subscriptions.update(membership.dodo_subscription_id, {
        status: 'cancelled',
      })
    } catch (err) {
      console.error('[account/delete] cancel subscription:', err instanceof Error ? err.message : err)
      return NextResponse.json({ error: 'Failed to cancel membership' }, { status: 502 })
    }
  }

  const { error: delErr } = await createServiceClient().auth.admin.deleteUser(user.id)
  if (delErr) {
    console.error('[account/delete] auth user:', delErr.message)
    return NextResponse.json({ error: 'Failed to delete account' }, { status: 500 })
  }

  // The session is now invalid (user gone). Clear local cookies best-effort.
  await supabase.auth.signOut({ scope: 'local' }).catch(() => {})

  return NextResponse.json({ deleted: true })
}
