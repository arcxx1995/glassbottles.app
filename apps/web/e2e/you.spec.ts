import { expect, test } from '@playwright/test'
import { admin, expectPath, makeUser, signIn } from './helpers'

// The You tab: a menu with your current, Settings and log out (and, when
// Keeper is on, your handle and kayak).

test('the You menu sets your current, opens Settings and logs out', async ({ page }) => {
  const u = await makeUser('you-menu')
  await signIn(page, u.email)
  await page.goto('/sea')

  const you = page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'You' })
  await you.click()
  const menu = page.getByRole('menu', { name: 'You' })
  await expect(menu).toBeVisible()

  // Your current → sheet → pick one.
  await menu.getByRole('menuitem', { name: /Your current/ }).click()
  await expect(menu).toHaveCount(0)
  await page.getByRole('dialog').getByRole('button', { name: /Night Owl/ }).click()
  await expect
    .poll(async () => (await admin.from('profiles').select('current').eq('id', u.id).single()).data?.current)
    .toBe('night_owl')
  await page.keyboard.press('Escape')

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
