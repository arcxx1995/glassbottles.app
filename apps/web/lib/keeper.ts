// Shared by the Keeper card and the billing routes (no server-only imports).

/** Subscription states Dodo can still charge — a second purchase or a deleted
 *  account must cancel or manage this one first. */
export function hasLiveSubscription(m: { plan: string; status: string } | null | undefined) {
  return !!m && m.plan !== 'lifetime' && ['active', 'past_due', 'on_hold'].includes(m.status)
}

/** Is a membership's access still open? Lifetime rows store Postgres
 *  'infinity', which `new Date()` can't parse — compared naively, every
 *  Founding Keeper read as lapsed. */
export function hasAccess(accessUntil: string | null | undefined): boolean {
  if (!accessUntil) return false
  return accessUntil === 'infinity' || new Date(accessUntil).getTime() > Date.now()
}
