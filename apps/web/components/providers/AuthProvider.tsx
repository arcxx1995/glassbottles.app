'use client'

/**
 * AuthProvider
 *
 * Bootstraps the Redux authSlice from the Supabase session on mount.
 * Must wrap all pages that read from `selectUser` (i.e., inside ReduxProvider).
 *
 * Flow:
 *   1. On mount: call supabase.auth.getUser() → setLoading(true)
 *   2. On success: fetch /api/profile → setUser(profile)
 *   3. On auth state change (sign-in/sign-out via the Supabase OAuth /
 *      email-confirm callback): re-fetch profile or clear user.
 *
 * Why fetch /api/profile and not use the auth.User object directly?
 *   - auth.User has email + id, but not timezone etc.
 *   - The Redux authSlice uses the Profile type for user, which has those fields.
 *   - Components (settings, bottom nav badge) need Profile shape.
 *   - Profile is fetched via authApi RTK Query; we dispatch the result into authSlice
 *     to keep a single source of truth rather than two separate objects in state.
 *
 * Security:
 *   - getUser() goes to Supabase server (not just localStorage) — cannot be spoofed.
 *   - /api/profile requires session cookie — validates server-side in the route.
 *   - No session data is read from client-side storage directly.
 */

import { useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAppDispatch } from '@/store'
import { setUser, clearUser, setLoading } from '@/store/authSlice'
import type { Profile } from '@/types'

async function fetchProfile(): Promise<Profile | null> {
  try {
    const res = await fetch('/api/profile')
    if (!res.ok) return null
    return (await res.json()) as Profile
  } catch {
    return null
  }
}

export default function AuthProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const dispatch = useAppDispatch()
  // Stable ref — supabase client must not be recreated on re-render (breaks subscription)
  const supabaseRef = useRef(createClient())

  useEffect(() => {
    const supabase = supabaseRef.current

    // Persist the browser's IANA timezone so the daily reset / quota day is
    // measured at the user's local midnight (migration 019). Routed through the
    // PATCH /api/profile endpoint for tz-format validation (an invalid string
    // would make user_local_date() throw at read time). Fire-and-forget, and
    // only when the value actually changed — no request on the steady state.
    const syncTimezone = (profile: Profile) => {
      const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone
      if (browserTz && profile.timezone !== browserTz) {
        void fetch('/api/profile', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ timezone: browserTz }),
        }).catch(() => {
          /* best-effort — next sign-in retries */
        })
      }
    }

    // ── 1. Bootstrap: restore session from cookie (no network round-trip) ────
    // getSession() reads the cookie synchronously — instant restore on reload.
    // Server-side security is covered by middleware calling getUser() on every
    // request, so skipping the client-side network validation here is safe.
    dispatch(setLoading(true))

    void (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (!session?.user) {
        dispatch(clearUser())
        return
      }

      const profile = await fetchProfile()
      if (profile) {
        dispatch(setUser(profile))
        syncTimezone(profile)
      } else {
        dispatch(
          setUser({
            id: session.user.id,
            timezone: 'UTC',
            email_notifications: true,
            created_at: session.user.created_at ?? new Date().toISOString(),
            last_active: null,
          })
        )
      }
    })()

    // ── 2. Listen for auth state changes (OAuth/email-confirm callback, sign-out) ─
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_OUT' || !session) {
        dispatch(clearUser())
        return
      }

      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        const profile = await fetchProfile()
        if (profile) {
          dispatch(setUser(profile))
          syncTimezone(profile)
        }
      }
    })

    return () => {
      subscription.unsubscribe()
    }
  }, [dispatch])

  return <>{children}</>
}
