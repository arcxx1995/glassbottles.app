import { describe, expect, it } from 'vitest'
import { findContact, parseVerdict } from '../../../supabase/functions/screen-bottle/screen'

// The Edge Function's pure logic (supabase/functions/screen-bottle/screen.ts),
// tested here because the repo's runner is vitest, not Deno.

describe('findContact', () => {
  it.each([
    'write me at sea.glass@example.com',
    'find me on insta @tidepool_22',
    'call +91 98765 43210 anytime',
    'my page is www.example.org',
    'see tidepool.io for more',
  ])('holds: %s', (text) => expect(findContact(text)).toBe(true))

  it.each([
    'I finally called my sister back on 2026-10-20.',
    'Three years, 4 months. Still miss you.',
    'Not sure where I am at with all of this',
    'Node.js broke my whole week, honestly',
    'I said "@ the beach" like an idiot',
  ])('lets through: %s', (text) => expect(findContact(text)).toBe(false))
})

describe('parseVerdict', () => {
  it('accepts the three verdicts', () => {
    expect(parseVerdict({ verdict: 'ok', reason: 'none' })).toEqual({ verdict: 'ok' })
    expect(parseVerdict({ verdict: 'crisis', reason: 'none' })).toEqual({ verdict: 'crisis' })
    expect(parseVerdict({ verdict: 'held', reason: 'harm' })).toEqual({ verdict: 'held', reason: 'harm' })
  })
  it('gives no verdict for anything malformed (fail-open)', () => {
    expect(parseVerdict({ verdict: 'held', reason: 'none' })).toBeNull()
    expect(parseVerdict({ verdict: 'delete' })).toBeNull()
    expect(parseVerdict('ok')).toBeNull()
    expect(parseVerdict(null)).toBeNull()
  })
})
