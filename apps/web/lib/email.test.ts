import { describe, expect, it } from 'vitest'
import { emailHtml } from '../../../supabase/functions/_shared/email'

// The shared email layout behind notify-receiver, moderation-alert and the auth templates.

const base = {
  title: 'T',
  preheader: 'Preview text',
  heading: 'Hello there.',
  cta: { label: 'Go', href: 'https://glassbottles.app/home?a=1&b=2' },
  footer: 'Footer text',
}

describe('emailHtml', () => {
  it('renders heading, preheader, button and footer', () => {
    const html = emailHtml(base)
    expect(html).toContain('Hello there.')
    expect(html).toContain('Preview text')
    expect(html).toContain('href="https://glassbottles.app/home?a=1&b=2"')
    expect(html).toContain('>Go</a>')
    expect(html).toContain('Footer text')
  })

  it('only prints the fallback link and stats when asked', () => {
    expect(emailHtml(base)).not.toContain('Button not working?')
    const html = emailHtml({ ...base, fallback: true, note: 'Expires soon.', stats: [['3', 'new']] })
    expect(html).toContain('Button not working?')
    expect(html).toContain('Expires soon.')
    expect(html).toMatch(/>3<\/div>.*>new<\/div>/)
  })
})
