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
 *   3. On auth state change (sign-in/sign-out via Supabase magic link callback):
 *      re-fetch profile or clear user.
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

    // ── 1. Bootstrap: check if already logged in ──────────────────────────────
    dispatch(setLoading(true))

    void (async () => {
      const {
        data: { user },
        error,
      } = await supabase.auth.getUser()

      if (error || !user) {
        dispatch(clearUser())
        return
      }

      // User authenticated — fetch their full Profile shape
      const profile = await fetchProfile()
      if (profile) {
        dispatch(setUser(profile))
      } else {
        // Auth session exists but profile fetch failed (e.g., new user before trigger fires)
        // Still mark as logged in with minimal data so the app doesn't stay loading forever.
        // Subsequent RTK Query calls will retry /api/profile via authApi.
        dispatch(
          setUser({
            id: user.id,
            timezone: 'UTC',
            created_at: user.created_at ?? new Date().toISOString(),
            last_active: null,
          })
        )
      }
    })()

    // ── 2. Listen for auth state changes (magic link callback, sign-out) ─────
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
        }
      }
    })

    return () => {
      subscription.unsubscribe()
    }
  }, [dispatch])

  return <>{children}</>
}
