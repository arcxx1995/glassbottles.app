import { expect, test, type Page } from '@playwright/test'
import { makeUser, signIn } from './helpers'

// The social layer (migration 050): handle, posts, votes, comments, friends,
// communities. The feed is global and specs run in parallel, so every
// locator is scoped to this test's own post / the middle column.

async function claim(page: Page, handle: string) {
  await page.getByLabel('Handle').fill(handle)
  await page.getByRole('button', { name: 'Claim handle' }).click()
  await expect(page.getByLabel('Write a post')).toBeVisible()
}

const stamp = () => Date.now().toString(36)

test('claim a handle, post, vote and comment', async ({ page }) => {
  const u = await makeUser('feed-a')
  await signIn(page, u.email)
  await expect(page).toHaveURL(/\/feed$/)
  await claim(page, `tide_${stamp()}`)

  const body = `first post ${Date.now()}`
  await page.getByLabel('Write a post').fill(body)
  await page.getByRole('button', { name: 'Post', exact: true }).click()
  const post = page.getByRole('article').filter({ hasText: body })
  await expect(post).toBeVisible()

  await post.getByRole('button', { name: 'Upvote' }).click()
  await expect(post.getByRole('button', { name: 'Upvote' })).toHaveAttribute('aria-pressed', 'true')
  await expect(post.getByText('1', { exact: true })).toBeVisible()

  await post.getByRole('button', { name: /0 comments/ }).click()
  await post.getByLabel('Write a comment').fill('nice one')
  await post.getByRole('button', { name: 'Reply' }).click()
  await expect(post.getByText('nice one')).toBeVisible()
})

test('friend request is accepted by the other side', async ({ browser }) => {
  const a = await makeUser('friend-a')
  const b = await makeUser('friend-b')
  const s = stamp()
  const pa = await (await browser.newContext()).newPage()
  const pb = await (await browser.newContext()).newPage()
  await signIn(pa, a.email)
  await claim(pa, `fa_${s}`)
  await signIn(pb, b.email)
  await claim(pb, `fb_${s}`)

  await pa.goto(`/u/fb_${s}`)
  await pa.getByRole('button', { name: 'Add friend' }).click()
  await expect(pa.getByRole('button', { name: 'Requested' })).toBeVisible()

  // The right panel can show the same request on wide screens: stay in <main>'s middle column.
  await pb.goto('/friends')
  const middle = pb.locator('section').filter({ has: pb.getByRole('heading', { name: 'Friends', exact: true }) })
  await middle.getByRole('button', { name: 'Accept' }).click()
  await expect(middle.getByRole('link', { name: `@fa_${s}` })).toBeVisible()
})

test('create a community, then post in it', async ({ page }) => {
  const u = await makeUser('comm-a')
  const s = stamp()
  await signIn(page, u.email)
  await claim(page, `ca_${s}`)

  await page.goto('/communities')
  await page.getByLabel('Community name').fill('Night Owls')
  await page.getByLabel('Community URL name').fill(`owls-${s}`)
  await page.getByRole('button', { name: 'Create' }).click()
  await page.goto(`/c/owls-${s}`)
  await expect(page.getByRole('heading', { name: 'Night Owls' })).toBeVisible()

  const body = `owl post ${Date.now()}`
  await page.getByLabel('Write a post').fill(body)
  await page.getByRole('button', { name: 'Post', exact: true }).click()
  await expect(page.getByRole('article').filter({ hasText: body })).toBeVisible()
})

test('phones reach friends and your profile from the bottom nav', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'bottom nav is the phone layout')
  const u = await makeUser('mobile-nav')
  const h = `mn_${stamp()}`
  await signIn(page, u.email)
  await claim(page, h)
  const nav = page.getByRole('navigation', { name: 'Main navigation' })
  await nav.getByRole('link', { name: 'Friends' }).click()
  await expect(page).toHaveURL(/\/friends$/)
  await nav.getByRole('link', { name: 'Me' }).click()
  await expect(page).toHaveURL(new RegExp(`/u/${h}$`))
  await page.getByRole('link', { name: 'Settings' }).click()
  await expect(page).toHaveURL(/\/settings$/)
})
