// Shared HTML layout for every glassbottles email: the Resend emails
// (notify-receiver, moderation-alert) and the Supabase auth templates, which
// supabase/templates/build.ts renders from this file. Tables + inline styles
// only so Gmail/Outlook keep it.
// No Deno or env access, so apps/web/lib/email.test.ts can check it.

const SITE = 'https://glassbottles.app'
const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"
const SERIF = "'Playfair Display',Georgia,'Times New Roman',serif"
const INK = '#F7E7CE'
const BODY = 'rgba(247,231,206,0.78)'
const MUTED = 'rgba(247,231,206,0.45)'
const RULE = 'rgba(247,231,206,0.12)'
const SEAFOAM = '#4ECDC4'
const BG = '#0A1628'

export interface EmailLayout {
  title: string
  /** Hidden inbox preview text. */
  preheader: string
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

const rule = (pad: string) =>
  `<tr><td style="padding:${pad};"><div style="height:1px;line-height:1px;background-color:${RULE};">&nbsp;</div></td></tr>`

export function emailHtml(e: EmailLayout): string {
  const paragraphs = (e.paragraphs ?? [])
    .map((p) => `<p style="margin:0 0 16px 0;font-family:${SANS};font-size:15px;line-height:1.6;color:${BODY};">${p}</p>`)
    .join('')
  const stats = e.stats?.length
    ? `<tr><td style="padding:0 0 28px 0;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>${e.stats
        .map(([n, label]) => `<td style="padding:14px 20px;background-color:#0D2137;border-radius:8px;font-family:${SANS};"><div style="font-family:${SERIF};font-size:28px;line-height:1;color:${INK};">${n}</div><div style="padding-top:6px;font-size:12px;color:${MUTED};">${label}</div></td><td width="10" style="width:10px;"></td>`)
        .join('')}</tr></table></td></tr>`
    : ''
  const small = e.note || e.fallback
    ? `<tr><td style="padding:24px 0 0 0;font-family:${SANS};font-size:12px;line-height:1.6;color:${MUTED};">${
        e.note ? `<p style="margin:0;font-size:13px;">${e.note}</p>` : ''
      }${
        e.fallback ? `<p style="margin:${e.note ? '16px' : '0'} 0 0 0;">Button not working? Paste this link into your browser:<br><a href="${e.cta.href}" style="color:${SEAFOAM};word-break:break-all;">${e.cta.href}</a></p>` : ''
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
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@500;600&display=swap" rel="stylesheet">
<style>a{color:${SEAFOAM};} @media only screen and (max-width:600px){.gb-pad{padding:32px 20px !important;} .gb-h1{font-size:23px !important;}}</style>
</head>
<body style="margin:0;padding:0;background-color:${BG};-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;font-size:1px;line-height:1px;color:${BG};">${e.preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${BG};">
<tr><td align="center" class="gb-pad" style="padding:48px 24px;">
<table role="presentation" width="520" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:520px;">
<tr><td style="padding:0 0 20px 0;font-family:${SERIF};font-size:20px;font-weight:600;letter-spacing:-0.2px;color:${INK};">glassbottles</td></tr>
${rule('0 0 36px 0')}
<tr><td>
<h1 class="gb-h1" style="margin:0 0 16px 0;font-family:${SERIF};font-size:27px;line-height:1.25;font-weight:500;color:${INK};">${e.heading}</h1>
${paragraphs}
</td></tr>
${stats}
<tr><td style="padding:12px 0 0 0;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td style="background-color:${SEAFOAM};border-radius:999px;"><a href="${e.cta.href}" style="display:inline-block;padding:13px 26px;font-family:${SANS};font-size:15px;font-weight:600;color:${BG};text-decoration:none;border-radius:999px;">${e.cta.label}</a></td>
</tr></table></td></tr>
${small}
${rule('40px 0 0 0')}
<tr><td style="padding:20px 0 0 0;font-family:${SANS};font-size:12px;line-height:1.6;color:${MUTED};">
${e.footer}
<br><br>glassbottles &middot; messages that drift &middot; <a href="${SITE}" style="color:${SEAFOAM};">glassbottles.app</a>
</td></tr>
</table>
</td></tr></table>
</body>
</html>`
}
