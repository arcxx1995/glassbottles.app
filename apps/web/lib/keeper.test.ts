import { describe, expect, it } from 'vitest'
import { hasAccess, hasLiveSubscription } from './keeper'

describe('hasAccess', () => {
  it('reads a lifetime membership (Postgres infinity) as open', () => {
    expect(hasAccess('infinity')).toBe(true)
  })
  it('compares real dates against now', () => {
    expect(hasAccess(new Date(Date.now() + 864e5).toISOString())).toBe(true)
    expect(hasAccess(new Date(Date.now() - 1000).toISOString())).toBe(false)
  })
  it('is closed with no membership', () => {
    expect(hasAccess(null)).toBe(false)
    expect(hasAccess(undefined)).toBe(false)
  })
})

describe('hasLiveSubscription', () => {
  it('counts subscriptions Dodo can still charge, never lifetime', () => {
    expect(hasLiveSubscription({ plan: 'monthly', status: 'on_hold' })).toBe(true)
    expect(hasLiveSubscription({ plan: 'monthly', status: 'cancelled' })).toBe(false)
    expect(hasLiveSubscription({ plan: 'lifetime', status: 'active' })).toBe(false)
  })
})
