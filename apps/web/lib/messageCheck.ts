import { createClient } from '@/lib/supabase/client'

// The live filter, shared by the bottle editor and Kayak notes and comments.

/** Why something can't be sent, by screen reason (check-message / 051). */
export const HELD_COPY: Record<string, string> = {
  blocked: 'It contains language that isn’t allowed here.',
  sexual: 'Sexual content isn’t allowed here.',
  minor: 'Sexual content isn’t allowed here.',
  contact: 'Bottles stay anonymous: no contact details, handles or links.',
  harm: 'It reads as hurtful or threatening toward someone.',
  spam: 'It looks like advertising or spam.',
  review: 'It needs a closer look before it can sail.',
  account_suspended: 'Your account is suspended for breaking our guidelines.',
  age_unconfirmed: 'Please confirm you’re 18 or older first.',
}

export type CheckResult = { verdict: 'ok' | 'held' | 'crisis' | 'unknown'; reason?: string }

// Verdicts by draft text, so a pause and the send don't ask twice.
const checked = new Map<string, CheckResult>()

/** The safety screen's verdict on a draft (check-message, migration 052).
 *  Fail-closed: only 'ok' sends; 'unknown' (screen unreachable) is never cached,
 *  so the next tap asks again. */
export async function checkMessage(text: string): Promise<CheckResult> {
  const hit = checked.get(text)
  if (hit) return hit
  const { data, error } = await createClient().functions.invoke<CheckResult>('check-message', {
    body: { text },
  })
  if (error || !data?.verdict) return { verdict: 'unknown' }
  if (data.verdict !== 'unknown') checked.set(text, data)
  return data
}
