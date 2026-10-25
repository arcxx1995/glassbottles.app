import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { classify } from '../_shared/classify.ts'
import { findContact, findCrisis } from '../screen-bottle/screen.ts'

// check-message — the live filter (migration 052). The editor sends the draft
// here while the person types (debounced) and again before a throw; the
// answer decides whether "Seal & Throw" is offered at all. Same checks as the
// screen after insert, in the same order: blocklist, contact details, crisis
// phrases, model. Writes nothing. No answer from the model → 'unknown', and
// the editor refuses the throw until a check succeeds (fail-closed).
//
// Called from the app with the user's session (the platform verifies the
// JWT). precheck_message() runs AS that user: the rate limit (60 checks per
// 10 minutes, 054), suspension and 18+ checks, then the blocklist — all
// before any model call. Not the last line: a draft that skips this still
// meets the insert guard and the fail-closed screen before anyone could
// receive it.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const OPENROUTER_API_KEY = Deno.env.get('OPENROUTER_API_KEY')
const OPENROUTER_MODEL = Deno.env.get('OPENROUTER_MODEL') // default: _shared/openrouter.ts

const MAX_CHARS = 1000 // send_bottle's limit

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const { text } = (await req.json().catch(() => ({}))) as { text?: unknown }
  const draft = typeof text === 'string' ? text.trim() : ''
  if (!draft || draft.length > MAX_CHARS) return json({ error: 'bad text' }, 400)

  const auth = req.headers.get('Authorization') ?? ''
  const asUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: auth } } })
  const { data: blocked, error } = await asUser.rpc('precheck_message', { p_text: draft })
  if (error) {
    // Too many checks: no verdict, so the editor stays fail-closed and says
    // to wait. 429 would make supabase-js drop the body.
    if (error.message.includes('rate_limited')) return json({ verdict: 'unknown', reason: 'rate_limited' })
    // The same names send_bottle raises; answered as a hold so the editor
    // can say why instead of "couldn't check".
    for (const reason of ['account_suspended', 'age_unconfirmed']) {
      if (error.message.includes(reason)) return json({ verdict: 'held', reason })
    }
    return json({ error: 'unauthorized' }, 401)
  }
  if (blocked) return json({ verdict: 'held', reason: 'blocked' })
  if (findContact(draft)) return json({ verdict: 'held', reason: 'contact' })
  if (findCrisis(draft)) return json({ verdict: 'crisis' })

  try {
    const verdict = await classify(draft, { apiKey: OPENROUTER_API_KEY, model: OPENROUTER_MODEL })
    if (!verdict) return json({ verdict: 'unknown' })
    return json(verdict)
  } catch (err) {
    console.error('[check-message]', err instanceof Error ? err.message : err)
    return json({ verdict: 'unknown' })
  }
})
