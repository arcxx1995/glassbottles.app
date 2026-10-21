import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { dodo, planFor } from '@/lib/dodo'

// POST /api/webhooks/dodo
// The only way Keeper access changes. Dodo signs every delivery (Standard
// Webhooks: webhook-id / webhook-timestamp / webhook-signature over the raw
// body); unwrap() rejects anything unsigned, tampered or stale.
//
// All state logic lives in apply_dodo_event (migration 041): idempotency on
// webhook-id, user mapping, ordering, the access rules. This route only
// verifies, resolves product id → plan, and hands over. A 5xx makes Dodo
// retry (up to 8 times); everything else is acknowledged.
export async function POST(req: NextRequest) {
  const body = await req.text()
  const headers = Object.fromEntries(req.headers)

  let event
  try {
    event = dodo().webhooks.unwrap(body, { headers })
  } catch {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  const data = event.data as unknown as Record<string, unknown>
  const productId =
    (data.product_id as string | undefined) ??
    (data.product_cart as { product_id: string }[] | null | undefined)?.[0]?.product_id

  const { data: result, error } = await createServiceClient().rpc('apply_dodo_event', {
    p_event_id: headers['webhook-id'],
    p_type: event.type,
    p_ts: event.timestamp,
    p_data: data,
    p_plan: planFor(productId),
  })

  if (error) {
    console.error('[webhooks/dodo]', event.type, error.message)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
  if (result === 'no_user') {
    // Not recorded in webhook_events — replay it from the Dodo dashboard once
    // the customer is matched to an account.
    console.error('[webhooks/dodo] no account for', event.type, headers['webhook-id'])
  }
  return NextResponse.json({ result })
}
