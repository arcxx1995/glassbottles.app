import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

// Outcome shape returned by the public.match_bottle() RPC (migration 017).
interface MatchResult {
  matched: boolean
  receiver_id?: string
  bottle_id?: string
  reason?: string
  queued?: boolean
}

Deno.serve(async (req) => {
  // ── 0. Caller auth — service role key required ────────────────────────────
  // The match logic now lives in the SECURITY DEFINER public.match_bottle()
  // RPC, which is GRANTed only to service_role. This function presents the
  // service role key both to authorize the caller and to invoke the RPC.
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

  // ── 1. Match atomically in the database ──────────────────────────────────
  // public.match_bottle() locks the bottle row (FOR UPDATE), assigns a random
  // eligible receiver, and writes that receiver's daily quota in ONE
  // transaction. All of the prior race / quota-desync / selection-bias /
  // unbounded-exclusion bugs are handled inside the function — there is no
  // longer any matching logic in TypeScript to get wrong.
  const { data, error } = await supabase.rpc('match_bottle', {
    p_bottle_id: bottle_id,
  })

  if (error) {
    console.error('[match-bottle] match_bottle RPC failed:', error.message)
    return new Response(
      JSON.stringify({ error: 'failed to match bottle' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const result = data as MatchResult

  // ── 2. Fire-and-forget receiver email — ONLY on a fresh match ────────────
  // receiver_id is present only when THIS call assigned the receiver. The
  // idempotent "already matched" path omits it, so we never re-notify. The
  // pg_cron retry path (migration 011) also re-attempts notification for any
  // bottle where email_notified_at IS NULL, so a swallowed failure self-heals.
  if (result.matched && result.receiver_id) {
    const notifyUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/notify-receiver`
    fetch(notifyUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ bottle_id }),
    }).catch((err) => {
      console.error('[match-bottle] notify-receiver invoke failed:', err?.message)
    })
  }

  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
})
