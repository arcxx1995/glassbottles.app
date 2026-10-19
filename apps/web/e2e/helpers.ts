import { createClient } from '@supabase/supabase-js'
import { expect, type Page } from '@playwright/test'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

// The suite creates users and rewrites quotas — never point it at a real project.
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url) || !serviceKey) {
  throw new Error(`e2e needs a LOCAL Supabase (got "${url}"). Run supabase start.`)
}

export const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

export const PASSWORD = 'bottle-pass-e2e-1'

/** Whether email+password signs in — on a throwaway client, so the shared
 *  service-role `admin` client never picks up a user session. */
export async function canSignIn(email: string, password: string) {
  const c = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '', {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return !(await c.auth.signInWithPassword({ email, password })).error
}

/** A fresh confirmed (or unconfirmed) user with a known timezone. */
export async function makeUser(name: string, opts: { timezone?: string; confirmed?: boolean } = {}) {
  const email = `${name}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: opts.confirmed ?? true,
  })
  if (error || !data.user) throw error ?? new Error('createUser failed')
  if (opts.timezone) {
    const { error: tzErr } = await admin
      .from('profiles')
      // Stamping the cooldown pins the zone: otherwise the browser's own zone
      // (AuthProvider sync) would replace it on first sign-in.
      .update({ timezone: opts.timezone, timezone_changed_at: new Date().toISOString() })
      .eq('id', data.user.id)
    if (tzErr) throw tzErr
  }
  return { id: data.user.id, email }
}

export async function signIn(page: Page, email: string, path = '/sign-in') {
  await page.goto(path)
  await page.getByPlaceholder('your@email.com').fill(email)
  await page.getByPlaceholder('Password').fill(PASSWORD)
  await page.locator('button[type="submit"]').click()
  // Let sign-in's own client-side navigation finish before the test navigates,
  // or a following page.goto() races it.
  await page.waitForURL((u) => !u.pathname.startsWith('/sign-in'))
  await page.waitForLoadState('networkidle')
}

/**
 * Make `receiverId` the only possible match: every other profile is marked as
 * having received a bottle for yesterday, today and tomorrow (covers every
 * timezone's local date).
 */
export async function isolateReceiver(receiverId: string) {
  const { data: profiles, error } = await admin.from('profiles').select('id')
  if (error) throw error
  const days = [-1, 0, 1].map((d) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10))
  const rows = profiles!
    .filter((p) => p.id !== receiverId)
    .flatMap((p) => days.map((date) => ({ user_id: p.id, date, has_sent: false, has_received: true })))
  if (rows.length) {
    const { error: upErr } = await admin
      .from('daily_quotas')
      .upsert(rows, { onConflict: 'user_id,date', ignoreDuplicates: false })
    if (upErr) throw upErr
  }
  await admin.from('daily_quotas').delete().eq('user_id', receiverId)
}

/** Skip the 1-hour adrift rule for a sender's bottles and run one cron tick. */
export async function deliverNow(senderId: string) {
  // Every other adrift bottle (left by earlier tests) goes back under the
  // 1-hour rule, so this tick can only match the sender's.
  const { error: holdErr } = await admin
    .from('bottles')
    .update({ sent_at: new Date().toISOString() })
    .neq('sender_id', senderId)
    .is('received_at', null)
  if (holdErr) throw holdErr
  const { error } = await admin
    .from('bottles')
    .update({ sent_at: new Date(Date.now() - 2 * 3_600_000).toISOString() })
    .eq('sender_id', senderId)
    .is('received_at', null)
  if (error) throw error
  const { data, error: rpcErr } = await admin.rpc('retry_unmatched_bottles')
  if (rpcErr) throw rpcErr
  return data as number
}

export async function expectPath(page: Page, path: string | RegExp) {
  await expect(page).toHaveURL(typeof path === 'string' ? new RegExp(`${path.replace(/[?]/g, '\\?')}$`) : path)
}
