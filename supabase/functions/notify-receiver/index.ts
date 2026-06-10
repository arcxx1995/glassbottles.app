import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ── Config ────────────────────────────────────────────────────────────────────
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!
const FROM_ADDRESS = Deno.env.get('RESEND_FROM_ADDRESS') ?? 'glassbottles <hello@glassbottles.app>'

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

// ── Types ─────────────────────────────────────────────────────────────────────
interface RequestBody {
  bottle_id: string
}

interface ResendError {
  statusCode?: number
  message?: string
}

// ── Handler ───────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  // ── 0. Caller auth — service role key required ────────────────────────────
  // This function mutates the bottles table (email_notified_at) and sends email.
  // It must only be reachable from trusted internal callers: match-bottle edge
  // function and the pg_cron retry path via pg_net.
  const authHeader = req.headers.get('Authorization')
  const token = authHeader?.replace('Bearer ', '')
  if (token !== SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  // ── 1. Parse body ─────────────────────────────────────────────────────────
  let body: RequestBody
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const { bottle_id } = body
  if (!bottle_id) {
    return new Response(JSON.stringify({ error: 'bottle_id required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // ── 2. Fetch bottle — verify it exists, has a receiver, and is not yet notified
  // email_notified_at IS NULL is the idempotency guard: if it is already set,
  // a previous invocation already sent the email. Return 200 without re-sending.
  const { data: bottle, error: bottleErr } = await supabase
    .from('bottles')
    .select('id, receiver_id, email_notified_at')
    .eq('id', bottle_id)
    .single()

  if (bottleErr || !bottle) {
    return new Response(JSON.stringify({ error: 'bottle not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  if (!bottle.receiver_id) {
    // Bottle not yet matched — caller invoked too early
    return new Response(
      JSON.stringify({ notified: false, reason: 'no receiver assigned yet' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }

  // Idempotency: already notified — do not re-send
  if (bottle.email_notified_at !== null) {
    return new Response(
      JSON.stringify({ notified: true, reason: 'already notified', notified_at: bottle.email_notified_at }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }

  // ── 3. Fetch receiver's auth email via admin API ──────────────────────────
  // auth.users is not exposed to the public schema. The admin API (service role)
  // is the correct way to read it. We never log the email.
  const { data: userData, error: userErr } = await supabase.auth.admin.getUserById(
    bottle.receiver_id
  )

  if (userErr || !userData?.user?.email) {
    // No email on record — skip silently rather than failing the match
    console.error('[notify-receiver] could not fetch receiver email:', userErr?.message ?? 'no email on user')
    return new Response(
      JSON.stringify({ notified: false, reason: 'no email address on record' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const receiverEmail = userData.user.email

  // ── 4. Send via Resend HTTP API (no npm package needed in Deno) ──────────
  const resendRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM_ADDRESS,
      to: [receiverEmail],
      subject: 'A bottle washed up 🫙',
      html: `
        <p>Hey,</p>
        <p>Someone sent you a message in a bottle. Open the app to read it — don't leave them drifting.</p>
        <p style="margin-top:32px;font-size:0.85em;color:#888;">
          You're getting this because someone sent you a glassbottle.
          If you no longer want email notifications, you can turn them off in your account settings.
        </p>
      `,
      text: `Someone sent you a message. Open glassbottles.app to read it.`,
    }),
  })

  if (!resendRes.ok) {
    let errBody: ResendError = {}
    try {
      errBody = await resendRes.json()
    } catch { /* non-JSON error body */ }
    console.error('[notify-receiver] Resend error:', resendRes.status, errBody?.message)
    return new Response(
      JSON.stringify({ notified: false, reason: 'email delivery failed', status: resendRes.status }),
      { status: 502, headers: { 'Content-Type': 'application/json' } }
    )
  }

  // ── 5. Mark bottle as notified — idempotency stamp ───────────────────────
  // Only stamp if still NULL (a concurrent invocation could have beaten us
  // between step 2 and here — the IS NULL guard makes this a safe no-op if so).
  const { error: stampErr } = await supabase
    .from('bottles')
    .update({ email_notified_at: new Date().toISOString() })
    .eq('id', bottle_id)
    .is('email_notified_at', null)

  if (stampErr) {
    // Email was sent but we couldn't stamp. Log it — on retry the idempotency
    // check will miss (still NULL) and Resend will get a duplicate send.
    // Resend deduplication is not relied on; this is a known v1 edge case.
    console.error('[notify-receiver] failed to stamp email_notified_at:', stampErr.message)
  }

  return new Response(
    JSON.stringify({ notified: true }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  )
})
