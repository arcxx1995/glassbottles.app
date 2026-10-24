import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

// push-notify — Web Push for bottle events (migration 044).
//
// Called by the on_bottle_push trigger through pg_net, once per transition:
//   matched → the receiver: "a bottle washed ashore"; the sender: "your bottle
//             was found"
//   ripple  → the sender: "your bottle reached someone"
//   future  → the writer: "a bottle from your past washed back" (047)
// Payloads never carry the other person or the words — a generic line and a
// deep link. Endpoints the push service has retired (404/410) are pruned.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY')
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY')
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:hello@glassbottles.app'

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)
}

type Payload = { title: string; body: string; url: string }

const WASHED_ASHORE: Payload = {
  title: 'A bottle washed ashore',
  body: 'A stranger’s words just drifted to you.',
  url: '/inbox',
}
const FOUND: Payload = {
  title: 'Your bottle was found',
  body: 'Somewhere, a stranger is reading your words.',
  url: '/sea',
}
const RIPPLE: Payload = {
  title: 'Your bottle reached someone',
  body: 'A stranger let you know your words landed.',
  url: '/sea',
}

const FROM_THE_PAST: Payload = {
  title: 'A bottle from your past washed back',
  body: 'Something you wrote to yourself has arrived.',
  url: '/inbox',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

async function pushToUser(userId: string, payload: Payload) {
  const { data: subs } = await supabase
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth')
    .eq('user_id', userId)
  await Promise.all(
    (subs ?? []).map(async (s: { endpoint: string; p256dh: string; auth: string }) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify(payload),
        )
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode
        if (status === 404 || status === 410) {
          await supabase.from('push_subscriptions').delete().eq('endpoint', s.endpoint)
        } else {
          console.error('[push-notify] send failed:', status ?? (err as Error).message)
        }
      }
    }),
  )
}

Deno.serve(async (req) => {
  if (req.headers.get('Authorization')?.replace('Bearer ', '') !== SERVICE_ROLE_KEY) {
    return json({ error: 'Unauthorized' }, 401)
  }
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return json({ pushed: false, reason: 'VAPID not configured' })

  const { bottle_id, future_id, event } = (await req.json().catch(() => ({}))) as {
    bottle_id?: string
    future_id?: string
    event?: string
  }

  if (event === 'future' && future_id) {
    const { data: future } = await supabase
      .from('future_bottles')
      .select('user_id')
      .eq('id', future_id)
      .single()
    if (!future) return json({ error: 'future bottle not found' }, 404)
    await pushToUser(future.user_id, FROM_THE_PAST)
    return json({ pushed: true })
  }

  if (!bottle_id || (event !== 'matched' && event !== 'ripple')) {
    return json({ error: 'bottle_id and event required' }, 400)
  }

  // Service role: ids stay server-side, never in a payload.
  const { data: bottle, error } = await supabase
    .from('bottles')
    .select('sender_id, receiver_id')
    .eq('id', bottle_id)
    .single()
  if (error || !bottle) return json({ error: 'bottle not found' }, 404)

  const sends: Promise<void>[] = []
  if (event === 'matched') {
    if (bottle.receiver_id) sends.push(pushToUser(bottle.receiver_id, WASHED_ASHORE))
    if (bottle.sender_id) sends.push(pushToUser(bottle.sender_id, FOUND))
  } else if (bottle.sender_id) {
    sends.push(pushToUser(bottle.sender_id, RIPPLE))
  }
  await Promise.all(sends)
  return json({ pushed: true })
})
