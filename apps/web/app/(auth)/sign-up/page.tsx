'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowRight, Mail } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { GoogleButton } from '@/components/auth/GoogleButton'
import WaveBackground from '@/components/shared/WaveBackground'
import NightSky from '@/components/shared/NightSky'
import {
  OrDivider,
  FieldError,
  FormError,
  isValidEmail,
  isValidPassword,
  mapAuthError,
  PASSWORD_MIN,
  AUTH_BOX_CLASS,
  AUTH_INPUT_CLASS,
  AUTH_PRIMARY_BTN_CLASS,
  AUTH_CARD_CLASS,
} from '@/components/auth/authShared'

const RESEND_COOLDOWN = 60 // seconds — mirrors server-side throttle

export default function SignUpPage() {
  const supabase = createClient()
  const router = useRouter()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [touched, setTouched] = useState(false)

  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  // Resend throttle
  const [cooldown, setCooldown] = useState(0)
  const [resendNote, setResendNote] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const emailOk = isValidEmail(email)
  const passwordOk = isValidPassword(password)
  const canSubmit = emailOk && passwordOk && !loading && !googleLoading

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [])

  function startCooldown() {
    setCooldown(RESEND_COOLDOWN)
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = setInterval(() => {
      setCooldown((c) => {
        if (c <= 1) {
          if (timerRef.current) clearInterval(timerRef.current)
          return 0
        }
        return c - 1
      })
    }, 1000)
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setTouched(true)
    if (!emailOk || !passwordOk) return

    setLoading(true)
    setFormError(null)

    // emailRedirectTo routes the confirmation link's {{ .ConfirmationURL }}
    // through /auth/callback (where the PKCE code is exchanged for a session)
    // and on to /home — the idle "Your bottle awaits" screen. Without it the
    // link fell back to the project Site URL (root), so confirming dropped the
    // user on the landing page with no session, never on the app.
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${location.origin}/auth/callback?next=/home` },
    })

    if (error) {
      setFormError(mapAuthError(error, 'sign-up'))
      setLoading(false)
      return
    }

    // Silent-duplicate trap: with email confirmation on, signing up for an
    // already-registered email returns 200 with no error but a null session
    // and an empty identities array. Treat as "already registered".
    if (data.session === null && data.user?.identities?.length === 0) {
      setFormError('An account with this email already exists. Sign in instead.')
      setLoading(false)
      router.push('/sign-in')
      return
    }

    setLoading(false)
    setSent(true)
    startCooldown()
  }

  async function handleGoogle() {
    setGoogleLoading(true)
    setFormError(null)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${location.origin}/auth/callback` },
    })
    if (error) {
      setFormError(mapAuthError(error, 'sign-up'))
      setGoogleLoading(false)
    }
    // On success the browser redirects to Google — keep the loading state.
  }

  async function handleResend() {
    if (cooldown > 0) return
    setResendNote(null)
    const { error } = await supabase.auth.resend({ type: 'signup', email })
    if (error) {
      setResendNote(
        error.code === 'over_email_send_rate_limit'
          ? 'Please wait a moment before requesting another email.'
          : 'Could not resend right now. Try again shortly.',
      )
      startCooldown()
      return
    }
    setResendNote('Sent! Check your inbox again.')
    startCooldown()
  }

  return (
    <>
      <WaveBackground />
      <NightSky />
      <main className="relative z-10 flex flex-col items-center justify-center min-h-screen px-6">
      <div className={AUTH_BOX_CLASS}>
        {/* Hero */}
        <motion.div
          className="text-center"
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          <h1 className="font-display text-2xl text-sand">glassbottles</h1>
        </motion.div>

        <AnimatePresence mode="wait">
          {sent ? (
            <motion.div
              key="sent"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
              className={`${AUTH_CARD_CLASS} flex flex-col items-center gap-4 text-center`}
            >
              <div className="w-14 h-14 rounded-full bg-seafoam/10 flex items-center justify-center">
                <Mail size={26} className="text-seafoam" strokeWidth={1.5} />
              </div>
              <div>
                <p className="font-display text-xl text-sand mb-1">Check your inbox</p>
                <p className="font-ui text-sm text-sand/45">
                  We sent a confirmation link to{' '}
                  <span className="text-sand/75">{email}</span>. Click it to finish setting up
                  your account.
                </p>
              </div>

              <button
                type="button"
                onClick={() => void handleResend()}
                disabled={cooldown > 0}
                className="font-ui text-sm text-seafoam hover:underline disabled:text-sand/25 disabled:no-underline"
              >
                {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend email'}
              </button>
              {resendNote && <p className="font-ui text-xs text-sand/45">{resendNote}</p>}
            </motion.div>
          ) : (
            <motion.div
              key="form"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
              className="flex flex-col gap-4"
            >
              <form onSubmit={handleSubmit} className="flex flex-col gap-3" noValidate>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="your@email.com"
                  autoComplete="email"
                  aria-label="Email"
                  className={AUTH_INPUT_CLASS}
                />
                {touched && !emailOk && <FieldError>Enter a valid email address.</FieldError>}

                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Password"
                  autoComplete="new-password"
                  aria-label="Password"
                  className={AUTH_INPUT_CLASS}
                />
                {touched && !passwordOk && (
                  <FieldError>Password must be at least {PASSWORD_MIN} characters.</FieldError>
                )}

                <FormError>{formError}</FormError>

                <button type="submit" disabled={!canSubmit} className={AUTH_PRIMARY_BTN_CLASS}>
                  {loading ? (
                    <span
                      className="w-5 h-5 border-2 border-ocean-deep/25 border-t-ocean-deep rounded-full animate-spin"
                      aria-label="Creating account…"
                    />
                  ) : (
                    <>
                      Create account
                      <ArrowRight size={18} strokeWidth={2} />
                    </>
                  )}
                </button>
              </form>

              <OrDivider />

              <GoogleButton
                onClick={() => void handleGoogle()}
                loading={googleLoading}
                disabled={loading}
              />
            </motion.div>
          )}
        </AnimatePresence>

        <p className="font-ui text-xs text-sand/25 text-center">
          Already have an account?{' '}
          <Link href="/sign-in" className="text-seafoam hover:underline">
            Sign in
          </Link>
        </p>
      </div>
      </main>
    </>
  )
}
