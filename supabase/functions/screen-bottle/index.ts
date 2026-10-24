import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { classify as classifyWith } from '../_shared/classify.ts'
import { findContact, findCrisis, findPersonalContact, type Verdict } from './screen.ts'

// screen-bottle — the safety screen (migration 043), plus social mode (050):
// a body of {table, id} screens a post / comment / scrap / community / bio
// (051) and hands the verdict to apply_social_screen() instead.
//
// Called by the on_bottle_screen trigger through pg_net for every new bottle,
// and again by the rescreen_pending cron for anything still unscreened.
// Reads the message, decides one verdict, and hands it to apply_screen(),
// which owns every state change (held → ashore + the day restored; crisis →
// the same since 052, and the sender is shown help). Fail-closed since 051: a
// failure here leaves the row unscreened, which means undelivered / hidden
// from others; after 6 misses the cron holds it for human review.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
// Optional: without it only the deterministic contact check runs.
const OPENROUTER_API_KEY = Deno.env.get('OPENROUTER_API_KEY')
const OPENROUTER_MODEL = Deno.env.get('OPENROUTER_MODEL') // default: _shared/openrouter.ts

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

// No usable answer → no verdict; the row stays unscreened (undelivered) and
// the rescreen cron tries again.
const classify = (message: string, social = false) =>
  classifyWith(message, { apiKey: OPENROUTER_API_KEY, model: OPENROUTER_MODEL, social })

// table → how to read its text, its key, and its screen column.
const SOCIAL_TABLES: Record<string, { select: string; key: string; screen: string; text: (row: Record<string, string | null>) => string }> = {
  posts: { select: 'body, screen', key: 'id', screen: 'screen', text: (r) => r.body ?? '' },
  comments: { select: 'body, screen', key: 'id', screen: 'screen', text: (r) => r.body ?? '' },
  scraps: { select: 'body, screen', key: 'id', screen: 'screen', text: (r) => r.body ?? '' },
  communities: {
    select: 'name, description, screen', key: 'id', screen: 'screen',
    text: (r) => [r.name, r.description].filter(Boolean).join('\n'),
  },
  social_profiles: { select: 'bio, bio_screen', key: 'user_id', screen: 'bio_screen', text: (r) => r.bio ?? '' },
}

async function screenSocial(table: string, id: string): Promise<Response> {
  const spec = SOCIAL_TABLES[table]
  if (!spec) return json({ error: 'bad table' }, 400)
  const { data, error } = await supabase.from(table).select(spec.select).eq(spec.key, id).single()
  if (error || !data) return json({ error: 'row not found' }, 404)
  const row = data as unknown as Record<string, string | null>
  if (row[spec.screen]) return json({ result: 'already_screened' })
  const text = spec.text(row).trim()

  let verdict: Verdict | null
  try {
    verdict = !text
      ? { verdict: 'ok' } // an emptied bio: nothing to hold
      : findPersonalContact(text)
      ? { verdict: 'held', reason: 'contact' }
      : await classify(text, true)
  } catch (err) {
    console.error('[screen-bottle] social classifier', err instanceof Error ? err.message : err)
    return json({ result: 'unscreened' }, 502)
  }
  if (!verdict) return json({ result: 'unscreened' }, 502)

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
      : findCrisis(bottle.message)
      ? { verdict: 'crisis' }
      : await classify(bottle.message)
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
