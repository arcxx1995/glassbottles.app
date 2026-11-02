import type { SeaTheme } from './dressing'
import type { KayakLook } from './kayakLook'

// The Harbour (migration 063): what get_harbour and friends answer, where things
// float, and what the water looks like.

export type VoyageState = 'screening' | 'sailing' | 'visiting' | 'returning' | 'home'

/** One of your own Kayaks. */
export interface MyKayak {
  id: string
  look: KayakLook
  aboard: number
  state: VoyageState
  /** Only while it's visiting, and only if that member's city is known. */
  city: string | null
  new_comments: number
}

/** Someone else's Kayak, in your harbour. Never says whose. */
export interface Visitor {
  visit_id: string
  look: KayakLook
  aboard: number
}

/** A note or comment the screen held: the writer sees why and can rewrite. */
export interface KayakNotice {
  kind: 'note' | 'comment'
  id: string
  reason: string | null
  body: string
  at: string
  /** A moderator hasn't decided yet. */
  waiting: boolean
  kayak_id?: string
}

export interface Harbour {
  keeper: boolean
  gems: { remaining: number; stock: number; refill_at: string | null }
  treasure: number
  kayaks: MyKayak[]
  visitors: Visitor[]
  notices: KayakNotice[]
}

export interface GemRef {
  id: string
  engine: number
  seed: number
}

export interface GuestbookEntry {
  id: string
  body: string
  at: string
}

export interface KayakVisit {
  id: string
  arrived_at: string
  leaves_at: string
  look: KayakLook
  note: string
  guestbook: GuestbookEntry[]
  gems: GemRef[]
}

export interface VoyageLog {
  id: string
  state: VoyageState
  started_at: string
  ended_at: string | null
  end_reason: string | null
  notes: { id: string; body: string; at: string; comments: GuestbookEntry[] }[]
}

export interface KayakDetail {
  id: string
  look: KayakLook
  state: VoyageState
  city: string | null
  edits_left: number | null
  edit_pending: boolean
  note: string | null
  gems: GemRef[]
  log: VoyageLog[]
}

export interface TreasureItem extends GemRef {
  state: 'kept' | 'reserved'
  kept_at: string | null
  comment: string | null
}

export const MAX_KAYAKS = 3
export const MAX_GEMS = 30
export const NOTE_MAX = 280
export const COMMENT_MIN = 10
export const COMMENT_MAX = 280

/** Said on the Harbour, for one of your Kayaks. */
export function kayakStatus(k: Pick<MyKayak, 'state' | 'city'>): string {
  switch (k.state) {
    case 'screening':
      return 'Checking your note before it sails'
    case 'visiting':
      return k.city ? `Your Kayak is somewhere near ${k.city}` : 'Your Kayak is sailing'
    case 'sailing':
      return 'Your Kayak is sailing'
    case 'returning':
      return 'Your Kayak is sailing home'
    default:
      return 'Tied to the mast'
  }
}

/** At the mast, or about to leave it. */
export const atMast = (k: Pick<MyKayak, 'state'>) => k.state === 'home' || k.state === 'screening'

/** Deterministic 0..1 from a seed: the same kayak bobs the same way every visit. */
export function seeded(seed: number) {
  const x = Math.sin(seed * 9301 + 49297) * 233280
  return x - Math.floor(x)
}

export interface Mooring {
  /** Centre, as a fraction of the square stage. */
  x: number
  y: number
  /** Degrees clockwise from bow-up. */
  rotate: number
  /** Kayak length as a fraction of the stage. */
  length: number
}

// The mast sits at the bottom of the stage, just above the Build button. The
// first Kayak ties up straight above it, the next two either side.
export const MAST = { x: 0.5, y: 0.88 }
const SPOTS: [number, number][] = [[0.5, 0.59], [0.2, 0.78], [0.8, 0.78]]
const VISITING: Mooring[] = [
  { x: 0.2, y: 0.34, rotate: -14, length: 0.27 },
  { x: 0.8, y: 0.34, rotate: 16, length: 0.27 },
  { x: 0.5, y: 0.2, rotate: 82, length: 0.24 },
]

/** Where the owner's Kayaks tie up, bows toward the mast. */
export function mastMooring(i: number): Mooring {
  const [x, y] = SPOTS[i % SPOTS.length]
  return { x, y, rotate: (Math.atan2(MAST.x - x, y - MAST.y) * 180) / Math.PI, length: 0.27 }
}

export const visitorMooring = (i: number): Mooring => VISITING[i % VISITING.length]

/** The bow's position, where the rope ties on. */
export function bowOf(m: Mooring): { x: number; y: number } {
  const rad = (m.rotate * Math.PI) / 180
  return { x: m.x + Math.sin(rad) * m.length * 0.46, y: m.y - Math.cos(rad) * m.length * 0.46 }
}

export type Light = 'dawn' | 'day' | 'dusk' | 'night'

export interface WaterLight {
  deep: string
  shallow: string
  caustic: string
  glint: string
  causticAmt: number
  glintAmt: number
}

export const LIGHTS: Record<Light, WaterLight> = {
  dawn: { deep: '#0F4E66', shallow: '#4AA9B0', caustic: '#FFE3C2', glint: '#FFD2A8', causticAmt: 0.55, glintAmt: 0.8 },
  day: { deep: '#06628A', shallow: '#22C3CF', caustic: '#F4FFFF', glint: '#FFFFFF', causticAmt: 0.85, glintAmt: 1 },
  dusk: { deep: '#173A5E', shallow: '#3C8798', caustic: '#FFC48A', glint: '#FFB070', causticAmt: 0.5, glintAmt: 0.85 },
  night: { deep: '#030F1C', shallow: '#0B2C43', caustic: '#7FB4E0', glint: '#C9DDF2', causticAmt: 0.22, glintAmt: 0.3 },
}

export type Rgb = [number, number, number]
export const hex = (h: string): Rgb => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as Rgb
/** a → b by t, as #rrggbb (the CSS fallback gradient needs strings too). */
const mix = (a: string, b: string, t: number) =>
  '#' + hex(a).map((v, i) => Math.round((v + (hex(b)[i] - v) * t) * 255).toString(16).padStart(2, '0')).join('')

/** How much of a current's daylight water survives at each hour. */
const BRIGHTNESS: Record<Light, number> = { dawn: 0.8, day: 1, dusk: 0.65, night: 0.28 }

/** A current sets the water's colours; the viewer's hour still sets how bright
 *  they are, and how strongly the light plays on the surface. */
export function currentLight(sea: SeaTheme, light: Light): WaterLight {
  const base = LIGHTS[light]
  const dim = 1 - BRIGHTNESS[light]
  return {
    ...base,
    deep: mix(sea.water.deep, '#000000', dim),
    shallow: mix(sea.water.shallow, '#000000', dim),
    caustic: mix(base.caustic, sea.foam, 0.6),
    glint: mix(base.glint, sea.foam, 0.5),
  }
}

/** The viewer's own hour decides the water's light. */
export function lightAt(hour: number): Light {
  if (hour >= 5 && hour < 8) return 'dawn'
  if (hour >= 8 && hour < 17) return 'day'
  if (hour >= 17 && hour < 20) return 'dusk'
  return 'night'
}
