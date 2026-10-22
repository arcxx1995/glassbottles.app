import { expect, test } from '@playwright/test'
import { admin, expectPath, makeUser, signIn } from './helpers'

// The safety screen (migration 043). The classifier itself runs in the
// screen-bottle Edge Function; these specs apply its verdicts the way it
// does — through apply_screen — and check what the sender sees, live.

async function latestBottle(senderId: string) {
  let id: string | undefined
  await expect
    .poll(async () => {
      const { data } = await admin
        .from('bottles')
        .select('id')
        .eq('sender_id', senderId)
        .order('sent_at', { ascending: false })
        .limit(1)
      id = data?.[0]?.id
      return id
    })
    .toBeTruthy()
  return id!
}

test('a held bottle comes back to rewrite, and the rewrite sails', async ({ page }) => {
  const u = await makeUser('held', { timezone: 'UTC' })
  await signIn(page, u.email)
  await expectPath(page, '/feed')
  await page.goto('/sea')
  await expectPath(page, '/sea')

  const words = 'come find me, my number is in my bio'
  await page.getByLabel('Message to place in your bottle').fill(words)
  await page.getByRole('button', { name: /Seal & Throw/ }).click()
  await expect(page.getByText('Sent today ✓')).toBeVisible()
  const first = await latestBottle(u.id)

  // The screen keeps it ashore → realtime → the throw comes back, no reload.
  const { data, error } = await admin.rpc('apply_screen', {
    p_bottle_id: first,
    p_verdict: 'held',
    p_reason: 'contact',
  })
  expect(error).toBeNull()
  expect(data).toBe('held')
  await expect(page.getByText('Your bottle stayed ashore')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText(/contact details or a link/)).toBeVisible()

  await page.getByRole('button', { name: 'Rewrite it' }).click()
  await expect(page.getByText('Your bottle stayed ashore')).toHaveCount(0)
  const editor = page.getByLabel('Message to place in your bottle')
  await expect(editor).toHaveValue(words)
  await editor.fill('hope your day is gentle, whoever you are')
  await page.getByRole('button', { name: /Seal & Throw/ }).click()
  await expect(page.getByText('Sent today ✓')).toBeVisible()

  await expect
    .poll(async () => (await admin.from('bottles').select('id').eq('sender_id', u.id).eq('is_stale', false)).data?.length)
    .toBe(1)
})

test('a bottle in crisis still sails, and its sender is offered help', async ({ page }) => {
  const u = await makeUser('care', { timezone: 'Asia/Kolkata' })
  await signIn(page, u.email)
  await page.goto('/sea')
  await page.getByLabel('Message to place in your bottle').fill('some nights I just want to die')
  await page.getByRole('button', { name: /Seal & Throw/ }).click()

  const card = page.getByRole('complementary', { name: 'Support' })
  await expect(card).toBeVisible()
  await expect(card.getByText('Tele-MANAS')).toBeVisible()
  await expect(card.getByText('Find a helpline')).toBeVisible()

  // Sailing, not blocked; and once closed it stays closed for the day.
  const id = await latestBottle(u.id)
  await admin.rpc('apply_screen', { p_bottle_id: id, p_verdict: 'crisis' })
  expect((await admin.from('bottles').select('is_stale').eq('id', id).single()).data?.is_stale).toBe(false)
  await card.getByRole('button', { name: 'Close' }).click()
  await expect(card).toHaveCount(0)
  await page.reload()
  await expect(page.getByText('Sent today ✓')).toBeVisible()
  await expect(page.getByRole('complementary', { name: 'Support' })).toHaveCount(0)
})
