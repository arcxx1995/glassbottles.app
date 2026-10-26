import { describe, expect, it } from 'vitest'
import { isAppRoute } from './routes'

describe('isAppRoute', () => {
  it.each(['/sea', '/sea/x', '/harbour', '/harbour/tidewalker', '/inbox', '/settings', '/logbook', '/admin/moderation'])(
    'guards %s', (p) => expect(isAppRoute(p)).toBe(true))
  it.each(['/', '/sign-in', '/privacy', '/feed', '/season', '/u/tidewalker', '/home', '/administrator'])(
    'leaves %s public', (p) => expect(isAppRoute(p)).toBe(false))
})
