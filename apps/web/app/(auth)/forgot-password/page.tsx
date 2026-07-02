'use client'

import { useState } from 'react'
import Link from 'next/link'
import { motion, AnimatePresence } from 'motion/react'
import { ArrowRight, Mail } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import {
  FieldError,
  FormError,
  isValidEmail,
  mapAuthError,
  AUTH_BOX_CLASS,
  AUTH_INPUT_CLASS,
  AUTH_PRIMARY_BTN_CLASS,
  AUTH_CARD_CLASS,
} from '@/components/auth/authShared'
import WaveBackground from '@/components/shared/WaveBackground'
import NightSky from '@/components/shared/NightSky'

export default function ForgotPasswordPage() {
  const supabase = createClient()

  const [email, setEmail] = useState('')
  const [touched, setTouched] = useState(false)
  const [loading, setLoading] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  const emailOk = isValidEmail(email)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setTouched(true)
    if (!emailOk) return

    setLoading(true)
    setFormError(null)

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${location.origin}/auth/callback?next=/reset-password`,
    })

    setLoading(false)
    if (error) {
      setFormError(mapAuthError(error, 'reset'))
      return
    }
    // Always land on the success state — don't reveal whether the email exists.
    setSent(true)
  }

  return (
    <>
      <WaveBackground />
      <NightSky />
      <main className="relative z-10 flex flex-col items-center justify-center min-h-screen px-6">
      <div className={AUTH_BOX_CLASS}>
        <motion.div
          className="text-center"
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          <h1 className="font-display text-2xl text-sand mb-2">Reset your password</h1>
          <p className="font-ui text-sm text-sand/45 max-w-[260px] mx-auto leading-relaxed">
            Enter your email and we&apos;ll send you a link to set a new password.
          </p>
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
                  If an account exists for <span className="text-sand/75">{email}</span>, a reset
                  link is on its way.
                </p>
              </div>
            </motion.div>
          ) : (
            <motion.form
              key="form"
              onSubmit={handleSubmit}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
              className="flex flex-col gap-3"
              noValidate
            >
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

              <FormError>{formError}</FormError>

              <button
                type="submit"
                disabled={!emailOk || loading}
                className={AUTH_PRIMARY_BTN_CLASS}
              >
                {loading ? (
                  <span
                    className="w-5 h-5 border-2 border-ocean-deep/25 border-t-ocean-deep rounded-full animate-spin"
                    aria-label="Sending…"
                  />
                ) : (
                  <>
                    Send reset link
                    <ArrowRight size={18} strokeWidth={2} />
                  </>
                )}
              </button>
            </motion.form>
          )}
        </AnimatePresence>

        <p className="font-ui text-xs text-sand/25 text-center">
          Remembered it?{' '}
          <Link href="/sign-in" className="text-seafoam hover:underline">
            Back to sign in
          </Link>
        </p>
      </div>
      </main>
    </>
  )
}
