export interface SeaItem {
  id: string
  day_key: string
}

/**
 * Decides which bottles float in the sailing sea, optionally adding ONE optimistic
 * placeholder to bridge the throw → server-refetch hand-off.
 *
 * The placeholder is added only when `justThrew` is true — the user threw in this
 * session and the refetch hasn't landed yet. This is the whole point of the fix:
 * a delivered bottle is legitimately absent from `sailing` (its `received_at` is
 * set), and on reload `justThrew` is false, so that absence no longer spawns a
 * phantom floating bottle next to the "your bottle found someone" banner.
 */
export function buildSeaBottles<T extends SeaItem>(
  sailing: T[],
  sendStatus: string,
  todayKey: string | undefined,
  justThrew: boolean,
): (T | SeaItem)[] {
  if (
    justThrew &&
    sendStatus === 'thrown' &&
    todayKey &&
    !sailing.some((b) => b.day_key === todayKey)
  ) {
    return [...sailing, { id: '__pending_today__', day_key: todayKey }]
  }
  return sailing
}
