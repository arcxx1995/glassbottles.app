import { expect, test } from '@playwright/test'
import { admin, makeUser, signIn } from './helpers'

// The ripple and the push offer (migration 044).

test('a ripple reaches the sender live, once, and says nothing else', async ({ browser }) => {
  const a = await makeUser('rippler-a')
  const b = await makeUser('rippler-b')
  await admin.from('bottles').insert({
    sender_id: a.id,
    receiver_id: b.id,
    message: `you are not alone in this ${Date.now()}`,
    sent_at: new Date(Date.now() - 3 * 36e5).toISOString(),
    received_at: new Date(Date.now() - 2 * 36e5).toISOString(),
    day_key: new Date(Date.now() - 864e5).toISOString().slice(0, 10),
    is_read: true,
    delivered_ack_at: new Date().toISOString(),
  })

  const sender = await (await browser.newContext()).newPage()
  await signIn(sender, a.email)
  await expect(sender.getByText('Your bottle reached someone')).toHaveCount(0)

  const receiver = await (await browser.newContext()).newPage()
  await signIn(receiver, b.email)
  await receiver.goto('/inbox')
  await receiver.getByRole('button', { name: 'This reached me' }).click()
  await expect(receiver.getByText('They’ll know')).toBeVisible()
  await expect(receiver.getByRole('button', { name: 'This reached me' })).toHaveCount(0)

  // Realtime → the sender's banner, without a reload.
  await expect(sender.getByText('Your bottle reached someone')).toBeVisible({ timeout: 15_000 })
  await sender.getByRole('button', { name: 'Dismiss' }).last().click()
  await expect(sender.getByText('Your bottle reached someone')).toHaveCount(0)
  await sender.reload()
  await expect(sender.getByText('Sent today ✓').or(sender.getByText('Your bottle awaits'))).toBeVisible()
  await expect(sender.getByText('Your bottle reached someone')).toHaveCount(0)

  // Once only, survives a reload on the receiver's side too.
  await receiver.reload()
  await expect(receiver.getByText('They’ll know')).toBeVisible()
})

test('after a throw, push is offered once', async ({ page, browserName }) => {
  test.skip(!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY, 'push not configured in this build')
  test.skip(browserName !== 'chromium', 'PushManager availability differs per engine')
  // Headless Chromium hard-denies notifications; a real first visit reports
  // "default". This checks the offer's own logic, not a push service.
  await page.addInitScript(() => {
    Object.defineProperty(Notification, 'permission', { get: () => 'default' })
  })
  const u = await makeUser('nudge')
  await signIn(page, u.email)
  await page.getByLabel('Message to place in your bottle').fill('tell me when it lands')
  await page.getByRole('button', { name: /Seal & Throw/ }).click()
  await expect(page.getByText('Want to know when it’s found?')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Notify me' })).toBeVisible()
  await page.getByRole('button', { name: 'Not now' }).click()
  await expect(page.getByText('Want to know when it’s found?')).toHaveCount(0)
  await page.reload()
  await expect(page.getByText('Sent today ✓')).toBeVisible()
  await expect(page.getByText('Want to know when it’s found?')).toHaveCount(0)
})
