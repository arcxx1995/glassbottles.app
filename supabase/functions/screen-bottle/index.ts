import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { chatJSON } from '../_shared/openrouter.ts'
import {
  SCREEN_PROMPT, SOCIAL_SCREEN_PROMPT, VERDICT_SCHEMA, findContact, findPersonalContact, parseVerdict, type Verdict,
} from './screen.ts'

// screen-bottle — the safety screen (migration 043), plus social mode (050):
// a body of {table, id} screens a post / comment / scrap and hands the
// verdict to apply_social_screen() instead.
//
// Called by the on_bottle_screen trigger through pg_net for every new bottle.
// Reads the message, decides one verdict, and hands it to apply_screen(),
// which owns every state change (held → ashore + the day restored; crisis →
// the sender is shown help). Any failure here leaves the bottle unscreened,
// and it sails as before after its hour: the screen fails open by design.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
// Optional: without it only the deterministic contact check runs.
const OPENROUTER_API_KEY = Deno.env.get('OPENROUTER_API_KEY')
const OPENROUTER_MODEL = Deno.env.get('OPENROUTER_MODEL') // default: _shared/openrouter.ts

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

async function classify(message: string, social = false): Promise<Verdict | null> {
  if (!OPENROUTER_API_KEY) return null
  const answer = await chatJSON({
    apiKey: OPENROUTER_API_KEY,
    model: OPENROUTER_MODEL,
    system: social ? SOCIAL_SCREEN_PROMPT : SCREEN_PROMPT,
    user: social ? `<post>\n${message}\n</post>` : `<bottle>\n${message}\n</bottle>`,
    name: 'verdict',
    schema: VERDICT_SCHEMA as unknown as Record<string, unknown>,
    maxTokens: 60,
  })
  // No usable answer → no verdict; the bottle sails unscreened and the
  // report flag stays the backstop.
  return parseVerdict(answer)
}

const SOCIAL_TABLES = new Set(['posts', 'comments', 'scraps'])

async function screenSocial(table: string, id: string): Promise<Response> {
  if (!SOCIAL_TABLES.has(table)) return json({ error: 'bad table' }, 400)
  const { data: row, error } = await supabase.from(table).select('body, screen').eq('id', id).single()
  if (error || !row) return json({ error: 'row not found' }, 404)
  if (row.screen) return json({ result: 'already_screened' })

  let verdict: Verdict | null
  try {
    verdict = findPersonalContact(row.body)
      ? { verdict: 'held', reason: 'contact' }
      : await classify(row.body, true)
  } catch (err) {
    console.error('[screen-bottle] social classifier', err instanceof Error ? err.message : err)
    return json({ result: 'unscreened' }, 502)
  }
  if (!verdict) return json({ result: 'unscreened' })

  const { data: result, error: applyErr } = await supabase.rpc('apply_social_screen', {
    p_table: table,
    p_id: id,
    p_verdict: verdict.verdict,
    p_reason: verdict.verdict === 'held' ? verdict.reason : null,
  })
  if (applyErr) {
    console.error('[screen-bottle] apply_social_screen', applyErr.message)
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
  if (payload.table && payload.id) return screenSocial(payload.table, payload.id)
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
    verdict = findContact(bottle.message)
      ? { verdict: 'held', reason: 'contact' }
      : await classify(bottle.message)
  } catch (err) {
    console.error('[screen-bottle] classifier', err instanceof Error ? err.message : err)
    return json({ result: 'unscreened' }, 502)
  }
  if (!verdict) return json({ result: 'unscreened' })

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
