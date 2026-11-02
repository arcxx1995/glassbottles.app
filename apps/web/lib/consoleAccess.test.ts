import { describe, expect, it } from 'vitest'
import { canUseConsole } from './consoleAccess'

const password = [{ method: 'password', timestamp: 1 }]
const google = [{ method: 'oauth', timestamp: 1 }]

describe('canUseConsole', () => {
  it('lets in an admin who signed in with a password', () => expect(canUseConsole(password, true)).toBe(true))
  it('refuses an admin who came through Google', () => expect(canUseConsole(google, true)).toBe(false))
  it('refuses anyone who is not an admin', () => {
    expect(canUseConsole(password, false)).toBe(false)
    expect(canUseConsole(password, null)).toBe(false)
  })
  it.each([[undefined], [null], ['password'], [[]], [[null]], [[{}]]])('refuses a malformed amr: %j', (amr) =>
    expect(canUseConsole(amr, true)).toBe(false))
})
