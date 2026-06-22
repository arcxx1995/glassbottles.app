/**
 * Web Push client helpers (migration 027).
 *
 * Flow: register the service worker → ask the browser to subscribe with our
 * VAPID public key → persist the subscription server-side via the
 * save_push_subscription RPC (Supabase-direct, no Vercel route). Unsubscribe
 * reverses both. iOS only exposes PushManager when the PWA is installed to the
 * home screen, so `isPushSupported()` gates the UI.
 */
import { createClient } from '@/lib/supabase/client'

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ''

export function isPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  )
}

/** VAPID public key is base64url; PushManager wants a Uint8Array. */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const output = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i)
  return output
}

async function getRegistration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration('/sw.js')
  return existing ?? (await navigator.serviceWorker.register('/sw.js'))
}

/** True if this browser already has an active push subscription. */
export async function getPushSubscribed(): Promise<boolean> {
  if (!isPushSupported()) return false
  const reg = await navigator.serviceWorker.getRegistration('/sw.js')
  if (!reg) return false
  return (await reg.pushManager.getSubscription()) !== null
}

/** Request permission, subscribe, persist. Returns true on success. */
export async function enablePush(): Promise<boolean> {
  if (!isPushSupported() || !VAPID_PUBLIC_KEY) return false

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return false

  const reg = await getRegistration()
  await navigator.serviceWorker.ready

  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
    }))

  const json = sub.toJSON()
  const keys = json.keys ?? {}
  const supabase = createClient()
  const { error } = await supabase.rpc('save_push_subscription', {
    p_endpoint: sub.endpoint,
    p_p256dh: keys.p256dh ?? '',
    p_auth: keys.auth ?? '',
  })
  return !error
}

/** Unsubscribe this browser and forget it server-side. */
export async function disablePush(): Promise<boolean> {
  if (!isPushSupported()) return false
  const reg = await navigator.serviceWorker.getRegistration('/sw.js')
  const sub = reg ? await reg.pushManager.getSubscription() : null
  if (!sub) return true

  const endpoint = sub.endpoint
  await sub.unsubscribe().catch(() => {})
  const supabase = createClient()
  await supabase.rpc('delete_push_subscription', { p_endpoint: endpoint })
  return true
}
