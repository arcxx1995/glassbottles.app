import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { chatJSON } from '../_shared/openrouter.ts'
import { SPARK_PROMPT, SPARK_SCHEMA, cleanQuestion, sparkContext, sparkRequest } from './spark.ts'

// spark — one AI question to write from, for Keepers (migration 046), from a
// small model through OpenRouter.
//
// Called from the app with the user's session (the platform verifies the JWT).
// use_spark() runs AS that user: it checks Keeper and the five-a-day cap
// atomically. Any failure answers { question: null } and the app uses its
// static deck instead.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const OPENROUTER_API_KEY = Deno.env.get('OPENROUTER_API_KEY')
const OPENROUTER_MODEL = Deno.env.get('OPENROUTER_MODEL') // default: _shared/openrouter.ts

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  if (!OPENROUTER_API_KEY) return json({ question: null, reason: 'not configured' })

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
    const answer = await chatJSON({
      apiKey: OPENROUTER_API_KEY,
      model: OPENROUTER_MODEL,
      system: SPARK_PROMPT,
      user: sparkRequest(ctx),
      name: 'spark',
      schema: SPARK_SCHEMA as unknown as Record<string, unknown>,
      temperature: 0.9, // a fresh question each tap
      maxTokens: 80,
    })
    return json({ question: cleanQuestion(answer), left })
  } catch (err) {
    console.error('[spark]', err instanceof Error ? err.message : err)
    return json({ question: null, left })
  }
})
