// Signed-in app routes, shared by middleware (redirect to sign-in) and
// AuthProvider (session ended under an open screen).
export const APP_PREFIXES = ['/sea', '/inbox', '/settings', '/logbook', '/admin']

export const isAppRoute = (path: string) =>
  APP_PREFIXES.some((p) => (p.endsWith('/') ? path.startsWith(p) : path === p || path.startsWith(p + '/')))
