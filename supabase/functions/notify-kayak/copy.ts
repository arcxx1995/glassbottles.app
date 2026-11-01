// The two Kayak emails. No Deno or env access, so apps/web/lib/kayakEmails.test.ts
// can check them. Neither ever includes a note or comment: those are screened for
// the app, and an inbox isn't the place to first meet a stranger's words.

const LINK = 'https://glassbottles.app/harbour'
const FOOTER =
  'You&rsquo;re getting this because you&rsquo;re a Keeper. <a href="https://glassbottles.app/settings" style="color:rgba(247,231,206,0.7);text-decoration:underline;">Turn off email notifications</a> in Settings.'

export function arrivalEmail() {
  return {
    subject: 'A Kayak drifted into your harbour',
    text: 'A Kayak has arrived in your harbour. It stays for a day. Open glassbottles.app/harbour to see what it carries.',
    layout: {
      title: 'A Kayak arrived',
      preheader: 'It stays for a day. See what it carries.',
      eyebrow: 'A visitor',
      heading: 'A Kayak drifted into your harbour.',
      paragraphs: ['Someone out there sent it with a note and something from the sea. It stays for a day, then sails on.'],
      cta: { label: 'Go to your harbour', href: LINK },
      footer: FOOTER,
    },
  }
}

const WHY: Record<string, string> = {
  empty: 'Every gem it carried has found a keeper.',
  lapsed: 'Your Keeper membership has ended, so it came back to the mast. Renew any time to launch it again.',
}

export function homeEmail(endReason: string | null, comments: number) {
  const left =
    comments === 0
      ? 'It came back without any comments this time.'
      : comments === 1
        ? 'It came back with one comment.'
        : `It came back with ${comments} comments.`
  const why = (endReason && WHY[endReason]) || 'It&rsquo;s tied up at the mast.'
  return {
    subject: 'Your Kayak is home',
    text: `Your Kayak is home. ${left} Open glassbottles.app/harbour to read its log.`,
    layout: {
      title: 'Your Kayak is home',
      preheader: left,
      eyebrow: 'Back at the mast',
      heading: 'Your Kayak is home.',
      paragraphs: [why, left],
      cta: { label: 'Read its log', href: LINK },
      footer: FOOTER,
    },
  }
}
