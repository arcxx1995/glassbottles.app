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
  await expectPath(page, '/sea')
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
  await expect(page.getByText(/no contact details, handles or links/)).toBeVisible()

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

test('a bottle in crisis is held, never delivered, and its sender is offered help', async ({ page }) => {
  const u = await makeUser('care', { timezone: 'Asia/Kolkata' })
  await signIn(page, u.email)
  await page.goto('/sea')
  await page.getByLabel('Message to place in your bottle').fill('some nights I just want to die')
  await page.getByRole('button', { name: /Seal & Throw/ }).click()

  // The client's own read shows support at once.
  const card = page.getByRole('complementary', { name: 'Support' })
  await expect(card).toBeVisible()
  await expect(card.getByText('Tele-MANAS')).toBeVisible()

  // 052: the screen's crisis verdict holds the bottle ashore — no stranger
  // receives it — and the sender sees help lines in place of the card.
  const id = await latestBottle(u.id)
  expect((await admin.rpc('apply_screen', { p_bottle_id: id, p_verdict: 'crisis' })).data).toBe('held')
  const { data: b } = await admin.from('bottles').select('is_stale, screen, screen_reason').eq('id', id).single()
  expect(b).toEqual({ is_stale: true, screen: 'held', screen_reason: 'crisis' })
  const help = page.getByRole('alert').filter({ hasText: 'carry this alone' })
  await expect(help).toBeVisible({ timeout: 15_000 })
  await expect(card).toHaveCount(0)

  // Dismissed help stays dismissed.
  await help.getByRole('button').click()
  await expect(help).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole('alert').filter({ hasText: 'carry this alone' })).toHaveCount(0)
})
