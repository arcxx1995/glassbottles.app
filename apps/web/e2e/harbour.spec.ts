import { expect, test } from '@playwright/test'
import { admin, expectPath, makeKeeper, makeUser, signIn } from './helpers'

// The Harbour (migration 056): Keepers only; launching a kayak; today's ring,
// a kayak's interior, and report / block taking a kayak out of your harbour.

test.skip(process.env.NEXT_PUBLIC_KEEPER !== 'on', 'Keeper is off in this build')

const uniq = () => `k${Math.random().toString(36).slice(2, 10)}`
const today = () => new Date().toISOString().slice(0, 10)

/** A Keeper whose kayak is already screened and floating. */
async function floatingKayak(hull: string) {
  const u = await makeUser('kayak')
  await makeKeeper(u.id)
  const handle = uniq()
  const { error } = await admin
    .from('social_profiles')
    .insert({ user_id: u.id, handle, bio: `Bio of ${handle}`, bio_screen: 'ok' })
  if (error) throw error
  const { error: kErr } = await admin.from('kayaks').insert({ user_id: u.id, hull, paddle: 'red', parked: true })
  if (kErr) throw kErr
  return { ...u, handle }
}

test('non-Keepers see the invitation, not the kayaks', async ({ page }) => {
  const u = await makeUser('harbour-guest')
  await signIn(page, u.email)
  await page.goto('/harbour')
  await expect(page.getByText('A harbour for Keepers')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Become a Keeper' })).toBeVisible()
  await expect(page.getByRole('link', { name: /^Kayak / })).toHaveCount(0)
})

test('a Keeper launches a kayak; it waits for the screen', async ({ page }) => {
  const u = await makeUser('launcher')
  await makeKeeper(u.id)
  await signIn(page, u.email)
  await page.goto('/harbour')
  await page.getByRole('button', { name: 'Launch my kayak' }).click()
  const handle = uniq()
  await page.getByPlaceholder('tidewalker').fill(handle)
  await page.getByPlaceholder('Night swimmer. Collects sea glass.').fill('Rows at dawn.')
  await page.getByRole('button', { name: 'Hull coral' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Launch my kayak' }).click()

  // CI has no edge runtime, so the handle + bio screen never answers.
  await expect(page.getByText('Your kayak is being checked')).toBeVisible()
  const { data } = await admin.from('kayaks').select('hull, parked').eq('user_id', u.id).single()
  expect(data).toEqual({ hull: 'coral', parked: true })
})

test('today’s ring: visit a kayak, report one, block another', async ({ page }) => {
  const a = await floatingKayak('yellow')
  const b = await floatingKayak('white')
  const c = await floatingKayak('teal')
  await admin.from('harbour_days').delete().eq('day', today())
  const { error } = await admin
    .from('harbour_days')
    .insert([a, b, c].map((k, i) => ({ day: today(), slot: i + 1, user_id: k.id })))
  if (error) throw error

  const viewer = await makeUser('harbour-viewer')
  await makeKeeper(viewer.id)
  await signIn(page, viewer.email)
  await page.goto('/harbour')
  for (const k of [a, b, c]) await expect(page.getByRole('link', { name: `Kayak @${k.handle}` })).toBeVisible()

  // Inside a kayak: its bio is the note on the seat.
  await page.getByRole('link', { name: `Kayak @${a.handle}` }).click()
  await expectPath(page, `/harbour/${a.handle}`)
  await expect(page.getByText(`Bio of ${a.handle}`)).toBeVisible()

  // Report: back to the harbour, and that kayak is gone for you.
  await page.getByRole('button', { name: 'Report or block' }).click()
  await page.getByRole('group', { name: 'Report reason' }).getByRole('button', { name: 'Spam' }).click()
  await expectPath(page, '/harbour')
  await expect(page.getByRole('link', { name: `Kayak @${a.handle}` })).toHaveCount(0)

  // Block (two taps).
  await page.getByRole('link', { name: `Kayak @${b.handle}` }).click()
  await page.getByRole('button', { name: 'Report or block' }).click()
  await page.getByRole('button', { name: 'Block', exact: true }).click()
  await page.getByRole('button', { name: 'Block?' }).click()
  await expectPath(page, '/harbour')
  await expect(page.getByRole('link', { name: `Kayak @${b.handle}` })).toHaveCount(0)
  await expect(page.getByRole('link', { name: `Kayak @${c.handle}` })).toBeVisible()

  const { data } = await admin.from('kayak_reports').select('reason').eq('target_id', a.id)
  expect(data).toEqual([{ reason: 'spam' }])
})
