export interface Profile {
  id: string
  timezone: string
  email_notifications: boolean
  created_at: string
  last_active: string | null
  /** 051: null = must confirm 18+ / accept terms before using the app.
   *  Undefined on the session-seeded profile, before /api/profile answers. */
  age_confirmed_at?: string | null
  suspended_at?: string | null
}

/** Reasons a receiver can give when reporting a bottle (051 report_bottle). */
export type ReportReason = 'sexual' | 'harassment' | 'spam' | 'contact' | 'other'

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
}

export interface DailyQuota {
  user_id: string
  date: string
  has_sent: boolean
  has_received: boolean
}

export type BottleSendStatus = 'idle' | 'composing' | 'throwing' | 'thrown'
export type BottleReceiveStatus = 'idle' | 'pending' | 'received' | 'read'
