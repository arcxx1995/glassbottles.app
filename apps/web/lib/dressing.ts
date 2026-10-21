// Bottle dressing (migration 042): what a bottle can carry besides its words.
// The Atelier catalog itself (pieces, tiers, colours) lives in the database —
// atelier_pieces is the single source for both validation and rendering. The
// small fixed vocabularies below mirror the column CHECK constraints.

export const WEATHERS = ['stormy', 'foggy', 'calm', 'sunny'] as const
export type Weather = (typeof WEATHERS)[number]
export const WEATHER_LABEL: Record<Weather, string> = {
  stormy: 'Stormy',
  foggy: 'Foggy',
  calm: 'Calm',
  sunny: 'Sunny',
}

export const VIBES = ['venting', 'small_win', 'wondering', 'grateful'] as const
export type Vibe = (typeof VIBES)[number]
export const VIBE_LABEL: Record<Vibe, string> = {
  venting: 'Just venting',
  small_win: 'A small win',
  wondering: 'Wondering',
  grateful: 'Grateful',
}

export const PIECE_KINDS = ['glass', 'seal', 'paper', 'ink'] as const
export type PieceKind = (typeof PIECE_KINDS)[number]
export type BottleStyle = Partial<Record<PieceKind, string>>

export interface AtelierPiece {
  kind: PieceKind
  id: string
  name: string
  tier: 'free' | 'coin' | 'keeper'
  look: { tint?: string; edge?: string; wax?: string | null; bg?: string; color?: string }
  sort: number
  /** Coin pieces only (049): what unlocking costs. */
  coin_cost?: number | null
}

/** Can this person throw this piece? Keepers: every piece. Coin pieces: once
 *  unlocked (`unlocked` holds 'kind:id' refs from get_coins). */
export function canUse(p: AtelierPiece, isKeeper: boolean, unlocked: readonly string[] = []) {
  return p.tier === 'free' || isKeeper || (p.tier === 'coin' && unlocked.includes(`${p.kind}:${p.id}`))
}

/** Resolved colours for one bottle. Defaults = the look bottles always had. */
export interface BottleLook {
  tint: string
  edge: string
  wax: string | null
  paper: string
  ink: string
}

export const DEFAULT_LOOK: BottleLook = {
  tint: 'rgba(78,205,196,0.04)',
  edge: 'rgba(255,255,255,0.18)',
  wax: null,
  paper: '#0D2137',
  ink: '#F7E7CE',
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
    paper: find('paper')?.bg ?? DEFAULT_LOOK.paper,
    ink: find('ink')?.color ?? DEFAULT_LOOK.ink,
  }
}

/** Drops pieces this person can't throw (a remembered style after the
 *  membership ended, a coin piece not unlocked) and anything no longer in the
 *  catalog. */
export function allowedStyle(
  style: BottleStyle,
  pieces: AtelierPiece[] | undefined,
  isKeeper: boolean,
  unlocked: readonly string[] = [],
): BottleStyle {
  if (!pieces) return {}
  const out: BottleStyle = {}
  for (const kind of PIECE_KINDS) {
    const p = pieces.find((x) => x.kind === kind && x.id === style[kind])
    if (p && p.sort > 0 && canUse(p, isKeeper, unlocked)) out[kind] = p.id
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

export const CURRENTS = ['night_owl', 'quiet_wins', 'heavy_water', 'busy_minds'] as const
export type CurrentId = (typeof CURRENTS)[number]

export interface SeaTheme {
  sky: string
  bands: readonly [string, string, string, string, string]
  foam: string
  glow: string
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
    },
  },
}
