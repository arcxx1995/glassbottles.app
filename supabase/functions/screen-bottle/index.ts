import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Anthropic from 'npm:@anthropic-ai/sdk@0.131.0'
import { SCREEN_PROMPT, VERDICT_SCHEMA, findContact, parseVerdict, type Verdict } from './screen.ts'

// screen-bottle — the safety screen (migration 043).
//
// Called by the on_bottle_screen trigger through pg_net for every new bottle.
// Reads the message, decides one verdict, and hands it to apply_screen(),
// which owns every state change (held → ashore + the day restored; crisis →
// the sender is shown help). Any failure here leaves the bottle unscreened,
// and it sails as before after its hour: the screen fails open by design.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
// Optional: without it only the deterministic contact check runs.
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
const anthropic = ANTHROPIC_API_KEY ? new Anthropic({ apiKey: ANTHROPIC_API_KEY }) : null

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

async function classify(message: string): Promise<Verdict | null> {
  if (!anthropic) return null
  const response = await anthropic.messages.create({
    model: 'claude-haiku-5-5',
    max_tokens: 2048,
    system: SCREEN_PROMPT,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: VERDICT_SCHEMA } },
    messages: [{ role: 'user', content: `<bottle>\n${message}\n</bottle>` }],
  })
  // A declined request gives no verdict; the bottle sails unscreened and the
  // report flag stays the backstop.
  if (response.stop_reason === 'refusal') return null
  const text = response.content.find((b) => b.type === 'text')
  if (!text || text.type !== 'text') return null
  try {
    return parseVerdict(JSON.parse(text.text))
  } catch {
    return null
  }
}

Deno.serve(async (req) => {
  // Service role only — the trigger is the one caller.
  if (req.headers.get('Authorization')?.replace('Bearer ', '') !== SERVICE_ROLE_KEY) {
    return json({ error: 'Unauthorized' }, 401)
  }
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  const { bottle_id } = (await req.json().catch(() => ({}))) as { bottle_id?: string }
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
    console.error(
      '[screen-bottle] classifier',
      err instanceof Anthropic.APIError ? `${err.status} ${err.message}` : err,
    )
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
