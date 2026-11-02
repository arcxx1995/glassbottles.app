import { createClient } from '@supabase/supabase-js'
import { expect, test, type Page } from '@playwright/test'
import { PASSWORD, admin, makeUser, signIn } from './helpers'

// The admin console (migration 065). It lives on its own host, VVS_HOST, so a
// build under test sets VVS_HOST=vvs.localhost. Chromium resolves *.localhost.

const VVS = process.env.E2E_VVS_URL ?? ''
test.skip(!VVS, 'Set E2E_VVS_URL, and VVS_HOST on the server under test')

const ok = <T,>({ data, error }: { data: T; error: { message: string } | null }) => {
  if (error) throw new Error(error.message)
  return data as NonNullable<T>
}

async function makeAdmin() {
  const u = await makeUser('vvs-admin')
  ok(await admin.from('admins').insert({ user_id: u.id }))
  return u
}

/** A person's own session, to report things the way the app does. */
async function asUser(email: string) {
  const c = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { error } = await c.auth.signInWithPassword({ email, password: PASSWORD })
  if (error) throw error
  return c
}

let day = 0
async function delivered(senderId: string, receiverId: string, message: string) {
  const d = new Date(Date.UTC(2030, 0, 1) + day++ * 864e5).toISOString().slice(0, 10)
  return ok(
    await admin
      .from('bottles')
      .insert({ sender_id: senderId, receiver_id: receiverId, message, received_at: new Date().toISOString(), screen: 'ok', day_key: d })
      .select('id')
      .single(),
  ).id as string
}

/** A filed report, unique to this test, ready to decide. */
async function reported(reason = 'harassment') {
  const sender = await makeUser('vvs-sender')
  const reporter = await makeUser('vvs-reporter')
  const words = `Reported words ${Math.random().toString(36).slice(2, 10)}`
  const bottle = await delivered(sender.id, reporter.id, words)
  const c = await asUser(reporter.email)
  ok(await c.rpc('report_bottle_for_review', { p_bottle_id: bottle, p_reason: reason }))
  return { sender, reporter, bottle, words }
}

async function signInToConsole(page: Page, email: string) {
  await page.goto(`${VVS}/vvs/login`)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL((u) => u.pathname === '/vvs' || u.search.includes('denied'))
}
const caseCard = (page: Page, words: string) => page.getByRole('article').filter({ hasText: words })

async function decide(page: Page, words: string, outcome: string, reason = 'Checked it') {
  const card = caseCard(page, words)
  await card.getByRole('radio', { name: outcome, exact: true }).click()
  await card.getByLabel('Reason, for the log').fill(reason)
  return card
}

test('it isn’t on the public site, and everything on its host leads to its own login', async ({ page, baseURL }) => {
  const res = await page.goto(`${baseURL}/vvs`)
  expect(res?.status()).toBe(404)

  for (const path of ['/', '/vvs', '/vvs/people', '/sign-in', '/sign-up', '/sea']) {
    await page.goto(`${VVS}${path}`)
    await expect(page).toHaveURL(/\/vvs\/login$/)
  }
  // Email and password only.
  await expect(page.getByLabel('Password')).toBeVisible()
  await expect(page.getByRole('button', { name: /Google/ })).toHaveCount(0)
  await expect(page.getByRole('link', { name: /account/i })).toHaveCount(0)
})

test('a wrong password is refused, and an account without access goes back to the login', async ({ page }) => {
  const u = await makeUser('vvs-nobody')

  await page.goto(`${VVS}/vvs/login`)
  await page.getByLabel('Email').fill(u.email)
  await page.getByLabel('Password').fill('not-the-password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'Incorrect email or password.' })).toBeVisible()

  await signInToConsole(page, u.email)
  await expect(page).toHaveURL(/\/vvs\/login\?denied=1$/)
  await expect(page.getByRole('alert').filter({ hasText: 'doesn’t have access' })).toBeVisible()
  await expect(page.getByText('Reports & blocks')).toHaveCount(0)

  // And they were signed out: trying again goes to the login, not round a loop.
  await page.goto(`${VVS}/vvs`)
  await expect(page).toHaveURL(/\/vvs\/login$/)
  await expect(page.getByLabel('Password')).toBeVisible()
})

test('an admin gets in with a password, and stays in', async ({ page }) => {
  const a = await makeAdmin()
  await signInToConsole(page, a.email)
  await expect(page).toHaveURL(/\/vvs$/)
  await expect(page.getByRole('heading', { name: 'Reports & blocks' })).toBeVisible()
  await page.goto(`${VVS}/vvs/login`)
  await expect(page).toHaveURL(/\/vvs$/)
  await page.goto(`${VVS}/vvs/log`)
  await expect(page.getByRole('heading', { name: 'Log' })).toBeVisible()
})

test('Log out signs the admin out and returns to the login, for good', async ({ page }) => {
  const a = await makeAdmin()
  await signInToConsole(page, a.email)
  await page.getByRole('button', { name: 'Log out' }).click()
  await expect(page).toHaveURL(/\/vvs\/login$/)
  await expect(page.getByLabel('Password')).toBeVisible()
  // No "doesn't have access": they did nothing wrong.
  await expect(page.getByRole('alert').filter({ hasText: 'access' })).toHaveCount(0)

  for (const path of ['/vvs', '/vvs/people', '/vvs/log']) {
    await page.goto(`${VVS}${path}`)
    await expect(page).toHaveURL(/\/vvs\/login$/)
  }
  // Back in, with the same password.
  await signInToConsole(page, a.email)
  await expect(page.getByRole('heading', { name: 'Reports & blocks' })).toBeVisible()
})

test('Log out and the tabs stay in view while scrolling', async ({ page }) => {
  const a = await makeAdmin()
  await signInToConsole(page, a.email)
  await page.setViewportSize({ width: 390, height: 300 })
  await page.goto(`${VVS}/vvs/people/${a.id}`)
  await expect(page.getByRole('heading', { name: 'Flags' })).toBeAttached()
  await page.evaluate(() => window.scrollTo(0, 400))
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0)
  await expect(page.getByRole('button', { name: 'Log out' })).toBeInViewport()
  await expect(page.getByRole('link', { name: 'People' })).toBeInViewport()
})

test('a report waits, hidden only from its reporter; removing it tells the reporter', async ({ page, baseURL }) => {
  const a = await makeAdmin()
  const { sender, reporter, bottle, words } = await reported()

  // Nothing has happened to the sender yet.
  const before = ok(await admin.from('bottles').select('screen, is_reported').eq('id', bottle).single())
  expect(before).toEqual({ screen: 'ok', is_reported: true })
  expect(ok(await admin.from('profiles').select('suspended_at').eq('id', sender.id).single()).suspended_at).toBeNull()

  await signInToConsole(page, a.email)
  await page.goto(`${VVS}/vvs`)
  await expect(caseCard(page, words)).toBeVisible()
  await expect(page.getByText(sender.email)).toHaveCount(0)

  // A reason is required before anything but a dismissal.
  const card = caseCard(page, words)
  await card.getByRole('radio', { name: 'Remove', exact: true }).click()
  await expect(card.getByRole('button', { name: 'Apply: Remove' })).toBeDisabled()
  await card.getByLabel('Reason, for the log').fill('Abusive')
  await card.getByRole('button', { name: 'Apply: Remove' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Done: Remove' })).toBeVisible()
  await expect(caseCard(page, words)).toHaveCount(0)

  expect(ok(await admin.from('bottles').select('screen').eq('id', bottle).single()).screen).toBe('held')

  // The reporter hears, without detail.
  await signIn(page, reporter.email, `${baseURL}/sign-in`)
  await expect(page.getByText('We reviewed your report and took action.')).toBeVisible()
  await page.getByRole('button', { name: 'Okay' }).click()
  await expect(page.getByText('We reviewed your report and took action.')).toHaveCount(0)
})

test('dismissing leaves the sender alone and tells the reporter', async ({ page, baseURL }) => {
  const a = await makeAdmin()
  const { sender, reporter, bottle, words } = await reported()
  await signInToConsole(page, a.email)
  await page.goto(`${VVS}/vvs`)
  const card = caseCard(page, words)
  await card.getByRole('radio', { name: 'Dismiss', exact: true }).click()
  await card.getByRole('button', { name: 'Apply: Dismiss' }).click()
  await expect(caseCard(page, words)).toHaveCount(0)

  expect(ok(await admin.from('bottles').select('screen, is_reported').eq('id', bottle).single())).toEqual({
    screen: 'ok',
    is_reported: true,
  })
  expect(ok(await admin.from('profiles').select('suspended_at').eq('id', sender.id).single()).suspended_at).toBeNull()
  await signIn(page, reporter.email, `${baseURL}/sign-in`)
  await expect(page.getByText(/didn.t break our rules/)).toBeVisible()
})

test('warning and suspending: the person is told why, and for how long', async ({ page, baseURL }) => {
  const a = await makeAdmin()
  const warned = await reported('contact')
  const suspended = await reported()
  await signInToConsole(page, a.email)
  await page.goto(`${VVS}/vvs`)

  const w = await decide(page, warned.words, 'Remove + warn')
  await w.getByLabel('Added to what they’re told').fill('Please keep it anonymous.')
  await w.getByRole('button', { name: 'Apply: Remove + warn' }).click()
  await expect(caseCard(page, warned.words)).toHaveCount(0)

  const s = await decide(page, suspended.words, 'Remove + suspend 7 days')
  await s.getByRole('button', { name: 'Apply: Remove + suspend 7 days' }).click()
  await expect(caseCard(page, suspended.words)).toHaveCount(0)

  const until = ok(await admin.from('profiles').select('suspended_at, suspended_until').eq('id', suspended.sender.id).single())
  expect(until.suspended_at).not.toBeNull()
  expect(new Date(until.suspended_until!).getTime()).toBeGreaterThan(Date.now() + 6 * 864e5)

  await signIn(page, warned.sender.email, `${baseURL}/sign-in`)
  await expect(page.getByText(/sharing contact details/)).toBeVisible()
  await expect(page.getByText(/Please keep it anonymous\./)).toBeVisible()
  await expect(page.getByText(warned.reporter.email)).toHaveCount(0)
})

test('a ban closes the account and its email; lifting restores both', async ({ page, baseURL }) => {
  const a = await makeAdmin()
  const { sender, words } = await reported()
  await signInToConsole(page, a.email)
  await page.goto(`${VVS}/vvs`)

  const card = await decide(page, words, 'Remove + ban')
  await card.getByRole('button', { name: 'Apply: Remove + ban' }).click()
  await card.getByRole('button', { name: 'Ban them?' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Banned.' })).toBeVisible()

  // Can't sign in, and is told why.
  const fresh = await page.context().browser()!.newContext()
  const other = await fresh.newPage()
  await other.goto(`${baseURL}/sign-in`)
  await other.getByPlaceholder('your@email.com').fill(sender.email)
  await other.getByPlaceholder('Password').fill(PASSWORD)
  await other.locator('button[type="submit"]').click()
  await expect(other.getByText(/This account has been closed/)).toBeVisible()
  await fresh.close()

  // Can't come back under the same address, tagged or not.
  const [name, domain] = sender.email.split('@')
  const { error: again } = await admin.auth.admin.createUser({ email: `${name}+again@${domain}`, password: PASSWORD, email_confirm: true })
  expect(again).not.toBeNull()

  // Lift it from their profile.
  await page.goto(`${VVS}/vvs/people/${sender.id}`)
  await expect(page.getByText('banned', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Lift ban' }).click()
  await page.getByRole('button', { name: 'Lift it?' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Lifted' })).toBeVisible()
  await asUser(sender.email)
})

test('a block is instant; the admin can keep it or remove it', async ({ page }) => {
  const a = await makeAdmin()
  const sender = await makeUser('vvs-blocked')
  const blocker = await makeUser('vvs-blocker')
  const bottle = await delivered(sender.id, blocker.id, 'A bottle someone didn’t want')
  const c = await asUser(blocker.email)
  ok(await c.rpc('block_bottle_sender', { p_bottle_id: bottle }))
  const blocks = () => admin.from('kayak_blocks').select('blocked_id').eq('blocker_id', blocker.id)
  expect(ok(await blocks())).toHaveLength(1)

  await signInToConsole(page, a.email)
  await page.goto(`${VVS}/vvs`)
  const card = page.getByRole('article').filter({ hasText: `by: ${blocker.id.slice(0, 8)}` })
  await expect(card).toBeVisible()
  await card.getByRole('button', { name: 'Remove block' }).click()
  await card.getByRole('button', { name: 'Remove it?' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Block removed.' })).toBeVisible()
  expect(ok(await blocks())).toHaveLength(0)
})

test('urgent reports come first, and show as urgent', async ({ page }) => {
  const a = await makeAdmin()
  await reported('spam')
  const { words } = await reported('danger')
  await signInToConsole(page, a.email)
  await page.goto(`${VVS}/vvs`)
  const first = page.getByRole('article').first()
  await expect(first.getByText('Urgent', { exact: true })).toBeVisible()
  await expect(caseCard(page, words).getByText('Someone may be in danger')).toBeVisible()
})

test('a profile shows history under a case ID; reveal and flag are logged', async ({ page }) => {
  const a = await makeAdmin()
  const { sender, words } = await reported()
  const secret = await delivered(sender.id, a.id, 'Private words nobody reported')
  expect(secret).toBeTruthy()

  await signInToConsole(page, a.email)
  await page.goto(`${VVS}/vvs/people`)
  await page.getByLabel(/Case ID/).fill(sender.id.slice(0, 18))
  await page.getByRole('button', { name: 'Search' }).click()
  await page.getByRole('link', { name: sender.id.slice(0, 8) }).click()

  await expect(page.getByRole('heading', { name: sender.id.slice(0, 8) })).toBeVisible()
  await expect(page.getByText(words)).toBeVisible()
  await expect(page.getByText('Private words nobody reported')).toHaveCount(0)
  await expect(page.getByText(sender.email)).toHaveCount(0)

  await page.getByRole('button', { name: 'Reveal email' }).click()
  await page.getByRole('button', { name: 'Reveal? This is logged.' }).click()
  await expect(page.getByText(sender.email)).toBeVisible()

  await page.getByLabel('New flag').fill('Watch this one')
  await page.getByRole('button', { name: 'Flag', exact: true }).click()
  await expect(page.getByText('Watch this one').first()).toBeVisible()

  await page.goto(`${VVS}/vvs/log`)
  await expect(page.getByText('reveal email').first()).toBeVisible()
  await expect(page.getByText('flag', { exact: true }).first()).toBeVisible()
})

test('AI holds are a separate tab, without user reports', async ({ page }) => {
  const a = await makeAdmin()
  const { words } = await reported()
  await signInToConsole(page, a.email)
  await page.goto(`${VVS}/vvs/ai-holds`)
  await expect(page.getByRole('heading', { name: 'AI holds' })).toBeVisible()
  await expect(page.getByText(words)).toHaveCount(0)
})

test('on the shelf: reporting takes it away and offers Block sender', async ({ page, baseURL }) => {
  const sender = await makeUser('vvs-shelf-sender')
  const me = await makeUser('vvs-shelf-me')
  const bottle = await delivered(sender.id, me.id, 'Shelf test words')
  await signIn(page, me.email, `${baseURL}/sign-in`)
  await page.goto(`${baseURL}/shelf`)
  await page.getByRole('button', { name: /^Bottle, unopened/ }).click()
  await page.getByLabel('Report this bottle').click()
  await expect(page.getByRole('button', { name: 'Someone may be in danger' })).toBeVisible()
  await page.getByRole('button', { name: 'Block sender' }).click()
  await expect(page.getByText(/Blocked\. You won.t get bottles/)).toBeVisible()
  expect(ok(await admin.from('kayak_blocks').select('blocked_id').eq('blocker_id', me.id).single()).blocked_id).toBe(sender.id)
  expect(bottle).toBeTruthy()
})
