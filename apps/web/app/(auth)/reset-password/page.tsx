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
} from '@/components/auth/authShared'

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
    <main className="flex flex-col items-center justify-center min-h-screen px-6">
      <div className="w-full max-w-sm flex flex-col gap-8">
        <motion.div
          className="text-center"
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          <h1 className="font-display text-3xl text-sand mb-2">Set a new password</h1>
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
              className="bg-ocean-mid rounded-3xl border border-white/5 p-7 text-center"
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
              className="bg-ocean-mid rounded-3xl border border-white/5 p-7 flex flex-col items-center gap-4 text-center"
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
                className="flex items-center justify-center gap-2 w-full py-4 rounded-2xl bg-coral text-ocean-deep font-ui font-semibold text-base tracking-wide transition-all duration-150 active:scale-[0.97] hover:brightness-110"
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
              className="flex flex-col gap-4"
              noValidate
            >
              <div className="bg-ocean-mid rounded-3xl border border-white/5 p-1 focus-within:border-seafoam/30 transition-colors">
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="New password"
                  autoComplete="new-password"
                  aria-label="New password"
                  className="w-full bg-transparent px-5 py-4 font-ui text-sand placeholder:text-sand/25 outline-none text-base"
                />
              </div>
              {touched && !passwordOk && (
                <FieldError>Password must be at least {PASSWORD_MIN} characters.</FieldError>
              )}

              <div className="bg-ocean-mid rounded-3xl border border-white/5 p-1 focus-within:border-seafoam/30 transition-colors">
                <input
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="Confirm new password"
                  autoComplete="new-password"
                  aria-label="Confirm new password"
                  className="w-full bg-transparent px-5 py-4 font-ui text-sand placeholder:text-sand/25 outline-none text-base"
                />
              </div>
              {touched && passwordOk && !matches && (
                <FieldError>Passwords don&apos;t match.</FieldError>
              )}

              <FormError>{formError}</FormError>

              <button
                type="submit"
                disabled={!canSubmit}
                className="flex items-center justify-center gap-2 py-4 rounded-2xl bg-coral text-ocean-deep font-ui font-semibold text-base tracking-wide transition-all duration-150 active:scale-[0.97] hover:brightness-110 disabled:opacity-50 disabled:pointer-events-none"
              >
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
  )
}
