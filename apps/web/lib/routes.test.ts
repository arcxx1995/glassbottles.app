import { describe, expect, it } from 'vitest'
import { isAppRoute } from './routes'

describe('isAppRoute', () => {
  it.each(['/feed', '/sea', '/u/tidewalker', '/c/owls', '/friends', '/inbox', '/settings', '/logbook'])(
    'guards %s', (p) => expect(isAppRoute(p)).toBe(true))
  it.each(['/', '/sign-in', '/privacy', '/feedback', '/season', '/u', '/home'])(
    'leaves %s public', (p) => expect(isAppRoute(p)).toBe(false))
})
