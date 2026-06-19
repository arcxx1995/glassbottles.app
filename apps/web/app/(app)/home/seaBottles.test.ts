import { describe, it, expect } from 'vitest'
import { buildSeaBottles } from './seaBottles'

const today = '2026-06-19'

describe('buildSeaBottles', () => {
  it('adds the optimistic placeholder during a genuine throw hand-off', () => {
    const out = buildSeaBottles([], 'thrown', today, true)
    expect(out).toHaveLength(1)
    expect(out[0]).toEqual({ id: '__pending_today__', day_key: today })
  })

  // Regression: the reported bug. On reload of a bottle that was already
  // delivered, the reconcile effect sets sendStatus to "thrown" and the bottle
  // is absent from sailing — but justThrew is false, so NO phantom must appear.
  it('does not add a placeholder on reload of a delivered bottle (justThrew=false)', () => {
    const out = buildSeaBottles([], 'thrown', today, false)
    expect(out).toEqual([])
  })

  it("does not add a placeholder once today's bottle is already sailing", () => {
    const sailing = [{ id: 'b1', day_key: today }]
    const out = buildSeaBottles(sailing, 'thrown', today, true)
    expect(out).toEqual(sailing)
  })

  it('leaves sailing untouched when idle', () => {
    const sailing = [{ id: 'b1', day_key: '2026-06-18' }]
    expect(buildSeaBottles(sailing, 'idle', today, true)).toEqual(sailing)
  })
})
