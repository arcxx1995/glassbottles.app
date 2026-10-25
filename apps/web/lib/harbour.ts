// The Harbour (migration 056). Palettes mirror the CHECKs on public.kayaks;
// widen both together.
export const HULLS = ['yellow', 'white', 'coral', 'teal', 'navy', 'lime'] as const
export const PADDLES = ['red', 'black', 'white', 'yellow', 'blue'] as const
export type Hull = (typeof HULLS)[number]
export type Paddle = (typeof PADDLES)[number]

/** One kayak in today's ring. */
export interface Kayak {
  slot: number
  handle: string
  bio: string | null
  hull: Hull
  paddle: Paddle
  mine: boolean
}

/** The caller's own kayak, whether or not it's in today's ring. */
export interface MyKayak {
  handle: string
  bio: string | null
  /** Handle + bio screen: null = pending, 'held' = kept out of the harbour. */
  screen: 'ok' | 'crisis' | 'held' | null
  hull: Hull | null
  paddle: Paddle | null
  parked: boolean
  launched: boolean
  afloat: boolean
  in_ring: boolean
}

export interface Harbour {
  keeper: boolean
  /** UTC day the twelve belong to (YYYY-MM-DD). */
  day: string
  kayaks: Kayak[]
  /** Null until a handle is claimed. */
  mine: MyKayak | null
}
