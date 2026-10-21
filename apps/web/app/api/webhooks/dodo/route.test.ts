import { createHmac } from 'node:crypto'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The access rules live in SQL (supabase/tests/041_keeper_memberships.test.sql).
// This checks the route's own job: reject unsigned/tampered deliveries, and
// hand a verified event to apply_dodo_event with the right plan.

const rpc = vi.fn()
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({ rpc }) }))

const SECRET = 'whsec_' + Buffer.from('test-webhook-secret-32-bytes-long!').toString('base64')

function signed(body: string, opts: { tamper?: boolean } = {}) {
  const id = 'msg_test_1'
  const ts = Math.floor(Date.now() / 1000).toString()
  const key = Buffer.from(SECRET.slice('whsec_'.length), 'base64')
  const sig = createHmac('sha256', key).update(`${id}.${ts}.${body}`).digest('base64')
  return new NextRequest('http://localhost/api/webhooks/dodo', {
    method: 'POST',
    body: opts.tamper ? body.replace('active', 'expired') : body,
    headers: { 'webhook-id': id, 'webhook-timestamp': ts, 'webhook-signature': `v1,${sig}` },
  })
}

const event = JSON.stringify({
  business_id: 'bus_1',
  type: 'subscription.active',
  timestamp: new Date().toISOString(),
  data: {
    payload_type: 'Subscription',
    subscription_id: 'sub_1',
    product_id: 'pdt_yearly',
    status: 'active',
    next_billing_date: new Date(Date.now() + 7 * 864e5).toISOString(),
    metadata: { user_id: '00000000-0000-4000-8000-000000000001' },
    customer: { customer_id: 'cus_1', email: 'a@example.invalid', name: 'A' },
  },
})

describe('POST /api/webhooks/dodo', () => {
  beforeEach(() => {
    rpc.mockReset().mockResolvedValue({ data: 'applied', error: null })
    process.env.DODO_PAYMENTS_API_KEY = 'test'
    process.env.DODO_PAYMENTS_WEBHOOK_KEY = SECRET
    process.env.DODO_PRODUCT_YEARLY = 'pdt_yearly'
  })

  it('rejects a tampered delivery without touching the database', async () => {
    const { POST } = await import('./route')
    const res = await POST(signed(event, { tamper: true }))
    expect(res.status).toBe(401)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('applies a verified event with the plan resolved from the product id', async () => {
    const { POST } = await import('./route')
    const res = await POST(signed(event))
    expect(res.status).toBe(200)
    expect(rpc).toHaveBeenCalledWith('apply_dodo_event', expect.objectContaining({
      p_event_id: 'msg_test_1',
      p_type: 'subscription.active',
      p_plan: 'yearly',
    }))
  })

  it('asks Dodo to retry when the database fails', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'down' } })
    const { POST } = await import('./route')
    expect((await POST(signed(event))).status).toBe(500)
  })
})
