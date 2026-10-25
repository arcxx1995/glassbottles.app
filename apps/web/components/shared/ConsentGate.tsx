'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useAppDispatch, useAppSelector } from '@/store'
import { setUser } from '@/store/authSlice'
import { AUTH_PRIMARY_BTN_CLASS } from '@/components/auth/authShared'
import type { Profile } from '@/types'

/**
 * 18+ / terms gate (migration 051). Shown over the app when the server says
 * this account never confirmed: Google sign-ups that skipped the sign-up page,
 * and accounts from before the gate. The database enforces it regardless
 * (no writing, no receiving) — this is just the way through.
 *
 * Only an explicit null from /api/profile opens it; the session-seeded profile
 * leaves the field undefined, so it never flashes during sign-in.
 */
export default function ConsentGate() {
  const user = useAppSelector((s) => s.auth.user)
  const dispatch = useAppDispatch()
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  if (!user || user.age_confirmed_at !== null) return null

  async function accept() {
    setBusy(true)
    setFailed(false)
    const { error } = await createClient().rpc('accept_terms')
    if (error) {
      setFailed(true)
      setBusy(false)
      return
    }
    const res = await fetch('/api/profile').catch(() => null)
    if (res?.ok) dispatch(setUser((await res.json()) as Profile))
    setBusy(false)
  }

  async function underage() {
    setBusy(true)
    await createClient().auth.signOut({ scope: 'local' })
    router.replace('/')
  }

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-ocean-deep/85 px-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="consent-title"
    >
      <div className="w-full max-w-sm rounded-card border border-border-subtle bg-ocean-mid p-6 shadow-card">
        <h2 id="consent-title" className="font-display text-2xl text-sand mb-3">
          Before you go to sea
        </h2>
        <p className="font-ui text-sm leading-relaxed text-sand/65 mb-3">
          glassbottles is for adults. Please confirm you&rsquo;re 18 or older and agree to our{' '}
          <a href="/terms" target="_blank" className="text-seafoam hover:underline">Terms</a>,{' '}
          <a href="/guidelines" target="_blank" className="text-seafoam hover:underline">
            Community Guidelines
          </a>{' '}
          and{' '}
          <a href="/privacy" target="_blank" className="text-seafoam hover:underline">Privacy Policy</a>.
        </p>
        <p className="font-ui text-xs leading-relaxed text-sand/45 mb-6">
          No sexual content, harassment or contact details. Every bottle is checked before
          it&rsquo;s delivered.
        </p>
        {failed && (
          <p className="font-ui text-xs text-coral mb-3" role="alert">
            That didn&rsquo;t save. Check your connection and try again.
          </p>
        )}
        <button type="button" onClick={accept} disabled={busy} className={AUTH_PRIMARY_BTN_CLASS}>
          I&rsquo;m 18 or older &mdash; I agree
        </button>
        <button
          type="button"
          onClick={underage}
          disabled={busy}
          className="mt-3 w-full py-2 font-ui text-xs text-sand/45 hover:text-sand/75 transition-colors disabled:opacity-40"
        >
          I&rsquo;m under 18
        </button>
      </div>
    </div>
  )
}
