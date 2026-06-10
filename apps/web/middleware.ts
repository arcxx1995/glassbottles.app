import { createServerClient } from '@supabase/ssr'
import type { CookieOptions } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
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

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const isAppRoute = request.nextUrl.pathname.startsWith('/home') ||
    request.nextUrl.pathname.startsWith('/inbox') ||
    request.nextUrl.pathname.startsWith('/settings')

  const isApiRoute = request.nextUrl.pathname.startsWith('/api/')

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

  // API routes: centralized 401 for unauthenticated requests.
  // Each API route still calls auth.getUser() individually (defence-in-depth).
  // This guard ensures any future route that forgets per-route auth is still protected.
  // Returns JSON (not a redirect) so clients receive a parseable error response.
  if (isApiRoute && !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/home',
    '/inbox',
    '/settings',
    '/home/:path*',
    '/inbox/:path*',
    '/settings/:path*',
    '/api/:path*',
    '/sign-in',
    '/sign-up',
  ],
}
