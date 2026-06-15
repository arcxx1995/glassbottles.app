'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowRight, Check } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import {
  FieldError,
  FormError,
  isValidPassword,
  mapAuthError,
  PASSWORD_MIN,
  AUTH_BOX_CLASS,
  AUTH_INPUT_CLASS,
  AUTH_PRIMARY_BTN_CLASS,
  AUTH_CARD_CLASS,
} from '@/components/auth/authShared'
import WaveBackground from '@/components/shared/WaveBackground'
import NightSky from '@/components/shared/NightSky'

type Phase = 'checking' | 'ready' | 'no-session' | 'done'

export default function ResetPasswordPage() {
  const supabase = createClient()
  const router = useRouter()

  const [phase, setPhase] = useState<Phase>('checking')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [touched, setTouched] = useState(false)
  const [loading, setLoading] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  // The callback exchange should have established a recovery session. Verify it.
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setPhase(data.session ? 'ready' : 'no-session')
    })
  }, [supabase])

  const passwordOk = isValidPassword(password)
  const matches = password === confirm
  const canSubmit = passwordOk && matches && !loading

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setTouched(true)
    if (!passwordOk || !matches) return

    setLoading(true)
    setFormError(null)

    const { error } = await supabase.auth.updateUser({ password })

    setLoading(false)
    if (error) {
      setFormError(mapAuthError(error, 'reset'))
      return
    }
    setPhase('done')
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
          <h1 className="font-display text-2xl text-sand mb-2">Set a new password</h1>
          <p className="font-ui text-sm text-sand/45 max-w-[260px] mx-auto leading-relaxed">
            Choose a password with at least {PASSWORD_MIN} characters.
          </p>
        </motion.div>

        <AnimatePresence mode="wait">
          {phase === 'checking' && (
            <motion.div
              key="checking"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex justify-center py-8"
            >
              <span
                className="w-6 h-6 border-2 border-seafoam/25 border-t-seafoam rounded-full animate-spin"
                aria-label="Loading…"
              />
            </motion.div>
          )}

          {phase === 'no-session' && (
            <motion.div
              key="no-session"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
              className={`${AUTH_CARD_CLASS} text-center`}
            >
              <p className="font-display text-xl text-sand mb-2">Link expired</p>
              <p className="font-ui text-sm text-sand/45 mb-4">
                This password reset link is invalid or has expired.
              </p>
              <Link
                href="/forgot-password"
                className="font-ui text-sm text-seafoam hover:underline"
              >
                Request a new link
              </Link>
            </motion.div>
          )}

          {phase === 'done' && (
            <motion.div
              key="done"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
              className={`${AUTH_CARD_CLASS} flex flex-col items-center gap-4 text-center`}
            >
              <div className="w-14 h-14 rounded-full bg-seafoam/10 flex items-center justify-center">
                <Check size={26} className="text-seafoam" strokeWidth={2} />
              </div>
              <div>
                <p className="font-display text-xl text-sand mb-1">Password updated</p>
                <p className="font-ui text-sm text-sand/45">You&apos;re all set.</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  router.refresh()
                  router.push('/home')
                }}
                className={`${AUTH_PRIMARY_BTN_CLASS} w-full`}
              >
                Go to home
                <ArrowRight size={18} strokeWidth={2} />
              </button>
            </motion.div>
          )}

          {phase === 'ready' && (
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
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="New password"
                autoComplete="new-password"
                aria-label="New password"
                className={AUTH_INPUT_CLASS}
              />
              {touched && !passwordOk && (
                <FieldError>Password must be at least {PASSWORD_MIN} characters.</FieldError>
              )}

              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Confirm new password"
                autoComplete="new-password"
                aria-label="Confirm new password"
                className={AUTH_INPUT_CLASS}
              />
              {touched && passwordOk && !matches && (
                <FieldError>Passwords don&apos;t match.</FieldError>
              )}

              <FormError>{formError}</FormError>

              <button type="submit" disabled={!canSubmit} className={AUTH_PRIMARY_BTN_CLASS}>
                {loading ? (
                  <span
                    className="w-5 h-5 border-2 border-ocean-deep/25 border-t-ocean-deep rounded-full animate-spin"
                    aria-label="Updating…"
                  />
                ) : (
                  <>
                    Update password
                    <ArrowRight size={18} strokeWidth={2} />
                  </>
                )}
              </button>
            </motion.form>
          )}
        </AnimatePresence>

        {phase !== 'done' && (
          <p className="font-ui text-xs text-sand/25 text-center">
            <Link href="/sign-in" className="text-seafoam hover:underline">
              Back to sign in
            </Link>
          </p>
        )}
      </div>
      </main>
    </>
  )
}
