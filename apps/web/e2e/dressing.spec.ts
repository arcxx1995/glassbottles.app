import { expect, test } from '@playwright/test'
import { admin, deliverNow, expectPath, isolateReceiver, makeUser, signIn } from './helpers'

// Bottle dressing (migration 042): weather and vibe are free, Atelier Keeper
// pieces need Keeper, and the stranger receives the bottle as it was dressed.

async function makeKeeper(userId: string) {
  const { error } = await admin.from('memberships').insert({
    user_id: userId,
    plan: 'yearly',
    status: 'active',
    access_until: new Date(Date.now() + 30 * 864e5).toISOString(),
  })
  if (error) throw error
}

test('a Keeper dresses a bottle and the stranger receives it dressed', async ({ browser }) => {
  test.skip(process.env.NEXT_PUBLIC_KEEPER !== 'on', 'Keeper is off in this build')
  const a = await makeUser('dresser', { timezone: 'UTC' })
  const b = await makeUser('finder', { timezone: 'UTC' })
  await makeKeeper(a.id)
  await admin.from('profiles').update({ current: 'night_owl' }).eq('id', a.id)

  const sender = await (await browser.newContext()).newPage()
  await signIn(sender, a.email)
  await expectPath(sender, '/home')

  await sender.getByLabel('Message to place in your bottle').fill('dressed for you')
  await sender.getByRole('button', { name: 'Stormy sky' }).click()
  await sender.getByRole('button', { name: 'Just venting' }).click()
  await sender.getByRole('button', { name: 'Dress', exact: true }).click()
  const sheet = sender.getByRole('dialog', { name: 'Dress your bottle' })
  await sheet.getByRole('button', { name: 'Amber' }).click()
  await sheet.getByRole('button', { name: 'Gold wax' }).click()
  await sheet.getByRole('button', { name: 'Dusk' }).click()
  await sheet.getByRole('button', { name: 'Done' }).click()
  await expect(sheet).toHaveCount(0)
  await sender.getByRole('button', { name: /Seal & Throw/ }).click()

  await expect
    .poll(async () => (await admin.from('bottles').select('style, weather, vibe, current').eq('sender_id', a.id).maybeSingle()).data)
    .toEqual({ style: { glass: 'amber', seal: 'gold', paper: 'dusk' }, weather: 'stormy', vibe: 'venting', current: 'night_owl' })

  // The stranger's inbox shows the sky, vibe and current over their paper.
  const receiver = await (await browser.newContext()).newPage()
  await signIn(receiver, b.email)
  await isolateReceiver(b.id)
  expect(await deliverNow(a.id)).toBeGreaterThanOrEqual(1)
  await receiver.goto('/inbox')
  await expect(receiver.getByLabel('Message content')).toContainText('dressed', { timeout: 10_000 })
  await expect(receiver.getByText('Stormy sky · Just venting · Night Owl')).toBeVisible()
  const paper = await receiver.locator('article').first().evaluate((el) => getComputedStyle(el).backgroundColor)
  expect(paper).toBe('rgb(36, 30, 58)') // Dusk #241E3A
})

test('a free user can try a Keeper piece on, but not throw it', async ({ page }) => {
  test.skip(process.env.NEXT_PUBLIC_KEEPER !== 'on', 'Keeper is off in this build')
  const u = await makeUser('tryon')
  await signIn(page, u.email)
  await page.getByRole('button', { name: 'Dress', exact: true }).click()
  const sheet = page.getByRole('dialog', { name: 'Dress your bottle' })

  await sheet.getByRole('button', { name: 'Seafoam' }).first().click()
  await expect(sheet.getByRole('button', { name: 'Done' })).toBeVisible()

  // Trying on Amber shows the Keeper offer in place of Done.
  await sheet.getByRole('button', { name: 'Amber (Keeper)' }).click()
  await expect(sheet.getByText(/Amber is for Keepers/)).toBeVisible()
  await expect(sheet.getByRole('button', { name: /Yearly/ })).toBeVisible()
  await expect(sheet.getByRole('button', { name: 'Done' })).toHaveCount(0)

  // (The server refusing it is supabase/tests/042_bottle_dressing.test.sql.)
  await page.keyboard.press('Escape')
  await expect(sheet).toHaveCount(0)
})
