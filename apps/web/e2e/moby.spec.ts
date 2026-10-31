import { expect, test, type Page } from '@playwright/test'
import { admin, makeKeeper, makeUser, signIn } from './helpers'

// Keeper holds every piece, and Moby Dick (migration 058).

test('a Keeper throws a former coin piece with no unlock', async ({ page }) => {
  test.skip(process.env.NEXT_PUBLIC_KEEPER !== 'on', 'Keeper is off in this build')
  const u = await makeUser('lavender')
  await makeKeeper(u.id)
  await signIn(page, u.email)
  await page.goto('/sea')

  await page.getByRole('button', { name: 'Dress', exact: true }).click()
  const sheet = page.getByRole('dialog', { name: 'Dress your bottle' })
  await sheet.getByRole('button', { name: 'Lavender', exact: true }).click()
  await sheet.getByRole('button', { name: 'Done' }).click()

  await page.getByLabel('Message to place in your bottle').fill('in lavender ink')
  await page.getByRole('button', { name: /Seal & Throw/ }).click()
  await expect
    .poll(async () => (await admin.from('bottles').select('style').eq('sender_id', u.id).maybeSingle()).data?.style)
    .toEqual({ ink: 'lavender' })
})

/** Places today's window around now; the server-side window is tested in SQL. */
async function stubWhale(page: Page, whale: () => object | null) {
  await page.route('**/rest/v1/rpc/get_today_bottle_status', async (route) => {
    const res = await route.fetch()
    const body = await res.json()
    body.whale = whale()
    await route.fulfill({ response: res, json: body })
  })
}

const surfaced = (spotted: boolean) => ({
  start: new Date(Date.now() - 60_000).toISOString(),
  end: new Date(Date.now() + 3_600_000).toISOString(),
  spotted,
})

test('a free user spots Moby Dick once and sees the sighting number', async ({ page }) => {
  const u = await makeUser('moby')
  let spotted = false
  await stubWhale(page, () => surfaced(spotted))
  await page.route('**/rest/v1/rpc/spot_whale', async (route) => {
    spotted = true
    await route.fulfill({ json: 12 })
  })
  // It bobs forever otherwise, and Playwright waits for a still target to click.
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await signIn(page, u.email)
  await page.goto('/sea')

  const whale = page.getByRole('button', { name: /Moby Dick surfaced/ })
  await whale.click()
  await expect(page.getByText('You spotted Moby Dick · Sighting no. 12')).toBeVisible()
  await expect(whale).toHaveCount(0)

  await page.reload()
  await expect(page.getByLabel('Message to place in your bottle')).toBeVisible()
  await expect(whale).toHaveCount(0)
})

test('Moby Dick stays away on other days', async ({ page }) => {
  const u = await makeUser('nomoby')
  await stubWhale(page, () => null)
  await signIn(page, u.email)
  await page.goto('/sea')
  await expect(page.getByLabel('Message to place in your bottle')).toBeVisible()
  await expect(page.getByRole('button', { name: /Moby Dick surfaced/ })).toHaveCount(0)
})
