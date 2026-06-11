import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

Deno.serve(async (req) => {
  // ── 0. Caller auth — service role key required ────────────────────────────
  // This function uses the service role client and must only be callable by
  // trusted internal callers (api/bottles/send, pg_cron retry). Any HTTP
  // client that does not present the service role key is rejected immediately.
  const authHeader = req.headers.get('Authorization')
  const token = authHeader?.replace('Bearer ', '')
  if (token !== Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  const { bottle_id } = await req.json()
  if (!bottle_id) {
    return new Response(JSON.stringify({ error: 'bottle_id required' }), { status: 400 })
  }

  // ── 1. Fetch bottle — verify it exists and is unmatched ──────────────────────
  const { data: bottle, error: bottleErr } = await supabase
    .from('bottles')
    .select('id, sender_id, day_key, received_at')
    .eq('id', bottle_id)
    .single()

  if (bottleErr || !bottle) {
    return new Response(JSON.stringify({ error: 'bottle not found' }), { status: 404 })
  }

  // Idempotent: already matched
  if (bottle.received_at !== null) {
    return new Response(
      JSON.stringify({ matched: true, reason: 'already matched' }),
      { status: 200 }
    )
  }

  // ── 2. Find eligible receiver (two-step — no template literal SQL) ───────────
  //
  // Step 2a: fetch user_ids who already received today via parameterised filters.
  // Avoids the original template-literal subquery `'${bottle.day_key}'` which,
  // while low-risk (value comes from DB), is a forbidden pattern in this codebase.
  const { data: receivedToday } = await supabase
    .from('daily_quotas')
    .select('user_id')
    .eq('date', bottle.day_key)
    .eq('has_received', true)

  // Build exclusion set: sender + everyone who already received today.
  // UUIDs are hex + hyphens only ([0-9a-f-]) — no SQL injection surface.
  const excludedIds: string[] = [
    bottle.sender_id,
    ...(receivedToday?.map((r: { user_id: string }) => r.user_id) ?? []),
  ]

  // Step 2b: find a receiver not in the exclusion set.
  const { data: receivers } = await supabase
    .from('profiles')
    .select('id')
    .not('id', 'in', `(${excludedIds.join(',')})`)
    .limit(20)

  if (!receivers || receivers.length === 0) {
    return new Response(
      JSON.stringify({ matched: false, queued: true, reason: 'no eligible receiver today' }),
      { status: 200 }
    )
  }

  const receiver = receivers[Math.floor(Math.random() * receivers.length)]

  // ── 3. Assign receiver — idempotent guard: only update if still unmatched ────
  //
  // Race note: two concurrent invocations can select the same receiver in step 2b
  // before either UPDATE fires. Only the first UPDATE wins (IS NULL predicate).
  // The second hits 0 rows — harmless; it returns a stale "matched: true" (the
  // bottle is already matched, just not by this invocation). The SQL retry cron
  // (migration 006) runs inside a single transaction and closes this window for
  // the retry path. For the edge-function path, this tiny window is accepted v1.
  const { error: updateErr } = await supabase
    .from('bottles')
    .update({ receiver_id: receiver.id, received_at: new Date().toISOString() })
    .eq('id', bottle_id)
    .is('received_at', null)

  if (updateErr) {
    return new Response(
      JSON.stringify({ error: 'failed to assign receiver' }),
      { status: 500 }
    )
  }

  // ── 4. Update receiver daily quota ───────────────────────────────────────────
  await supabase.from('daily_quotas').upsert(
    { user_id: receiver.id, date: bottle.day_key, has_received: true },
    { onConflict: 'user_id,date' }
  )

  // ── 5. Fire-and-forget: notify receiver by email ──────────────────────────
  // Invoke notify-receiver with the service role key so it accepts the call.
  // Failures are swallowed — the pg_cron retry path in migration 011 will
  // also attempt notification for any bottle where email_notified_at IS NULL.
  const notifyUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/notify-receiver`
  fetch(notifyUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ bottle_id: bottle_id }),
  }).catch((err) => {
    console.error('[match-bottle] notify-receiver invoke failed:', err?.message)
  })

  return new Response(
    JSON.stringify({ matched: true }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  )
})
