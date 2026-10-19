// Two IANA names for one place — Chrome says Asia/Calcutta, Safari says
// Asia/Kolkata — must not count as a timezone change: each change starts the
// server's 24h cooldown (migration 036). Same UTC offset now and half a year
// out (so DST rules match too) = same local day boundaries = same zone here.
export function sameTimeZone(a: string, b: string, now = Date.now()): boolean {
  if (a === b) return true
  try {
    return [0, 182].every((days) => {
      const t = new Date(now + days * 86_400_000)
      const offset = (tz: string) =>
        new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' })
          .formatToParts(t)
          .find((p) => p.type === 'timeZoneName')?.value
      return offset(a) === offset(b)
    })
  } catch {
    return false // an unknown name on either side: let the server decide
  }
}
