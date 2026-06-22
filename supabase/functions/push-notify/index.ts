import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

// ── Config ────────────────────────────────────────────────────────────────────
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY')!
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY')!
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:hello@glassbottles.app'

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)

// ── Types ─────────────────────────────────────────────────────────────────────
interface RequestBody {
  bottle_id: string
}

interface PushSub {
  endpoint: string
  p256dh: string
  auth: string
}

// Anonymity-safe payloads. Neither carries the counterpart's identity — only a
// generic line + a deep link. The receiver gets "a bottle arrived"; the sender
// gets the headline "your bottle was found".
function payloadFor(role: 'receiver' | 'sender') {
  return role === 'receiver'
    ? {
        title: '🫙 A bottle washed up',
        body: "Someone's message just drifted to you. Open to read it.",
        url: '/inbox',
      }
    : {
        title: '🌊 Your bottle was found',
        body: 'Somewhere, a stranger just read your words.',
        url: '/home',
      }
}

// Send to every subscription a user has; prune endpoints the push service has
// retired (404/410) so the table doesn't accumulate dead rows.
async function pushToUser(userId: string, role: 'receiver' | 'sender') {
  const { data: subs } = await supabase
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth')
    .eq('user_id', userId)

  if (!subs || subs.length === 0) return

  const payload = JSON.stringify(payloadFor(role))

  await Promise.all(
    (subs as PushSub[]).map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
        )
      } catch (err) {
        const statusCode = (err as { statusCode?: number })?.statusCode
        if (statusCode === 404 || statusCode === 410) {
          await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
        } else {
          console.error('[push-notify] send failed:', statusCode ?? (err as Error).message)
        }
      }
    }),
  )
}

// ── Handler ───────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  // Only trusted internal callers (the matcher cron via pg_net).
  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (token !== SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  let body: RequestBody
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  if (!body.bottle_id) {
    return new Response(JSON.stringify({ error: 'bottle_id required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Service role bypasses the column ACL — reading sender_id/receiver_id here is
  // server-side only and never returned to a client.
  const { data: bottle, error } = await supabase
    .from('bottles')
    .select('id, sender_id, receiver_id')
    .eq('id', body.bottle_id)
    .single()

  if (error || !bottle) {
    return new Response(JSON.stringify({ error: 'bottle not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  if (!bottle.receiver_id) {
    return new Response(
      JSON.stringify({ pushed: false, reason: 'no receiver yet' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  }

  await Promise.all([
    pushToUser(bottle.receiver_id, 'receiver'),
    bottle.sender_id ? pushToUser(bottle.sender_id, 'sender') : Promise.resolve(),
  ])

  return new Response(JSON.stringify({ pushed: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
})
