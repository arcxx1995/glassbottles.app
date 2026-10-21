import { expect, test } from '@playwright/test'
import { admin, makeUser, signIn } from './helpers'

// Keepsakes (migration 045): keep a bottle, see only the kept ones, let go.

test('keeping a bottle adds a Kept view; letting go removes it', async ({ page }) => {
  const a = await makeUser('keep-a')
  const b = await makeUser('keep-b')
  const day = (n: number) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10)
  const base = { sender_id: a.id, receiver_id: b.id, is_read: true }
  await admin.from('bottles').insert([
    { ...base, message: 'the one worth keeping', sent_at: new Date(Date.now() - 50 * 36e5).toISOString(), received_at: new Date(Date.now() - 49 * 36e5).toISOString(), day_key: day(2) },
    { ...base, message: 'an ordinary tuesday', sent_at: new Date(Date.now() - 26 * 36e5).toISOString(), received_at: new Date(Date.now() - 25 * 36e5).toISOString(), day_key: day(1) },
  ])

  await signIn(page, b.email)
  await page.goto('/inbox')
  await expect(page.getByText('an ordinary tuesday')).toBeVisible()
  await expect(page.getByRole('button', { name: /^Kept ·/ })).toHaveCount(0)

  const card = page.locator('article', { hasText: 'the one worth keeping' })
  await card.getByRole('button', { name: 'Keep this bottle' }).click()
  await page.getByRole('button', { name: 'Kept · 1' }).click()
  await expect(page.getByText('the one worth keeping')).toBeVisible()
  await expect(page.getByText('an ordinary tuesday')).toHaveCount(0)

  // Kept survives a reload (it's on the server, not the device).
  await page.reload()
  await expect(page.getByRole('button', { name: 'Kept · 1' })).toBeVisible()

  await page.locator('article', { hasText: 'the one worth keeping' })
    .getByRole('button', { name: /Kept — tap to let go/ }).click()
  await expect(page.getByRole('button', { name: /^Kept ·/ })).toHaveCount(0)
  await expect(page.getByText('an ordinary tuesday')).toBeVisible()
})
