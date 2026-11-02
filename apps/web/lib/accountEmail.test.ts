import { describe, expect, it } from 'vitest'
import { emailHtml } from '../../../supabase/functions/_shared/email'
import { accountEmail } from '../../../supabase/functions/notify-account/copy'

describe('account emails', () => {
  it('escapes what an admin typed, since the layout takes trusted HTML', () => {
    const html = emailHtml(accountEmail('warn', 'Rule text.\n\n<script>x</script> & "more"').layout)
    expect(html).not.toContain('<script>x')
    expect(html).toContain('&lt;script&gt;x')
    expect(html).toContain('&amp; &quot;more&quot;')
  })

  it('makes each paragraph its own, with subject and link by kind', () => {
    const e = accountEmail('banned', 'First.\n\nSecond.')
    expect(e.layout.paragraphs).toEqual(['First.', 'Second.'])
    expect(e.subject).toContain('closed')
    expect(e.layout.cta.href).toContain('/guidelines')
    expect(accountEmail('lifted', 'Back.').layout.cta.href).toBe('https://glassbottles.app')
  })

  it('never names who reported them, because it only carries the notice', () => {
    expect(accountEmail('warn', 'Body').text).toBe('Body\n\nCommunity guidelines: https://glassbottles.app/guidelines')
  })
})
