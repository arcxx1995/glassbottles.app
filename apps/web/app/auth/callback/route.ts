import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import type { CookieOptions } from '@supabase/ssr'
import { cookies } from 'next/headers'

/**
 * GET /auth/callback
 *
 * Supabase magic-link and OAuth flows land here via the `emailRedirectTo` /
 * `redirectTo` option.  Supabase appends either:
 *   - ?code=<pkce_code>   (PKCE — default for email OTP / magic link)
 *   - #access_token=...   (implicit — legacy, not used here)
 *
 * We exchange the code for a session and redirect to /home (or /sign-in on
 * failure).  Cookies are written by the SSR client exactly as the middleware
 * expects them.
 *
 * Security:
 *   - `next` param is validated against same-origin to prevent open-redirect.
 *   - No session data is exposed to the client in the redirect URL.
 *   - Any error results in a redirect to /sign-in — never a 500 with details.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  // Optional: honour a `next` param for post-login destination, but only same-origin.
  const rawNext = searchParams.get('next') ?? '/home'
  // Reject protocol-relative (//evil.com) and backslash variants (/\evil.com)
  const next =
    rawNext.startsWith('/') && !rawNext.startsWith('//') && !rawNext.startsWith('/\\')
      ? rawNext
      : '/home'

  if (!code) {
    // No code means user navigated here directly or link was malformed.
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

  const { error } = await supabase.auth.exchangeCodeForSession(code)

  if (error) {
    // Never surface Supabase error details in the redirect URL.
    console.error('[auth/callback] exchangeCodeForSession failed:', error.message)
    return NextResponse.redirect(`${origin}/sign-in?error=auth_failed`)
  }

  return NextResponse.redirect(`${origin}${next}`)
}
