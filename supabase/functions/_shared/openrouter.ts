// One JSON answer from a small model through OpenRouter (OpenAI-compatible
// chat API). Used by screen-bottle and spark. No Deno or env access here —
// callers pass the key — so apps/web/lib/openrouter.test.ts can check it.
//
// Privacy: `provider.data_collection: 'deny'` routes only to providers that
// neither store nor train on the text; `require_parameters` skips providers
// that can't honour the JSON schema.

export const DEFAULT_MODEL = 'google/gemini-2.5-flash-lite'

export interface ChatJSON {
  apiKey: string
  model?: string
  system: string
  user: string
  /** Name + JSON schema the answer must match. */
  name: string
  schema: Record<string, unknown>
  temperature?: number
  maxTokens?: number
  fetchImpl?: typeof fetch
}

export function openRouterBody(o: ChatJSON) {
  return {
    model: o.model || DEFAULT_MODEL,
    messages: [
      { role: 'system', content: o.system },
      { role: 'user', content: o.user },
    ],
    response_format: { type: 'json_schema', json_schema: { name: o.name, strict: true, schema: o.schema } },
    provider: { require_parameters: true, data_collection: 'deny' },
    temperature: o.temperature ?? 0,
    max_tokens: o.maxTokens ?? 300,
  }
}

/** The parsed JSON answer, or null when the model gave nothing usable.
 *  Throws on HTTP errors so callers can log them. */
export async function chatJSON(o: ChatJSON): Promise<unknown> {
  const res = await (o.fetchImpl ?? fetch)('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${o.apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://glassbottles.app',
      'X-Title': 'glassbottles',
    },
    body: JSON.stringify(openRouterBody(o)),
    signal: AbortSignal.timeout(20_000),
  })
  if (!res.ok) throw new Error(`openrouter ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const data = (await res.json()) as { choices?: { message?: { content?: unknown } }[] }
  const text = data.choices?.[0]?.message?.content
  if (typeof text !== 'string') return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}
