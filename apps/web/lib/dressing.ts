// Bottle dressing (migration 042): what a bottle can carry besides its words.
// The Atelier catalog itself (pieces, tiers, colours) lives in the database —
// atelier_pieces is the single source for both validation and rendering. The
// small fixed vocabularies below mirror the column CHECK constraints.

import { shapeId } from './bottleShapes'

export const WEATHERS = ['stormy', 'foggy', 'calm', 'sunny'] as const
export type Weather = (typeof WEATHERS)[number]
export const WEATHER_LABEL: Record<Weather, string> = {
  stormy: 'Stormy',
  foggy: 'Foggy',
  calm: 'Calm',
  sunny: 'Sunny',
}

export const PIECE_KINDS = ['shape', 'glass', 'seal'] as const
export type PieceKind = (typeof PIECE_KINDS)[number]
export type BottleStyle = Partial<Record<PieceKind, string>>

export interface AtelierPiece {
  kind: PieceKind
  id: string
  name: string
  tier: 'free' | 'keeper'
  look: { tint?: string; edge?: string; wax?: string | null }
  sort: number
  /** Out of the picker. Bottles already wearing it still resolve (061). */
  retired: boolean
}

/** Can this person throw this piece? Only Keepers dress (057). Free pieces are
 *  just the plain defaults. */
export function canUse(p: AtelierPiece, isKeeper: boolean) {
  return p.tier === 'free' || isKeeper
}

/** Every note is written on the same paper, in the same ink. */
export const NOTE_PAPER = '#0D2137'
export const NOTE_INK = '#F7E7CE'

/** How one bottle looks. Defaults = the look bottles always had. */
export interface BottleLook {
  tint: string
  edge: string
  wax: string | null
  shape: string
}

export const DEFAULT_LOOK: BottleLook = {
  tint: 'rgba(78,205,196,0.04)',
  edge: 'rgba(255,255,255,0.18)',
  wax: null,
  shape: 'classic',
}

export function resolveLook(
  style: BottleStyle | null | undefined,
  pieces: AtelierPiece[] | undefined,
): BottleLook {
  if (!style || !pieces) return DEFAULT_LOOK
  const find = (kind: PieceKind) => pieces.find((p) => p.kind === kind && p.id === style[kind])?.look
  const glass = find('glass')
  return {
    tint: glass?.tint ?? DEFAULT_LOOK.tint,
    edge: glass?.edge ?? DEFAULT_LOOK.edge,
    wax: find('seal')?.wax ?? null,
    shape: shapeId(style.shape),
  }
}

/** A Keeper's look for a bottle its sender didn't dress: glass and seal picked
 *  from the bottle's id, so it's the same every visit. Always the classic shape:
 *  a shape means another Keeper chose it.
 *  ponytail: adding catalogue pieces reshuffles these looks; store the choice on
 *  the bottle if that ever matters. */
export function seaDress(id: string, pieces: AtelierPiece[] | undefined): BottleStyle {
  if (!pieces) return {}
  let hash = 0
  for (const c of id) hash = (hash * 31 + c.charCodeAt(0)) >>> 0
  const pick = (kind: PieceKind, salt: number) => {
    const options = pieces.filter((p) => p.kind === kind && p.tier === 'keeper' && !p.retired)
    return options[(hash + salt) % options.length]?.id
  }
  return { glass: pick('glass', 0), seal: pick('seal', hash >>> 8) }
}

/** The one way to colour a bottle on the Shelf. The server only sends `style`
 *  to Keepers (057), so a free viewer's bottle always resolves plain. */
export function bottleLook(
  bottle: { id: string; style?: BottleStyle | null },
  pieces: AtelierPiece[] | undefined,
  isKeeper: boolean,
): BottleLook {
  return resolveLook(bottle.style ?? (isKeeper ? seaDress(bottle.id, pieces) : null), pieces)
}

/** Drops pieces this person can't throw (a remembered style after the
 *  membership ended) and anything no longer offered. */
export function allowedStyle(
  style: BottleStyle,
  pieces: AtelierPiece[] | undefined,
  isKeeper: boolean,
): BottleStyle {
  if (!pieces) return {}
  const out: BottleStyle = {}
  for (const kind of PIECE_KINDS) {
    const p = pieces.find((x) => x.kind === kind && x.id === style[kind])
    if (p && p.sort > 0 && !p.retired && canUse(p, isKeeper)) out[kind] = p.id
  }
  return out
}

// The last dressing is remembered per device — a convenience, never state
// that matters (the server re-checks every piece on throw).
const STYLE_KEY = 'gb:style'
export function loadStyle(): BottleStyle {
  try {
    const v = JSON.parse(localStorage.getItem(STYLE_KEY) ?? '{}')
    return v && typeof v === 'object' ? (v as BottleStyle) : {}
  } catch {
    return {}
  }
}
export function saveStyle(style: BottleStyle) {
  try {
    localStorage.setItem(STYLE_KEY, JSON.stringify(style))
  } catch {
    /* private mode / blocked storage: just don't remember */
  }
}

// A half-written bottle survives the round trip to Dodo checkout (same tab,
// so sessionStorage): stashed just before the redirect, restored once.
const DRAFT_KEY = 'gb:draft'
export function stashDraft(message: string) {
  try {
    if (message.trim()) sessionStorage.setItem(DRAFT_KEY, message)
  } catch {
    /* blocked storage: the draft is lost, as before */
  }
}
export function takeDraft(): string | null {
  try {
    const v = sessionStorage.getItem(DRAFT_KEY)
    sessionStorage.removeItem(DRAFT_KEY)
    return v
  } catch {
    return null
  }
}

// ─── Currents ────────────────────────────────────────────────────────────────
// Cosmetic: a label on your bottles. Keepers also see the current's sea.

export const CURRENTS = [
  'night_owl',
  'quiet_wins',
  'heavy_water',
  'busy_minds',
  'first_snow',
  'soft_rain',
  'first_light',
  'amber_fall',
] as const
export type CurrentId = (typeof CURRENTS)[number]

export type SeaWeather = 'stars' | 'motes' | 'fog' | 'fireflies' | 'snow' | 'rain' | 'petals' | 'leaves'

export interface SeaTheme {
  sky: string
  bands: readonly [string, string, string, string, string]
  foam: string
  glow: string
  /** CSS filter on the ships, lighthouse and clouds. */
  objects: string
  weather: SeaWeather
  /** Lightning in the clouds. Only the unsettled seas have it. */
  storm: boolean
  /** The Harbour's water at full daylight (lib/harbour.ts currentLight). */
  water: { deep: string; shallow: string }
}

export const CURRENT_INFO: Record<CurrentId, { name: string; blurb: string; sea: SeaTheme }> = {
  night_owl: {
    name: 'Night Owl',
    blurb: 'Late-night thoughts',
    sea: {
      sky: 'linear-gradient(to bottom, #070A1F 0%, #0B1033 30%, #1B1F5A 40%, #121645 52%, #060820 100%)',
      bands: ['#1E2363', '#191D55', '#141848', '#10133A', '#080A22'],
      foam: '#7CF5FF',
      glow: 'rgba(124,245,255,0.22)',
      objects: 'hue-rotate(25deg) brightness(0.75)',
      weather: 'stars',
      storm: false,
      water: { deep: '#0C1045', shallow: '#3A46B5' },
    },
  },
  quiet_wins: {
    name: 'Quiet Wins',
    blurb: 'Small good things',
    sea: {
      sky: 'linear-gradient(to bottom, #1A1626 0%, #3A2A3A 30%, #B97D57 40%, #3D4A5C 52%, #1A2433 100%)',
      bands: ['#3C5568', '#33495A', '#2A3E4E', '#223443', '#141F2A'],
      foam: '#F5C98A',
      glow: 'rgba(245,201,138,0.25)',
      objects: 'sepia(0.35) brightness(0.92)',
      weather: 'motes',
      storm: false,
      water: { deep: '#274459', shallow: '#8FA08A' },
    },
  },
  heavy_water: {
    name: 'Heavy Water',
    blurb: 'Grief and hard days',
    sea: {
      sky: 'linear-gradient(to bottom, #11161C 0%, #1A222B 30%, #2C3A47 40%, #222D38 52%, #0E1318 100%)',
      bands: ['#33424F', '#2C3A46', '#25313C', '#1E2932', '#11171D'],
      foam: '#AFC3D1',
      glow: 'rgba(175,195,209,0.14)',
      objects: 'grayscale(0.6) brightness(0.72)',
      weather: 'fog',
      storm: true,
      water: { deep: '#1E2A35', shallow: '#5F7687' },
    },
  },
  busy_minds: {
    name: 'Busy Minds',
    blurb: 'Racing thoughts',
    sea: {
      sky: 'linear-gradient(to bottom, #0B1A2A 0%, #13284A 30%, #2A4F7A 40%, #1F3E66 52%, #0A1830 100%)',
      bands: ['#1F6B78', '#1B5A70', '#174A63', '#133B55', '#0A2238'],
      foam: '#FF9EC7',
      glow: 'rgba(255,158,199,0.18)',
      objects: 'hue-rotate(-10deg) saturate(1.1)',
      weather: 'fireflies',
      storm: true,
      water: { deep: '#134A6B', shallow: '#2FA3A8' },
    },
  },
  first_snow: {
    name: 'First Snow',
    blurb: 'Slow, quiet days',
    sea: {
      sky: 'linear-gradient(to bottom, #1F2F42 0%, #4A6580 30%, #B8CBD9 40%, #6C8BA3 52%, #24384B 100%)',
      bands: ['#7E9DB4', '#64859E', '#4D6E88', '#3A5A74', '#1F3346'],
      foam: '#F2F8FF',
      glow: 'rgba(242,248,255,0.3)',
      objects: 'grayscale(0.4) brightness(1.15)',
      weather: 'snow',
      storm: false,
      water: { deep: '#38617F', shallow: '#B9D6E4' },
    },
  },
  soft_rain: {
    name: 'Soft Rain',
    blurb: 'Letting it out',
    sea: {
      sky: 'linear-gradient(to bottom, #141D24 0%, #25343D 30%, #4F6A70 40%, #33484F 52%, #121C22 100%)',
      bands: ['#4A686C', '#3E5A5F', '#324C52', '#273F45', '#141F24'],
      foam: '#BFE3E8',
      glow: 'rgba(191,227,232,0.16)',
      objects: 'grayscale(0.45) brightness(0.8)',
      weather: 'rain',
      storm: true,
      water: { deep: '#1F3F47', shallow: '#5E9498' },
    },
  },
  first_light: {
    name: 'First Light',
    blurb: 'Starting over',
    sea: {
      sky: 'linear-gradient(to bottom, #231A3A 0%, #5B3A63 30%, #F0A98F 40%, #6C5570 52%, #1F1D33 100%)',
      bands: ['#7A6482', '#65546F', '#51455F', '#3E374F', '#1F1D33'],
      foam: '#FFD9C7',
      glow: 'rgba(255,217,199,0.32)',
      objects: 'sepia(0.25) hue-rotate(-15deg) brightness(0.95)',
      weather: 'petals',
      storm: false,
      water: { deep: '#4A4468', shallow: '#E2AFA6' },
    },
  },
  amber_fall: {
    name: 'Amber Fall',
    blurb: 'Letting go',
    sea: {
      sky: 'linear-gradient(to bottom, #1E130F 0%, #4A2A1C 30%, #D08A3E 40%, #5A3C28 52%, #1C130E 100%)',
      bands: ['#6E4C30', '#5C3F29', '#4A3322', '#38281B', '#1C130E'],
      foam: '#FFC56B',
      glow: 'rgba(255,197,107,0.28)',
      objects: 'sepia(0.55) brightness(0.88)',
      weather: 'leaves',
      storm: false,
      water: { deep: '#3F3A26', shallow: '#B58A47' },
    },
  },
}
