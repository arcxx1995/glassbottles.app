import { expect, test } from '@playwright/test'
import { admin, makeKeeper, makeUser, signIn, stubCheck } from './helpers'

// The Harbour (migration 063): the same screen for everyone, building and
// launching a Kayak, a visit with its gem and comment, and the owner's controls.
// CI has no edge runtime, so the screen never answers on its own: tests pass
// verdicts in themselves, through the same RPC the screen uses.

test.skip(process.env.NEXT_PUBLIC_KEEPER !== 'on', 'Keeper is off in this build')

const LOOK = { vessel: 'canoe', color: 'sky_deep', pattern: 'waves', paddle: 'canoe_paddle', deck: { mid: 'cat' } }
const NOTE = 'What did the sea teach you?'

/** A paid member past their trial. */
async function keeper(tag: string) {
  const u = await makeUser(tag)
  await makeKeeper(u.id)
  const { error } = await admin
    .from('memberships')
    .update({ keeper_since: new Date(Date.now() - 40 * 864e5).toISOString() })
    .eq('user_id', u.id)
  if (error) throw error
  return u
}

const ok = <T,>({ data, error }: { data: T; error: { message: string } | null }) => {
  if (error) throw new Error(error.message)
  return data as NonNullable<T>
}

/** `owner`'s Kayak, passed screening, sitting in `recipient`'s harbour. */
async function visiting(ownerId: string, recipientId: string, gems = 3, city: string | null = null) {
  const kayak = ok(await admin.from('kayaks').insert({ owner_id: ownerId, look: LOOK }).select('id').single())
  const voyage = ok(await admin.from('voyages').insert({ kayak_id: kayak.id, owner_id: ownerId, state: 'visiting' }).select('id').single())
  ok(await admin.from('kayak_notes').insert({ voyage_id: voyage.id, owner_id: ownerId, body: NOTE, screen: 'ok' }))
  ok(
    await admin.from('gems').insert(
      Array.from({ length: gems }, () => ({
        seed: Math.floor(Math.random() * 238878720),
        owner_id: ownerId,
        kayak_id: kayak.id,
        state: 'aboard',
      })),
    ),
  )
  const visit = ok(
    await admin.from('kayak_visits').insert({ voyage_id: voyage.id, owner_id: ownerId, recipient_id: recipientId, city }).select('id').single(),
  )
  return { kayak: kayak.id, voyage: voyage.id, visit: visit.id }
}

test('a free member sees the same harbour; building opens the plans', async ({ page }) => {
  const u = await makeUser('harbour-free')
  await signIn(page, u.email)
  await page.goto('/harbour')
  await expect(page.getByRole('heading', { name: 'The Harbour' })).toBeVisible()
  await expect(page.getByRole('link', { name: /visiting Kayak/ })).toHaveCount(0)
  await page.getByRole('button', { name: 'Build your Kayak' }).click()
  await expect(page.getByRole('dialog').getByText('Kayaks are for Keepers')).toBeVisible()
  await expect(page.getByRole('dialog').getByRole('button', { name: /free trial|Monthly|Yearly|Keeper/ }).first()).toBeVisible()
})

test('a Keeper builds, fills and launches a Kayak; it waits for the screen', async ({ page }) => {
  const u = await keeper('kayak-builder')
  await signIn(page, u.email)
  await page.goto('/harbour')
  await page.getByRole('button', { name: 'Build your Kayak' }).click()

  await page.getByRole('button', { name: 'Rowing boat' }).click()
  await page.getByRole('button', { name: 'stripes' }).click()
  await page.getByLabel('At the bow').selectOption('lantern')
  await page.getByRole('button', { name: 'Build it' }).click()
  await expect(page.getByRole('heading', { name: 'Fill it with gems' })).toBeVisible()

  await page.getByRole('button', { name: 'Get gemstones' }).click()
  await expect(page.getByRole('list', { name: 'Gems aboard' }).getByRole('listitem')).toHaveCount(10)

  // Taking one out returns it to stock, so asking again doesn't spend new allowance.
  await page.getByRole('button', { name: /^Take out / }).first().click()
  await expect(page.getByRole('list', { name: 'Gems aboard' }).getByRole('listitem')).toHaveCount(9)

  await page.getByLabel('A note, or a question, for whoever finds it').fill(NOTE)
  await page.getByRole('button', { name: 'Launch' }).click()
  await expect(page).toHaveURL(/\/harbour$/)

  const kayak = ok(await admin.from('kayaks').select('id, look').eq('owner_id', u.id).single())
  expect(kayak.look).toMatchObject({ vessel: 'rowing_boat', pattern: 'stripes', deck: { bow: 'lantern' } })
  const voyage = ok(await admin.from('voyages').select('id, state').eq('kayak_id', kayak.id).single())
  expect(voyage.state).toBe('screening')
  const note = ok(await admin.from('kayak_notes').select('id, screen').eq('voyage_id', voyage.id).single())
  expect(note.screen).toBeNull()

  // The screen passes it: now it's at sea, not at the mast.
  ok(await admin.rpc('apply_kayak_screen', { p_table: 'kayak_notes', p_id: note.id, p_verdict: 'ok' }))
  await page.reload()
  await expect(page.getByRole('link', { name: /Your Kayak is sailing/ })).toBeVisible()
})

test('a trial member gets 5 gems', async ({ page }) => {
  const u = await makeUser('kayak-trial')
  await makeKeeper(u.id) // keeper_since is now, so still within the 7-day trial
  await signIn(page, u.email)
  await page.goto('/harbour/kayak/new')
  await page.getByRole('button', { name: 'Build it' }).click()
  await expect(page.getByText('5 left this month.')).toBeVisible()
})

test('a held note can’t launch, and a crisis note gets helplines', async ({ page }) => {
  const u = await keeper('kayak-held')
  await signIn(page, u.email)
  await page.goto('/harbour/kayak/new')
  await page.getByRole('button', { name: 'Build it' }).click()
  await page.getByRole('button', { name: 'Get gemstones' }).click()

  await stubCheck(page, { verdict: 'held', reason: 'contact' })
  await page.getByLabel('A note, or a question, for whoever finds it').fill('my number is on instagram')
  await expect(page.getByRole('alert').filter({ hasText: 'Kayaks stay anonymous' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Launch' })).toBeDisabled()

  await stubCheck(page, { verdict: 'crisis' })
  await page.getByLabel('A note, or a question, for whoever finds it').fill('i cannot carry on any more')
  await expect(page.getByText('You don’t have to carry this alone.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Launch' })).toBeDisabled()
})

test('a visit: read, pick a gem, comment, and it sails on', async ({ page }) => {
  const owner = await keeper('kayak-owner')
  const me = await keeper('kayak-visited')
  const { visit, voyage } = await visiting(owner.id, me.id)

  await signIn(page, me.email)
  await page.goto('/harbour')
  await page.getByRole('link', { name: 'A visiting Kayak' }).click()
  await expect(page.getByText(NOTE)).toBeVisible()
  await expect(page.getByText('Nobody has answered yet')).toBeVisible()
  await expect(page.getByRole('radio')).toHaveCount(3)

  // Needs a gem and enough words.
  const send = page.getByRole('button', { name: 'Keep it and send it on' })
  await expect(send).toBeDisabled()
  await page.getByRole('radio').first().click()
  await page.getByLabel('In return, a few words').fill('Patience, mostly. And tides.')
  await send.click()
  await expect(page).toHaveURL(/\/harbour$/)

  // Moved at once, with the delay; the comment isn't public yet.
  expect(ok(await admin.from('voyages').select('state').eq('id', voyage).single()).state).toBe('sailing')
  const comment = ok(await admin.from('kayak_comments').select('id, screen').eq('visit_id', visit).single())
  expect(comment.screen).toBeNull()

  await page.goto('/harbour/treasure')
  await expect(page.getByText('On its way to you')).toBeVisible()

  ok(await admin.rpc('apply_kayak_screen', { p_table: 'kayak_comments', p_id: comment.id, p_verdict: 'ok' }))
  await page.reload()
  await expect(page.getByText(/^Found /)).toBeVisible()
  await expect(page.getByText('“Patience, mostly. And tides.”')).toBeVisible()
})

test('a comment the live filter holds can’t be sent', async ({ page }) => {
  const owner = await keeper('kayak-owner2')
  const me = await keeper('kayak-visited2')
  const { visit } = await visiting(owner.id, me.id)
  await signIn(page, me.email)
  await page.goto(`/harbour/visit/${visit}`)
  await page.getByRole('radio').first().click()
  await stubCheck(page, { verdict: 'held', reason: 'harm' })
  await page.getByLabel('In return, a few words').fill('something cruel and long enough')
  await expect(page.getByRole('alert').filter({ hasText: 'hurtful or threatening' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Keep it and send it on' })).toBeDisabled()
  expect(ok(await admin.from('kayak_comments').select('id').eq('visit_id', visit))).toHaveLength(0)
})

test('let it sail, report and block each send the Kayak on its way', async ({ page }) => {
  const owner = await keeper('kayak-owner3')
  const me = await keeper('kayak-visited3')
  await signIn(page, me.email)

  const a = await visiting(owner.id, me.id)
  await page.goto(`/harbour/visit/${a.visit}`)
  await page.getByRole('button', { name: /^Let it sail/ }).click()
  await expect(page).toHaveURL(/\/harbour$/)
  expect(ok(await admin.from('kayak_visits').select('left_reason').eq('id', a.visit).single()).left_reason).toBe('waved')

  const b = await visiting(owner.id, me.id)
  await page.goto(`/harbour/visit/${b.visit}`)
  await page.getByRole('button', { name: 'Report or block' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Abusive' }).click()
  await expect(page).toHaveURL(/\/harbour$/)
  // 065: it leaves this harbour and keeps sailing; the rest waits for an admin.
  expect(ok(await admin.from('voyages').select('state, end_reason').eq('id', b.voyage).single())).toEqual({
    state: 'sailing',
    end_reason: null,
  })
  expect(ok(await admin.from('kayak_visits').select('left_reason').eq('id', b.visit).single()).left_reason).toBe('reported')

  const c = await visiting(owner.id, me.id)
  await page.goto(`/harbour/visit/${c.visit}`)
  await page.getByRole('button', { name: 'Report or block' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Block', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Block?' }).click()
  await expect(page).toHaveURL(/\/harbour$/)
  expect(ok(await admin.from('kayak_blocks').select('blocked_id').eq('blocker_id', me.id).single()).blocked_id).toBe(owner.id)
})

test('the owner sees the city, changes the note, and calls it home', async ({ page }) => {
  const owner = await keeper('kayak-owner4')
  const other = await keeper('kayak-visited4')
  const { kayak, voyage, visit } = await visiting(owner.id, other.id, 3, 'Lisbon')

  await signIn(page, owner.email)
  await page.goto('/harbour')
  await expect(page.getByText('Your Kayak is somewhere near Lisbon')).toBeVisible()
  await page.goto(`/harbour/kayak/${kayak}`)
  await expect(page.getByRole('heading', { name: 'Your Kayak is somewhere near Lisbon' })).toBeVisible()

  await page.getByRole('button', { name: /^Change the note/ }).click()
  await page.getByRole('dialog').getByLabel('New note').fill('A better question?')
  await page.getByRole('dialog').getByRole('button', { name: 'Send the new note' }).click()
  await expect(page.getByText('Your new note is being checked.')).toBeVisible()
  // The old note stays live until it passes.
  await expect(page.getByRole('blockquote')).toHaveText(NOTE)

  await page.getByRole('button', { name: 'Call it home', exact: true }).click()
  await page.getByRole('button', { name: 'Call it home?' }).click()
  await expect(page.getByRole('heading', { name: 'Your Kayak is sailing home' })).toBeVisible()
  expect(ok(await admin.from('kayak_visits').select('left_reason').eq('id', visit).single()).left_reason).toBe('recalled')
  expect(ok(await admin.from('voyages').select('end_reason').eq('id', voyage).single()).end_reason).toBe('recalled')
})

test('a lapsed Keeper keeps their treasure room and Kayak, but can’t launch', async ({ page }) => {
  const u = await keeper('kayak-lapsed')
  ok(await admin.from('kayaks').insert({ owner_id: u.id, look: LOOK }))
  ok(await admin.from('gems').insert({ seed: Math.floor(Math.random() * 238878720), holder_id: u.id, state: 'kept', kept_at: new Date().toISOString() }))
  ok(await admin.from('memberships').update({ access_until: new Date(Date.now() - 864e5).toISOString() }).eq('user_id', u.id))

  await signIn(page, u.email)
  await page.goto('/harbour')
  await expect(page.getByRole('link', { name: 'Your Kayak 1' })).toBeVisible()
  await page.getByRole('link', { name: 'Your Kayak 1' }).click()
  await expect(page.getByText('Your Keeper membership has ended.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Launch' })).toBeDisabled()

  await page.goto('/harbour/treasure')
  await expect(page.getByText(/^Found /)).toBeVisible()
})

test.describe('the layout', () => {
  const box = async (l: import('@playwright/test').Locator) => {
    const b = await l.boundingBox()
    if (!b) throw new Error('not on screen')
    return b
  }

  for (const [width, height] of [[320, 568], [390, 844], [1440, 900]] as const) {
    test(`at ${width}px the title is centred, clear of the wordmark; the mast sits above the button; treasure on the right`, async ({ page, isMobile }) => {
      test.skip(isMobile && width > 500, 'no phone is this wide')
      const u = await makeUser('harbour-layout')
      await signIn(page, u.email)
      await page.setViewportSize({ width, height })
      for (const [path, title] of [['/harbour', 'The Harbour'], ['/sea', 'The Sea'], ['/shelf', 'The Shelf']]) {
        await page.goto(path)
        const heading = await box(page.getByRole('heading', { name: title, exact: true }))
        expect(Math.abs(heading.x + heading.width / 2 - width / 2)).toBeLessThanOrEqual(1)
        const mark = await box(page.getByText('glassbottles', { exact: true }))
        expect(mark.x + mark.width).toBeLessThan(heading.x)
        expect(Math.abs(mark.y + mark.height / 2 - (heading.y + heading.height / 2))).toBeLessThanOrEqual(4)
      }

      await page.goto('/harbour')
      const build = await box(page.getByRole('button', { name: 'Build your Kayak' }))
      const mast = await box(page.getByTestId('mast'))
      expect(Math.abs(mast.x + mast.width / 2 - (build.x + build.width / 2))).toBeLessThanOrEqual(1)
      const gap = build.y - (mast.y + mast.height)
      expect(gap).toBeGreaterThanOrEqual(0)
      expect(gap).toBeLessThan(80)

      const chest = await box(page.getByRole('link', { name: /treasure room/ }))
      expect(width - (chest.x + chest.width)).toBeLessThanOrEqual(24)
      expect(chest.y).toBeGreaterThanOrEqual(56)
    })
  }

  test('a Kayak’s screen fills the window, and the close button goes back to the Harbour', async ({ page }) => {
    const u = await keeper('kayak-frame')
    await signIn(page, u.email)
    await page.goto('/harbour/kayak/new')
    await expect(page.getByRole('heading', { name: 'Build your Kayak' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Harbour' })).toHaveCount(0)
    await expect(page.getByText('glassbottles', { exact: true })).toHaveCount(0)
    await page.getByRole('link', { name: 'Close' }).click()
    await expect(page).toHaveURL(/\/harbour$/)
    await expect(page.getByRole('link', { name: 'Harbour' })).toBeVisible()
  })

  test('the plans fill the screen', async ({ page }) => {
    const u = await makeUser('harbour-plans')
    await signIn(page, u.email)
    await page.goto('/harbour')
    await page.getByRole('button', { name: 'Build your Kayak' }).click()
    const size = page.viewportSize()!
    // Polled: it scales up as it opens.
    await expect.poll(async () => (await box(page.getByRole('dialog'))).width).toBe(size.width)
    await expect.poll(async () => (await box(page.getByRole('dialog'))).height).toBe(size.height)
  })
})
