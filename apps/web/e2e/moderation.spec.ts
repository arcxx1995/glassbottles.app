import { test, expect } from '@playwright/test'
import { admin, makeUser, signIn, expectPath } from './helpers'

// Migration 051: the 18+ gate and the submission blocklist, end to end.

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
