import { describe, expect, it } from 'vitest'
import { SCREEN_PROMPT, findContact, findCrisis, findPersonalContact, parseVerdict } from '../../../supabase/functions/screen-bottle/screen'

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

describe('findCrisis (052)', () => {
  it.each([
    'I want to commit suicide, I want to fuck your pussy', // a reviewer's test, delivered pre-052
    'some nights I think about killing myself',
    'I just want to die',
    'everyone would be better off dead without me',
    'I keep cutting myself',
    "I don't want to live anymore",
    'feeling suicidal again',
  ])('crisis: %s', (text) => expect(findCrisis(text)).toBe(true))

  it.each([
    'her suicide last year still hurts', // grief: the classifier decides
    "I'd die for a good pizza",
    'I want to end things with my boyfriend',
    'the movie Suicide Squad was bad',
  ])('left to the classifier: %s', (text) => expect(findCrisis(text)).toBe(false))
})

describe('SCREEN_PROMPT', () => {
  it('lets held win over crisis, so explicit + suicide is never just "crisis"', () =>
    expect(SCREEN_PROMPT).toContain('choose "held" even if it also shows crisis'))
})

describe('findPersonalContact (social mode)', () => {
  it.each(['mail me sea.glass@example.com', 'call +91 98765 43210'])('holds: %s', (t) =>
    expect(findPersonalContact(t)).toBe(true))
  it.each(['thanks @tidewalker!', 'great read at example.org'])('lets through: %s', (t) =>
    expect(findPersonalContact(t)).toBe(false))
})

describe('parseVerdict', () => {
  it('accepts the three verdicts', () => {
    expect(parseVerdict({ verdict: 'ok', reason: 'none' })).toEqual({ verdict: 'ok' })
    expect(parseVerdict({ verdict: 'crisis', reason: 'none' })).toEqual({ verdict: 'crisis' })
    expect(parseVerdict({ verdict: 'held', reason: 'harm' })).toEqual({ verdict: 'held', reason: 'harm' })
    expect(parseVerdict({ verdict: 'held', reason: 'minor' })).toEqual({ verdict: 'held', reason: 'minor' })
  })
  it('gives no verdict for anything malformed (fail-open)', () => {
    expect(parseVerdict({ verdict: 'held', reason: 'none' })).toBeNull()
    // 'review' is the cron's reason, never the classifier's.
    expect(parseVerdict({ verdict: 'held', reason: 'review' })).toBeNull()
    expect(parseVerdict({ verdict: 'delete' })).toBeNull()
    expect(parseVerdict('ok')).toBeNull()
    expect(parseVerdict(null)).toBeNull()
  })
})
