import { expect, test, type Locator } from '@playwright/test'
import { admin, makeKeeper, makeUser, signIn } from './helpers'

// The Shelf: bottles on planks, a tap opens one. Seeing dressing is Keeper-only
// (057); the server's half of that is 057_shelf_keeper_only.test.sql.

const expectShape = (dialog: Locator, shape: string) =>
  expect(dialog.locator('article svg[data-shape]')).toHaveAttribute('data-shape', shape)

async function deliver(senderId: string, receiverId: string, message: string, style?: object, isRead = false) {
  const { error } = await admin.from('bottles').insert({
    sender_id: senderId,
    receiver_id: receiverId,
    message,
    style: style ?? null,
    sent_at: new Date(Date.now() - 3 * 36e5).toISOString(),
    received_at: new Date(Date.now() - 2 * 36e5).toISOString(),
    day_key: new Date(Date.now() - 864e5).toISOString().slice(0, 10),
    is_read: isRead,
  })
  expect(error).toBeNull()
}

const opened = /^Bottle, opened/
const unopened = /^Bottle, unopened/

test('a bottle waits until tapped; opening reads it and Escape puts it back', async ({ page }) => {
  const a = await makeUser('shelf-a')
  const b = await makeUser('shelf-b')
  await deliver(a.id, b.id, 'tapped into being read')
  await signIn(page, b.email)
  await page.goto('/shelf')

  const bottle = page.getByRole('button', { name: unopened })
  await expect(bottle).toBeVisible()
  await expect(page.locator('.gb-wiggle')).toHaveCount(1)
  await page.waitForTimeout(800)
  const { data: before } = await admin.from('bottles').select('is_read').eq('sender_id', a.id).single()
  expect(before?.is_read).toBe(false)

  // By keyboard: Safari doesn't focus a tapped button, so there's nothing to restore.
  await bottle.focus()
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog', { name: 'A bottle washed ashore' })
  await expect(dialog.getByLabel('Message content')).toContainText('tapped', { timeout: 5_000 })
  await expect(page.locator('.shelf-cell svg')).toBeHidden() // it left the plank
  await expect(dialog.getByRole('button', { name: 'Keep this bottle' })).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'This reached me' })).toBeVisible()
  await expect(dialog.getByLabel('Report this bottle')).toBeVisible()
  await expect
    .poll(async () => (await admin.from('bottles').select('is_read').eq('sender_id', a.id).single()).data?.is_read)
    .toBe(true)

  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  // Uncorked now, and focus went back to the bottle that opened it.
  const settled = page.getByRole('button', { name: opened })
  await expect(settled).toBeFocused()
  await expect(page.locator('.gb-wiggle')).toHaveCount(0)
})

test('opening a bottle leaves the next new one in its place', async ({ page }) => {
  const [a, c, b] = await Promise.all([makeUser('shelf-n-a'), makeUser('shelf-n-c'), makeUser('shelf-n-b')])
  await deliver(a.id, b.id, 'one')
  await deliver(c.id, b.id, 'two')
  await signIn(page, b.email)
  await page.goto('/shelf')
  await page.getByRole('button', { name: unopened }).first().click()
  await expect(page.getByRole('dialog')).toBeVisible()
  // Any view-transition name out there would lift that bottle above the dialog.
  const named = await page.locator('.shelf-cell span').evaluateAll((all) =>
    all.filter((el) => getComputedStyle(el).viewTransitionName !== 'none').length,
  )
  expect(named).toBe(0)
})

test('reporting from the dialog closes it and clears the bottle', async ({ page }) => {
  const a = await makeUser('shelf-rep-a')
  const b = await makeUser('shelf-rep-b')
  await deliver(a.id, b.id, 'not nice', undefined, true)
  await signIn(page, b.email)
  await page.goto('/shelf')
  await page.getByRole('button', { name: opened }).click()
  await page.getByLabel('Report this bottle').click()
  await page.getByRole('group', { name: 'Report reason' }).getByRole('button', { name: 'Spam' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('button', { name: opened })).toHaveCount(0)
  await expect(page.getByText(/gone from your shelf/)).toBeVisible()
})

test('reduced motion: a new bottle glows but does not wiggle', async ({ page }) => {
  const a = await makeUser('shelf-rm-a')
  const b = await makeUser('shelf-rm-b')
  await deliver(a.id, b.id, 'still and glowing')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await signIn(page, b.email)
  await page.goto('/shelf')
  const bottle = page.locator('.gb-wiggle')
  await expect(bottle).toHaveCount(1)
  await expect.poll(() => bottle.evaluate((el) => el.getAnimations().length)).toBe(0)
  const filter = await bottle.locator('svg').evaluate((el) => getComputedStyle(el).filter)
  expect(filter).toContain('drop-shadow')
})

test.describe('with Keeper on', () => {
  test.skip(process.env.NEXT_PUBLIC_KEEPER !== 'on', 'Keeper is off in this build')

  const dress = { shape: 'fish', glass: 'rose_soft', seal: 'mint_deep' }

  test('a free viewer gets the plain bottle and a hint that opens the plans', async ({ page }) => {
    const a = await makeUser('shelf-free-a')
    const b = await makeUser('shelf-free-b')
    await deliver(a.id, b.id, 'dressed for no one', dress, true)
    await signIn(page, b.email)
    await page.goto('/shelf')
    await page.getByRole('button', { name: opened }).click()

    const dialog = page.getByRole('dialog', { name: 'A bottle washed ashore' })
    await expectShape(dialog, 'classic')

    await dialog.getByRole('button', { name: /This bottle was dressed/ }).click()
    const plans = page.getByRole('dialog', { name: 'Become a Keeper' })
    await expect(plans.getByRole('button', { name: /Yearly/ })).toBeVisible()

    // Escape closes only the top sheet.
    await page.keyboard.press('Escape')
    await expect(plans).toHaveCount(0)
    await expect(dialog).toBeVisible()
  })

  test('no hint on a bottle nobody dressed', async ({ page }) => {
    const a = await makeUser('shelf-bare-a')
    const b = await makeUser('shelf-bare-b')
    await deliver(a.id, b.id, 'bare', undefined, true)
    await signIn(page, b.email)
    await page.goto('/shelf')
    await page.getByRole('button', { name: opened }).click()
    await expect(page.getByLabel('Message content')).toContainText('bare')
    await expect(page.getByRole('button', { name: /This bottle was dressed/ })).toHaveCount(0)
  })

  test('a Keeper sees the sender’s look, and a stable sea-dressed look otherwise', async ({ page }) => {
    const a = await makeUser('shelf-k-a')
    const c = await makeUser('shelf-k-c')
    const b = await makeUser('shelf-k-b')
    await makeKeeper(b.id)
    await deliver(a.id, b.id, 'dressed for you', dress, true)
    await deliver(c.id, b.id, 'never dressed', undefined, true)
    await signIn(page, b.email)
    await page.goto('/shelf')

    const bottles = page.getByRole('button', { name: opened })
    await expect(bottles).toHaveCount(2)

    // Which one sorts first is arbitrary: both arrived together.
    for (const i of [0, 1]) {
      await bottles.nth(i).click()
      const dialog = page.getByRole('dialog', { name: 'A bottle washed ashore' })
      const message = (await dialog.getByLabel('Message content').innerText()).trim()
      // Sea-dressed bottles get colours, never a shape.
      await expectShape(dialog, message === 'dressed for you' ? 'fish' : 'classic')
      await expect(dialog.getByRole('button', { name: /This bottle was dressed/ })).toHaveCount(0)
      await page.keyboard.press('Escape')
      await expect(dialog).toHaveCount(0)
    }

    const art = async () => {
      await expect(bottles).toHaveCount(2)
      await page.waitForFunction(() => document.querySelectorAll('.shelf-cell svg').length === 2)
      await page.waitForTimeout(500) // the catalogue and membership resolve just after
      return page.locator('.shelf-cell svg').evaluateAll((all) => all.map((el) => el.outerHTML).sort())
    }
    const first = await art()
    expect(first.every((svg) => !svg.includes('rgba(78,205,196,0.04)'))).toBe(true) // none plain
    await page.reload()
    expect(await art()).toEqual(first)
  })

  test('a lapsed Keeper’s shelf turns plain', async ({ page }) => {
    const a = await makeUser('shelf-lapse-a')
    const b = await makeUser('shelf-lapse-b')
    await deliver(a.id, b.id, 'once dressed', dress, true)
    await admin.from('memberships').insert({
      user_id: b.id, plan: 'yearly', status: 'canceled',
      access_until: new Date(Date.now() - 864e5).toISOString(),
    })
    await signIn(page, b.email)
    await page.goto('/shelf')
    await page.getByRole('button', { name: opened }).click()
    const dialog = page.getByRole('dialog', { name: 'A bottle washed ashore' })
    await expectShape(dialog, 'classic')
  })
})
