import { test, expect } from '@playwright/test'
import { admin, makeUser, signIn, expectPath, PASSWORD } from './helpers'

test('deep link survives sign-in', async ({ page }) => {
  const u = await makeUser('deeplink')
  await page.goto('/inbox?from=email')
  await expect(page).toHaveURL(/\/sign-in\?next=%2Finbox%3Ffrom%3Demail$/)
  await page.getByPlaceholder('your@email.com').fill(u.email)
  await page.getByPlaceholder('Password').fill(PASSWORD)
  await page.locator('button[type="submit"]').click()
  await expectPath(page, '/inbox?from=email')
})

test('signed-in visitor skips landing and auth pages', async ({ page }) => {
  const u = await makeUser('skiplanding')
  await signIn(page, u.email)
  await expectPath(page, '/sea')
  await page.goto('/')
  await expectPath(page, '/sea')
  await page.goto('/sign-in')
  await expectPath(page, '/sea')
})

test('open redirect via next is refused', async ({ page }) => {
  const u = await makeUser('openredirect')
  await signIn(page, u.email, '/sign-in?next=//evil.example.com')
  await expectPath(page, '/sea')
})

test('wrong password shows an error, short legacy-length password is still submittable', async ({ page }) => {
  const u = await makeUser('wrongpw')
  await page.goto('/sign-in')
  await page.getByPlaceholder('your@email.com').fill(u.email)
  await page.getByPlaceholder('Password').fill('short')
  await expect(page.locator('button[type="submit"]')).toBeEnabled()
  await page.locator('button[type="submit"]').click()
  await expect(page.getByText(/invalid|incorrect|wrong/i)).toBeVisible()
  await expectPath(page, /\/sign-in/)
})

test('dev-only and temporary routes are not served', async ({ request }) => {
  expect((await request.get('/shot')).status()).toBe(404)
})

test('dead recovery link lands on the reset page, not sign-in', async ({ page }) => {
  await page.goto('/auth/callback?code=bogus&next=/reset-password')
  await expectPath(page, '/reset-password')
  await expect(page.getByText('Link expired')).toBeVisible()
})

// A session that dies under an open screen (refresh token revoked elsewhere,
// account deleted on another device) must land on sign-in, not leave /sea on
// its skeleton forever. Revoke every session, make the browser's copy look
// expired, and let the client's own refresh attempt fail.
test('a session revoked mid-use sends the user to sign-in', async ({ page, context }) => {
  const u = await makeUser('revoked')
  await signIn(page, u.email)
  await expectPath(page, '/sea')

  // @supabase/ssr stores the session as "base64-<json>", possibly split
  // across sb-…-auth-token.0, .1, … cookies.
  const parts = (await context.cookies())
    .filter((c) => /^sb-.+-auth-token(\.\d+)?$/.test(c.name))
    .sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }))
  expect(parts.length).toBeGreaterThan(0)
  const raw = parts.map((c) => c.value).join('')
  const session = JSON.parse(Buffer.from(raw.replace(/^base64-/, ''), 'base64url').toString())

  const { error } = await admin.auth.admin.signOut(session.access_token, 'global')
  expect(error).toBeNull()

  session.expires_at = Math.floor(Date.now() / 1000) - 60
  const base = parts[0]
  await context.clearCookies({ name: new RegExp(`^${base.name.replace(/\.\d+$/, '')}`) })
  await context.addCookies([
    {
      ...base,
      name: base.name.replace(/\.\d+$/, ''),
      value: `base64-${Buffer.from(JSON.stringify(session)).toString('base64url')}`,
    },
  ])

  // supabase-js re-checks the session when the tab becomes visible; its 30s
  // ticker would get there too, just slower.
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fsea$/, { timeout: 40_000 })
})
