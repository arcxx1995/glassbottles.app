import { expect, test } from '@playwright/test'
import { admin, makeUser, signIn } from './helpers'

// Coins and the whale (migration 049).

test('earned coins unlock a coin piece in the Atelier', async ({ page }) => {
  const u = await makeUser('coins')
  await admin.from('coin_ledger').insert({ user_id: u.id, delta: 20, reason: 'whale', ref: 'seed' })
  await signIn(page, u.email)
  await page.goto('/sea')
  await expect(page.getByText('20 ✦')).toBeVisible()

  await page.getByRole('button', { name: 'Dress', exact: true }).click()
  const sheet = page.getByRole('dialog', { name: 'Dress your bottle' })
  await sheet.getByRole('button', { name: 'Lavender (15 coins)' }).click()
  await expect(sheet.getByRole('button', { name: 'Done' })).toHaveCount(0)
  await sheet.getByRole('button', { name: 'Unlock Lavender · 15 ✦' }).click()
  await sheet.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByText('5 ✦')).toBeVisible()

  await page.getByLabel('Message to place in your bottle').fill('in lavender ink')
  await page.getByRole('button', { name: /Seal & Throw/ }).click()
  await expect
    .poll(async () => (await admin.from('bottles').select('style').eq('sender_id', u.id).maybeSingle()).data?.style)
    .toEqual({ ink: 'lavender' })
})

test('the whale shows only while surfaced and unspotted', async ({ page }) => {
  const u = await makeUser('whale')
  let spotted = false
  // Place today's window around now; the server-side window is tested in SQL.
  await page.route('**/rest/v1/rpc/get_today_bottle_status', async (route) => {
    const res = await route.fetch()
    const body = await res.json()
    body.whale = {
      start: new Date(Date.now() - 60_000).toISOString(),
      end: new Date(Date.now() + 3_600_000).toISOString(),
      spotted,
    }
    await route.fulfill({ response: res, json: body })
  })
  await signIn(page, u.email)
  await page.goto('/sea')
  const whale = page.getByRole('button', { name: /A whale surfaced/ })
  await expect(whale).toBeVisible()
  spotted = true
  await page.reload()
  await expect(page.getByLabel('Message to place in your bottle')).toBeVisible()
  await expect(whale).toHaveCount(0)
})
