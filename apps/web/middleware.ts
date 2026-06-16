import { createServerClient } from '@supabase/ssr'
import type { CookieOptions } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  // API routes: cheap cookie-presence guard only — no Supabase Auth call.
  // Every API route performs its own supabase.auth.getUser() (real
  // verification). Doing getUser() here too meant TWO Auth round-trips per
  // API request, billed as Fluid provisioned-memory wall-clock time.
  if (request.nextUrl.pathname.startsWith('/api/')) {
    const hasSessionCookie = request.cookies
      .getAll()
      .some(({ name }) => name.startsWith('sb-') && name.includes('-auth-token'))
    if (!hasSessionCookie) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return NextResponse.next({ request })
  }

  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet: { name: string; value: string; options?: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // getClaims() verifies the access-token JWT LOCALLY against the project's
  // cached JWKS (asymmetric signing keys) — no Auth-server round-trip on the
  // steady state. getUser() here cost a full network call on EVERY navigation
  // and prefetch to /home,/inbox,/settings; that call blocked the RSC payload,
  // so Next showed each route's loading.tsx skeleton for its whole duration
  // (the "slow tab + other screen flashes" report). getClaims still refreshes
  // an about-to-expire session and writes the rotated cookies via setAll, so
  // the redirect gate stays correct. Falls back to a network verify only if the
  // project uses a symmetric secret or WebCrypto is unavailable.
  const {
    data: claimsData,
  } = await supabase.auth.getClaims()
  const user = claimsData?.claims ?? null

  const isAppRoute = request.nextUrl.pathname.startsWith('/home') ||
    request.nextUrl.pathname.startsWith('/inbox') ||
    request.nextUrl.pathname.startsWith('/settings')

  const isAuthRoute = request.nextUrl.pathname === '/sign-in' ||
    request.nextUrl.pathname === '/sign-up'

  // Redirect unauthenticated users away from protected app routes
  if (isAppRoute && !user) {
    const redirectUrl = request.nextUrl.clone()
    redirectUrl.pathname = '/sign-in'
    return NextResponse.redirect(redirectUrl)
  }

  // Redirect authenticated users away from auth routes → home
  // Prevents a logged-in user from seeing the sign-in page on back-navigation
  if (isAuthRoute && user) {
    const redirectUrl = request.nextUrl.clone()
    redirectUrl.pathname = '/home'
    return NextResponse.redirect(redirectUrl)
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    /*
     * Match all routes EXCEPT:
     *   - /auth/callback  — must be reachable unauthenticated (PKCE code exchange)
     *   - /_next/          — Next.js internals
     *   - /favicon.ico
     */
    '/home',
    '/inbox',
    '/settings',
    '/home/:path*',
    '/inbox/:path*',
    '/settings/:path*',
    '/api/:path*',
    '/sign-in',
    '/sign-up',
    // Explicitly NOT listing /auth/callback here keeps it outside the middleware.
  ],
}
