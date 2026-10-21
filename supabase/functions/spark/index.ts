import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Anthropic from 'npm:@anthropic-ai/sdk@0.131.0'
import { SPARK_PROMPT, SPARK_SCHEMA, cleanQuestion, sparkContext, sparkRequest } from './spark.ts'

// spark — one AI question to write from, for Keepers (migration 046).
//
// Called from the app with the user's session (the platform verifies the JWT).
// use_spark() runs AS that user: it checks Keeper and the five-a-day cap
// atomically. Any failure answers { question: null } and the app uses its
// static deck instead.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')
const anthropic = ANTHROPIC_API_KEY ? new Anthropic({ apiKey: ANTHROPIC_API_KEY }) : null

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  if (!anthropic) return json({ question: null, reason: 'not configured' })

  const auth = req.headers.get('Authorization') ?? ''
  const asUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: auth } } })

  // ponytail: a spark is spent before the call; a failed call costs one of five.
  const { data: left, error } = await asUser.rpc('use_spark')
  if (error) {
    const status = error.message.includes('spark_limit') ? 429 : error.message.includes('keeper_only') ? 403 : 401
    return json({ question: null, reason: error.message }, status)
  }

  const ctx = sparkContext(await req.json().catch(() => ({})))
  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-5-5',
      max_tokens: 1024,
      system: SPARK_PROMPT,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SPARK_SCHEMA } },
      messages: [{ role: 'user', content: sparkRequest(ctx) }],
    })
    const text = response.content.find((b) => b.type === 'text')
    const question =
      response.stop_reason !== 'refusal' && text && text.type === 'text'
        ? cleanQuestion(JSON.parse(text.text))
        : null
    return json({ question, left })
  } catch (err) {
    console.error('[spark]', err instanceof Anthropic.APIError ? `${err.status} ${err.message}` : err)
    return json({ question: null, left })
  }
})
