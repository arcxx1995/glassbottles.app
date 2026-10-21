import { expect, test } from '@playwright/test'
import { admin, makeUser, signIn } from './helpers'

// The Keeper card ships dark: it only exists in builds with NEXT_PUBLIC_KEEPER=on.
test.skip(process.env.NEXT_PUBLIC_KEEPER !== 'on', 'Keeper is off in this build')

test('a webhook-granted membership reaches the open settings page live', async ({ page }) => {
  const user = await makeUser('keeper')
  await signIn(page, user.email)
  await page.goto('/settings')

  const header = page.getByRole('button', { name: /Become a Keeper/ })
  // The header only expands once the membership has loaded.
  await expect(header).toContainText('The bottle is free, always')
  await header.click() // collapsed like the other settings rows
  await expect(page.getByRole('button', { name: /Yearly.*\$24/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /Monthly.*\$2\.99/ })).toBeVisible()
  await expect(page.getByText('7-day free trial', { exact: true })).toBeVisible()
  await expect(page.getByText(/of 100 left/)).toBeVisible()

  // What the signed Dodo webhook does once checkout completes (route → RPC).
  const { data, error } = await admin.rpc('apply_dodo_event', {
    p_event_id: `evt_e2e_${user.id}`,
    p_type: 'subscription.active',
    p_ts: new Date().toISOString(),
    p_data: {
      subscription_id: `sub_${user.id}`,
      status: 'active',
      next_billing_date: new Date(Date.now() + 7 * 864e5).toISOString(),
      metadata: { user_id: user.id },
      customer: { customer_id: `cus_${user.id}`, email: user.email },
    },
    p_plan: 'yearly',
  })
  expect(error).toBeNull()
  expect(data).toBe('applied')

  // No reload: the 'membership' broadcast refetches the card.
  await expect(page.getByText(/^Renews /)).toBeVisible({ timeout: 10_000 })
  await expect(page.getByRole('button', { name: 'Manage membership' })).toBeVisible()
})
