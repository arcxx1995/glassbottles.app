// Web Push on this device (migration 044). Register the service worker,
// subscribe with the VAPID public key, store the subscription through the
// save_push_subscription RPC (Supabase-direct). iOS only exposes PushManager
// to a home-screen web app, so the UI asks for the install there instead.
import { createClient } from '@/lib/supabase/client'

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ''

export type PushState =
  | 'off' //          supported, not subscribed, never asked
  | 'on' //           subscribed on this device
  | 'blocked' //      the user said no in the browser prompt
  | 'install' //      iOS Safari tab: add to Home Screen first
  | 'unsupported' //  no push here (or not configured)

function isIos() {
  return /iP(hone|ad|od)/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) // iPadOS
}

function isStandalone() {
  return window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
}

function supported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

export async function getPushState(): Promise<PushState> {
  if (typeof window === 'undefined' || !VAPID_PUBLIC_KEY) return 'unsupported'
  if (!supported()) return isIos() && !isStandalone() ? 'install' : 'unsupported'
  if (Notification.permission === 'denied') return 'blocked'
  const reg = await navigator.serviceWorker.getRegistration('/sw.js')
  return (await reg?.pushManager.getSubscription()) ? 'on' : 'off'
}

/** VAPID keys are base64url; PushManager wants bytes. */
function keyBytes(base64url: string): Uint8Array {
  const base64 = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4))
    .replace(/-/g, '+')
    .replace(/_/g, '/')
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
}

/** Ask, subscribe, store. Must run inside a user gesture (the browser prompt). */
export async function enablePush(): Promise<PushState> {
  if (!supported() || !VAPID_PUBLIC_KEY) return 'unsupported'
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return permission === 'denied' ? 'blocked' : 'off'

  const reg =
    (await navigator.serviceWorker.getRegistration('/sw.js')) ??
    (await navigator.serviceWorker.register('/sw.js'))
  await navigator.serviceWorker.ready
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: keyBytes(VAPID_PUBLIC_KEY) as BufferSource,
    }))
  const { keys } = sub.toJSON()
  const { error } = await createClient().rpc('save_push_subscription', {
    p_endpoint: sub.endpoint,
    p_p256dh: keys?.p256dh ?? '',
    p_auth: keys?.auth ?? '',
  })
  return error ? 'off' : 'on'
}

/** Unsubscribe this device and forget it server-side. */
export async function disablePush(): Promise<PushState> {
  const reg = await navigator.serviceWorker.getRegistration('/sw.js')
  const sub = await reg?.pushManager.getSubscription()
  if (sub) {
    const { endpoint } = sub
    await sub.unsubscribe().catch(() => {})
    await createClient().rpc('delete_push_subscription', { p_endpoint: endpoint })
  }
  return 'off'
}
