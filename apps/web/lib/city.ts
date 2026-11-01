/** Vercel's x-vercel-ip-city header is URL-encoded ('S%C3%A3o%20Paulo'). Anything
 *  that doesn't read as a place name is dropped rather than shown to a stranger. */
export function cityFromHeader(raw: string | null | undefined): string | null {
  if (!raw) return null
  let city: string
  try {
    city = decodeURIComponent(raw).trim()
  } catch {
    return null
  }
  return /^[\p{L}\p{M}][\p{L}\p{M} .'’-]{0,79}$/u.test(city) ? city : null
}
