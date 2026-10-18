import { test, expect } from '@playwright/test'
import { admin, makeUser, signIn, expectPath, isolateReceiver, deliverNow } from './helpers'

// The whole loop: A throws → cron matches it to B → B's realtime banner →
// B opens the inbox and the bottle uncorks + marks itself read → A sees
// "Your bottle found someone".
test('a thrown bottle reaches a stranger, end to end', async ({ browser }) => {
  const a = await makeUser('sender', { timezone: 'UTC' })
  const b = await makeUser('receiver', { timezone: 'Asia/Kolkata' })
  const message = `hello from the e2e sea ${Date.now()}`

  const senderCtx = await browser.newContext()
  const receiverCtx = await browser.newContext()
  const sender = await senderCtx.newPage()
  const receiver = await receiverCtx.newPage()

  // Sender throws.
  await signIn(sender, a.email)
  await expectPath(sender, '/home')
  await sender.getByLabel('Message to place in your bottle').fill(message)
  await sender.getByRole('button', { name: /Seal & Throw/ }).click()
  await expect(sender.getByText('Sent today ✓')).toBeVisible()
  // The badge is optimistic; wait for the server to actually hold the bottle.
  await expect
    .poll(async () => (await admin.from('bottles').select('id').eq('sender_id', a.id)).data?.length)
    .toBe(1)

  // Quota: the throw entry is gone for today, and a second throw is refused.
  await sender.reload()
  await expect(sender.getByLabel('Message to place in your bottle')).toHaveCount(0)

  // Receiver is on the app (realtime socket open) when the cron runs.
  await signIn(receiver, b.email)
  await expectPath(receiver, '/home')
  await isolateReceiver(b.id)
  expect(await deliverNow(a.id)).toBeGreaterThanOrEqual(1)

  // Realtime broadcast → banner, without a reload.
  await expect(receiver.getByText('A bottle found you')).toBeVisible({ timeout: 15_000 })
  await receiver.getByText('A bottle found you').click()
  await expectPath(receiver, '/inbox')

  // Uncorks on view, then reads.
  await expect(receiver.getByText('A bottle washed ashore')).toBeVisible()
  await expect(receiver.getByLabel('Message content')).toContainText(message.split(' ')[0], {
    timeout: 5_000,
  })
  await expect(receiver.getByText('Read', { exact: true })).toBeVisible()
  await expect
    .poll(async () => {
      const { data } = await admin.from('bottles').select('is_read').eq('sender_id', a.id).single()
      return data?.is_read
    })
    .toBe(true)
  // Banner gone once read.
  await receiver.goto('/home')
  await expect(receiver.getByText('A bottle found you')).toHaveCount(0)

  // Sender side: delivered banner (realtime or the status refetch).
  await sender.reload()
  await expect(sender.getByText('Your bottle found someone')).toBeVisible({ timeout: 15_000 })

  await senderCtx.close()
  await receiverCtx.close()
})

test('reporting asks first, then removes the bottle for good', async ({ page }) => {
  const a = await makeUser('rsender')
  const b = await makeUser('rreceiver')
  const unkind = `something unkind ${Date.now()}`
  await admin.from('bottles').insert({
    sender_id: a.id,
    receiver_id: b.id,
    message: unkind,
    sent_at: new Date(Date.now() - 3 * 3_600_000).toISOString(),
    received_at: new Date(Date.now() - 2 * 3_600_000).toISOString(),
    day_key: new Date(Date.now() - 86_400_000).toISOString().slice(0, 10),
    is_read: true,
  })

  await signIn(page, b.email)
  await expectPath(page, '/home')
  await page.goto('/inbox')
  await expect(page.getByText(unkind)).toBeVisible()

  await page.getByLabel('Report this bottle').click()
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByText(unkind)).toBeVisible()

  await page.getByLabel('Report this bottle').click()
  await page.getByRole('button', { name: 'Report', exact: true }).click()
  await expect(page.getByText(unkind)).toHaveCount(0)
  await expect(page.getByText(/Reported\./)).toBeVisible()

  await page.reload()
  await expect(page.getByText('No bottles yet')).toBeVisible()
})

test('account deletion keeps a stranger’s delivered bottle', async ({ page }) => {
  const a = await makeUser('dsender')
  const b = await makeUser('dreceiver')
  const keptMessage = `kept after my author leaves ${Date.now()}`
  await admin.from('bottles').insert({
    sender_id: a.id,
    receiver_id: b.id,
    message: keptMessage,
    sent_at: new Date(Date.now() - 3 * 3_600_000).toISOString(),
    received_at: new Date(Date.now() - 2 * 3_600_000).toISOString(),
    day_key: new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10),
  })

  await signIn(page, a.email)
  await expectPath(page, '/home')
  await page.goto('/settings')
  await page.getByRole('button', { name: /Delete account/ }).click()
  await page.getByPlaceholder('DELETE').fill('DELETE')
  await page.getByRole('button', { name: 'Delete forever' }).click()
  await expectPath(page, '/')

  const { data } = await admin
    .from('bottles')
    .select('sender_id, receiver_id')
    .eq('message', keptMessage)
    .single()
  expect(data).toEqual({ sender_id: null, receiver_id: b.id })
})
