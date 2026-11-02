import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { dodo } from '@/lib/dodo'
import { hasLiveSubscription } from '@/lib/keeper'

// POST /api/vvs/billing { userId }
// Cancels a banned person's renewing subscription, so Dodo stops charging them.
// No refund: that stays a manual decision in Dodo. Admins only, and only for
// someone who really is banned, so this can't cancel a member in good standing.
export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: isAdmin } = await supabase.rpc('is_admin')
  if (!user || isAdmin !== true) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const { userId } = (await req.json().catch(() => ({}))) as { userId?: string }
  if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })

  const service = createServiceClient()
  const { data: profile } = await service.from('profiles').select('banned_at').eq('id', userId).maybeSingle()
  if (!profile?.banned_at) return NextResponse.json({ error: 'Not banned' }, { status: 409 })

  const { data: membership } = await service
    .from('memberships')
    .select('plan, status, dodo_subscription_id')
    .eq('user_id', userId)
    .maybeSingle()
  if (!hasLiveSubscription(membership) || !membership?.dodo_subscription_id) {
    return NextResponse.json({ result: 'none' })
  }

  try {
    await dodo().subscriptions.update(membership.dodo_subscription_id, { status: 'cancelled' })
  } catch (err) {
    console.error('[vvs/billing] cancel subscription:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Failed to cancel' }, { status: 502 })
  }
  await service.from('admin_actions').insert({
    admin_id: user.id,
    action: 'cancel_subscription',
    subject_id: userId,
    detail: { plan: membership.plan },
  })
  return NextResponse.json({ result: 'cancelled' })
}
