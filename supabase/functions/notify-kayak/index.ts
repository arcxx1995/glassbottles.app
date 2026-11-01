import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { emailHtml } from '../_shared/email.ts'
import { arrivalEmail, homeEmail } from './copy.ts'

// notify-kayak (063): {visit_id} tells a member a Kayak has arrived; {voyage_id}
// tells an owner theirs is home. Called by advance_kayaks through pg_net, which
// also retries anything that didn't land.
//
// notify-receiver's guarantees: the send is claimed before emailing, so at most
// one goes out. A 4xx is a definite non-send and releases the claim; a 5xx may have
// been delivered, so it keeps it, preferring a missed email to a duplicate.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!
const FROM_ADDRESS = Deno.env.get('RESEND_FROM_ADDRESS') ?? 'glassbottles <hello@glassbottles.app>'

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

async function commentCount(voyageId: string): Promise<number> {
  const { data: notes } = await supabase.from('kayak_notes').select('id').eq('voyage_id', voyageId)
  const { count } = await supabase
    .from('kayak_comments')
    .select('id', { count: 'exact', head: true })
    .in('note_id', (notes ?? []).map((n) => n.id))
    .eq('screen', 'ok')
    .is('reported_at', null)
  return count ?? 0
}

Deno.serve(async (req) => {
  // Service role only: advance_kayaks is the one caller.
  if (req.headers.get('Authorization')?.replace('Bearer ', '') !== SERVICE_ROLE_KEY) {
    return json({ error: 'Unauthorized' }, 401)
  }
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  const { visit_id, voyage_id } = (await req.json().catch(() => ({}))) as { visit_id?: string; voyage_id?: string }
  if (!visit_id && !voyage_id) return json({ error: 'visit_id or voyage_id required' }, 400)

  const table = visit_id ? 'kayak_visits' : 'voyages'
  const id = (visit_id ?? voyage_id)!

  let to: string
  let email: ReturnType<typeof arrivalEmail>
  if (visit_id) {
    const { data: visit } = await supabase
      .from('kayak_visits')
      .select('recipient_id, left_at, email_notified_at')
      .eq('id', visit_id)
      .single()
    if (!visit) return json({ error: 'visit not found' }, 404)
    // It may have sailed on while this waited; don't announce what's gone.
    if (visit.email_notified_at || visit.left_at) return json({ notified: false, reason: 'nothing to announce' })
    to = visit.recipient_id
    email = arrivalEmail()
  } else {
    const { data: voyage } = await supabase
      .from('voyages')
      .select('owner_id, state, end_reason, email_notified_at')
      .eq('id', voyage_id!)
      .single()
    if (!voyage) return json({ error: 'voyage not found' }, 404)
    if (voyage.email_notified_at || voyage.state !== 'home') return json({ notified: false, reason: 'nothing to announce' })
    to = voyage.owner_id
    email = homeEmail(voyage.end_reason, await commentCount(voyage_id!))
  }

  // FALSE = opted out in settings. Not stamped, so re-enabling can still reach them.
  const { data: profile } = await supabase
    .from('profiles')
    .select('email_notifications, suspended_at')
    .eq('id', to)
    .single()
  if (!profile || profile.email_notifications === false || profile.suspended_at) {
    return json({ notified: false, reason: 'not sending to this member' })
  }

  const { data: user } = await supabase.auth.admin.getUserById(to)
  const address = user?.user?.email
  if (!address) return json({ notified: false, reason: 'no email address on record' })

  const claimedAt = new Date().toISOString()
  const { data: claimed, error: claimErr } = await supabase
    .from(table)
    .update({ email_notified_at: claimedAt })
    .eq('id', id)
    .is('email_notified_at', null)
    .select('id')
  if (claimErr) return json({ notified: false, reason: 'claim failed' }, 500)
  if (!claimed?.length) return json({ notified: true, reason: 'already claimed' })

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

  // Resend allows about 2 a second and a run's posts land together, so a 429
  // backs off here rather than burning one of the cron's 8 tries.
  let res = await sendOnce()
  for (let attempt = 0; res.status === 429 && attempt < 3; attempt++) {
    await new Promise((r) => setTimeout(r, 2 ** attempt * 1000 + Math.random() * 500))
    res = await sendOnce()
  }

  if (!res.ok) {
    console.error('[notify-kayak] Resend error:', res.status)
    if (res.status < 500) {
      await supabase.from(table).update({ email_notified_at: null }).eq('id', id).eq('email_notified_at', claimedAt)
    }
    return json({ notified: false, reason: 'email delivery failed', status: res.status }, 502)
  }
  return json({ notified: true })
})
