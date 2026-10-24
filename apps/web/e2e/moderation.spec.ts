import { test, expect, type Page } from '@playwright/test'
import { admin, makeUser, signIn, expectPath } from './helpers'

// Migration 051: the 18+ gate and the submission blocklist, end to end.
// Migration 052: the live filter in the editor (check-message), stubbed here
// because CI runs Supabase without the edge runtime.

async function stubCheck(page: Page, verdict: { verdict: string; reason?: string }) {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  }
  await page.route('**/functions/v1/check-message', (route) =>
    route.request().method() === 'OPTIONS'
      ? route.fulfill({ status: 200, headers: cors })
      : route.fulfill({ status: 200, headers: cors, json: verdict }),
  )
}

test('an account that never confirmed 18+ is gated until it does', async ({ page }) => {
  const u = await makeUser('gate', { adult: false })
  await signIn(page, u.email)
  await expectPath(page, '/home')

  const gate = page.getByRole('dialog', { name: 'Before you go to sea' })
  await expect(gate).toBeVisible()
  await gate.getByRole('button', { name: /18 or older/ }).click()
  await expect(gate).toHaveCount(0)

  const { data } = await admin.from('profiles').select('age_confirmed_at, terms_accepted_at').eq('id', u.id).single()
  expect(data?.age_confirmed_at).not.toBeNull()
  expect(data?.terms_accepted_at).not.toBeNull()

  await page.reload()
  await expect(page.getByLabel('Message to place in your bottle')).toBeVisible()
  await expect(gate).toHaveCount(0)
})

test('a confirmed adult never sees the gate', async ({ page }) => {
  const u = await makeUser('adult')
  await signIn(page, u.email)
  await expect(page.getByLabel('Message to place in your bottle')).toBeVisible()
  await expect(page.getByRole('dialog', { name: 'Before you go to sea' })).toHaveCount(0)
})

test('the live filter blocks a prohibited draft while typing — nothing is submitted', async ({ page }) => {
  const u = await makeUser('live-held', { timezone: 'UTC' })
  await stubCheck(page, { verdict: 'held', reason: 'sexual' })
  await signIn(page, u.email)
  await page.getByLabel('Message to place in your bottle').fill('an explicit draft')

  const alert = page.getByRole('alert').filter({ hasText: 'be thrown' })
  await expect(alert).toBeVisible({ timeout: 10_000 })
  await expect(alert).toContainText('Sexual content')
  await expect(alert.getByRole('link', { name: 'community guidelines' })).toHaveAttribute('href', '/guidelines')
  await expect(page.getByRole('button', { name: /Seal & Throw/ })).toHaveCount(0)

  const { data } = await admin.from('bottles').select('id').eq('sender_id', u.id)
  expect(data).toHaveLength(0)
})

test('a crisis draft shows helplines instead of the throw button', async ({ page }) => {
  const u = await makeUser('live-crisis', { timezone: 'UTC' })
  await stubCheck(page, { verdict: 'crisis' })
  await signIn(page, u.email)
  await page.getByLabel('Message to place in your bottle').fill('a heavy draft')

  await expect(page.getByRole('link', { name: 'findahelpline.com' })).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText('won’t be sent to a stranger')).toBeVisible()
  await expect(page.getByRole('button', { name: /Seal & Throw/ })).toHaveCount(0)
})

test('a clean draft gets the throw button once checked', async ({ page }) => {
  const u = await makeUser('live-ok', { timezone: 'UTC' })
  await stubCheck(page, { verdict: 'ok' })
  await signIn(page, u.email)
  await page.getByLabel('Message to place in your bottle').fill('the tide came in slow today')
  await expect(page.getByRole('button', { name: /Seal & Throw/ })).toBeVisible({ timeout: 10_000 })
})

// The backstop: with the live check unreachable (no edge runtime here), the
// insert guard still refuses the words.
test('a blocklisted message is refused at send, with the guidelines linked', async ({ page }) => {
  const u = await makeUser('blocked', { timezone: 'UTC' })
  await signIn(page, u.email)
  await page.getByLabel('Message to place in your bottle').fill('send me your nudes')
  await page.getByRole('button', { name: /Seal & Throw/ }).click()

  const alert = page.getByRole('alert').filter({ hasText: 'community guidelines' })
  await expect(alert).toBeVisible({ timeout: 10_000 })
  await expect(alert.getByRole('link', { name: 'community guidelines' })).toHaveAttribute('href', '/guidelines')

  const { data } = await admin.from('bottles').select('id').eq('sender_id', u.id)
  expect(data).toHaveLength(0)
})
