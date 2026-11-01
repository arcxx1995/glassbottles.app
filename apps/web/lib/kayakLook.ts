// What a Kayak can look like. Mirrors check_kayak_look (063); kayakLook.test.ts
// keeps the two lists equal. Colours are the Atelier's 36 pastels (061).

export const VESSELS = [
  'sit_on_top', 'sea_kayak', 'canoe', 'rowing_boat', 'dinghy', 'sailboat',
  'punt', 'coracle', 'pirogue', 'outrigger',
] as const
export const PATTERNS = ['none', 'stripes', 'waves', 'scales', 'stars', 'woodgrain', 'faded'] as const
export const PADDLE_STYLES = ['double_blade', 'canoe_paddle', 'wooden_oars', 'painted_tips'] as const
export const DECK_ITEMS = [
  'lantern', 'flag', 'plant', 'cat', 'dog', 'books', 'gull', 'fishing_rod',
  'crate', 'rope', 'teapot', 'parasol', 'guitar', 'blanket', 'shells', 'radio',
] as const
export const DECK_SLOTS = ['bow', 'mid', 'stern'] as const

export type Vessel = (typeof VESSELS)[number]
export type Pattern = (typeof PATTERNS)[number]
export type PaddleStyle = (typeof PADDLE_STYLES)[number]
export type DeckItem = (typeof DECK_ITEMS)[number]
export type DeckSlot = (typeof DECK_SLOTS)[number]

export interface KayakLook {
  vessel: Vessel
  /** An Atelier pastel id, e.g. 'rose_pale'. */
  color: string
  pattern?: Pattern
  paddle: PaddleStyle
  deck?: Partial<Record<DeckSlot, DeckItem | null>>
}

// Spectrum order, as in migration 061.
const HUES: [string, number][] = [
  ['rose', 350], ['coral', 12], ['peach', 28], ['butter', 48], ['lime', 80], ['mint', 140],
  ['seafoam', 170], ['sky', 200], ['periwinkle', 228], ['lilac', 265], ['orchid', 295], ['blush', 325],
]
const SHADES: [string, number, number][] = [
  ['pale', 70, 88],
  ['soft', 65, 78],
  ['deep', 55, 66],
]

export const COLORS: { id: string; hue: number; sat: number; light: number }[] = HUES.flatMap(([name, hue]) =>
  SHADES.map(([shade, sat, light]) => ({ id: `${name}_${shade}`, hue, sat, light })),
)

export const DEFAULT_LOOK: KayakLook = {
  vessel: 'sit_on_top',
  color: 'butter_deep',
  pattern: 'none',
  paddle: 'double_blade',
  deck: {},
}
