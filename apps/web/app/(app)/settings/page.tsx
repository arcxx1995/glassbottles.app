'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'motion/react'
import { spring } from '@/components/ui/springs'
import Switch from '@/components/ui/Switch'
import { Bell, BellRing, LogOut, Mail, KeyRound, Trash2, Waves } from 'lucide-react'
import { feel, feelEnabled, setFeelEnabled } from '@/lib/feel'
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
import KeeperCard from '@/components/keeper/KeeperCard'
import { signOut } from '@/lib/signOut'
import HarbourSettings from '@/components/harbour/HarbourSettings'
import { useGetKayakBlocksQuery } from '@/store/api/bottleApi'
import { disablePush, enablePush, getPushState, type PushState } from '@/lib/push'

// ─── Animation helpers ────────────────────────────────────────────────────────
function staggerItem(i: number) {
  return {
    initial: { opacity: 0, y: 10 } as const,
    animate: { opacity: 1, y: 0 } as const,
    transition: { ...spring, delay: Math.min(i, 6) * 0.04 },
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
        flex items-center gap-4 glass rounded-3xl p-5
        transition-[border-color,transform] duration-200 group w-full text-left
        ${onClick
          ? destructive
            ? 'press cursor-pointer hover:border-coral/20'
            : 'press cursor-pointer hover:border-seafoam/20'
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
            font-ui text-sm font-medium transition-colors duration-200            ${destructive
              ? 'text-coral/70 group-hover:text-coral'
              : 'text-sand/60 group-hover:text-sand/90'
            }
          `}
        >
          {label}
        </span>
        {meta && (
          <span className="font-ui text-xs text-sand/45 mt-0.5 leading-snug whitespace-nowrap">
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
    <div className="flex items-center gap-4 glass rounded-3xl p-5">
      <div className={`w-9 h-9 rounded-xl ${iconBg} flex items-center justify-center shrink-0`}>
        <span className={iconColor}>{icon}</span>
      </div>

      <div className="flex flex-col flex-1 min-w-0">
        <span className="font-ui text-sm font-medium text-sand/60 whitespace-nowrap">{label}</span>
        {meta && (
          <span className="font-ui text-xs text-sand/45 mt-0.5 leading-snug whitespace-nowrap">{meta}</span>
        )}
      </div>

      <Switch checked={checked} onChange={onChange} disabled={disabled} label={label} />
    </div>
  )
}

// ─── Section label ────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-ui text-[10px] text-sand/45 uppercase tracking-widest px-1 mb-2 mt-2">
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
    <div className="glass rounded-3xl overflow-hidden">
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
          <span className="font-ui text-sm font-medium text-sand/60 group-hover:text-sand/90 transition-colors duration-200 whitespace-nowrap">
            Change email
          </span>
          {/* truncate: a long address ran out of the card on phones */}
          <span className="font-ui text-xs text-sand/45 mt-0.5 leading-snug truncate">
            {currentEmail ?? 'Update the address tied to your account'}
          </span>
        </div>
        <span
          className={cn(
            'font-ui text-sand/45 text-lg leading-none transition-transform duration-300 ease-ease-quart',
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
            transition={spring}
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
                      className="press flex-1 py-2.5 rounded-full shadow-seafoam bg-seafoam text-ocean-deep font-ui font-semibold text-sm hover:brightness-110 disabled:opacity-50 disabled:pointer-events-none"
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
// off (config.toml), so the app proves ownership itself: the current password
// is re-verified first, or an unlocked session could take over the account.
// Google-only accounts have no current password; they get a reset link, which
// proves ownership through the inbox instead.

// Opt-in sound + haptics (lib/feel.ts). Per-device, so it lives in this
// browser rather than the profile.
function FeelRow() {
  const [on, setOn] = useState(false)
  useEffect(() => setOn(feelEnabled()), [])
  return (
    <ToggleRow
      icon={<Waves size={17} strokeWidth={1.5} />}
      iconBg="bg-seafoam/10"
      iconColor="text-seafoam"
      label="Sounds & haptics"
      meta="Splash, cork pop, a chime on delivery"
      checked={on}
      onChange={(next) => {
        setFeelEnabled(next)
        setOn(next)
        if (next) feel('chime') // a taste of it, inside the tap that unlocks audio
      }}
    />
  )
}

// Web Push on this device (migration 044). Per-device by nature, so the
// toggle reads the browser, not the profile.
const PUSH_META: Record<PushState, string> = {
  off: 'When your bottle is found, or one finds you',
  on: 'When your bottle is found, or one finds you',
  blocked: 'Blocked in this browser’s site settings',
  install: 'Add glassbottles to your Home Screen first',
  unsupported: '',
}

function PushRow() {
  const [state, setState] = useState<PushState>('unsupported')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    void getPushState().then(setState)
  }, [])
  if (state === 'unsupported') return null
  return (
    <ToggleRow
      icon={<BellRing size={17} strokeWidth={1.5} />}
      iconBg="bg-seafoam/10"
      iconColor="text-seafoam"
      label="Notifications on this device"
      meta={PUSH_META[state]}
      checked={state === 'on'}
      disabled={busy || state === 'blocked' || state === 'install'}
      onChange={(next) => {
        setBusy(true)
        void (next ? enablePush() : disablePush()).then(setState).finally(() => setBusy(false))
      }}
    />
  )
}

function ChangePasswordRow() {
  const supabase = createClient()
  const [open, setOpen] = useState(false)
  const [current, setCurrent] = useState('')
  const [pw, setPw] = useState('')
  const [confirm, setConfirm] = useState('')
  const [touched, setTouched] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  // null = still loading; '' = no email/password identity (Google-only).
  const [passwordEmail, setPasswordEmail] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    void supabase.auth.getUser().then(({ data }) => {
      const hasPassword = data.user?.identities?.some((i) => i.provider === 'email')
      setPasswordEmail(hasPassword ? (data.user?.email ?? '') : '')
    })
  }, [open, supabase])

  const pwOk = isValidPassword(pw)
  const matches = pw === confirm
  const canSave = !!passwordEmail && current.length > 0 && pwOk && matches

  function close() {
    setOpen(false)
    setCurrent('')
    setPw('')
    setConfirm('')
    setTouched(false)
    setError(null)
    setDone(false)
  }

  async function handleSave() {
    setTouched(true)
    setError(null)
    if (!canSave || !passwordEmail) return // passwordEmail narrows for TS
    setLoading(true)
    const { error: authErr } = await supabase.auth.signInWithPassword({
      email: passwordEmail,
      password: current,
    })
    if (authErr) {
      setLoading(false)
      setError('Current password is incorrect.')
      return
    }
    const { error: err } = await supabase.auth.updateUser({ password: pw })
    setLoading(false)
    if (err) {
      setError(mapAuthError(err, 'reset'))
      return
    }
    setDone(true)
  }

  async function sendResetLink() {
    setLoading(true)
    setError(null)
    const { data } = await supabase.auth.getUser()
    const { error: err } = data.user?.email
      ? await supabase.auth.resetPasswordForEmail(data.user.email, {
          redirectTo: `${location.origin}/auth/callback?next=/reset-password`,
        })
      : { error: new Error('no email') }
    setLoading(false)
    if (err) setError('Could not send the link. Please try again.')
    else setDone(true)
  }

  return (
    <div className="glass rounded-3xl overflow-hidden">
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
          <span className="font-ui text-sm font-medium text-sand/60 group-hover:text-sand/90 transition-colors duration-200 whitespace-nowrap">
            Change password
          </span>
          <span className="font-ui text-xs text-sand/45 mt-0.5 leading-snug whitespace-nowrap">
            Update the password you sign in with
          </span>
        </div>
        <span
          className={cn(
            'font-ui text-sand/45 text-lg leading-none transition-transform duration-300 ease-ease-quart',
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
            transition={spring}
            className="overflow-hidden"
          >
            <div className="px-5 pb-5 pt-0 flex flex-col gap-3">
              {done ? (
                <p className="font-ui text-xs text-seafoam/90 leading-relaxed">
                  {passwordEmail
                    ? <>Password updated. You&rsquo;ll use it next time you sign in.</>
                    : <>Check your inbox for a link to set your password.</>}
                </p>
              ) : passwordEmail === '' ? (
                <>
                  <p className="font-ui text-xs text-sand/50 leading-relaxed">
                    You sign in with Google, so there&rsquo;s no password yet. We&rsquo;ll
                    email you a link to set one.
                  </p>
                  {error && (
                    <p className="font-ui text-xs text-coral px-1 -mt-1">{error}</p>
                  )}
                  <button
                    type="button"
                    onClick={() => void sendResetLink()}
                    disabled={loading}
                    className="press py-2.5 rounded-full shadow-seafoam bg-seafoam text-ocean-deep font-ui font-semibold text-sm hover:brightness-110 disabled:opacity-50"
                  >
                    {loading ? 'Sending…' : 'Email me a link'}
                  </button>
                </>
              ) : (
                <>
                  <input
                    type="password"
                    autoComplete="current-password"
                    placeholder="Current password"
                    value={current}
                    disabled={loading}
                    onChange={(e) => setCurrent(e.target.value)}
                    className={AUTH_INPUT_CLASS}
                  />
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
                      className="press flex-1 py-2.5 rounded-full shadow-seafoam bg-seafoam text-ocean-deep font-ui font-semibold text-sm hover:brightness-110 disabled:opacity-50 disabled:pointer-events-none"
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
    <div className="glass rounded-3xl overflow-hidden">
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
          <span className="font-ui text-sm font-medium text-coral/70 group-hover:text-coral transition-colors duration-200 whitespace-nowrap">
            Delete account
          </span>
          <span className="font-ui text-xs text-sand/45 mt-0.5 leading-snug whitespace-nowrap">
            Permanently erase your account and your inbox
          </span>
        </div>
        <span
          className={cn(
            'font-ui text-sand/45 text-lg leading-none transition-transform duration-300 ease-ease-quart',
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
            transition={spring}
            className="overflow-hidden"
          >
            <div className="px-5 pb-5 pt-0 flex flex-col gap-3">
              <p className="font-ui text-xs text-sand/50 leading-relaxed">
                This can&rsquo;t be undone. Your account, profile, inbox and any
                bottles still drifting are permanently deleted. Bottles that already
                washed ashore stay with the strangers who found them, unlinked from
                your account. Type{' '}
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
                  className="press flex-1 py-2.5 rounded-full shadow-coral bg-coral text-ocean-deep font-ui font-semibold text-sm hover:brightness-110 disabled:opacity-50 disabled:pointer-events-none"
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
    // getSession() reads from the local cookie — no Auth-server round-trip.
    // Displaying email doesn't need server-verified identity (middleware guards the route).
    supabase.auth.getSession().then(({ data }) => {
      setEmail(data.session?.user?.email ?? null)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  const { data: blocked = [] } = useGetKayakBlocksQuery(undefined, {
    skip: process.env.NEXT_PUBLIC_KEEPER !== 'on',
  })

  async function handleSignOut() {
    await signOut((path) => router.replace(path))
  }

  return (
    <div className="no-scrollbar flex h-full flex-col overflow-y-auto px-5 pt-10 pb-10 sm:overflow-hidden sm:pt-14 sm:pb-0">
      {/* Mobile: single column, page scrolls. sm+: two columns fit the viewport
          with no scroll (overflow-hidden frame). */}
      <motion.div className="mb-6 shrink-0" {...staggerItem(0)}>
        <h1 className="font-display text-title text-sand">Settings</h1>
        {email && (
          <p className="font-mono text-xs text-sand/45 mt-1 truncate max-w-[240px]">
            {email}
          </p>
        )}
        {/* Member since — profile has created_at */}
        {user?.created_at && (
          <p className="font-mono text-[10px] text-sand/35 mt-0.5">
            member since{' '}
            {new Date(user.created_at).toLocaleDateString('en-US', {
              month: 'long',
              year: 'numeric',
            })}
          </p>
        )}
      </motion.div>

      {/* Two centered columns that share the available height. Full text (no
          truncation), no page scroll, and the lower band is kept clear so the
          wave animation reads underneath. Account is the starting column. */}
      <div className="flex flex-col sm:min-h-0 sm:flex-1 sm:overflow-hidden">
        <div className="no-scrollbar flex flex-col gap-5 sm:min-h-0 sm:flex-1 sm:flex-row sm:justify-center sm:gap-6 sm:overflow-y-auto">

          {/* ── Column 1: Account · Notifications · Privacy ─────────── */}
          <div className="mx-auto flex w-full max-w-[27rem] flex-col gap-5">
            <motion.section className="flex flex-col gap-3" {...staggerItem(1)}>
              <SectionLabel>Account</SectionLabel>
              <div className="glass inset-group">
                <ChangeEmailRow currentEmail={email} />
                <ChangePasswordRow />
              </div>
            </motion.section>

            <motion.section className="flex flex-col gap-3" {...staggerItem(2)}>
              <SectionLabel>Notifications</SectionLabel>
              <div className="glass inset-group">
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
                <PushRow />
                <FeelRow />
              </div>
            </motion.section>
          </div>

          {/* ── Column 2: Membership · Danger zone · Session ───────── */}
          <div className="mx-auto flex w-full max-w-[27rem] flex-col gap-5">
            {process.env.NEXT_PUBLIC_KEEPER === 'on' && (
              <motion.section className="flex flex-col gap-3" {...staggerItem(4)}>
                <SectionLabel>Membership</SectionLabel>
                <KeeperCard />
              </motion.section>
            )}
            {blocked.length > 0 && (
              <motion.section className="flex flex-col gap-3" {...staggerItem(4)}>
                <SectionLabel>Blocked in the Harbour</SectionLabel>
                <HarbourSettings blocked={blocked} />
              </motion.section>
            )}

            <motion.section className="flex flex-col gap-3" {...staggerItem(5)}>
              <SectionLabel>Danger zone</SectionLabel>
              <DeleteAccountRow />
            </motion.section>

            <motion.section className="flex flex-col gap-3" {...staggerItem(6)}>
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
          </div>

        </div>

        {/* Footer — anonymity note over the brand line, above the wave band. */}
        <motion.div
          className="text-center shrink-0 pt-5 pb-3"
          {...staggerItem(7)}
        >
          <p className="font-ui text-xs text-sand/45 leading-relaxed max-w-[420px] mx-auto">
            You&rsquo;re anonymous by design — the strangers who find your bottles
            never learn who you are.
          </p>
          <p className="font-mono text-[10px] text-sand/35 mt-2">
            glassbottles · one bottle, one stranger
          </p>
        </motion.div>
      </div>
    </div>
  )
}
