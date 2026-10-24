import { chatJSON } from './openrouter.ts'
import { SCREEN_PROMPT, SOCIAL_SCREEN_PROMPT, VERDICT_SCHEMA, parseVerdict, type Verdict } from '../screen-bottle/screen.ts'

// The safety screen's model call, shared by screen-bottle (after insert) and
// check-message (while typing). null = no usable answer.
export async function classify(
  message: string,
  opts: { apiKey?: string; model?: string; social?: boolean },
): Promise<Verdict | null> {
  if (!opts.apiKey) return null
  const answer = await chatJSON({
    apiKey: opts.apiKey,
    model: opts.model,
    system: opts.social ? SOCIAL_SCREEN_PROMPT : SCREEN_PROMPT,
    user: opts.social ? `<post>\n${message}\n</post>` : `<bottle>\n${message}\n</bottle>`,
    name: 'verdict',
    schema: VERDICT_SCHEMA as unknown as Record<string, unknown>,
    maxTokens: 60,
  })
  return parseVerdict(answer)
}
