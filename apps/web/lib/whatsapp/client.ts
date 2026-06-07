/**
 * WhatsApp Cloud API client — server-only.
 * NEVER import in client components.
 * Numbers must never be logged or returned to the client.
 */

const GRAPH_BASE = 'https://graph.facebook.com/v18.0'

export function validateE164(number: string): boolean {
  return /^\+[1-9]\d{6,14}$/.test(number)
}

function getEnv(key: string): string {
  const val = process.env[key]
  if (!val) throw new Error(`Missing env var: ${key}`)
  return val
}

export interface WhatsAppSendResult {
  ok: boolean
  messageId?: string
  error?: string
}

/**
 * Send a WhatsApp OTP template message.
 * Template: glassbottle_otp — one body text variable: the 6-digit code.
 * Required template body: "Your glassbottles verification code is {{1}}. Valid for 10 minutes. Do not share."
 * Register in Meta Business Manager before enabling WHATSAPP_OTP_ENABLED=true.
 * Retries once on transient failure.
 */
export async function sendOtpTemplate(
  to: string,
  otpCode: string
): Promise<WhatsAppSendResult> {
  const phoneId = getEnv('WHATSAPP_PHONE_NUMBER_ID')
  const token = getEnv('WHATSAPP_ACCESS_TOKEN')
  const templateName = process.env.WHATSAPP_OTP_TEMPLATE_NAME ?? 'glassbottle_otp'

  const payload = {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: templateName,
      language: { code: 'en' },
      components: [
        {
          type: 'body',
          parameters: [{ type: 'text', text: otpCode }],
        },
      ],
    },
  }

  const attempt = async (): Promise<WhatsAppSendResult> => {
    const res = await fetch(`${GRAPH_BASE}/${phoneId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    const data = await res.json()

    if (!res.ok) {
      return { ok: false, error: data?.error?.message ?? `HTTP ${res.status}` }
    }

    return { ok: true, messageId: data.messages?.[0]?.id }
  }

  const first = await attempt()
  if (first.ok) return first

  await new Promise((r) => setTimeout(r, 1000))
  return attempt()
}

/**
 * Send a WhatsApp template message.
 * Template: glassbottle_received — expects one URL button parameter (app_link).
 * Retries once on transient failure.
 */
export async function sendGlassbottleReceivedTemplate(
  to: string,
  inboxUrl: string
): Promise<WhatsAppSendResult> {
  const phoneId = getEnv('WHATSAPP_PHONE_NUMBER_ID')
  const token = getEnv('WHATSAPP_ACCESS_TOKEN')
  const templateName = process.env.WHATSAPP_TEMPLATE_NAME ?? 'glassbottle_received'

  const payload = {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: templateName,
      language: { code: 'en' },
      components: [
        {
          type: 'button',
          sub_type: 'url',
          index: 0,
          parameters: [{ type: 'text', text: inboxUrl }],
        },
      ],
    },
  }

  const attempt = async (): Promise<WhatsAppSendResult> => {
    const res = await fetch(`${GRAPH_BASE}/${phoneId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    const data = await res.json()

    if (!res.ok) {
      // Never include `to` in the error message
      return { ok: false, error: data?.error?.message ?? `HTTP ${res.status}` }
    }

    return { ok: true, messageId: data.messages?.[0]?.id }
  }

  const first = await attempt()
  if (first.ok) return first

  // One retry after 1s for transient failures
  await new Promise((r) => setTimeout(r, 1000))
  return attempt()
}
