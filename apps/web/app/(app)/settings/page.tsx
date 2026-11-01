'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'motion/react'
import { spring } from '@/components/ui/springs'
import Switch from '@/components/ui/Switch'
import { Bell, BellRing, ChevronRight, LogOut, Mail, KeyRound, Trash2, Waves } from 'lucide-react'
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
import { disablePush, enablePush, getPushState, type PushState } from '@/lib/push'

// ─── Animation helpers ────────────────────────────────────────────────────────
function staggerItem(i: number) {
  return {
    initial: { opacity: 0, y: 10 } as const,
    animate: { opacity: 1, y: 0 } as const,
    transition: { ...spring, delay: Math.min(i, 6) * 0.04 },
  }
}

// ─── Rows ─────────────────────────────────────────────────────────────────────
// Vercel-style: one flat bordered card per section, rows split by hairlines,
// small type, bare icons.

const CARD = 'overflow-hidden rounded-xl border border-white/10 bg-ocean-mid/50 divide-y divide-white/[0.06]'
const ROW = 'flex w-full items-center gap-3 px-4 py-3 text-left'
const FIELD = cn(AUTH_INPUT_CLASS, 'rounded-lg px-3 py-2')
const BTN =
  'h-8 flex-1 rounded-lg border border-white/10 font-ui text-[13px] text-sand/70 transition-colors hover:border-white/20 hover:text-sand disabled:opacity-50'
const BTN_PRIMARY =
  'press h-8 flex-1 rounded-lg bg-seafoam font-ui text-[13px] font-semibold text-ocean-deep hover:brightness-110 disabled:opacity-50 disabled:pointer-events-none'

function RowText({ label, meta, destructive = false, wrap = false }: {
  label: string
  meta?: string | null
  destructive?: boolean
  /** Toggle rows wrap: one line ran under the switch on narrow phones. */
  wrap?: boolean
}) {
  return (
    <span className="flex min-w-0 flex-1 flex-col">
      <span className={cn('font-ui text-sm', destructive ? 'text-coral/85' : 'text-sand/85')}>{label}</span>
      {meta && (
        <span className={cn('font-ui text-xs text-sand/45', wrap ? 'leading-snug' : 'truncate')}>{meta}</span>
      )}
    </span>
  )
}

function RowIcon({ children, destructive = false }: { children: React.ReactNode; destructive?: boolean }) {
  return <span className={cn('shrink-0', destructive ? 'text-coral/70' : 'text-sand/45')}>{children}</span>
}

function SettingsRow({ icon, label, meta, onClick, destructive = false }: {
  icon: React.ReactNode
  label: string
  meta?: string
  onClick: () => void
  destructive?: boolean
}) {
  return (
    <button type="button" onClick={onClick} className={cn(ROW, 'transition-colors hover:bg-white/[0.03]')}>
      <RowIcon destructive={destructive}>{icon}</RowIcon>
      <RowText label={label} meta={meta} destructive={destructive} />
    </button>
  )
}

function ToggleRow({ icon, label, meta, checked, disabled = false, onChange }: {
  icon: React.ReactNode
  label: string
  meta?: string
  checked: boolean
  disabled?: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <div className={ROW}>
      <RowIcon>{icon}</RowIcon>
      <RowText label={label} meta={meta} wrap />
      <Switch checked={checked} onChange={onChange} disabled={disabled} label={label} />
    </div>
  )
}

// A row that opens in place (change email, password, delete).
function Disclosure({ icon, label, meta, destructive = false, open, onToggle, children }: {
  icon: React.ReactNode
  label: string
  meta?: string | null
  destructive?: boolean
  open: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={cn(ROW, 'transition-colors hover:bg-white/[0.03]')}
      >
        <RowIcon destructive={destructive}>{icon}</RowIcon>
        <RowText label={label} meta={meta} destructive={destructive} />
        <ChevronRight
          size={14}
          strokeWidth={1.75}
          className={cn('shrink-0 text-sand/35 transition-transform duration-300 ease-ease-quart', open && 'rotate-90')}
          aria-hidden="true"
        />
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
            <div className="flex flex-col gap-2.5 px-4 pb-4">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-1.5 px-1 font-ui text-[11px] font-medium uppercase tracking-wider text-sand/45">
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
    <Disclosure
      icon={<Mail size={16} strokeWidth={1.5} />}
      label="Change email"
      meta={currentEmail ?? 'Update the address tied to your account'}
      open={open}
      onToggle={() => (open ? close() : setOpen(true))}
    >
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
            className={FIELD}
          />
          {touched && !valid && value.length > 0 && (
            <p className="font-ui text-xs text-coral px-1 -mt-1">
              Enter a valid email address.
            </p>
          )}
          {error && (
            <p className="font-ui text-xs text-coral px-1 -mt-1">{error}</p>
          )}
          <div className="flex items-center gap-2 pt-0.5">
            <button
              type="button"
              onClick={close}
              disabled={loading}
              className={BTN}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={loading || !valid}
              className={BTN_PRIMARY}
            >
              {loading ? 'Sending…' : 'Save'}
            </button>
          </div>
        </>
      )}
    </Disclosure>
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
      icon={<Waves size={16} strokeWidth={1.5} />}
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
      icon={<BellRing size={16} strokeWidth={1.5} />}
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
    <Disclosure
      icon={<KeyRound size={16} strokeWidth={1.5} />}
      label="Change password"
      meta={'Update the password you sign in with'}
      open={open}
      onToggle={() => (open ? close() : setOpen(true))}
    >
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
            className={BTN_PRIMARY}
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
            className={FIELD}
          />
          <input
            type="password"
            autoComplete="new-password"
            placeholder={`New password (min ${PASSWORD_MIN})`}
            value={pw}
            disabled={loading}
            onChange={(e) => setPw(e.target.value)}
            onBlur={() => setTouched(true)}
            className={FIELD}
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
            className={FIELD}
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
          <div className="flex items-center gap-2 pt-0.5">
            <button
              type="button"
              onClick={close}
              disabled={loading}
              className={BTN}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={loading || !canSave}
              className={BTN_PRIMARY}
            >
              {loading ? 'Saving…' : 'Update'}
            </button>
          </div>
        </>
      )}
    </Disclosure>
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
    <Disclosure
      icon={<Trash2 size={16} strokeWidth={1.5} />}
      label="Delete account"
      meta={'Permanently erase your account and your shelf'} destructive
      open={open}
      onToggle={() => (open ? close() : setOpen(true))}
    >
      <p className="font-ui text-xs text-sand/50 leading-relaxed">
        This can&rsquo;t be undone. Your account, profile, shelf and any
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
        className={FIELD}
      />
      {error && (
        <p className="font-ui text-xs text-coral px-1 -mt-1">{error}</p>
      )}
      <div className="flex items-center gap-2 pt-0.5">
        <button
          type="button"
          onClick={close}
          disabled={loading}
          className={BTN}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void handleDelete()}
          disabled={loading || !confirmed}
          className={cn(BTN_PRIMARY, 'bg-coral')}
        >
          {loading ? 'Deleting…' : 'Delete forever'}
        </button>
      </div>
    </Disclosure>
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
  // The profile is in the store on the client's first render but not on the
  // server's, so anything drawn from it waits for mount (hydration mismatch).
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

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

  async function handleSignOut() {
    await signOut((path) => router.replace(path))
  }

  const since =
    mounted && user?.created_at
      ? `member since ${new Date(user.created_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`
      : null

  return (
    // Scrolls below the shell's wordmark row (mt-14), never under it.
    <div className="no-scrollbar mt-14 h-[calc(100%-3.5rem)] overflow-y-auto px-5 pt-2 pb-10">
      <div className="mx-auto flex w-full max-w-xl flex-col gap-6">
        <motion.div {...staggerItem(0)}>
          <h1 className="font-display text-headline text-sand">Settings</h1>
          {(email || since) && (
            <p className="mt-0.5 truncate font-mono text-[11px] text-sand/45">
              {[email, since].filter(Boolean).join(' · ')}
            </p>
          )}
        </motion.div>

        <motion.section {...staggerItem(1)}>
          <SectionLabel>Account</SectionLabel>
          <div className={CARD}>
            <ChangeEmailRow currentEmail={email} />
            <ChangePasswordRow />
            <SettingsRow
              icon={<LogOut size={16} strokeWidth={1.5} />}
              label="Sign out"
              meta="End your session on this device"
              onClick={() => void handleSignOut()}
            />
          </div>
        </motion.section>

        <motion.section {...staggerItem(2)}>
          <SectionLabel>Notifications</SectionLabel>
          <div className={CARD}>
            <ToggleRow
              icon={<Bell size={16} strokeWidth={1.5} />}
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

        {process.env.NEXT_PUBLIC_KEEPER === 'on' && (
          <motion.section {...staggerItem(3)}>
            <SectionLabel>Membership</SectionLabel>
            <div className={CARD}>
              <KeeperCard />
            </div>
          </motion.section>
        )}
        {process.env.NEXT_PUBLIC_KEEPER === 'on' && (
          <motion.section {...staggerItem(4)}>
            <SectionLabel>Kayaks you&rsquo;ve blocked</SectionLabel>
            <div className={CARD}>
              <HarbourSettings />
            </div>
          </motion.section>
        )}

        <motion.section {...staggerItem(5)}>
          <SectionLabel>Danger zone</SectionLabel>
          <div className={cn(CARD, 'border-coral/20')}>
            <DeleteAccountRow />
          </div>
        </motion.section>

        <motion.p className="pt-2 text-center font-ui text-xs leading-relaxed text-sand/40" {...staggerItem(6)}>
          You&rsquo;re anonymous by design — the strangers who find your bottles
          never learn who you are.
        </motion.p>
      </div>
    </div>
  )
}
