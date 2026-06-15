'use client'

import type { AuthError } from '@supabase/supabase-js'

// ─── Validation ───────────────────────────────────────────────────────────────

// Pragmatic email check — good enough for client-side gating; server is source of truth.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const PASSWORD_MIN = 8

export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email.trim())
}

export function isValidPassword(password: string): boolean {
  return password.length >= PASSWORD_MIN
}

// ─── Error-code → copy mapping (match on error.code, never error.message) ──────

const GENERIC_FALLBACK =
  'This email is already registered with a different sign-in method. ' +
  'Please use the method you originally signed up with.'

/**
 * Maps a Supabase AuthError to friendly copy keyed on `error.code`.
 * `context` lets us pick the right message when the same code could appear in
 * multiple flows. Returns the generic fallback for anything unrecognised.
 */
export function mapAuthError(
  error: AuthError,
  context: 'sign-in' | 'sign-up' | 'reset',
): string {
  switch (error.code) {
    case 'invalid_credentials':
      // ONE generic message — never reveal whether email or password was wrong.
      return 'Incorrect email or password.'
    case 'email_not_confirmed':
      return 'Please confirm your email first. Check your inbox.'
    case 'user_already_exists':
    case 'email_exists':
      return 'An account with this email already exists. Sign in instead.'
    case 'weak_password':
      return `Password must be at least ${PASSWORD_MIN} characters.`
    case 'over_email_send_rate_limit':
    case 'over_request_rate_limit':
      return 'Too many attempts. Please wait a moment and try again.'
    case 'same_password':
      return 'Your new password must be different from the old one.'
    default:
      if (context === 'sign-up') return GENERIC_FALLBACK
      return error.message || 'Something went wrong. Please try again.'
  }
}

// ─── Shared layout classes ─────────────────────────────────────────────────────
// One source of truth so every auth screen shares the same box size, input and
// primary-button proportions.

export const AUTH_BOX_CLASS = 'w-full max-w-[20rem] flex flex-col gap-6'

export const AUTH_INPUT_CLASS =
  'w-full bg-ocean-mid rounded-2xl border border-white/5 px-4 py-3 font-ui ' +
  'text-sand placeholder:text-sand/25 outline-none text-sm ' +
  'focus:border-seafoam/30 transition-colors'

export const AUTH_PRIMARY_BTN_CLASS =
  'flex items-center justify-center gap-2 py-3 rounded-2xl bg-seafoam ' +
  'text-ocean-deep font-ui font-semibold text-sm tracking-wide ' +
  'transition-all duration-150 active:scale-[0.97] hover:brightness-110 ' +
  'disabled:opacity-50 disabled:pointer-events-none'

export const AUTH_CARD_CLASS =
  'bg-ocean-mid rounded-3xl border border-white/5 p-6'

// ─── Shared UI bits ────────────────────────────────────────────────────────────

export function OrDivider() {
  return (
    <div className="flex items-center gap-4 py-1">
      <span className="h-px flex-1 bg-white/10" />
      <span className="font-ui text-xs text-sand/30 uppercase tracking-wider">or</span>
      <span className="h-px flex-1 bg-white/10" />
    </div>
  )
}

export function FieldError({ children }: { children: React.ReactNode }) {
  if (!children) return null
  return <p className="font-ui text-xs text-coral px-1 -mt-1">{children}</p>
}

export function FormError({ children }: { children: React.ReactNode }) {
  if (!children) return null
  return <p className="font-ui text-sm text-coral px-1">{children}</p>
}
