import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_MODEL, chatJSON, openRouterBody } from '../../../supabase/functions/_shared/openrouter'

// The shared OpenRouter call behind screen-bottle and spark.

const base = { apiKey: 'k', system: 'sys', user: 'hi', name: 'verdict', schema: { type: 'object' } }

const reply = (content: unknown, status = 200) =>
  vi.fn(async () =>
    new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status }),
  ) as unknown as typeof fetch

describe('openRouterBody', () => {
  it('asks for strict JSON from providers that keep no data', () => {
    const b = openRouterBody(base)
    expect(b.model).toBe(DEFAULT_MODEL)
    expect(b.response_format).toEqual({ type: 'json_schema', json_schema: { name: 'verdict', strict: true, schema: { type: 'object' } } })
    expect(b.provider).toEqual({ require_parameters: true, data_collection: 'deny' })
    expect(b.temperature).toBe(0)
  })
  it('takes a model override (OPENROUTER_MODEL)', () => {
    expect(openRouterBody({ ...base, model: 'openai/gpt-oss-20b' }).model).toBe('openai/gpt-oss-20b')
    expect(openRouterBody({ ...base, model: '' }).model).toBe(DEFAULT_MODEL)
  })
})

describe('chatJSON', () => {
  it('returns the parsed answer and sends the key', async () => {
    const f = reply('{"verdict":"ok","reason":"none"}')
    expect(await chatJSON({ ...base, fetchImpl: f })).toEqual({ verdict: 'ok', reason: 'none' })
    const init = (f as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0][1]
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer k')
  })
  it('gives null for a non-JSON or missing answer (callers fail open)', async () => {
    expect(await chatJSON({ ...base, fetchImpl: reply('not json') })).toBeNull()
    expect(await chatJSON({ ...base, fetchImpl: reply(null) })).toBeNull()
  })
  it('throws on an HTTP error so the caller can log it', async () => {
    const f = vi.fn(async () => new Response('rate limited', { status: 429 })) as unknown as typeof fetch
    await expect(chatJSON({ ...base, fetchImpl: f })).rejects.toThrow('openrouter 429')
  })
})
