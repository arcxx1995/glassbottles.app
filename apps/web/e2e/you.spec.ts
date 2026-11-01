import { expect, test } from '@playwright/test'
import { admin, expectPath, makeUser, signIn } from './helpers'

// The You tab: a menu with Settings and log out (and, when Keeper is on,
// your handle and kayak). Your current is picked from the Sea's header.

test('the Sea sets your current; the You menu opens Settings and logs out', async ({ page }) => {
  const u = await makeUser('you-menu')
  await signIn(page, u.email)
  await page.goto('/sea')

  // The Your current button (top right of the Sea) → pick one in its dialog.
  await page.getByRole('button', { name: /Your current: Open sea/ }).click()
  await page.getByRole('dialog', { name: 'Your current' }).getByRole('button', { name: /Night Owl/ }).click()
  await expect
    .poll(async () => (await admin.from('profiles').select('current').eq('id', u.id).single()).data?.current)
    .toBe('night_owl')
  await expect(page.getByRole('button', { name: /Your current: Night Owl/ })).toBeVisible()
  await page.keyboard.press('Escape')

  const you = page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'You' })
  const menu = page.getByRole('menu', { name: 'You' })

  // Escape and outside taps close the menu.
  await you.click()
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)

  await you.click()
  await menu.getByRole('menuitem', { name: 'Settings' }).click()
  await expectPath(page, '/settings')

  await you.click()
  await menu.getByRole('menuitem', { name: 'Log out' }).click()
  await expectPath(page, '/sign-in')
})
