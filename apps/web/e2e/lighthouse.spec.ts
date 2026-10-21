import { expect, test } from '@playwright/test'
import { admin, makeUser, signIn } from './helpers'

// The Keeper lighthouse (Step 10): lit for a Keeper, dimmed after a lapse,
// absent for anyone who never joined.

test.skip(process.env.NEXT_PUBLIC_KEEPER !== 'on', 'Keeper is off in this build')

for (const [label, membership, expected] of [
  ['a Keeper', 'active', 'lit'],
  // Regression: lifetime rows store 'infinity', which once read as lapsed.
  ['a Founding Keeper', 'lifetime', 'lit'],
  ['an ex-Keeper', 'expired', 'dim'],
  ['someone who never joined', null, null],
] as const) {
  test(`lighthouse for ${label}`, async ({ page }) => {
    const u = await makeUser('light')
    if (membership) {
      await admin.from('memberships').insert(
        membership === 'lifetime'
          ? { user_id: u.id, plan: 'lifetime', status: 'active', access_until: 'infinity' }
          : {
              user_id: u.id, plan: 'monthly', status: membership,
              access_until: new Date(Date.now() + (membership === 'active' ? 30 : -1) * 864e5).toISOString(),
            },
      )
    }
    await signIn(page, u.email)
    await expect(page.getByLabel('Message to place in your bottle')).toBeVisible()
    const light = page.locator('[data-lighthouse]')
    if (expected) await expect(light).toHaveAttribute('data-lighthouse', expected)
    else await expect(light).toHaveCount(0)
  })
}
