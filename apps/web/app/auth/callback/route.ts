import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import type { CookieOptions } from '@supabase/ssr'
import type { EmailOtpType } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

/**
 * GET /auth/callback
 *
 * Single PKCE code-exchange landing point for both supported auth methods:
 *   - Google OAuth        (signInWithOAuth → provider redirect → ?code=...)
 *   - Email confirmation  (signUp / email-confirm link → ?code=...)
 *   - Password recovery   (resetPasswordForEmail → ?code=... → /home then
 *                          client routes to the update-password screen)
 *
 * In every case Supabase appends `?code=<pkce_code>` and we exchange it for a
 * session here. The exchange itself is provider-agnostic — the same
 * `exchangeCodeForSession` call resolves OAuth, email-confirm, and recovery
 * codes. (Implicit `#access_token=...` hash flow is not used by this app.)
 *
 * We redirect to /home on success (or `?next=` when same-origin), and to
 * /sign-in with a canonical `?error=` code on failure. Cookies are written by
 * the SSR client exactly as the middleware expects them.
 *
 * Canonical error codes emitted (frontend must match copy to these):
 *   - ?error=missing_code  → no `code` query param present
 *   - ?error=auth_failed   → exchangeCodeForSession returned an error
 *                            (expired/used code, provider mismatch, etc.)
 *
 * Security:
 *   - `next` param is validated against same-origin to prevent open-redirect.
 *   - No session data is exposed to the client in the redirect URL.
 *   - Any error results in a redirect to /sign-in — never a 500 with details.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  // OAuth (Google) arrives with ?code= (PKCE). Email links — signup confirm,
  // password recovery, email change — arrive with ?token_hash=&type=. The OTP
  // path is STATELESS: unlike PKCE, it needs no code_verifier from the
  // originating browser, so the link works when opened in a different browser /
  // device / mail app (the common case) and the user lands signed in instead of
  // being bounced to /sign-in.
  const code = searchParams.get('code')
  const tokenHash = searchParams.get('token_hash')
  const type = searchParams.get('type')
  // Optional: honour a `next` param for post-login destination, but only same-origin.
  const rawNext = searchParams.get('next') ?? '/home'
  // Reject protocol-relative (//evil.com) and backslash variants (/\evil.com)
  const next =
    rawNext.startsWith('/') && !rawNext.startsWith('//') && !rawNext.startsWith('/\\')
      ? rawNext
      : '/home'

  if (!code && !tokenHash) {
    // Neither credential present — user navigated here directly or link was malformed.
    return NextResponse.redirect(`${origin}/sign-in?error=missing_code`)
  }

  const cookieStore = cookies()

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet: { name: string; value: string; options?: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options)
          })
        },
      },
    }
  )

  let error
  if (tokenHash) {
    // Email OTP confirmation. Whitelist the type so only known email-link flows
    // are accepted (never trust an arbitrary query value).
    const allowed: EmailOtpType[] = [
      'signup',
      'recovery',
      'email_change',
      'email',
      'magiclink',
      'invite',
    ]
    const otpType = allowed.includes(type as EmailOtpType)
      ? (type as EmailOtpType)
      : null
    if (!otpType) {
      return NextResponse.redirect(`${origin}/sign-in?error=auth_failed`)
    }
    ;({ error } = await supabase.auth.verifyOtp({ type: otpType, token_hash: tokenHash }))
  } else {
    ;({ error } = await supabase.auth.exchangeCodeForSession(code!))
  }

  if (error) {
    // Never surface Supabase error details in the redirect URL.
    console.error('[auth/callback] session exchange failed:', error.message)
    return NextResponse.redirect(`${origin}/sign-in?error=auth_failed`)
  }

  return NextResponse.redirect(`${origin}${next}`)
}
