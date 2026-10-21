import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { dodo } from '@/lib/dodo'

// POST /api/billing/portal
// Returns a Dodo customer-portal link for the session user's own customer
// (plan changes, cancel, payment method, invoices).
export async function POST() {
  const supabase = createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: membership } = await supabase
    .from('memberships')
    .select('dodo_customer_id')
    .maybeSingle()
  if (!membership?.dodo_customer_id) {
    return NextResponse.json({ error: 'No membership' }, { status: 404 })
  }

  try {
    const { link } = await dodo().customers.customerPortal.create(membership.dodo_customer_id)
    return NextResponse.json({ url: link })
  } catch (err) {
    console.error('[billing/portal]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Could not open billing' }, { status: 502 })
  }
}
