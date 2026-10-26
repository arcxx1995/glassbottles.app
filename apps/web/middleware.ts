import { createServerClient } from '@supabase/ssr'
import type { CookieOptions } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { isAppRoute as isAppPath } from '@/lib/routes'

const hasAuthCookie = (request: NextRequest) =>
  request.cookies
    .getAll()
    .some(({ name }) => name.startsWith('sb-') && name.includes('-auth-token'))

// Same-origin path only — same rule as /auth/callback (no open redirect).
const safeNext = (next: string | null) =>
  next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\')
    ? next
    : '/sea'

export async function middleware(request: NextRequest) {
  // API routes: cheap cookie-presence guard only — no Supabase Auth call.
  // Every API route performs its own supabase.auth.getUser() (real
  // verification). Doing getUser() here too meant TWO Auth round-trips per
  // API request, billed as Fluid provisioned-memory wall-clock time.
  if (request.nextUrl.pathname.startsWith('/api/')) {
    // Health check must stay reachable by unauthenticated uptime monitors;
    // webhooks carry no cookie — each verifies its own signature.
    if (
      request.nextUrl.pathname === '/api/health' ||
      request.nextUrl.pathname.startsWith('/api/webhooks/')
    ) {
      return NextResponse.next({ request })
    }
    if (!hasAuthCookie(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return NextResponse.next({ request })
  }

  // Landing page: anonymous visitors (no session cookie) pass straight through
  // with no Auth work; only returning users pay for getClaims().
  if (request.nextUrl.pathname === '/' && !hasAuthCookie(request)) {
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

  const isAppRoute = isAppPath(request.nextUrl.pathname)

  const isAuthRoute = request.nextUrl.pathname === '/sign-in' ||
    request.nextUrl.pathname === '/sign-up'

  const isLanding = request.nextUrl.pathname === '/'

  // A redirect is a fresh response: copy over any cookies getClaims() just
  // rotated, or the browser keeps the spent refresh token and the next
  // request signs the user out.
  const redirectTo = (url: URL) => {
    const res = NextResponse.redirect(url)
    supabaseResponse.cookies.getAll().forEach((c) => res.cookies.set(c))
    return res
  }

  // Redirect unauthenticated users away from protected app routes, keeping
  // where they were headed so sign-in can send them back.
  if (isAppRoute && !user) {
    const url = request.nextUrl.clone()
    url.pathname = '/sign-in'
    url.search = ''
    url.searchParams.set('next', request.nextUrl.pathname + request.nextUrl.search)
    return redirectTo(url)
  }

  // Redirect authenticated users away from auth routes (and the landing page)
  // → where they were headed, else home. Prevents a logged-in user seeing the
  // sign-in page on back-navigation, or a flash of the landing page.
  if ((isAuthRoute || isLanding) && user) {
    return redirectTo(new URL(safeNext(request.nextUrl.searchParams.get('next')), request.url))
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/',
    /*
     * Match all routes EXCEPT:
     *   - /auth/callback  — must be reachable unauthenticated (PKCE code exchange)
     *   - /_next/          — Next.js internals
     *   - /favicon.ico
     */
    '/sea',
    '/harbour',
    '/inbox',
    '/settings',
    '/sea/:path*',
    '/harbour/:path*',
    '/inbox/:path*',
    '/settings/:path*',
    '/logbook',
    '/admin/:path*',
    '/api/:path*',
    '/sign-in',
    '/sign-up',
    // Explicitly NOT listing /auth/callback here keeps it outside the middleware.
  ],
}
