'use client'

import { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { motion } from 'motion/react'
import { ArrowRight, ArrowLeft } from 'lucide-react'
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
} from '@/components/auth/authShared'

// Friendly copy for the canonical ?error= codes emitted by /auth/callback.
const CALLBACK_ERRORS: Record<string, string> = {
  missing_code: 'Sign-in link was invalid or expired. Please try again.',
  auth_failed: 'Sign-in link was invalid or expired. Please try again.',
}

function SignInForm() {
  const supabase = createClient()
  const router = useRouter()
  const searchParams = useSearchParams()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [touched, setTouched] = useState(false)

  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  // True when the account exists but the email hasn't been confirmed yet.
  const [needsConfirm, setNeedsConfirm] = useState(false)
  const [resendNote, setResendNote] = useState<string | null>(null)

  // Surface callback errors (?error=missing_code | auth_failed).
  useEffect(() => {
    const code = searchParams.get('error')
    if (code && CALLBACK_ERRORS[code]) setFormError(CALLBACK_ERRORS[code])
  }, [searchParams])

  const emailOk = isValidEmail(email)
  const passwordOk = isValidPassword(password)
  const canSubmit = emailOk && passwordOk && !loading && !googleLoading

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setTouched(true)
    if (!emailOk || !passwordOk) return

    setLoading(true)
    setFormError(null)
    setNeedsConfirm(false)

    const { error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      setFormError(mapAuthError(error, 'sign-in'))
      if (error.code === 'email_not_confirmed') setNeedsConfirm(true)
      setLoading(false)
      return
    }

    // Cookies are already set by signInWithPassword above, so a plain push runs
    // middleware with the fresh session. No router.refresh(): it re-requests
    // /sign-in, which middleware redirects to /home — a second route resolution
    // racing this push and doubling the post-login loading frame.
    router.push('/home')
  }

  async function handleGoogle() {
    setGoogleLoading(true)
    setFormError(null)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${location.origin}/auth/callback` },
    })
    if (error) {
      setFormError(mapAuthError(error, 'sign-in'))
      setGoogleLoading(false)
    }
  }

  async function handleResend() {
    setResendNote(null)
    const { error } = await supabase.auth.resend({ type: 'signup', email })
    setResendNote(
      error
        ? 'Could not resend right now. Please wait a moment and try again.'
        : 'Confirmation email sent. Check your inbox.',
    )
  }

  return (
    <>
      <WaveBackground />
      <NightSky />
      <main className="relative z-10 flex flex-col items-center justify-center min-h-screen px-6">
      <Link
        href="/"
        className="absolute top-[calc(1.5rem+env(safe-area-inset-top))] left-6 inline-flex items-center gap-1.5 font-ui text-sm
                   text-sand/70 hover:text-sand/90 transition-colors
                   focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-seafoam
                   focus-visible:rounded px-1 -mx-1"
      >
        <ArrowLeft size={16} strokeWidth={2} />
        Back
      </Link>
      <div className={AUTH_BOX_CLASS}>
        {/* Logo */}
        <motion.div
          className="text-center"
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          <h1 className="font-display text-2xl text-sand mb-2">glassbottles</h1>
          <p className="font-ui text-sm text-sand/45">One bottle. One stranger. Every day.</p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="flex flex-col gap-3"
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
              autoComplete="current-password"
              aria-label="Password"
              className={AUTH_INPUT_CLASS}
            />
            {touched && !passwordOk && (
              <FieldError>Password must be at least {PASSWORD_MIN} characters.</FieldError>
            )}

            <div className="flex justify-end -mt-1">
              <Link
                href="/forgot-password"
                className="font-ui text-xs text-sand/45 hover:text-seafoam transition-colors"
              >
                Forgot password?
              </Link>
            </div>

            <FormError>{formError}</FormError>

            {needsConfirm && (
              <button
                type="button"
                onClick={() => void handleResend()}
                className="font-ui text-sm text-seafoam hover:underline text-left px-1 -mt-2"
              >
                Resend confirmation email
              </button>
            )}
            {resendNote && <p className="font-ui text-xs text-sand/45 px-1 -mt-2">{resendNote}</p>}

            <button type="submit" disabled={!canSubmit} className={AUTH_PRIMARY_BTN_CLASS}>
              {loading ? (
                <span
                  className="w-5 h-5 border-2 border-ocean-deep/25 border-t-ocean-deep rounded-full animate-spin"
                  aria-label="Signing in…"
                />
              ) : (
                <>
                  Sign in
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

        <p className="font-ui text-xs text-sand/25 text-center">
          New here?{' '}
          <Link href="/sign-up" className="text-seafoam hover:underline">
            Create an account
          </Link>
        </p>
      </div>
      </main>
    </>
  )
}

export default function SignInPage() {
  return (
    <Suspense fallback={null}>
      <SignInForm />
    </Suspense>
  )
}
