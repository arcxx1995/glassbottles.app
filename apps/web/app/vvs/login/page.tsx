'use client'

import { Suspense, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { INPUT_CLASS } from '@/components/ui/Input'

// The console's own door: email and password only. No Google and no sign-up, on
// purpose. Middleware sends anyone who isn't an admin back here, signed out.
function LoginForm() {
  const denied = useSearchParams().get('denied') === '1'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(denied ? 'This account doesn’t have access.' : null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error: authError } = await createClient().auth.signInWithPassword({ email, password })
    if (authError) {
      // One message for every failure, so this page can't confirm who has an account.
      setError('Incorrect email or password.')
      setBusy(false)
      return
    }
    // A full load, so middleware decides with the new session.
    window.location.assign('/vvs')
  }

  return (
    <main className="flex min-h-[100svh] items-center justify-center bg-ocean-deep px-4 text-sand">
      <form onSubmit={submit} className="flex w-full max-w-sm flex-col gap-3 rounded-card border border-border-subtle bg-ocean-mid p-6">
        <h1 className="font-display text-2xl">vvs</h1>
        <label className="flex flex-col gap-1.5 font-ui text-xs text-sand/60">
          Email
          <input
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={INPUT_CLASS}
          />
        </label>
        <label className="flex flex-col gap-1.5 font-ui text-xs text-sand/60">
          Password
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={INPUT_CLASS}
          />
        </label>
        {error && (
          <p role="alert" className="font-ui text-xs text-coral">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={busy}
          className="press mt-1 w-full rounded-full bg-seafoam py-3 font-ui text-sm font-semibold text-ocean-deep disabled:opacity-50"
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  )
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  )
}
