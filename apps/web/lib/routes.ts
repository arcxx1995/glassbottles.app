// Signed-in app routes, shared by middleware (redirect to sign-in) and
// AuthProvider (session ended under an open screen).
export const APP_PREFIXES = ['/sea', '/harbour', '/shelf', '/inbox', '/settings', '/logbook', '/vvs']

// The console's login is its own door, so a signed-out person belongs there.
export const isAppRoute = (path: string) =>
  path !== '/vvs/login' &&
  APP_PREFIXES.some((p) => (p.endsWith('/') ? path.startsWith(p) : path === p || path.startsWith(p + '/')))
