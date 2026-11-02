/** Who may use the admin console: an admin, signed in with a password. A Google
 *  session is refused even for an admin, so hiding the button isn't the only
 *  thing keeping Google out. `amr` is the JWT's list of how the session signed in. */
export function canUseConsole(amr: unknown, isAdmin: unknown): boolean {
  if (isAdmin !== true || !Array.isArray(amr)) return false
  return amr.some((a) => (a as { method?: unknown } | null)?.method === 'password')
}
