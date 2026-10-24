// moderation-alert — one email when the moderation queue has new items
// (migration 051). Called every 30 min by the moderation-alert cron through
// pg_net, only when something new arrived since the last alert.
//
// Secrets: RESEND_API_KEY (shared with notify-receiver), ADMIN_ALERT_EMAIL.

const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const ADMIN_ALERT_EMAIL = Deno.env.get('ADMIN_ALERT_EMAIL')
const FROM_ADDRESS = Deno.env.get('RESEND_FROM_ADDRESS') ?? 'glassbottles <hello@glassbottles.app>'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  // Service role only — the cron is the one caller.
  if (req.headers.get('Authorization')?.replace('Bearer ', '') !== SERVICE_ROLE_KEY) {
    return json({ error: 'Unauthorized' }, 401)
  }
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })
  if (!RESEND_API_KEY || !ADMIN_ALERT_EMAIL) return json({ error: 'alert email not configured' }, 500)

  const body = (await req.json().catch(() => ({}))) as { new?: number; open?: number }
  const fresh = Number(body.new) || 0
  const open = Number(body.open) || 0

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: FROM_ADDRESS,
      to: [ADMIN_ALERT_EMAIL],
      subject: `Moderation: ${fresh} new item${fresh === 1 ? '' : 's'} to review`,
      html: `<p>${fresh} new item${fresh === 1 ? '' : 's'} in the moderation queue (${open} open).</p>
             <p><a href="https://glassbottles.app/admin/moderation">Review them</a></p>`,
      text: `${fresh} new in the moderation queue (${open} open). https://glassbottles.app/admin/moderation`,
    }),
  })
  if (!res.ok) {
    console.error('[moderation-alert] Resend error', res.status)
    return json({ error: 'send failed' }, 502)
  }
  return json({ sent: true })
})
