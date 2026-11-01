import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { classify as classifyWith } from '../_shared/classify.ts'
import { findContact, findCrisis, type Verdict } from './screen.ts'

// screen-bottle — the safety screen (migration 043), for bottles and for Kayak
// notes and comments (063). A body of {bottle_id} screens a bottle; {table, id}
// screens a note or comment, with the same checks in the same order.
//
// Called by the insert triggers through pg_net, and again by the rescreen_pending
// cron for anything still unscreened. Reads the text, decides one verdict, and
// hands it to apply_screen() or apply_kayak_screen(), which own every state
// change. Fail-closed since 051: a failure here leaves the row unscreened, which
// means undelivered / hidden from others; after 6 misses the cron holds it for
// human review.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
// Optional: without it only the deterministic checks run.
const OPENROUTER_API_KEY = Deno.env.get('OPENROUTER_API_KEY')
const OPENROUTER_MODEL = Deno.env.get('OPENROUTER_MODEL') // default: _shared/openrouter.ts

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

// No usable answer from the model → null, so the row stays unscreened.
async function decide(text: string): Promise<Verdict | null> {
  if (findContact(text)) return { verdict: 'held', reason: 'contact' }
  if (findCrisis(text)) return { verdict: 'crisis' }
  return classifyWith(text, { apiKey: OPENROUTER_API_KEY, model: OPENROUTER_MODEL })
}

const KAYAK_TABLES = new Set(['kayak_notes', 'kayak_comments'])

async function screenKayak(table: string, id: string): Promise<Response> {
  if (!KAYAK_TABLES.has(table)) return json({ error: 'bad table' }, 400)
  const { data, error } = await supabase.from(table).select('body, screen').eq('id', id).single()
  if (error || !data) return json({ error: 'row not found' }, 404)
  if (data.screen) return json({ result: 'already_screened' })

  let verdict: Verdict | null
  try {
    verdict = await decide(data.body)
  } catch (err) {
    console.error('[screen-bottle] kayak classifier', err instanceof Error ? err.message : err)
    return json({ result: 'unscreened' }, 502)
  }
  if (!verdict) return json({ result: 'unscreened' }, 502)

  const { data: result, error: applyErr } = await supabase.rpc('apply_kayak_screen', {
    p_table: table,
    p_id: id,
    p_verdict: verdict.verdict,
    p_reason: verdict.verdict === 'held' ? verdict.reason : null,
  })
  if (applyErr) {
    console.error('[screen-bottle] apply_kayak_screen', applyErr.message)
    return json({ error: 'apply failed' }, 500)
  }
  return json({ result })
}

Deno.serve(async (req) => {
  // Service role only — the trigger is the one caller.
  if (req.headers.get('Authorization')?.replace('Bearer ', '') !== SERVICE_ROLE_KEY) {
    return json({ error: 'Unauthorized' }, 401)
  }
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  const payload = (await req.json().catch(() => ({}))) as { bottle_id?: string; table?: string; id?: string }
  if (payload.table && payload.id) return screenKayak(payload.table, payload.id)
  const { bottle_id } = payload
  if (!bottle_id) return json({ error: 'bottle_id required' }, 400)

  const { data: bottle, error } = await supabase
    .from('bottles')
    .select('message, screen')
    .eq('id', bottle_id)
    .single()
  if (error || !bottle) return json({ error: 'bottle not found' }, 404)
  if (bottle.screen) return json({ result: 'already_screened' })

  let verdict: Verdict | null
  try {
    verdict = await decide(bottle.message)
  } catch (err) {
    console.error('[screen-bottle] classifier', err instanceof Error ? err.message : err)
    return json({ result: 'unscreened' }, 502)
  }
  if (!verdict) return json({ result: 'unscreened' }, 502)

  const { data: result, error: applyErr } = await supabase.rpc('apply_screen', {
    p_bottle_id: bottle_id,
    p_verdict: verdict.verdict,
    p_reason: verdict.verdict === 'held' ? verdict.reason : null,
  })
  if (applyErr) {
    console.error('[screen-bottle] apply_screen', applyErr.message)
    return json({ error: 'apply failed' }, 500)
  }
  return json({ result })
})
