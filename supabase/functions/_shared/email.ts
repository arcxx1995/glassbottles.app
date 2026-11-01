// Shared HTML layout for every glassbottles email: the Resend emails
// (notify-receiver, moderation-alert) and the Supabase auth templates, which
// supabase/templates/build.ts renders from this file. Tables + inline styles
// only so Gmail/Outlook keep it.
// No Deno or env access, so apps/web/lib/email.test.ts can check it.

const SITE = 'https://glassbottles.app'
// The landing-page wordmark (Playfair Display 400, tracking-tight, sand), rendered
// at 3x. An image because Gmail/Outlook drop web fonts and fall back to Georgia.
// New filename, not an overwrite: Gmail's image proxy caches by URL.
const WORDMARK = `${SITE}/email/wordmark-sand@3x.png`
const SANS = "'DM Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"
const SERIF = "'Playfair Display',Georgia,'Times New Roman',serif"
const INK = '#F7E7CE'
const BODY = 'rgba(247,231,206,0.74)'
const MUTED = 'rgba(247,231,206,0.45)'
const FAINT = 'rgba(247,231,206,0.3)'
const RULE = 'rgba(247,231,206,0.1)'
const SEAFOAM = '#4ECDC4'
const BG = '#0A1628'
const CARD = '#0D2137'

export interface EmailLayout {
  title: string
  /** Hidden inbox preview text. */
  preheader: string
  /** Small caps label above the heading, e.g. 'Password reset'. */
  eyebrow?: string
  heading: string
  /** Trusted HTML paragraphs — never interpolate user input here. */
  paragraphs?: string[]
  /** Big-number tiles, e.g. [['3', 'new'], ['12', 'open in queue']]. */
  stats?: [string, string][]
  cta: { label: string; href: string }
  /** Small print under the button, e.g. link expiry. */
  note?: string
  /** Print cta.href as a copyable link for clients that drop the button. */
  fallback?: boolean
  /** Trusted HTML. */
  footer: string
}

export function emailHtml(e: EmailLayout): string {
  const eyebrow = e.eyebrow
    ? `<p style="margin:0 0 18px 0;font-family:${SANS};font-size:11px;line-height:1;font-weight:600;letter-spacing:2.2px;text-transform:uppercase;color:${SEAFOAM};">${e.eyebrow}</p>`
    : ''
  const paragraphs = (e.paragraphs ?? [])
    .map((p) => `<p style="margin:0 0 16px 0;font-family:${SANS};font-size:16px;line-height:1.65;color:${BODY};">${p}</p>`)
    .join('')
  const stats = e.stats?.length
    ? `<tr><td style="padding:8px 0 20px 0;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>${e.stats
        .map(([n, label], i) => `${i ? '<td width="12" style="width:12px;"></td>' : ''}<td style="padding:16px 22px;background-color:${BG};border:1px solid ${RULE};border-radius:12px;font-family:${SANS};"><div style="font-family:${SERIF};font-size:30px;line-height:1;color:${INK};">${n}</div><div style="padding-top:8px;font-size:11px;letter-spacing:1.4px;text-transform:uppercase;color:${MUTED};">${label}</div></td>`)
        .join('')}</tr></table></td></tr>`
    : ''
  const small = e.note || e.fallback
    ? `<tr><td style="padding:32px 0 0 0;"><div style="height:1px;line-height:1px;font-size:1px;background-color:${RULE};">&nbsp;</div></td></tr>
<tr><td style="padding:20px 0 0 0;font-family:${SANS};font-size:12px;line-height:1.6;color:${MUTED};">${
        e.note ? `<p style="margin:0;font-size:13px;">${e.note}</p>` : ''
      }${
        e.fallback ? `<p style="margin:${e.note ? '10px' : '0'} 0 0 0;">Button not working? Paste this link into your browser:<br><a href="${e.cta.href}" style="color:${SEAFOAM};word-break:break-all;text-decoration:none;">${e.cta.href}</a></p>` : ''
      }</td></tr>`
    : ''

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<title>${e.title}</title>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400&family=DM+Sans:wght@400;600&display=swap" rel="stylesheet">
<style>a{color:${SEAFOAM};} @media only screen and (max-width:600px){.gb-outer{padding:40px 12px !important;} .gb-card{padding:36px 24px !important;} .gb-h1{font-size:26px !important;}}</style>
</head>
<body style="margin:0;padding:0;background-color:${BG};-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;font-size:1px;line-height:1px;color:${BG};">${e.preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${BG}" style="background-color:${BG};background-image:linear-gradient(180deg,${CARD} 0%,${BG} 360px);">
<tr><td align="center" class="gb-outer" style="padding:56px 24px 48px 24px;">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;">
<tr><td align="center" style="padding:0 0 32px 0;"><a href="${SITE}" style="text-decoration:none;"><img src="${WORDMARK}" width="120" height="32" alt="glassbottles" style="display:block;width:120px;height:32px;border:0;outline:none;font-family:${SERIF};font-size:22px;line-height:32px;color:${INK};"></a></td></tr>
<tr><td class="gb-card" bgcolor="${CARD}" style="background-color:${CARD};border:1px solid rgba(255,255,255,0.06);border-radius:20px;padding:48px 44px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
<tr><td>
${eyebrow}<h1 class="gb-h1" style="margin:0 0 18px 0;font-family:${SERIF};font-size:30px;line-height:1.2;font-weight:400;letter-spacing:-0.4px;color:${INK};">${e.heading}</h1>
${paragraphs}
</td></tr>
${stats}
<tr><td style="padding:16px 0 0 0;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td bgcolor="${SEAFOAM}" style="background-color:${SEAFOAM};border-radius:999px;"><a href="${e.cta.href}" style="display:inline-block;padding:15px 32px;font-family:${SANS};font-size:15px;line-height:1;font-weight:600;letter-spacing:0.2px;color:${BG};text-decoration:none;border-radius:999px;">${e.cta.label}</a></td>
</tr></table></td></tr>
${small}
</table>
</td></tr>
<tr><td align="center" style="padding:32px 24px 0 24px;font-family:${SANS};font-size:12px;line-height:1.7;color:${MUTED};">
${e.footer}
</td></tr>
<tr><td align="center" style="padding:24px 0 0 0;font-family:${SERIF};font-size:14px;font-style:italic;color:${FAINT};">messages that drift</td></tr>
<tr><td align="center" style="padding:6px 0 0 0;font-family:${SANS};font-size:11px;letter-spacing:1.4px;text-transform:uppercase;"><a href="${SITE}" style="color:${FAINT};text-decoration:none;">glassbottles.app</a></td></tr>
</table>
</td></tr></table>
</body>
</html>`
}
