import { expect, test } from '@playwright/test'
import { admin, makeUser, signIn } from './helpers'

// Letters to yourself (migration 047).

test.skip(process.env.NEXT_PUBLIC_KEEPER !== 'on', 'Keeper is off in this build')

test('a Keeper seals a letter to themselves; it washes back into the inbox', async ({ page }) => {
  const u = await makeUser('future', { timezone: 'UTC' })
  await admin.from('memberships').insert({
    user_id: u.id, plan: 'yearly', status: 'active',
    access_until: new Date(Date.now() + 30 * 864e5).toISOString(),
  })
  await signIn(page, u.email)

  const words = 'dear me, I hope the move went fine'
  await page.getByLabel('Message to place in your bottle').fill(words)
  await page.getByRole('button', { name: 'Future me' }).click()
  const sheet = page.getByRole('dialog', { name: 'Send to future me' })
  await sheet.getByRole('button', { name: 'A month' }).click()
  await sheet.getByRole('button', { name: 'Seal for future me' }).click()
  await expect(sheet).toHaveCount(0)
  await expect(page.getByText(/Sealed\. It washes back to you on/)).toBeVisible()
  await expect(page.getByLabel('Message to place in your bottle')).toHaveValue('')
  // Today's stranger throw is untouched.
  await expect(page.getByText('Sent today ✓')).toHaveCount(0)

  await page.goto('/inbox')
  await expect(page.getByText('1 letter to yourself drifting back')).toBeVisible()
  await expect(page.getByText(words)).toHaveCount(0) // sealed while waiting

  // The date comes; the hourly cron delivers it.
  await admin.from('future_bottles').update({ deliver_on: new Date().toISOString().slice(0, 10) }).eq('user_id', u.id)
  const { error } = await admin.rpc('deliver_future_bottles')
  expect(error).toBeNull()
  await page.reload()
  await expect(page.getByText(words)).toBeVisible()
  await expect(page.getByText(/From you · written/)).toBeVisible()
})

test('a free user is offered Keeper instead', async ({ page }) => {
  const u = await makeUser('future-free')
  await signIn(page, u.email)
  await page.getByRole('button', { name: 'Future me' }).click()
  const sheet = page.getByRole('dialog', { name: 'Send to future me' })
  await expect(sheet.getByText('Letters to yourself are for Keepers.')).toBeVisible()
  await expect(sheet.getByRole('button', { name: /Yearly/ })).toBeVisible()
})
