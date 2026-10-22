// Signed-in app routes, shared by middleware (redirect to sign-in) and
// AuthProvider (session ended under an open screen). `/u/` and `/c/` are
// prefixes of profile / community pages.
export const APP_PREFIXES = ['/feed', '/sea', '/u/', '/c/', '/friends', '/communities', '/inbox', '/settings', '/logbook']

export const isAppRoute = (path: string) =>
  APP_PREFIXES.some((p) => (p.endsWith('/') ? path.startsWith(p) : path === p || path.startsWith(p + '/')))
