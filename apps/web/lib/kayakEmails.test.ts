import { describe, expect, it } from 'vitest'
import { emailHtml } from '../../../supabase/functions/_shared/email'
import { arrivalEmail, homeEmail } from '../../../supabase/functions/notify-kayak/copy'

describe('Kayak emails', () => {
  it('arrival links to the harbour in the shared template', () => {
    const e = arrivalEmail()
    expect(e.subject).toContain('Kayak')
    const html = emailHtml(e.layout)
    expect(html).toContain('href="https://glassbottles.app/harbour"')
    expect(html).toContain('Turn off email notifications')
  })

  it('home counts comments, with singular and none', () => {
    expect(homeEmail('empty', 0).text).toContain('without any comments')
    expect(homeEmail('empty', 1).text).toContain('one comment')
    expect(homeEmail('empty', 12).text).toContain('12 comments')
  })

  it('home explains a lapse, and never the reason it was reported', () => {
    expect(emailHtml(homeEmail('lapsed', 2).layout)).toContain('Renew')
    expect(emailHtml(homeEmail('reported', 2).layout)).not.toMatch(/report/i)
    expect(emailHtml(homeEmail('removed', 2).layout)).not.toMatch(/remov/i)
  })
})
