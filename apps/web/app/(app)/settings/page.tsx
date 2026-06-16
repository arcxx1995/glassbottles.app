'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { Bell, LogOut, Shield, Info, Mail, KeyRound, Trash2 } from 'lucide-react'
import type { AuthError } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import {
  isValidEmail,
  isValidPassword,
  PASSWORD_MIN,
  mapAuthError,
  AUTH_INPUT_CLASS,
} from '@/components/auth/authShared'
import { useAppDispatch, useAppSelector } from '@/store'
import { selectUser, setUser } from '@/store/authSlice'
import type { Profile } from '@/types'

// ─── Animation helpers ────────────────────────────────────────────────────────
const EASE_OUT = [0.25, 0.46, 0.45, 0.94] as const

function staggerItem(i: number) {
  return {
    initial: { opacity: 0, y: 10 } as const,
    animate: { opacity: 1, y: 0 } as const,
    transition: { duration: 0.35, ease: EASE_OUT, delay: i * 0.06 },
  }
}

// ─── Row component ────────────────────────────────────────────────────────────

interface RowProps {
  icon: React.ReactNode
  iconBg: string
  iconColor: string
  label: string
  meta?: string
  onClick?: () => void
  destructive?: boolean
}

function SettingsRow({
  icon,
  iconBg,
  iconColor,
  label,
  meta,
  onClick,
  destructive = false,
}: RowProps) {
  return (
    <div
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={(e) => {
        if (onClick && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault()
          onClick()
        }
      }}
      className={`
        flex items-center gap-4 bg-ocean-mid rounded-3xl border border-white/5 p-5
        transition-colors duration-200 group w-full text-left
        ${onClick
          ? destructive
            ? 'cursor-pointer hover:border-coral/20'
            : 'cursor-pointer hover:border-seafoam/20'
          : ''
        }
      `}
    >
      {/* Icon tile */}
      <div className={`w-9 h-9 rounded-xl ${iconBg} flex items-center justify-center shrink-0`}>
        <span className={iconColor}>{icon}</span>
      </div>

      {/* Text */}
      <div className="flex flex-col flex-1 min-w-0">
        <span
          className={`
            font-ui text-sm font-medium transition-colors duration-200 truncate
            ${destructive
              ? 'text-coral/70 group-hover:text-coral'
              : 'text-sand/60 group-hover:text-sand/90'
            }
          `}
        >
          {label}
        </span>
        {meta && (
          <span className="font-ui text-xs text-sand/30 mt-0.5 leading-snug truncate">
            {meta}
          </span>
        )}
      </div>
    </div>
  )
}

// ─── Toggle row ───────────────────────────────────────────────────────────────

interface ToggleRowProps {
  icon: React.ReactNode
  iconBg: string
  iconColor: string
  label: string
  meta?: string
  checked: boolean
  disabled?: boolean
  onChange: (next: boolean) => void
}

function ToggleRow({
  icon,
  iconBg,
  iconColor,
  label,
  meta,
  checked,
  disabled = false,
  onChange,
}: ToggleRowProps) {
  return (
    <div className="flex items-center gap-4 bg-ocean-mid rounded-3xl border border-white/5 p-5">
      <div className={`w-9 h-9 rounded-xl ${iconBg} flex items-center justify-center shrink-0`}>
        <span className={iconColor}>{icon}</span>
      </div>

      <div className="flex flex-col flex-1 min-w-0">
        <span className="font-ui text-sm font-medium text-sand/60 truncate">{label}</span>
        {meta && (
          <span className="font-ui text-xs text-sand/30 mt-0.5 leading-snug truncate">{meta}</span>
        )}
      </div>

      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative shrink-0 w-11 h-6 rounded-full transition-colors duration-200',
          checked ? 'bg-seafoam/80' : 'bg-white/10',
          disabled && 'opacity-50 pointer-events-none'
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-sand shadow-sm transition-transform duration-200',
            checked && 'translate-x-5'
          )}
        />
      </button>
    </div>
  )
}

// ─── Section label ────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-ui text-[10px] text-sand/30 uppercase tracking-widest px-1 mb-2 mt-2">
      {children}
    </p>
  )
}

// ─── Change-email row ───────────────────────────────────────────────────────────
// Wires to Supabase Auth. updateUser({ email }) with double_confirm_changes=true
// sends the branded email-change template to BOTH the current and new address;
// the email only changes once both links are clicked. No API route, no DB write —
// Auth owns the email (profiles has no email column).

function mapChangeEmailError(error: AuthError): string {
  switch (error.code) {
    case 'email_exists':
    case 'user_already_exists':
      return 'That email is already in use by another account.'
    case 'email_address_invalid':
      return 'That email address looks invalid.'
    case 'over_email_send_rate_limit':
    case 'over_request_rate_limit':
      return 'Too many attempts. Please wait a moment and try again.'
    case 'same_email':
      return "That's already your email."
    default:
      return error.message || 'Could not start the change. Please try again.'
  }
}

function ChangeEmailRow({ currentEmail }: { currentEmail: string | null }) {
  const supabase = createClient()
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState('')
  const [touched, setTouched] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  const valid = isValidEmail(value)
  const isSame =
    currentEmail != null && value.trim().toLowerCase() === currentEmail.toLowerCase()

  function close() {
    setOpen(false)
    setValue('')
    setTouched(false)
    setError(null)
    setSent(false)
  }

  async function handleSave() {
    setTouched(true)
    setError(null)
    if (!valid) return
    if (isSame) {
      setError("That's already your email.")
      return
    }
    setLoading(true)
    const { error: err } = await supabase.auth.updateUser(
      { email: value.trim() },
      { emailRedirectTo: `${location.origin}/auth/callback?next=/settings` },
    )
    setLoading(false)
    if (err) {
      setError(mapChangeEmailError(err))
      return
    }
    setSent(true)
  }

  return (
    <div className="bg-ocean-mid rounded-3xl border border-white/5 overflow-hidden">
      {/* Trigger */}
      <button
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        aria-expanded={open}
        className="flex items-center gap-4 p-5 w-full text-left group cursor-pointer"
      >
        <div className="w-9 h-9 rounded-xl bg-seafoam/10 flex items-center justify-center shrink-0">
          <Mail size={17} strokeWidth={1.5} className="text-seafoam" />
        </div>
        <div className="flex flex-col flex-1 min-w-0">
          <span className="font-ui text-sm font-medium text-sand/60 group-hover:text-sand/90 transition-colors duration-200 truncate">
            Change email
          </span>
          <span className="font-ui text-xs text-sand/30 mt-0.5 leading-snug truncate">
            {currentEmail ?? 'Update the address tied to your account'}
          </span>
        </div>
        <span
          className={cn(
            'font-ui text-sand/30 text-lg leading-none transition-transform duration-200',
            open && 'rotate-90',
          )}
        >
          ›
        </span>
      </button>

      {/* Expandable body */}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: EASE_OUT }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-5 pt-0 flex flex-col gap-3">
              {sent ? (
                <p className="font-ui text-xs text-seafoam/90 leading-relaxed">
                  Confirmation links sent. Check both your current and new inbox to
                  finish the change — your email updates once both are confirmed.
                </p>
              ) : (
                <>
                  <input
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    placeholder="new@email.com"
                    value={value}
                    disabled={loading}
                    onChange={(e) => setValue(e.target.value)}
                    onBlur={() => setTouched(true)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        void handleSave()
                      }
                    }}
                    className={AUTH_INPUT_CLASS}
                  />
                  {touched && !valid && value.length > 0 && (
                    <p className="font-ui text-xs text-coral px-1 -mt-1">
                      Enter a valid email address.
                    </p>
                  )}
                  {error && (
                    <p className="font-ui text-xs text-coral px-1 -mt-1">{error}</p>
                  )}
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={close}
                      disabled={loading}
                      className="flex-1 py-2.5 rounded-2xl border border-white/10 font-ui text-sm text-sand/60 transition-colors hover:text-sand/90 hover:border-white/20 disabled:opacity-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleSave()}
                      disabled={loading || !valid}
                      className="flex-1 py-2.5 rounded-2xl bg-seafoam text-ocean-deep font-ui font-semibold text-sm transition-all active:scale-[0.97] hover:brightness-110 disabled:opacity-50 disabled:pointer-events-none"
                    >
                      {loading ? 'Sending…' : 'Save'}
                    </button>
                  </div>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── Change-password row ─────────────────────────────────────────────────────
// Client-side supabase.auth.updateUser({ password }). secure_password_change is
// off (config.toml), so no reauthentication step is required.

function ChangePasswordRow() {
  const supabase = createClient()
  const [open, setOpen] = useState(false)
  const [pw, setPw] = useState('')
  const [confirm, setConfirm] = useState('')
  const [touched, setTouched] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const pwOk = isValidPassword(pw)
  const matches = pw === confirm
  const canSave = pwOk && matches

  function close() {
    setOpen(false)
    setPw('')
    setConfirm('')
    setTouched(false)
    setError(null)
    setDone(false)
  }

  async function handleSave() {
    setTouched(true)
    setError(null)
    if (!canSave) return
    setLoading(true)
    const { error: err } = await supabase.auth.updateUser({ password: pw })
    setLoading(false)
    if (err) {
      setError(mapAuthError(err, 'reset'))
      return
    }
    setDone(true)
  }

  return (
    <div className="bg-ocean-mid rounded-3xl border border-white/5 overflow-hidden">
      <button
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        aria-expanded={open}
        className="flex items-center gap-4 p-5 w-full text-left group cursor-pointer"
      >
        <div className="w-9 h-9 rounded-xl bg-seafoam/10 flex items-center justify-center shrink-0">
          <KeyRound size={17} strokeWidth={1.5} className="text-seafoam" />
        </div>
        <div className="flex flex-col flex-1 min-w-0">
          <span className="font-ui text-sm font-medium text-sand/60 group-hover:text-sand/90 transition-colors duration-200 truncate">
            Change password
          </span>
          <span className="font-ui text-xs text-sand/30 mt-0.5 leading-snug truncate">
            Update the password you sign in with
          </span>
        </div>
        <span
          className={cn(
            'font-ui text-sand/30 text-lg leading-none transition-transform duration-200',
            open && 'rotate-90',
          )}
        >
          ›
        </span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: EASE_OUT }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-5 pt-0 flex flex-col gap-3">
              {done ? (
                <p className="font-ui text-xs text-seafoam/90 leading-relaxed">
                  Password updated. You&rsquo;ll use it next time you sign in.
                </p>
              ) : (
                <>
                  <input
                    type="password"
                    autoComplete="new-password"
                    placeholder={`New password (min ${PASSWORD_MIN})`}
                    value={pw}
                    disabled={loading}
                    onChange={(e) => setPw(e.target.value)}
                    onBlur={() => setTouched(true)}
                    className={AUTH_INPUT_CLASS}
                  />
                  <input
                    type="password"
                    autoComplete="new-password"
                    placeholder="Confirm new password"
                    value={confirm}
                    disabled={loading}
                    onChange={(e) => setConfirm(e.target.value)}
                    onBlur={() => setTouched(true)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        void handleSave()
                      }
                    }}
                    className={AUTH_INPUT_CLASS}
                  />
                  {touched && pw.length > 0 && !pwOk && (
                    <p className="font-ui text-xs text-coral px-1 -mt-1">
                      Password must be at least {PASSWORD_MIN} characters.
                    </p>
                  )}
                  {touched && pwOk && confirm.length > 0 && !matches && (
                    <p className="font-ui text-xs text-coral px-1 -mt-1">
                      Passwords don&rsquo;t match.
                    </p>
                  )}
                  {error && (
                    <p className="font-ui text-xs text-coral px-1 -mt-1">{error}</p>
                  )}
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={close}
                      disabled={loading}
                      className="flex-1 py-2.5 rounded-2xl border border-white/10 font-ui text-sm text-sand/60 transition-colors hover:text-sand/90 hover:border-white/20 disabled:opacity-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleSave()}
                      disabled={loading || !canSave}
                      className="flex-1 py-2.5 rounded-2xl bg-seafoam text-ocean-deep font-ui font-semibold text-sm transition-all active:scale-[0.97] hover:brightness-110 disabled:opacity-50 disabled:pointer-events-none"
                    >
                      {loading ? 'Saving…' : 'Update'}
                    </button>
                  </div>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── Delete-account row ──────────────────────────────────────────────────────
// Irreversible hard delete. The actual deletion runs server-side
// (POST /api/account/delete, service role) because Supabase has no client-side
// user delete. Type-to-confirm guards against accidents.

const DELETE_PHRASE = 'DELETE'

function DeleteAccountRow() {
  const router = useRouter()
  const supabase = createClient()
  const [open, setOpen] = useState(false)
  const [phrase, setPhrase] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const confirmed = phrase.trim().toUpperCase() === DELETE_PHRASE

  function close() {
    setOpen(false)
    setPhrase('')
    setError(null)
  }

  async function handleDelete() {
    if (!confirmed) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/account/delete', { method: 'POST' })
      if (!res.ok) throw new Error('delete failed')
      // Clear the local session/Redux, then leave the app for good.
      await supabase.auth.signOut({ scope: 'local' }).catch(() => {})
      router.replace('/')
    } catch {
      setLoading(false)
      setError('Could not delete your account. Please try again.')
    }
  }

  return (
    <div className="bg-ocean-mid rounded-3xl border border-white/5 overflow-hidden">
      <button
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        aria-expanded={open}
        className="flex items-center gap-4 p-5 w-full text-left group cursor-pointer"
      >
        <div className="w-9 h-9 rounded-xl bg-coral/10 flex items-center justify-center shrink-0">
          <Trash2 size={17} strokeWidth={1.5} className="text-coral" />
        </div>
        <div className="flex flex-col flex-1 min-w-0">
          <span className="font-ui text-sm font-medium text-coral/70 group-hover:text-coral transition-colors duration-200 truncate">
            Delete account
          </span>
          <span className="font-ui text-xs text-sand/30 mt-0.5 leading-snug truncate">
            Permanently erase your account and all your bottles
          </span>
        </div>
        <span
          className={cn(
            'font-ui text-sand/30 text-lg leading-none transition-transform duration-200',
            open && 'rotate-90',
          )}
        >
          ›
        </span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: EASE_OUT }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-5 pt-0 flex flex-col gap-3">
              <p className="font-ui text-xs text-sand/50 leading-relaxed">
                This can&rsquo;t be undone. Your account, profile, and every bottle
                you&rsquo;ve sent or received are permanently deleted. Type{' '}
                <span className="text-coral font-semibold">{DELETE_PHRASE}</span> to
                confirm.
              </p>
              <input
                type="text"
                autoComplete="off"
                autoCapitalize="characters"
                placeholder={DELETE_PHRASE}
                value={phrase}
                disabled={loading}
                onChange={(e) => setPhrase(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void handleDelete()
                  }
                }}
                className={AUTH_INPUT_CLASS}
              />
              {error && (
                <p className="font-ui text-xs text-coral px-1 -mt-1">{error}</p>
              )}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={close}
                  disabled={loading}
                  className="flex-1 py-2.5 rounded-2xl border border-white/10 font-ui text-sm text-sand/60 transition-colors hover:text-sand/90 hover:border-white/20 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void handleDelete()}
                  disabled={loading || !confirmed}
                  className="flex-1 py-2.5 rounded-2xl bg-coral text-ocean-deep font-ui font-semibold text-sm transition-all active:scale-[0.97] hover:brightness-110 disabled:opacity-50 disabled:pointer-events-none"
                >
                  {loading ? 'Deleting…' : 'Delete forever'}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const router = useRouter()
  const supabase = createClient()
  const dispatch = useAppDispatch()
  const user = useAppSelector(selectUser)

  // Email comes from Supabase Auth session, not the profiles table
  const [email, setEmail] = useState<string | null>(null)

  // Optimistic mirror of profiles.email_notifications (defaults on).
  const [emailNotifs, setEmailNotifs] = useState<boolean>(
    user?.email_notifications ?? true
  )
  const [notifsSaving, setNotifsSaving] = useState(false)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setEmail(data.user?.email ?? null)
    })
  }, [supabase])

  // Keep the local toggle in sync once the profile hydrates into Redux.
  useEffect(() => {
    if (user) setEmailNotifs(user.email_notifications)
  }, [user])

  async function handleToggleNotifs(next: boolean) {
    setEmailNotifs(next) // optimistic
    setNotifsSaving(true)
    try {
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email_notifications: next }),
      })
      if (!res.ok) throw new Error('save failed')
      const profile = (await res.json()) as Profile
      dispatch(setUser(profile)) // single source of truth
    } catch {
      setEmailNotifs(!next) // revert on failure
    } finally {
      setNotifsSaving(false)
    }
  }

  async function handleSignOut() {
    // scope:'local' clears the session from the browser immediately with no
    // Auth-server round-trip. The default global scope revokes the refresh token
    // server-side first, so the await blocked navigation for the whole network
    // call (the slow sign-out). Local is instant; the token expires server-side
    // on its own, and onAuthStateChange(SIGNED_OUT) still clears Redux.
    await supabase.auth.signOut({ scope: 'local' })
    router.replace('/sign-in')
  }

  return (
    <div className="flex h-full flex-col overflow-hidden pt-14 px-5">
      {/* Settings fits the viewport — no scroll (overflow-hidden frame) */}
      <motion.div className="mb-8" {...staggerItem(0)}>
        <h1 className="font-display text-2xl text-sand">Settings</h1>
        {email && (
          <p className="font-mono text-xs text-sand/30 mt-1 truncate max-w-[240px]">
            {email}
          </p>
        )}
        {/* Member since — profile has created_at */}
        {user?.created_at && (
          <p className="font-mono text-[10px] text-sand/20 mt-0.5">
            member since{' '}
            {new Date(user.created_at).toLocaleDateString('en-US', {
              month: 'long',
              year: 'numeric',
            })}
          </p>
        )}
      </motion.div>

      {/* Explicit columns side by side. Sections stack vertically WITHIN a
          column, so expanding a row cascades (pushes) only its column-mates —
          it never re-flows the other columns. Account is the starting column. */}
      <div className="flex flex-1 flex-col overflow-hidden pb-4 min-h-0">
        <div className="flex flex-row gap-6 items-start overflow-y-auto min-h-0">

          {/* ── Column 1: Account · Notifications ───────────────────── */}
          <div className="flex flex-col gap-5 w-80 shrink-0">
            <motion.section className="flex flex-col gap-3" {...staggerItem(1)}>
              <SectionLabel>Account</SectionLabel>
              <ChangeEmailRow currentEmail={email} />
              <ChangePasswordRow />
            </motion.section>

            <motion.section className="flex flex-col gap-3" {...staggerItem(2)}>
              <SectionLabel>Notifications</SectionLabel>
              <ToggleRow
                icon={<Bell size={17} strokeWidth={1.5} />}
                iconBg="bg-coral/10"
                iconColor="text-coral"
                label="Email on bottle arrival"
                meta="When a stranger's bottle reaches you"
                checked={emailNotifs}
                disabled={notifsSaving}
                onChange={handleToggleNotifs}
              />
            </motion.section>
          </div>

          {/* ── Column 2: Privacy · About ───────────────────────────── */}
          <div className="flex flex-col gap-5 w-80 shrink-0">
            <motion.section className="flex flex-col gap-3" {...staggerItem(3)}>
              <SectionLabel>Privacy</SectionLabel>
              <SettingsRow
                icon={<Shield size={17} strokeWidth={1.5} />}
                iconBg="bg-seafoam/10"
                iconColor="text-seafoam"
                label="Anonymous by design"
                meta="Your identity is never shared with message receivers"
              />
            </motion.section>

            <motion.section className="flex flex-col gap-3" {...staggerItem(4)}>
              <SectionLabel>About</SectionLabel>
              <SettingsRow
                icon={<Info size={17} strokeWidth={1.5} />}
                iconBg="bg-sand/[0.06]"
                iconColor="text-sand/50"
                label="How it works"
                meta="One bottle per day, matched to a random stranger"
              />
            </motion.section>
          </div>

          {/* ── Column 3: Session · Danger zone ─────────────────────── */}
          <div className="flex flex-col gap-5 w-80 shrink-0">
            <motion.section className="flex flex-col gap-3" {...staggerItem(5)}>
              <SectionLabel>Session</SectionLabel>
              <SettingsRow
                icon={<LogOut size={17} strokeWidth={1.5} />}
                iconBg="bg-coral/10"
                iconColor="text-coral"
                label="Sign out"
                meta="End your session on this device"
                onClick={() => void handleSignOut()}
                destructive
              />
            </motion.section>

            <motion.section className="flex flex-col gap-3" {...staggerItem(6)}>
              <SectionLabel>Danger zone</SectionLabel>
              <DeleteAccountRow />
            </motion.section>
          </div>

        </div>

        {/* ── Build footer ──────────────────────────────────────────── */}
        <motion.p
          className="font-mono text-[10px] text-sand/15 text-center mt-8"
          {...staggerItem(7)}
        >
          glassbottles · one bottle, one stranger
        </motion.p>
      </div>
    </div>
  )
}
