import { expect, test } from '@playwright/test'
import { admin, makeUser, signIn } from './helpers'

// Sparks (migration 046): a question shown as the empty box's placeholder,
// never written into the bottle.

const deck = /\?$/

test('a spark is a placeholder question, never the message', async ({ page }) => {
  const u = await makeUser('spark-free')
  await signIn(page, u.email)
  await page.goto('/sea')
  const box = page.getByLabel('Message to place in your bottle')
  await page.getByRole('button', { name: 'Need a spark?' }).click()
  const first = await box.getAttribute('placeholder')
  expect(first).toMatch(deck)
  await expect(box).toHaveValue('')
  await page.getByRole('button', { name: 'Another spark' }).click()
  expect(await box.getAttribute('placeholder')).not.toBe(first)
  await box.fill('my own words')
  await expect(page.getByRole('button', { name: 'Another spark' })).toHaveCount(0)
})

test('a Keeper still gets a spark when the AI is unreachable', async ({ page }) => {
  test.skip(process.env.NEXT_PUBLIC_KEEPER !== 'on', 'Keeper is off in this build')
  const u = await makeUser('spark-keeper')
  await admin.from('memberships').insert({
    user_id: u.id, plan: 'monthly', status: 'active',
    access_until: new Date(Date.now() + 30 * 864e5).toISOString(),
  })
  await signIn(page, u.email)
  await page.goto('/sea')
  await page.getByRole('button', { name: 'Need a spark?' }).click()
  await expect
    .poll(() => page.getByLabel('Message to place in your bottle').getAttribute('placeholder'))
    .toMatch(deck)
})
