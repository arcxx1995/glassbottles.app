import type { SeaTheme } from './dressing'

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

export const HULL_COLOR: Record<Hull, string> = {
  yellow: '#F5C518',
  white: '#ECF1F2',
  coral: '#F2735C',
  teal: '#1FA99B',
  navy: '#24426E',
  lime: '#A9D43C',
}
export const PADDLE_COLOR: Record<Paddle, string> = {
  red: '#D93A2B',
  black: '#1C1E22',
  white: '#F3F3F1',
  yellow: '#F5C518',
  blue: '#2F6FD6',
}

export const HANDLE_RE = /^[a-z0-9_]{3,20}$/

/** Deterministic 0..1 from a seed: the same kayak bobs the same way every visit. */
export function seeded(seed: number) {
  const x = Math.sin(seed * 9301 + 49297) * 233280
  return x - Math.floor(x)
}

export interface Mooring {
  /** Centre, as a fraction of the square stage. */
  x: number
  y: number
  /** Degrees clockwise from bow-up; bows point at the centre. */
  rotate: number
  /** Kayak length as a fraction of the stage. */
  length: number
}

/** Kayaks rafted in a loose ring, bows inward, like petals. A few jitters
 *  per slot keep it from looking machine-placed. */
export function ringLayout(n: number): Mooring[] {
  if (n <= 0) return []
  const length = n <= 4 ? 0.38 : n <= 8 ? 0.33 : 0.3
  if (n === 1) return [{ x: 0.5, y: 0.5, rotate: -12, length }]
  const width = length * 0.27
  // Room for every hull side by side at mid-length, and a gap between bows.
  const r = Math.max(length / 2 + 0.035, (n * width * 1.4) / (2 * Math.PI))
  return Array.from({ length: n }, (_, i) => {
    const a = (2 * Math.PI * i) / n - Math.PI / 2 + (seeded(i + 1) - 0.5) * (Math.PI / n) * 0.35
    const rr = r + (seeded(i + 31) - 0.5) * 0.02
    return {
      x: 0.5 + rr * Math.cos(a),
      y: 0.5 + rr * Math.sin(a),
      rotate: (a * 180) / Math.PI - 90 + (seeded(i + 57) - 0.5) * 14,
      length,
    }
  })
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
