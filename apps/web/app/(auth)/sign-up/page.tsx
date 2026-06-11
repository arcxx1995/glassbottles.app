'use client'

import { useState } from 'react'
import Link from 'next/link'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowRight } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

type Status = 'idle' | 'loading' | 'sent' | 'error'

export default function SignUpPage() {
  const supabase = createClient()
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setStatus('loading')
    setErrorMsg(null)

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    })

    if (error) {
      setErrorMsg(error.message)
      setStatus('error')
    } else {
      setStatus('sent')
    }
  }

  return (
    <main className="flex flex-col items-center justify-center min-h-screen px-6">
      <div className="w-full max-w-sm flex flex-col gap-8">

        {/* Hero */}
        <motion.div
          className="text-center"
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          <span
            className="text-5xl block mb-4 select-none"
            role="img"
            aria-label="glass bottle"
          >
            🫙
          </span>
          <h1 className="font-display text-3xl text-sand mb-2">
            Join glassbottles
          </h1>
          <p className="font-ui text-sm text-sand/45 max-w-[240px] mx-auto leading-relaxed">
            Every day, one bottle. One stranger. One honest message.
          </p>
        </motion.div>

        <AnimatePresence mode="wait">
          {status === 'sent' ? (
            <motion.div
              key="sent"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
              className="bg-ocean-mid rounded-3xl border border-white/5 p-7 text-center"
            >
              <p className="font-display text-xl text-sand mb-2">
                You&apos;re almost in 🌊
              </p>
              <p className="font-ui text-sm text-sand/45">
                Check{' '}
                <span className="text-sand/75">{email}</span>
                {' '}for your magic link.
              </p>
            </motion.div>
          ) : (
            <motion.form
              key="form"
              onSubmit={handleSubmit}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
              className="flex flex-col gap-4"
            >
              <div className="bg-ocean-mid rounded-3xl border border-white/5 p-1 focus-within:border-seafoam/30 transition-colors">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="your@email.com"
                  required
                  autoComplete="email"
                  className="w-full bg-transparent px-5 py-4 font-ui text-sand
                             placeholder:text-sand/25 outline-none text-base"
                />
              </div>

              {status === 'error' && errorMsg && (
                <p className="font-ui text-sm text-coral px-1">{errorMsg}</p>
              )}

              <button
                type="submit"
                disabled={status === 'loading' || !email}
                className="flex items-center justify-center gap-2 py-4 rounded-2xl
                           bg-coral text-ocean-deep font-ui font-semibold text-base
                           tracking-wide transition-all duration-150
                           active:scale-[0.97] hover:brightness-110
                           disabled:opacity-50 disabled:pointer-events-none"
              >
                {status === 'loading' ? (
                  <span
                    className="w-5 h-5 border-2 border-ocean-deep/25 border-t-ocean-deep
                               rounded-full animate-spin"
                    aria-label="Creating account…"
                  />
                ) : (
                  <>
                    Get started
                    <ArrowRight size={18} strokeWidth={2} />
                  </>
                )}
              </button>
            </motion.form>
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
  )
}
