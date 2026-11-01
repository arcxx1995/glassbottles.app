import { expect, test } from '@playwright/test'
import { admin, deliverNow, expectPath, isolateReceiver, makeKeeper, makeUser, signIn } from './helpers'

// Bottle dressing (042, 057): weather is free, every Atelier piece
// needs Keeper, and only a Keeper who finds it sees the bottle as it was dressed.

test('a Keeper dresses a bottle and another Keeper receives it dressed', async ({ browser }) => {
  test.skip(process.env.NEXT_PUBLIC_KEEPER !== 'on', 'Keeper is off in this build')
  const a = await makeUser('dresser', { timezone: 'UTC' })
  const b = await makeUser('finder', { timezone: 'UTC' })
  await makeKeeper(a.id)
  await makeKeeper(b.id)
  await admin.from('profiles').update({ current: 'night_owl' }).eq('id', a.id)

  const sender = await (await browser.newContext()).newPage()
  await signIn(sender, a.email)
  await expectPath(sender, '/sea')
  await sender.goto('/sea')
  await expectPath(sender, '/sea')

  await sender.getByLabel('Message to place in your bottle').fill('dressed for you')
  await sender.getByRole('button', { name: 'Stormy sky' }).click()
  await sender.getByRole('button', { name: 'Dress', exact: true }).click()
  const sheet = sender.getByRole('dialog', { name: 'Dress your bottle' })
  await sheet.getByRole('tab', { name: 'Shape' }).click()
  await sheet.getByRole('button', { name: 'Fish', exact: true }).click()
  await sheet.getByRole('tab', { name: 'Glass' }).click()
  await sheet.getByRole('button', { name: 'Soft rose' }).click()
  await sheet.getByRole('tab', { name: 'Seal' }).click()
  await sheet.getByRole('button', { name: 'Deep mint wax' }).click()
  await sheet.getByRole('button', { name: 'Done' }).click()
  await expect(sheet).toHaveCount(0)
  await sender.getByRole('button', { name: /Seal & Throw/ }).click()

  await expect
    .poll(async () => (await admin.from('bottles').select('style, weather, current').eq('sender_id', a.id).maybeSingle()).data)
    .toEqual({ style: { shape: 'fish', glass: 'rose_soft', seal: 'mint_deep' }, weather: 'stormy', current: 'night_owl' })

  // The bottle arrives in its shape, with the sky and current.
  const receiver = await (await browser.newContext()).newPage()
  await signIn(receiver, b.email)
  await isolateReceiver(b.id)
  expect(await deliverNow(a.id)).toBeGreaterThanOrEqual(1)
  await receiver.goto('/shelf')
  await receiver.getByRole('button', { name: /^Bottle, unopened/ }).click()
  await expect(receiver.getByLabel('Message content')).toContainText('dressed', { timeout: 10_000 })
  await expect(receiver.getByText('Stormy sky · Night Owl')).toBeVisible()
  await expect(receiver.locator('article svg[data-shape="fish"]')).toBeVisible()
})

test('a free user can try a Keeper piece on, but not throw it', async ({ page }) => {
  test.skip(process.env.NEXT_PUBLIC_KEEPER !== 'on', 'Keeper is off in this build')
  const u = await makeUser('tryon')
  await signIn(page, u.email)
  await page.goto('/sea')
  await page.getByRole('button', { name: 'Dress', exact: true }).click()
  const sheet = page.getByRole('dialog', { name: 'Dress your bottle' })

  await expect(sheet.getByRole('button', { name: 'Done' })).toBeVisible()

  // Trying on a shape shows the Keeper offer in place of Done.
  await sheet.getByRole('button', { name: 'Rose (Keeper)' }).click()
  await expect(sheet.locator('svg[data-shape="rose"]').first()).toBeVisible()
  await expect(sheet.getByText(/Rose is for Keepers/)).toBeVisible()
  await expect(sheet.getByRole('button', { name: /Yearly/ })).toBeVisible()
  await expect(sheet.getByRole('button', { name: 'Done' })).toHaveCount(0)

  // (The server refusing it is supabase/tests/057_shelf_keeper_only.test.sql.)
  await page.keyboard.press('Escape')
  await expect(sheet).toHaveCount(0)
})

test('a current paints a Keeper’s Sea; a free user only carries its name', async ({ page, browser }) => {
  test.skip(process.env.NEXT_PUBLIC_KEEPER !== 'on', 'Keeper is off in this build')
  const keeper = await makeUser('current-keeper')
  await makeKeeper(keeper.id)
  await signIn(page, keeper.email)
  await page.goto('/sea')
  await page.getByRole('button', { name: /Your current: Open sea/ }).click()
  await page.getByRole('dialog', { name: 'Your current' }).getByRole('button', { name: /First Snow/ }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('[data-weather="snow"]')).toBeAttached()
  await expect(page.locator('html')).toHaveAttribute('data-current', 'first_snow')
  await expect
    .poll(async () => (await admin.from('profiles').select('current').eq('id', keeper.id).single()).data?.current)
    .toBe('first_snow')

  const context = await browser.newContext()
  const freePage = await context.newPage()
  const free = await makeUser('current-free')
  await signIn(freePage, free.email)
  await freePage.goto('/sea')
  await freePage.getByRole('button', { name: /Your current: Open sea/ }).click()
  await freePage.getByRole('dialog', { name: 'Your current' }).getByRole('button', { name: /Soft Rain/ }).click()
  await expect(freePage.getByRole('dialog')).toHaveCount(0)
  await expect
    .poll(async () => (await admin.from('profiles').select('current').eq('id', free.id).single()).data?.current)
    .toBe('soft_rain')
  await expect(freePage.locator('[data-weather]')).toHaveCount(0)
  await context.close()
})
