import { describe, it, expect } from 'vitest'
import { getTimeUntilMidnightInTz } from './DailyTimer'

function totalSec(t: { hours: number; minutes: number; seconds: number }) {
  return t.hours * 3600 + t.minutes * 60 + t.seconds
}

describe('getTimeUntilMidnightInTz', () => {
  it('counts down to midnight in the given tz, not browser-local', () => {
    const now = new Date()
    const utcElapsed =
      now.getUTCHours() * 3600 + now.getUTCMinutes() * 60 + now.getUTCSeconds()
    const got = totalSec(getTimeUntilMidnightInTz('UTC'))
    expect(Math.abs(got - (86400 - utcElapsed))).toBeLessThanOrEqual(2)
  })

  it('offset zones differ from UTC by their offset', () => {
    const utc = totalSec(getTimeUntilMidnightInTz('UTC'))
    const kiritimati = totalSec(getTimeUntilMidnightInTz('Pacific/Kiritimati')) // UTC+14
    // Same instant: remaining-to-midnight differs by the offset, mod 24h.
    const delta = (utc - kiritimati + 86400 * 2) % 86400
    expect(Math.abs(delta - 14 * 3600)).toBeLessThanOrEqual(2)
  })

  it('falls back to browser-local for an invalid tz instead of throwing', () => {
    const got = getTimeUntilMidnightInTz('not/a-zone')
    expect(totalSec(got)).toBeGreaterThan(0)
    expect(totalSec(got)).toBeLessThanOrEqual(86400)
  })
})
