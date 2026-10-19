import { describe, expect, it } from 'vitest'
import { sameTimeZone } from './timezone'

describe('sameTimeZone', () => {
  const jan = Date.UTC(2026, 0, 15)
  it('treats IANA aliases as one zone', () => {
    expect(sameTimeZone('Asia/Calcutta', 'Asia/Kolkata', jan)).toBe(true)
  })
  it('tells apart zones whose DST rules differ', () => {
    // Same offset in January (UTC+0), different in July (London +1).
    expect(sameTimeZone('Europe/London', 'Africa/Abidjan', jan)).toBe(false)
  })
  it('tells apart different offsets', () => {
    expect(sameTimeZone('Asia/Kolkata', 'Asia/Tokyo', jan)).toBe(false)
  })
  it('defers unknown names to the server', () => {
    expect(sameTimeZone('Not/AZone', 'UTC', jan)).toBe(false)
  })
})
