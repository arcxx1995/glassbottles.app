import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { dodo, productFor, KEEPER_PLANS, TRIAL_DAYS, type KeeperPlan } from '@/lib/dodo'
import { hasAccess, hasLiveSubscription } from '@/lib/keeper'

// POST /api/billing/checkout  { plan: 'monthly' | 'yearly' | 'lifetime' }
// Starts a Dodo hosted checkout for the session user and returns its URL.
// Nothing is granted here — access only ever comes from the signed webhook
// (apply_dodo_event, migration 041). metadata.user_id is how that webhook
// finds the account again.
export async function POST(req: NextRequest) {
  const supabase = createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { plan, returnTo } = (await req.json().catch(() => ({}))) as {
    plan?: KeeperPlan
    returnTo?: string
  }
  // Allow-listed: never echo a client path into the redirect. 'home' was the
  // Sea's old name.
  const back = returnTo === 'harbour' ? 'harbour' : returnTo === 'home' || returnTo === 'sea' ? 'sea' : 'settings'
  if (!plan || !KEEPER_PLANS.includes(plan)) {
    return NextResponse.json({ error: 'Unknown plan' }, { status: 400 })
  }
  const productId = productFor(plan)
  if (!productId) {
    return NextResponse.json({ error: 'Keeper is not available yet' }, { status: 503 })
  }

  // RLS: the user's own row only.
  const { data: membership } = await supabase
    .from('memberships')
    .select('plan, status, access_until, dodo_customer_id')
    .maybeSingle()

  const isKeeperNow = hasAccess(membership?.access_until)
  if (isKeeperNow && membership?.plan === 'lifetime') {
    return NextResponse.json({ error: 'You are already a Founding Keeper' }, { status: 409 })
  }
  // A subscription Dodo can still charge would bill next to a new purchase.
  if (hasLiveSubscription(membership)) {
    return NextResponse.json(
      { error: 'Your membership is active. Manage or cancel it first.' },
      { status: 409 },
    )
  }

  if (plan === 'lifetime') {
    // ponytail: checked, not reserved — two buyers racing for the last spot can
    // both pay; refund the extra by hand. Reserve spots if they ever run hot.
    const { data: spots } = await supabase.rpc('founding_spots_left')
    if (!spots) {
      return NextResponse.json({ error: 'Founding spots are gone' }, { status: 409 })
    }
  }

  const origin = req.nextUrl.origin
  try {
    const session = await dodo().checkoutSessions.create({
      product_cart: [{ product_id: productId, quantity: 1 }],
      customer: membership?.dodo_customer_id
        ? { customer_id: membership.dodo_customer_id }
        : { email: user.email },
      metadata: { user_id: user.id },
      // Back where the purchase started — a fixed choice, never a caller URL.
      return_url: `${origin}/${back}?keeper=welcome`,
      cancel_url: `${origin}/${back}`,
      // One trial per account: anyone who has ever had a membership row pays.
      ...(plan !== 'lifetime' && !membership
        ? { subscription_data: { trial_period_days: TRIAL_DAYS } }
        : {}),
    })
    if (!session.checkout_url) throw new Error('no checkout_url')
    return NextResponse.json({ url: session.checkout_url })
  } catch (err) {
    console.error('[billing/checkout]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Could not start checkout' }, { status: 502 })
  }
}
