import { test, expect } from '@playwright/test'
import { admin, canSignIn, makeUser, signIn, expectPath, PASSWORD } from './helpers'

test('settings password change needs the current password', async ({ page }) => {
  const u = await makeUser('pwchange')
  await signIn(page, u.email)
  await expectPath(page, '/sea')
  await page.goto('/settings')
  await page.getByRole('button', { name: /Change password/ }).click()

  await page.getByPlaceholder('Current password').fill('not-my-password')
  await page.getByPlaceholder(/New password/).fill('brand-new-pass-1')
  await page.getByPlaceholder('Confirm new password').fill('brand-new-pass-1')
  await page.getByRole('button', { name: 'Update', exact: true }).click()
  await expect(page.getByText('Current password is incorrect.')).toBeVisible()

  await page.getByPlaceholder('Current password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Update', exact: true }).click()
  await expect(page.getByText(/Password updated/)).toBeVisible()

  expect(await canSignIn(u.email, 'brand-new-pass-1')).toBe(true)
})

test('a normal session cannot use the reset page to set a password', async ({ page }) => {
  const u = await makeUser('resetbypass')
  await signIn(page, u.email)
  await expectPath(page, '/sea')
  await page.goto('/reset-password')
  await expect(page.getByText('Link expired')).toBeVisible()
})

test('a real recovery link still resets the password', async ({ page }) => {
  const u = await makeUser('recovery')
  const { data, error } = await admin.auth.admin.generateLink({ type: 'recovery', email: u.email })
  expect(error).toBeNull()
  await page.goto(
    `/auth/callback?token_hash=${data.properties!.hashed_token}&type=recovery&next=/reset-password`,
  )
  await expectPath(page, '/reset-password')
  const fields = page.locator('input[type="password"]')
  await fields.nth(0).fill('recovered-pass-1')
  await fields.nth(1).fill('recovered-pass-1')
  await page.locator('button[type="submit"]').click()
  await expect(page.getByText('Link expired')).toHaveCount(0)
  await expect.poll(() => canSignIn(u.email, 'recovered-pass-1')).toBe(true)
})
