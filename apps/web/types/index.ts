export interface Profile {
  id: string
  timezone: string
  email_notifications: boolean
  created_at: string
  last_active: string | null
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
}

export interface DailyQuota {
  user_id: string
  date: string
  has_sent: boolean
  has_received: boolean
}

export type BottleSendStatus = 'idle' | 'composing' | 'throwing' | 'thrown'
export type BottleReceiveStatus = 'idle' | 'pending' | 'received' | 'read'

// ─── Mood check-in + streak (migration 025) ──────────────────────────────────

/** Daily mood as a weather metaphor. Ordered calm→stormy for the picker. */
export type Mood = 'sunny' | 'calm' | 'foggy' | 'stormy'

export interface MoodStreakStatus {
  today_mood: Mood | null
  checked_in_today: boolean
  current_streak: number
  longest_streak: number
  /** Live streak that hasn't checked in yet today — drives a gentle nudge. */
  at_risk: boolean
}

/** Result of check_in_mood — `advanced` is false when only re-setting today's mood. */
export interface MoodCheckInResult {
  mood: Mood
  current_streak: number
  longest_streak: number
  checked_in_today: boolean
  advanced: boolean
}

// ─── Save shelf (migration 026) ──────────────────────────────────────────────

/** A received bottle kept on the shelf — a Bottle plus when it was saved. */
export interface SavedBottle extends Bottle {
  saved_at: string
}

/** Result of save_bottle / unsave_bottle. `capped` = free shelf full. */
export interface SaveResult {
  saved: boolean
  capped?: boolean
  saved_count: number
  cap?: number
}
