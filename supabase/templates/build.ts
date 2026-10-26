// Renders the Supabase auth email templates from the shared layout.
// Run after changing either file:  node supabase/templates/build.ts
// Then push to prod (config.toml only drives local): see config.toml notes.

import { writeFileSync } from 'node:fs'
import { emailHtml } from '../functions/_shared/email.ts'

const callback = (type: string, next: string) =>
  `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=${type}&next=${next}`

const templates = {
  'confirmation.html': emailHtml({
    title: 'Confirm your glassbottles account',
    preheader: 'Confirm your email to finish signing up.',
    eyebrow: 'New account',
    heading: 'A bottle&rsquo;s waiting to be cast for you.',
    paragraphs: ['Confirm your email to finish signing up.'],
    cta: { label: 'Confirm email', href: callback('signup', '/home') },
    note: 'This link expires in 1 hour.',
    fallback: true,
    footer: 'If you didn&rsquo;t create a glassbottles account, you can ignore this email.',
  }),
  'recovery.html': emailHtml({
    title: 'Reset your glassbottles password',
    preheader: 'Choose a new password for your account.',
    eyebrow: 'Password reset',
    heading: 'Reset your password.',
    paragraphs: ['Someone asked to reset the password for this account. If it was you, choose a new one below.'],
    cta: { label: 'Choose a new password', href: callback('recovery', '/reset-password') },
    note: 'This link expires in 1 hour.',
    fallback: true,
    footer: 'If you didn&rsquo;t ask for this, ignore this email. Your password stays the same.',
  }),
  'email-change.html': emailHtml({
    title: 'Confirm your new glassbottles email',
    preheader: 'Confirm the new address for your account.',
    eyebrow: 'Account email',
    heading: 'Confirm your new email.',
    paragraphs: [
      'You asked to change your account email from <b style="color:#F7E7CE;">{{ .Email }}</b> to <b style="color:#F7E7CE;">{{ .NewEmail }}</b>.',
    ],
    cta: { label: 'Confirm new email', href: callback('email_change', '/settings') },
    note: 'This link expires in 1 hour.',
    fallback: true,
    footer: 'If you didn&rsquo;t ask for this, ignore this email and your address won&rsquo;t change.',
  }),
}

for (const [file, html] of Object.entries(templates)) {
  writeFileSync(new URL(file, import.meta.url), html + '\n')
}
