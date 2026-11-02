// The email about an account's standing. The words are the notice's own, written
// by the database, plus any text an admin added, so they're escaped. No Deno or
// env access, so apps/web/lib/accountEmail.test.ts can check them.

const SUBJECT: Record<string, string> = {
  warn: 'A warning about your glassbottles account',
  suspended: 'Your glassbottles account is suspended',
  banned: 'Your glassbottles account has been closed',
  lifted: 'Your glassbottles account is back',
}
const HEADING: Record<string, string> = {
  warn: 'A warning about your account.',
  suspended: 'Your account is suspended.',
  banned: 'Your account has been closed.',
  lifted: 'Your account is back.',
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

export function accountEmail(kind: string, body: string) {
  const lifted = kind === 'lifted'
  return {
    subject: SUBJECT[kind] ?? 'About your glassbottles account',
    text: `${body}\n\nCommunity guidelines: https://glassbottles.app/guidelines`,
    layout: {
      title: SUBJECT[kind] ?? 'Your account',
      preheader: escapeHtml(body.slice(0, 110)),
      eyebrow: 'Your account',
      heading: HEADING[kind] ?? 'About your account.',
      paragraphs: body.split(/\n\n+/).map(escapeHtml),
      cta: lifted
        ? { label: 'Open glassbottles', href: 'https://glassbottles.app' }
        : { label: 'Read the community guidelines', href: 'https://glassbottles.app/guidelines' },
      footer: 'You&rsquo;re getting this because it concerns your account.',
    },
  }
}
