import type { BottleStyle, CurrentId, Vibe, Weather } from '@/lib/dressing'

export interface Profile {
  id: string
  timezone: string
  email_notifications: boolean
  created_at: string
  last_active: string | null
  /** Joined current (migration 042) — cosmetic, free. */
  current?: CurrentId | null
}

export interface Bottle {
  id: string
  // sender_id is intentionally omitted from all API responses — anonymity.
  // It is typed as optional so the compiler catches any attempt to read it
  // from a client-context shape. The field is present only on sender's own
  // queries (bottles/send response) and never on received bottle queries.
  sender_id?: string
  // receiver_id is omitted from sent-bottle API responses (anonymity).
  // It is present on received-bottle shapes but that is receiver-private.
  receiver_id?: string | null
  message: string
  sent_at: string
  received_at: string | null
  read_at: string | null
  is_read: boolean
  is_reported: boolean
  is_stale: boolean
  day_key: string
  // How it was dressed (migration 042). Absent on pre-042 shapes.
  style?: BottleStyle | null
  weather?: Weather | null
  vibe?: Vibe | null
  current?: CurrentId | null
  /** Safety screen verdict (migration 043) — sender's own shapes only. */
  screen?: 'ok' | 'crisis' | 'held' | null
  /** When the receiver tapped "this reached me" (migration 044). */
  rippled_at?: string | null
  /** Kept by the receiver as a keepsake (migration 045). */
  kept_at?: string | null
}

export interface DailyQuota {
  user_id: string
  date: string
  has_sent: boolean
  has_received: boolean
}

export type BottleSendStatus = 'idle' | 'composing' | 'throwing' | 'thrown'
export type BottleReceiveStatus = 'idle' | 'pending' | 'received' | 'read'
