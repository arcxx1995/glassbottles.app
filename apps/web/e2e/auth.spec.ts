import { test, expect } from '@playwright/test'
import { makeUser, signIn, expectPath, PASSWORD } from './helpers'

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
  await expectPath(page, '/home')
  await page.goto('/')
  await expectPath(page, '/home')
  await page.goto('/sign-in')
  await expectPath(page, '/home')
})

test('open redirect via next is refused', async ({ page }) => {
  const u = await makeUser('openredirect')
  await signIn(page, u.email, '/sign-in?next=//evil.example.com')
  await expectPath(page, '/home')
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
