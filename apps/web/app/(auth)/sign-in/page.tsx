'use client'

import { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { motion } from 'framer-motion'
import { ArrowRight } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { GoogleButton } from '@/components/auth/GoogleButton'
import {
  OrDivider,
  FieldError,
  FormError,
  isValidEmail,
  isValidPassword,
  mapAuthError,
  PASSWORD_MIN,
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

    router.refresh()
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
    <main className="flex flex-col items-center justify-center min-h-screen px-6">
      <div className="w-full max-w-sm flex flex-col gap-8">
        {/* Logo */}
        <motion.div
          className="text-center"
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          <h1 className="font-display text-4xl text-sand mb-2">glassbottles</h1>
          <p className="font-ui text-sm text-sand/45">One bottle. One stranger. Every day.</p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="flex flex-col gap-4"
        >
          <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
            <div className="bg-ocean-mid rounded-3xl border border-white/5 p-1 focus-within:border-seafoam/30 transition-colors">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your@email.com"
                autoComplete="email"
                aria-label="Email"
                className="w-full bg-transparent px-5 py-4 font-ui text-sand placeholder:text-sand/25 outline-none text-base"
              />
            </div>
            {touched && !emailOk && <FieldError>Enter a valid email address.</FieldError>}

            <div className="bg-ocean-mid rounded-3xl border border-white/5 p-1 focus-within:border-seafoam/30 transition-colors">
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                autoComplete="current-password"
                aria-label="Password"
                className="w-full bg-transparent px-5 py-4 font-ui text-sand placeholder:text-sand/25 outline-none text-base"
              />
            </div>
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

            <button
              type="submit"
              disabled={!canSubmit}
              className="flex items-center justify-center gap-2 py-4 rounded-2xl bg-seafoam text-ocean-deep font-ui font-semibold text-base tracking-wide transition-all duration-150 active:scale-[0.97] hover:brightness-110 disabled:opacity-50 disabled:pointer-events-none"
            >
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
  )
}

export default function SignInPage() {
  return (
    <Suspense fallback={null}>
      <SignInForm />
    </Suspense>
  )
}
