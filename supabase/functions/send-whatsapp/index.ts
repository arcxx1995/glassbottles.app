import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

async function sendWhatsAppMessage(
  whatsappNumber: string
): Promise<{ ok: boolean; messageId?: string; error?: string }> {
  const phoneId = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID')!
  const token = Deno.env.get('WHATSAPP_ACCESS_TOKEN')!
  const templateName = Deno.env.get('WHATSAPP_TEMPLATE_NAME') ?? 'glassbottle_received'
  const appUrl = Deno.env.get('NEXT_PUBLIC_APP_URL') ?? 'https://glassbottles.app'

  const body = {
    messaging_product: 'whatsapp',
    to: whatsappNumber,
    type: 'template',
    template: {
      name: templateName,
      language: { code: 'en' },
      components: [
        {
          type: 'button',
          sub_type: 'url',
          index: 0,
          parameters: [{ type: 'text', text: `${appUrl}/inbox` }],
        },
      ],
    },
  }

  const res = await fetch(
    `https://graph.facebook.com/v18.0/${phoneId}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }
  )

  const data = await res.json()
  if (!res.ok) {
    // Do NOT log whatsapp_number — log Meta's error object only
    return { ok: false, error: JSON.stringify(data) }
  }

  return { ok: true, messageId: data.messages?.[0]?.id }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  // Only service role may invoke this function — blocks open WhatsApp relay
  const authHeader = req.headers.get('Authorization') ?? ''
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  if (authHeader !== `Bearer ${serviceRoleKey}`) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 })
  }

  const { bottle_id, receiver_id } = await req.json()

  if (!bottle_id || !receiver_id) {
    return new Response(JSON.stringify({ error: 'bottle_id and receiver_id required' }), { status: 400 })
  }

  // Assert receiver_id matches this bottle — prevents misdirected notifications
  const { data: bottle, error: bottleErr } = await supabase
    .from('bottles')
    .select('receiver_id')
    .eq('id', bottle_id)
    .single()

  if (bottleErr || !bottle || bottle.receiver_id !== receiver_id) {
    return new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 })
  }

  // Look up whatsapp_number server-side — never trust caller-supplied number
  const { data: profile } = await supabase
    .from('profiles')
    .select('whatsapp_number, whatsapp_verified')
    .eq('id', receiver_id)
    .single()

  const whatsapp_number = profile?.whatsapp_number

  if (!whatsapp_number || !profile?.whatsapp_verified) {
    await supabase.from('whatsapp_logs').insert({
      bottle_id,
      receiver_id,
      status: 'failed',
      meta: { reason: whatsapp_number ? 'not_verified' : 'no_number' },
    })
    return new Response(
      JSON.stringify({ sent: false, reason: whatsapp_number ? 'not_verified' : 'no_number' }),
      { status: 200 }
    )
  }

  // ── Send with one retry on transient failure ──────────────────────────────
  let result = await sendWhatsAppMessage(whatsapp_number)

  if (!result.ok) {
    await new Promise((r) => setTimeout(r, 1000))
    result = await sendWhatsAppMessage(whatsapp_number)
  }

  const status = result.ok ? 'sent' : 'failed'

  await supabase.from('whatsapp_logs').insert({
    bottle_id,
    receiver_id,
    status,
    meta: result.ok
      ? { message_id: result.messageId }
      : { error: result.error },
  })

  return new Response(
    JSON.stringify({ sent: result.ok, message_id: result.messageId }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  )
})
