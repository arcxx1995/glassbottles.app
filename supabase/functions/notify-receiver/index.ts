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
  // It must only be reachable from trusted internal callers: the pg_cron retry
  // path (retry_unmatched_bottles) via pg_net.
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

  // ── 2b. Honour the receiver's email-notification preference ───────────────
  // profiles.email_notifications (migration 018). FALSE = the user opted out
  // in settings; skip the send. NOT stamped as notified — if they re-enable
  // notifications later, the retry cron can still reach them for this bottle.
  const { data: pref } = await supabase
    .from('profiles')
    .select('email_notifications')
    .eq('id', bottle.receiver_id)
    .single()

  if (pref && pref.email_notifications === false) {
    return new Response(
      JSON.stringify({ notified: false, reason: 'receiver opted out' }),
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

  // ── 4. Claim the send BEFORE emailing (atomic idempotency) ───────────────
  // Stamp email_notified_at with an IS NULL guard and read back the affected
  // row. Exactly one invocation wins the claim; any concurrent caller (edge fn
  // vs cron) sees 0 rows and bails without sending. This closes the prior
  // window where send-then-stamp could double-send: if the stamp failed after
  // a successful send, a retry re-sent. Now the stamp happens first; on send
  // failure we release it so a later retry can try again.
  const claimedAt = new Date().toISOString()
  const { data: claimed, error: claimErr } = await supabase
    .from('bottles')
    .update({ email_notified_at: claimedAt })
    .eq('id', bottle_id)
    .is('email_notified_at', null)
    .select('id')

  if (claimErr) {
    console.error('[notify-receiver] failed to claim send:', claimErr.message)
    return new Response(
      JSON.stringify({ notified: false, reason: 'claim failed' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }

  if (!claimed || claimed.length === 0) {
    // Another invocation already claimed (and is sending / has sent) this bottle.
    return new Response(
      JSON.stringify({ notified: true, reason: 'already claimed' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }

  // ── 5. Send via Resend HTTP API (no npm package needed in Deno) ──────────
  // pg_net dispatches a cron tick's posts as one burst (they all commit
  // together), so concurrent invocations can trip Resend's ~2 req/s limit.
  // A 429 is a definite non-send — retry it here with jittered backoff
  // (1s/2s/4s) instead of releasing the claim and burning a 15-min cron
  // retry (and one of the 8 capped attempts) per collision.
  const sendOnce = () => fetch('https://api.resend.com/emails', {
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
        <p>You received a message in a bottle. Open the app to read it — don't leave them drifting.</p>
        <p style="margin-top:32px;font-size:0.85em;color:#888;">
          You're getting this because someone sent you a glassbottle.
          If you no longer want email notifications, you can turn them off in your account settings.
        </p>
      `,
      text: `Someone sent you a message. Open glassbottles.app to read it.`,
    }),
  })

  let resendRes = await sendOnce()
  for (let attempt = 0; resendRes.status === 429 && attempt < 3; attempt++) {
    await new Promise((r) => setTimeout(r, (2 ** attempt) * 1000 + Math.random() * 500))
    resendRes = await sendOnce()
  }

  if (!resendRes.ok) {
    let errBody: ResendError = {}
    try {
      errBody = await resendRes.json()
    } catch { /* non-JSON error body */ }
    console.error('[notify-receiver] Resend error:', resendRes.status, errBody?.message)

    // Release the claim ONLY on a definite non-send (4xx: rejected, rate
    // limited, validation error) so the retry cron re-attempts. A 5xx is
    // ambiguous — Resend may have delivered before failing — so the claim
    // stays and the email is not retried: we prefer a missed email over a
    // duplicate. Release is guarded to our own claim timestamp so we never
    // clobber a concurrent claim; if the release itself fails, the bottle
    // stays stamped (same missed-over-duplicate preference).
    if (resendRes.status < 500) {
      const { error: releaseErr } = await supabase
        .from('bottles')
        .update({ email_notified_at: null })
        .eq('id', bottle_id)
        .eq('email_notified_at', claimedAt)
      if (releaseErr) {
        console.error('[notify-receiver] failed to release claim:', releaseErr.message)
      }
    }

    return new Response(
      JSON.stringify({ notified: false, reason: 'email delivery failed', status: resendRes.status }),
      { status: 502, headers: { 'Content-Type': 'application/json' } }
    )
  }

  // Email sent and the claim (step 4) already stamped email_notified_at —
  // nothing more to persist. The claim-before-send order guarantees at-most-once.
  return new Response(
    JSON.stringify({ notified: true }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  )
})
