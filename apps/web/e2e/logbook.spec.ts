import { expect, test } from '@playwright/test'
import { admin, makeUser, signIn } from './helpers'

// The Logbook (migration 048).

test.skip(process.env.NEXT_PUBLIC_KEEPER !== 'on', 'Keeper is off in this build')

async function seed(withMembership: 'active' | 'expired' | null) {
  const me = await makeUser('log')
  const other = await makeUser('log-other')
  if (withMembership) {
    await admin.from('memberships').insert({
      user_id: me.id, plan: 'monthly', status: withMembership,
      access_until: new Date(Date.now() + (withMembership === 'active' ? 30 : -1) * 864e5).toISOString(),
    })
  }
  const d = (n: number) => new Date(Date.now() - n * 864e5)
  await admin.from('bottles').insert([
    { sender_id: me.id, receiver_id: other.id, message: 'the bottle I threw', sent_at: d(5).toISOString(),
      received_at: d(4).toISOString(), day_key: d(5).toISOString().slice(0, 10), weather: 'calm', rippled_at: d(3).toISOString() },
    { sender_id: other.id, receiver_id: me.id, message: 'the bottle that found me', sent_at: d(8).toISOString(),
      received_at: d(7).toISOString(), day_key: d(8).toISOString().slice(0, 10), kept_at: d(6).toISOString() },
  ])
  return me
}

test('a Keeper reads the Logbook and can save it', async ({ page }) => {
  const me = await seed('active')
  await signIn(page, me.email)
  await page.goto('/inbox')
  await page.getByRole('link', { name: 'Logbook' }).click()
  await expect(page).toHaveURL(/\/logbook$/)
  await expect(page.getByText('the bottle I threw')).toBeVisible()
  await expect(page.getByText('the bottle that found me')).toBeVisible()
  await expect(page.locator('article').getByText(/reached someone/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Save as PDF' })).toBeVisible()
})

test('an ex-Keeper still reads it, without export', async ({ page }) => {
  const me = await seed('expired')
  await signIn(page, me.email)
  await page.goto('/logbook')
  await expect(page.getByText('the bottle I threw')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Save as PDF' })).toHaveCount(0)
  await expect(page.getByText(/Rejoin Keeper to save it/)).toBeVisible()
})

test('someone who never joined sees what it is', async ({ page }) => {
  const me = await seed(null)
  await signIn(page, me.email)
  await page.goto('/logbook')
  await expect(page.getByText('A keepsake of your sea')).toBeVisible()
  await expect(page.getByText('the bottle I threw')).toHaveCount(0)
})
