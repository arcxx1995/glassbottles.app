'use client'

import { useState } from 'react'
import Link from 'next/link'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowRight, Mail } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { FieldError, FormError, isValidEmail, mapAuthError } from '@/components/auth/authShared'

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
    <main className="flex flex-col items-center justify-center min-h-screen px-6">
      <div className="w-full max-w-sm flex flex-col gap-8">
        <motion.div
          className="text-center"
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          <h1 className="font-display text-3xl text-sand mb-2">Reset your password</h1>
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
              className="bg-ocean-mid rounded-3xl border border-white/5 p-7 flex flex-col items-center gap-4 text-center"
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
              className="flex flex-col gap-4"
              noValidate
            >
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

              <FormError>{formError}</FormError>

              <button
                type="submit"
                disabled={!emailOk || loading}
                className="flex items-center justify-center gap-2 py-4 rounded-2xl bg-seafoam text-ocean-deep font-ui font-semibold text-base tracking-wide transition-all duration-150 active:scale-[0.97] hover:brightness-110 disabled:opacity-50 disabled:pointer-events-none"
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
  )
}
