import { describe, expect, it } from 'vitest'
import { isAppRoute } from './routes'

describe('isAppRoute', () => {
  it('leaves the console login open, since it has its own gate', () => expect(isAppRoute('/vvs/login')).toBe(false))
  it.each(['/sea', '/sea/x', '/harbour', '/harbour/tidewalker', '/shelf', '/inbox', '/settings', '/logbook', '/vvs', '/vvs/people'])(
    'guards %s', (p) => expect(isAppRoute(p)).toBe(true))
  it.each(['/', '/sign-in', '/privacy', '/feed', '/season', '/u/tidewalker', '/home', '/administrator'])(
    'leaves %s public', (p) => expect(isAppRoute(p)).toBe(false))
})
