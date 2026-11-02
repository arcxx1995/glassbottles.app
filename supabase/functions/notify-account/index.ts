import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { emailHtml } from '../_shared/email.ts'
import { accountEmail } from './copy.ts'

// notify-account (065): tells someone an admin has acted on their account, once
// per notice. Sent even with notifications off, because it's about the account
// itself. Claimed before sending, as in notify-receiver: a 4xx releases the claim
// for the hourly retry, and a 5xx keeps it, preferring a missed email to a double.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!
const FROM_ADDRESS = Deno.env.get('RESEND_FROM_ADDRESS') ?? 'glassbottles <hello@glassbottles.app>'

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.headers.get('Authorization')?.replace('Bearer ', '') !== SERVICE_ROLE_KEY) {
    return json({ error: 'Unauthorized' }, 401)
  }
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  const { notice_id } = (await req.json().catch(() => ({}))) as { notice_id?: string }
  if (!notice_id) return json({ error: 'notice_id required' }, 400)

  const { data: notice } = await supabase
    .from('account_notices')
    .select('user_id, kind, body, wants_email, emailed_at')
    .eq('id', notice_id)
    .single()
  if (!notice) return json({ error: 'notice not found' }, 404)
  if (!notice.wants_email || notice.emailed_at) return json({ notified: false, reason: 'nothing to send' })

  const { data: user } = await supabase.auth.admin.getUserById(notice.user_id)
  const address = user?.user?.email
  if (!address) return json({ notified: false, reason: 'no email address on record' })

  const claimedAt = new Date().toISOString()
  const { data: claimed, error: claimErr } = await supabase
    .from('account_notices')
    .update({ emailed_at: claimedAt })
    .eq('id', notice_id)
    .is('emailed_at', null)
    .select('id')
  if (claimErr) return json({ notified: false, reason: 'claim failed' }, 500)
  if (!claimed?.length) return json({ notified: true, reason: 'already claimed' })

  const email = accountEmail(notice.kind, notice.body)
  const sendOnce = () =>
    fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM_ADDRESS,
        to: [address],
        subject: email.subject,
        html: emailHtml(email.layout),
        text: email.text,
      }),
    })

  let res = await sendOnce()
  for (let attempt = 0; res.status === 429 && attempt < 3; attempt++) {
    await new Promise((r) => setTimeout(r, 2 ** attempt * 1000 + Math.random() * 500))
    res = await sendOnce()
  }
  if (!res.ok) {
    console.error('[notify-account] Resend error:', res.status)
    if (res.status < 500) {
      await supabase.from('account_notices').update({ emailed_at: null }).eq('id', notice_id).eq('emailed_at', claimedAt)
    }
    return json({ notified: false, reason: 'email delivery failed', status: res.status }, 502)
  }
  return json({ notified: true })
})
