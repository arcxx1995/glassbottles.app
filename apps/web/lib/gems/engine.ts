// The gem engine, version 1. A gem IS its seed: the seed's mixed-radix digits
// decode one to one into traits, so UNIQUE (engine, seed) in the database (063)
// means no two gems match. load_gems picks the digits; this only draws them.
//
// FROZEN once released: a member keeps a gem forever, so it must look the same
// forever. Don't change a drawing here, or the order of FAMILIES. New looks ship
// as engine 2 in their own file; gems.test.ts pins engine 1's output.
//
// Pure, with no DOM, so tests and scripts can run it. Output is built only from
// numbers and the constants below, never user text.

/** Low to high. Mirrors load_gems. Product: 238,878,720. */
const RADIX = { family: 30, palette: 36, silhouette: 48, facets: 24, texture: 24, finish: 8 } as const
export const SEED_SPACE = 30 * 36 * 48 * 24 * 24 * 8

export const FAMILIES = [
  'emerald_cut', 'rose_cut', 'cabochon', 'tumbled_stone', 'baroque_pearl', 'black_pearl',
  'opal', 'moonstone', 'aquamarine', 'tourmaline', 'amber', 'jet',
  'spiral_shell', 'scallop', 'cowrie', 'nautilus', 'urchin', 'starfish', 'sand_dollar',
  'branch_coral', 'brain_coral', 'sea_glass', 'abalone', 'driftwood_knot',
  'ships_coin', 'brass_key', 'compass_rose', 'anchor_charm', 'amphora_shard', 'glass_float',
] as const
export type Family = (typeof FAMILIES)[number]

const NOUN: Record<Family, string> = {
  emerald_cut: 'Step-Cut Stone', rose_cut: 'Rose Stone', cabochon: 'Cabochon', tumbled_stone: 'Sea Stone',
  baroque_pearl: 'Baroque Pearl', black_pearl: 'Black Pearl', opal: 'Opal', moonstone: 'Moonstone',
  aquamarine: 'Aquamarine', tourmaline: 'Tourmaline', amber: 'Amber', jet: 'Jet',
  spiral_shell: 'Whelk', scallop: 'Scallop', cowrie: 'Cowrie', nautilus: 'Nautilus', urchin: 'Urchin',
  starfish: 'Starfish', sand_dollar: 'Sand Dollar', branch_coral: 'Coral Branch', brain_coral: 'Brain Coral',
  sea_glass: 'Sea Glass', abalone: 'Abalone', driftwood_knot: 'Driftwood Knot', ships_coin: 'Ship’s Coin',
  brass_key: 'Brass Key', compass_rose: 'Compass Rose', anchor_charm: 'Anchor Charm',
  amphora_shard: 'Amphora Shard', glass_float: 'Glass Float',
}

const ADJECTIVE = [
  'Tidewater', 'Moonlit', 'Saltworn', 'Drifting', 'Northern', 'Quiet', 'Sunken', 'Windward',
  'Dawnlit', 'Harbour', 'Deepwater', 'Foamborn', 'Leeward', 'Stormglass', 'Lantern', 'Slack-Tide',
  'Pelagic', 'Coastal', 'Wandering', 'Mariner’s', 'Sea-Bright', 'Undertow', 'Fathom', 'Evening',
  'Brine', 'Lost', 'Gulf', 'Shoreline', 'Morning', 'Reef', 'Spindrift', 'Old',
  'Ebbing', 'Rising', 'Silver-Tide', 'Far', 'Hidden', 'Rainwashed', 'Horizon', 'Low-Tide',
  'Kelpwoven', 'Sailor’s', 'Glimmering', 'Cloudbreak', 'Long-Lost', 'Ocean', 'Wavecut', 'Starlit',
]

export interface Traits {
  family: Family
  palette: number
  silhouette: number
  facets: number
  texture: number
  finish: number
}

export function decodeSeed(seed: number): Traits {
  let n = Math.floor(Number(seed))
  if (!Number.isSafeInteger(n) || n < 0 || n >= SEED_SPACE) n = 0
  const take = (radix: number) => {
    const digit = n % radix
    n = Math.floor(n / radix)
    return digit
  }
  const family = FAMILIES[take(RADIX.family)]
  return {
    family,
    palette: take(RADIX.palette),
    silhouette: take(RADIX.silhouette),
    facets: take(RADIX.facets),
    texture: take(RADIX.texture),
    finish: take(RADIX.finish),
  }
}

export function encodeSeed(t: Traits): number {
  return (
    FAMILIES.indexOf(t.family) +
    30 * (t.palette + 36 * (t.silhouette + 48 * (t.facets + 24 * (t.texture + 24 * t.finish))))
  )
}

export function gemName(seed: number): string {
  const t = decodeSeed(seed)
  return `${ADJECTIVE[(t.silhouette + t.texture * 5 + t.palette) % ADJECTIVE.length]} ${NOUN[t.family]}`
}

// ── drawing kit ─────────────────────────────────────────────────────────────
function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const f = (n: number) => (Math.round(n * 10) / 10).toString()
const hsl = (h: number, s: number, l: number, a = 1) =>
  a === 1
    ? `hsl(${f(((h % 360) + 360) % 360)} ${f(s)}% ${f(l)}%)`
    : `hsl(${f(((h % 360) + 360) % 360)} ${f(s)}% ${f(l)}% / ${f(a * 100)}%)`

type Pt = [number, number]
const poly = (pts: Pt[]) => `M${pts.map(([x, y]) => `${f(x)} ${f(y)}`).join('L')}Z`

/** Smooth closed curve through points (Catmull-Rom as cubic Béziers). */
function blob(pts: Pt[]) {
  const n = pts.length
  let d = `M${f(pts[0][0])} ${f(pts[0][1])}`
  for (let i = 0; i < n; i++) {
    const [p0, p1, p2, p3] = [pts[(i + n - 1) % n], pts[i], pts[(i + 1) % n], pts[(i + 2) % n]]
    d += `C${f(p1[0] + (p2[0] - p0[0]) / 6)} ${f(p1[1] + (p2[1] - p0[1]) / 6)} ${f(p2[0] - (p3[0] - p1[0]) / 6)} ${f(p2[1] - (p3[1] - p1[1]) / 6)} ${f(p2[0])} ${f(p2[1])}`
  }
  return d + 'Z'
}

function ring(cx: number, cy: number, rx: number, ry: number, n: number, rot = -Math.PI / 2, wob = 0, r = () => 0.5): Pt[] {
  return Array.from({ length: n }, (_, i) => {
    const a = rot + (i / n) * Math.PI * 2
    const k = 1 + (r() - 0.5) * wob
    return [cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k] as Pt
  })
}

interface Ctx {
  id: string
  t: Traits
  r: () => number
  /** Silhouette split into two axes, 0–1. */
  a: number
  b: number
  /** Facet digit split into a small count and a level. */
  k: number
  m: number
  /** Palette position, 0–1. */
  p: number
  /** Palette's three-step shade, -1, 0 or 1. */
  shade: number
}

interface Drawn {
  /** Clips texture and finish. Absent for open shapes (coral, anchor), which
   *  mask to their own drawing, so overlays can't spill into the empty space. */
  outline?: string
  body: string
  /** Gradients and clip paths this family needs. */
  defs?: string
}

const radial = (id: string, stops: [number, string][], cx = 0.38, cy = 0.32, r = 0.75) =>
  `<radialGradient id="${id}" cx="${cx}" cy="${cy}" r="${r}">${stops.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('')}</radialGradient>`
const linear = (id: string, stops: [number, string][], x2 = 1, y2 = 1) =>
  `<linearGradient id="${id}" x1="0" y1="0" x2="${x2}" y2="${y2}">${stops.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('')}</linearGradient>`

/** Light from the upper left: how bright a facet is, by which way it faces. */
const lit = (a: Pt, b: Pt, cx: number, cy: number) => {
  const mx = (a[0] + b[0]) / 2 - cx
  const my = (a[1] + b[1]) / 2 - cy
  const len = Math.hypot(mx, my) || 1
  return (-mx * 0.7 - my * 0.7) / len
}

/** A cut stone: bands of facets between rings, with a bright table on top. */
function cutStone(c: Ctx, rings: Pt[][], h: number, s: number, l: number, cx = 50, cy = 50) {
  let out = ''
  for (let j = 0; j < rings.length - 1; j++) {
    const [o, i] = [rings[j], rings[j + 1]]
    for (let n = 0; n < o.length; n++) {
      const n2 = (n + 1) % o.length
      const light = lit(o[n], o[n2], cx, cy)
      const tone = l + light * 17 + (c.r() - 0.5) * 9 + j * 3
      out += `<path d="${poly([o[n], o[n2], i[n2], i[n]])}" fill="${hsl(h + (c.r() - 0.5) * 8, s, tone)}" stroke="${hsl(h, s * 0.6, Math.min(94, l + 30), 0.28)}" stroke-width="0.3"/>`
    }
  }
  return out
}

/** Short glinting cross. */
const glint = (x: number, y: number, size: number, opacity = 0.9) =>
  `<path d="M${f(x)} ${f(y - size)}Q${f(x + size * 0.12)} ${f(y - size * 0.12)} ${f(x + size)} ${f(y)}Q${f(x + size * 0.12)} ${f(y + size * 0.12)} ${f(x)} ${f(y + size)}Q${f(x - size * 0.12)} ${f(y + size * 0.12)} ${f(x - size)} ${f(y)}Q${f(x - size * 0.12)} ${f(y - size * 0.12)} ${f(x)} ${f(y - size)}Z" fill="#fff" opacity="${opacity}"/>`

// ── the 30 families ─────────────────────────────────────────────────────────
const DRAW: Record<Family, (c: Ctx) => Drawn> = {
  emerald_cut(c) {
    const h = c.p * 360
    const w = 25 + c.a * 9
    const tall = 27 + c.b * 10
    const cut = 4 + c.k * 1.4
    const oct = (dx: number, dy: number, q: number): Pt[] => [
      [50 - dx + q, 50 - dy], [50 + dx - q, 50 - dy], [50 + dx, 50 - dy + q], [50 + dx, 50 + dy - q],
      [50 + dx - q, 50 + dy], [50 - dx + q, 50 + dy], [50 - dx, 50 + dy - q], [50 - dx, 50 - dy + q],
    ]
    const steps = 2 + (c.m % 3)
    const rings = Array.from({ length: steps + 1 }, (_, i) => {
      const k = 1 - (i / (steps + 1)) * 0.62
      return oct(w * k, tall * k, cut * k)
    })
    const inner = rings[rings.length - 1]
    return {
      outline: poly(rings[0]),
      defs: linear(`${c.id}t`, [[0, hsl(h, 72, 82)], [0.5, hsl(h, 75, 56 + c.shade * 6)], [1, hsl(h, 80, 38)]]),
      body: cutStone(c, rings, h, 72, 44 + c.shade * 8) + `<path d="${poly(inner)}" fill="url(#${c.id}t)"/>`,
    }
  },

  rose_cut(c) {
    const h = c.p * 360 + 330
    const n = 6 + c.k * 2
    const rx = 28 + c.a * 8
    const ry = 28 + c.b * 8
    const rot = -Math.PI / 2 + c.m * 0.2
    const outer = ring(50, 50, rx, ry, n, rot)
    const mid = ring(50, 50, rx * 0.62, ry * 0.62, n, rot + Math.PI / n)
    let body = ''
    outer.forEach((p, i) => {
      const q = outer[(i + 1) % n]
      const tip = mid[i]
      body += `<path d="${poly([p, q, tip])}" fill="${hsl(h + (c.r() - 0.5) * 10, 66, 48 + lit(p, q, 50, 50) * 18 + c.shade * 7)}"/>`
      const nx = mid[(i + 1) % n]
      body += `<path d="${poly([q, tip, nx])}" fill="${hsl(h, 64, 40 + lit(tip, nx, 50, 50) * 16 + c.shade * 7)}"/>`
      body += `<path d="${poly([tip, nx, [50, 50]])}" fill="${hsl(h - 6, 70, 62 + lit(tip, nx, 50, 50) * 18 + c.shade * 6)}"/>`
    })
    return { outline: poly(outer), body }
  },

  cabochon(c) {
    const h = c.p * 360
    const rx = 24 + c.a * 12
    const ry = 24 + c.b * 9
    const d = blob(ring(50, 50, rx, ry, 16))
    return {
      outline: d,
      defs: radial(`${c.id}c`, [[0, hsl(h, 70, 84)], [0.4, hsl(h, 65, 56 + c.shade * 8)], [1, hsl(h + 10, 72, 22)]]),
      body:
        `<path d="${d}" fill="url(#${c.id}c)"/>` +
        `<ellipse cx="${f(50 - rx * 0.28)}" cy="${f(50 - ry * 0.4)}" rx="${f(rx * 0.32)}" ry="${f(ry * 0.18)}" fill="#fff" opacity="${f(0.45 + c.k * 0.06)}" transform="rotate(-24 50 50)"/>` +
        `<ellipse cx="${f(50 + rx * 0.34)}" cy="${f(50 + ry * 0.5)}" rx="${f(rx * 0.3)}" ry="${f(ry * 0.14)}" fill="${hsl(h, 80, 80, 0.3)}"/>`,
    }
  },

  tumbled_stone(c) {
    const h = c.p * 300 + 10
    const d = blob(ring(50, 50, 25 + c.a * 10, 22 + c.b * 9, 9, 0.4, 0.3, c.r))
    let bands = ''
    for (let i = 0; i <= c.k + 1; i++) {
      const y = 28 + (i * 44) / (c.k + 2) + (c.r() - 0.5) * 5
      bands += `<path d="M10 ${f(y)}Q50 ${f(y + (c.r() - 0.5) * 22)} 90 ${f(y + (c.r() - 0.5) * 8)}" fill="none" stroke="${hsl(h + 22, 30, 78, 0.45)}" stroke-width="${f(1 + c.r() * 3)}"/>`
    }
    return {
      outline: d,
      defs: radial(`${c.id}c`, [[0, hsl(h, 34, 72 + c.shade * 5)], [0.6, hsl(h, 38, 48 + c.shade * 6)], [1, hsl(h, 42, 26)]]),
      body: `<path d="${d}" fill="url(#${c.id}c)"/><g clip-path="url(#${c.id}o)">${bands}</g>`,
    }
  },

  baroque_pearl(c) {
    const h = 20 + c.p * 300
    const d = blob(ring(50, 50, 22 + c.a * 10, 25 + c.b * 11, 8, 0.2, 0.34, c.r))
    return {
      outline: d,
      defs: radial(`${c.id}c`, [[0, '#fffdf8'], [0.42, hsl(h, 26, 88 + c.shade * 3)], [0.8, hsl(h + 40, 22, 72)], [1, hsl(h + 70, 18, 52)]]),
      body:
        `<path d="${d}" fill="url(#${c.id}c)"/>` +
        `<path d="${d}" fill="${hsl(h + 120, 60, 72, 0.14)}" transform="translate(4 5) scale(.92)" transform-origin="50 50"/>` +
        `<ellipse cx="41" cy="${f(36 + c.m)}" rx="${f(5 + c.k)}" ry="${f(3.5 + c.k * 0.4)}" fill="#fff" opacity=".85"/>`,
    }
  },

  black_pearl(c) {
    const h = c.p * 360
    const r = 25 + c.a * 8
    const ry = r * (0.94 + c.b * 0.1)
    const d = blob(ring(50, 50, r, ry, 14))
    return {
      outline: d,
      defs:
        radial(`${c.id}c`, [[0, hsl(h, 16, 48 + c.shade * 5)], [0.3, hsl(h, 22, 22)], [0.75, '#0c0d12'], [1, hsl(h + 60, 34, 16)]]) +
        linear(`${c.id}i`, [[0, hsl(h, 80, 62, 0.34)], [0.5, hsl(h + 70, 80, 60, 0.1)], [1, hsl(h + 150, 80, 60, 0.3)]]),
      body:
        `<path d="${d}" fill="url(#${c.id}c)"/><path d="${d}" fill="url(#${c.id}i)"/>` +
        `<ellipse cx="${f(50 - r * 0.32)}" cy="${f(50 - ry * 0.44)}" rx="${f(4.5 + c.k * 0.7)}" ry="${f(3 + c.k * 0.3)}" fill="#fff" opacity=".82"/>`,
    }
  },

  opal(c) {
    const h = c.p * 360
    const d = blob(ring(50, 50, 24 + c.a * 11, 21 + c.b * 11, 11, 0, 0.14, c.r))
    let fire = ''
    const count = 18 + c.k * 5 + c.m * 3
    for (let i = 0; i < count; i++) {
      const a = c.r() * Math.PI * 2
      const q = Math.sqrt(c.r()) * 27
      const s = 2 + c.r() * 5
      fire += `<path d="${poly(ring(50 + Math.cos(a) * q, 50 + Math.sin(a) * q, s, s * (0.5 + c.r() * 0.5), 3 + Math.floor(c.r() * 3), c.r() * 6))}" fill="${hsl(h + c.r() * 220, 92, 62 + c.r() * 18, 0.72)}"/>`
    }
    return {
      outline: d,
      defs: radial(`${c.id}c`, [[0, '#f8fbff'], [0.6, hsl(h + 180, 30, 82 + c.shade * 4)], [1, hsl(h + 200, 28, 58)]]),
      body: `<path d="${d}" fill="url(#${c.id}c)"/><g clip-path="url(#${c.id}o)">${fire}</g><path d="${d}" fill="#fff" opacity=".12"/>`,
    }
  },

  moonstone(c) {
    const h = 190 + c.p * 80
    const rx = 23 + c.a * 10
    const ry = 26 + c.b * 8
    const d = blob(ring(50, 50, rx, ry, 14))
    const tilt = -40 + c.k * 14
    return {
      outline: d,
      defs:
        radial(`${c.id}c`, [[0, '#fbfbf7'], [0.6, hsl(h, 16, 86 + c.shade * 3)], [1, hsl(h, 22, 62)]]) +
        radial(`${c.id}s`, [[0, hsl(h, 92, 74, 0.9)], [1, hsl(h, 92, 74, 0)]], 0.5, 0.5, 0.5),
      body:
        `<path d="${d}" fill="url(#${c.id}c)"/>` +
        `<g clip-path="url(#${c.id}o)"><ellipse cx="50" cy="${f(40 + c.m * 4)}" rx="${f(rx * 0.95)}" ry="${f(ry * 0.42)}" fill="url(#${c.id}s)" transform="rotate(${tilt} 50 50)"/></g>`,
    }
  },

  aquamarine(c) {
    const h = 170 + c.p * 45
    const w = 15 + c.a * 8
    const hi = 30 + c.b * 8
    const peak = 7 + c.k * 1.3
    const outer: Pt[] = [
      [50, 50 - hi], [50 + w, 50 - hi + peak], [50 + w, 50 + hi - peak], [50, 50 + hi], [50 - w, 50 + hi - peak], [50 - w, 50 - hi + peak],
    ]
    const inner: Pt[] = outer.map(([x, y]) => [50 + (x - 50) * 0.55, 50 + (y - 50) * 0.72])
    return {
      outline: poly(outer),
      defs: linear(`${c.id}t`, [[0, hsl(h, 70, 90)], [1, hsl(h, 70, 58 + c.shade * 7)]], 0.6, 1),
      body:
        cutStone(c, [outer, inner], h, 62, 56 + c.shade * 6) +
        `<path d="${poly(inner)}" fill="url(#${c.id}t)" opacity=".92"/>` +
        (c.m > 1 ? `<path d="M${f(50 - w * 0.2)} ${f(50 - hi * 0.5)}L${f(50 - w * 0.2)} ${f(50 + hi * 0.5)}" stroke="#fff" stroke-width="1" opacity=".5"/>` : ''),
    }
  },

  tourmaline(c) {
    const pink = 320 + c.p * 40
    const green = 120 + c.p * 50
    const w = 13 + c.a * 8
    const hi = 31 + c.b * 8
    const split = 30 + c.k * 7
    const outer: Pt[] = [[50 - w * 0.7, 50 - hi], [50 + w * 0.7, 50 - hi], [50 + w, 50 - hi + 6], [50 + w, 50 + hi - 6], [50 + w * 0.7, 50 + hi], [50 - w * 0.7, 50 + hi], [50 - w, 50 + hi - 6], [50 - w, 50 - hi + 6]]
    const d = poly(outer)
    let lines = ''
    for (let i = 0; i < 3 + c.m; i++) {
      const x = 50 - w + ((i + 1) * 2 * w) / (4 + c.m)
      lines += `<path d="M${f(x)} ${f(50 - hi + 2)}L${f(x)} ${f(50 + hi - 2)}" stroke="#fff" stroke-width="${f(0.5 + c.r())}" opacity=".26"/>`
    }
    return {
      outline: d,
      defs: linear(`${c.id}t`, [[0, hsl(pink, 74, 62 + c.shade * 5)], [split / 100, hsl(pink, 78, 54)], [(split + 12) / 100, hsl(green, 58, 46)], [1, hsl(green, 66, 30 + c.shade * 4)]], 0, 1),
      body: `<path d="${d}" fill="url(#${c.id}t)"/><g clip-path="url(#${c.id}o)">${lines}</g>`,
    }
  },

  amber(c) {
    const h = 24 + c.p * 22
    const d = blob(ring(50, 52, 23 + c.a * 10, 25 + c.b * 9, 9, 0.8, 0.3, c.r))
    let bits = ''
    for (let i = 0; i < 4 + c.k; i++) {
      bits += `<circle cx="${f(36 + c.r() * 28)}" cy="${f(38 + c.r() * 28)}" r="${f(0.5 + c.r() * 1.3)}" fill="${hsl(h - 12, 80, 18, 0.7)}"/>`
    }
    // A tiny caught insect, on some.
    const fly =
      c.m === 3
        ? `<g transform="translate(${f(46 + c.r() * 8)} ${f(48 + c.r() * 8)}) rotate(${f(c.r() * 360)})" fill="${hsl(h - 14, 70, 13, 0.85)}"><ellipse rx="1.3" ry="2.7"/><ellipse cx="-2.3" cy="-.8" rx="2.5" ry="1" opacity=".45"/><ellipse cx="2.3" cy="-.8" rx="2.5" ry="1" opacity=".45"/></g>`
        : ''
    return {
      outline: d,
      defs: radial(`${c.id}c`, [[0, hsl(h + 16, 96, 76)], [0.55, hsl(h, 92, 52 + c.shade * 6)], [1, hsl(h - 10, 86, 26)]]),
      body: `<path d="${d}" fill="url(#${c.id}c)"/>${bits}${fly}<ellipse cx="41" cy="38" rx="7" ry="3.8" fill="#fff" opacity=".42" transform="rotate(-28 41 38)"/>`,
    }
  },

  jet(c) {
    const h = c.p * 360
    const outer = ring(50, 50, 24 + c.a * 10, 22 + c.b * 11, 6 + c.k, 0.3 + c.m * 0.2, 0.26, c.r)
    const inner = outer.map(([x, y]) => [50 + (x - 50) * 0.55, 50 + (y - 50) * 0.55] as Pt)
    let body = ''
    outer.forEach((p, i) => {
      const q = outer[(i + 1) % outer.length]
      body += `<path d="${poly([p, q, inner[(i + 1) % inner.length], inner[i]])}" fill="${hsl(h, 10, 11 + lit(p, q, 50, 50) * 13 + c.shade * 2)}"/>`
    })
    body += `<path d="${poly(inner)}" fill="${hsl(h, 12, 16)}"/>`
    body += `<path d="${poly([inner[0], inner[1], [50, 50]])}" fill="#fff" opacity=".2"/>`
    return { outline: poly(outer), body }
  },

  spiral_shell(c) {
    const h = 18 + c.p * 40
    const whorls = 4 + c.k % 3
    const w = 19 + c.a * 8
    const tall = 34 + c.b * 6
    const tipY = 50 - tall
    const baseY = 50 + tall * 0.72
    const d = blob([[50, tipY], [50 + w * 0.5, 50 - tall * 0.3], [50 + w, 50 + tall * 0.3], [50 + w * 0.42, baseY], [50 - w * 0.5, baseY + 3], [50 - w, 50 + tall * 0.26], [50 - w * 0.48, 50 - tall * 0.3]])
    let bands = ''
    for (let i = 1; i <= whorls; i++) {
      const y = tipY + ((baseY - tipY) * (i * i)) / (whorls * whorls + 1)
      const half = w * (0.2 + (i / whorls) * 0.85)
      bands += `<path d="M${f(50 - half)} ${f(y - 2)}Q50 ${f(y + 6 + i)} ${f(50 + half)} ${f(y - 4)}" fill="none" stroke="${hsl(h - 8, 44, 30, 0.75)}" stroke-width="${f(1 + i * 0.28)}"/>`
      if (c.m > 0) bands += `<path d="M${f(50 - half)} ${f(y + 1.5)}Q50 ${f(y + 9 + i)} ${f(50 + half)} ${f(y - 1)}" fill="none" stroke="${hsl(h + 16, 80, 90, 0.45)}" stroke-width="1"/>`
    }
    return {
      outline: d,
      defs: linear(`${c.id}c`, [[0, hsl(h + 8, 60, 88 + c.shade * 3)], [0.55, hsl(h, 54, 66 + c.shade * 5)], [1, hsl(h - 6, 48, 40)]], 1, 0.7),
      body:
        `<path d="${d}" fill="url(#${c.id}c)"/><g clip-path="url(#${c.id}o)">${bands}` +
        `<ellipse cx="${f(50 + w * 0.2)}" cy="${f(baseY - 8)}" rx="${f(w * 0.4)}" ry="9" fill="${hsl(h - 6, 44, 24, 0.75)}" transform="rotate(-18 50 ${f(baseY)})"/></g>`,
    }
  },

  scallop(c) {
    const h = c.p * 60 + 330
    const ribs = 8 + c.k * 2
    const r = 30 + c.a * 7
    const flare = 0.58 + c.b * 0.24
    const hingeY = 78
    const pts: Pt[] = []
    for (let i = 0; i <= ribs; i++) {
      const a = -Math.PI / 2 + (i / ribs - 0.5) * Math.PI * 2 * flare * 0.72
      const rr = r * 1.32 * (i % 2 ? 1 : 0.96)
      pts.push([50 + Math.cos(a) * rr, hingeY + Math.sin(a) * rr])
    }
    const edge = pts.map(([x, y], i) => (i === 0 ? `M${f(x)} ${f(y)}` : `Q${f((pts[i - 1][0] + x) / 2)} ${f((pts[i - 1][1] + y) / 2 - 2)} ${f(x)} ${f(y)}`)).join('')
    const d = `${edge}L${f(50 + 7)} ${hingeY}L${f(50 - 7)} ${hingeY}Z`
    let lines = ''
    pts.forEach(([x, y], i) => {
      lines += `<path d="M50 ${hingeY}L${f(x)} ${f(y)}" stroke="${hsl(h - 10, 44, 42, 0.5)}" stroke-width="${i % 2 ? 1.5 : 0.7}"/>`
    })
    let arcs = ''
    for (let i = 1; i <= 2 + c.m; i++) {
      const q = (r * 1.25 * i) / (3 + c.m)
      arcs += `<circle cx="50" cy="${hingeY}" r="${f(q)}" fill="none" stroke="${hsl(h + 6, 70, 92, 0.42)}" stroke-width="${f(1 + c.r())}"/>`
    }
    return {
      outline: d,
      defs: radial(`${c.id}c`, [[0, hsl(h + 18, 72, 92)], [0.6, hsl(h + 8, 60, 76 + c.shade * 4)], [1, hsl(h, 54, 52)]], 0.5, 0.95, 1.05),
      body: `<path d="${d}" fill="url(#${c.id}c)"/><g clip-path="url(#${c.id}o)">${arcs}${lines}</g><path d="M${f(50 - 11)} ${hingeY}L${f(50 + 11)} ${hingeY}L${f(50 + 7)} ${hingeY + 5}L${f(50 - 7)} ${hingeY + 5}Z" fill="${hsl(h, 50, 58)}"/>`,
    }
  },

  cowrie(c) {
    const h = 22 + c.p * 30
    const rx = 20 + c.a * 7
    const ry = 30 + c.b * 6
    const d = blob(ring(50, 50, rx, ry, 12))
    const spots = Array.from({ length: 12 + c.k * 4 }, () => {
      const a = c.r() * Math.PI * 2
      const q = Math.sqrt(c.r())
      return `<ellipse cx="${f(50 + Math.cos(a) * rx * q)}" cy="${f(50 + Math.sin(a) * ry * q)}" rx="${f(1 + c.r() * 2.2)}" ry="${f(0.8 + c.r() * 1.6)}" fill="${hsl(h - 8, 62, 26, 0.7)}"/>`
    }).join('')
    const toothCount = 6 + c.m * 2
    const teeth = Array.from({ length: toothCount }, (_, i) => {
      const y = 50 - ry * 0.68 + ((i + 0.5) * ry * 1.36) / toothCount
      return `<path d="M50 ${f(y)}h${i % 2 ? 4 : -4}" stroke="#fdf3df" stroke-width="1.5" stroke-linecap="round"/>`
    }).join('')
    return {
      outline: d,
      defs: radial(`${c.id}c`, [[0, hsl(h + 14, 66, 88 + c.shade * 3)], [0.65, hsl(h, 62, 60 + c.shade * 4)], [1, hsl(h - 8, 54, 30)]]),
      body:
        `<path d="${d}" fill="url(#${c.id}c)"/><g clip-path="url(#${c.id}o)">${spots}</g>` +
        `<path d="M50 ${f(50 - ry * 0.78)}C${f(50 + 6)} ${f(50 - ry * 0.3)} ${f(50 - 6)} ${f(50 + ry * 0.3)} 50 ${f(50 + ry * 0.78)}" fill="none" stroke="#2c1c10" stroke-width="3" stroke-linecap="round"/>${teeth}` +
        `<ellipse cx="42" cy="34" rx="5" ry="3" fill="#fff" opacity=".55"/>`,
    }
  },

  nautilus(c) {
    const h = 16 + c.p * 34
    const r = 33 + c.a * 5
    const growth = 0.2 + c.b * 0.05
    const turns = 3.1
    const spiral = (s: number): Pt[] =>
      Array.from({ length: 40 }, (_, i) => {
        const th = (i / 39) * turns * Math.PI * 2
        const rr = r * s * Math.exp(growth * (th - turns * Math.PI * 2))
        return [52 + Math.cos(th + 1) * rr, 50 + Math.sin(th + 1) * rr] as Pt
      })
    const line = (pts: Pt[]) => `M${pts.map(([x, y]) => `${f(x)} ${f(y)}`).join('L')}`
    const d = blob(ring(50, 50, r, r * 0.92, 18))
    const chambers = 11 + c.k * 2
    let walls = ''
    const s = spiral(1)
    for (let i = 0; i < chambers; i++) {
      const p = s[39 - Math.floor((i * 28) / chambers)]
      walls += `<path d="M52 50Q${f((p[0] + 52) / 2 + 4)} ${f((p[1] + 50) / 2 - 3)} ${f(p[0])} ${f(p[1])}" fill="none" stroke="${hsl(h - 8, 42, 34, 0.6)}" stroke-width=".8"/>`
    }
    let stripes = ''
    for (let i = 0; i < 6 + c.m * 2; i++) {
      const y = 18 + (i * 64) / (6 + c.m * 2)
      stripes += `<path d="M14 ${f(y)}Q50 ${f(y + 18)} 86 ${f(y - 4)}" fill="none" stroke="${hsl(h - 2, 66, 40, 0.42)}" stroke-width="${f(1.4 + c.r() * 2)}"/>`
    }
    return {
      outline: d,
      defs: radial(`${c.id}c`, [[0, hsl(h + 16, 54, 92)], [0.7, hsl(h + 6, 56, 74 + c.shade * 4)], [1, hsl(h, 50, 46)]], 0.55, 0.5),
      body:
        `<path d="${d}" fill="url(#${c.id}c)"/><g clip-path="url(#${c.id}o)">${stripes}${walls}` +
        `<path d="${line(s)}" fill="none" stroke="${hsl(h - 10, 54, 22, 0.85)}" stroke-width="2.2" stroke-linecap="round"/></g>`,
    }
  },

  urchin(c) {
    const h = c.p * 340
    const r = 19 + c.a * 8
    const spikes = 26 + c.k * 5
    const long = 8 + c.b * 10
    let spines = ''
    for (let i = 0; i < spikes; i++) {
      const a = (i / spikes) * Math.PI * 2 + (c.r() - 0.5) * 0.08
      const l = long * (0.75 + c.r() * 0.45)
      spines += `<path d="M${f(50 + Math.cos(a) * r * 0.9)} ${f(50 + Math.sin(a) * r * 0.9)}L${f(50 + Math.cos(a) * (r + l))} ${f(50 + Math.sin(a) * (r + l))}" stroke="${hsl(h + (c.r() - 0.5) * 16, 52, 30 + c.r() * 22)}" stroke-width="1.3" stroke-linecap="round"/>`
    }
    let dots = ''
    const rows = 5 + c.m
    for (let i = 0; i < rows; i++) {
      const a = (i / rows) * Math.PI * 2
      for (let j = 1; j < 4; j++) {
        dots += `<circle cx="${f(50 + (Math.cos(a) * r * j) / 4.2)}" cy="${f(50 + (Math.sin(a) * r * j) / 4.2)}" r="${f(1.2 - j * 0.15)}" fill="${hsl(h, 40, 88, 0.8)}"/>`
      }
    }
    const d = blob(ring(50, 50, r + long * 0.82, r + long * 0.82, 16))
    return {
      outline: d,
      defs: radial(`${c.id}c`, [[0, hsl(h, 40, 58 + c.shade * 6)], [1, hsl(h, 48, 22)]]),
      body: `${spines}<circle cx="50" cy="50" r="${f(r)}" fill="url(#${c.id}c)"/>${dots}`,
    }
  },

  starfish(c) {
    const h = c.p * 50 - 10
    const arms = c.m === 3 ? 6 : 5
    const R = 33 + c.a * 6
    const q = 10 + c.b * 6
    const rot = -Math.PI / 2 + c.k * 0.07
    const pts: Pt[] = []
    for (let i = 0; i < arms * 2; i++) {
      const a = rot + (i / (arms * 2)) * Math.PI * 2
      const rr = i % 2 ? q : R * (0.9 + c.r() * 0.16)
      pts.push([50 + Math.cos(a) * rr, 50 + Math.sin(a) * rr])
    }
    const d = blob(pts)
    let bumps = ''
    for (let i = 0; i < arms; i++) {
      const a = rot + (i / arms) * Math.PI * 2
      const n = 4 + c.k % 4
      for (let j = 0; j <= n; j++) {
        const rr = (R * 0.84 * j) / n
        bumps += `<circle cx="${f(50 + Math.cos(a) * rr)}" cy="${f(50 + Math.sin(a) * rr)}" r="${f(2.1 - (j / n) * 0.9)}" fill="${hsl(h + 18, 78, 84, 0.9)}"/>`
        if (j > 0 && j < n) {
          for (const side of [-1, 1]) {
            bumps += `<circle cx="${f(50 + Math.cos(a + (side * 3.6) / (rr + 8)) * rr)}" cy="${f(50 + Math.sin(a + (side * 3.6) / (rr + 8)) * rr)}" r="1" fill="${hsl(h + 14, 72, 80, 0.7)}"/>`
          }
        }
      }
    }
    return {
      outline: d,
      defs: radial(`${c.id}c`, [[0, hsl(h + 16, 82, 66 + c.shade * 5)], [1, hsl(h, 78, 40)]], 0.5, 0.5, 0.7),
      body: `<path d="${d}" fill="url(#${c.id}c)"/><g clip-path="url(#${c.id}o)">${bumps}</g>`,
    }
  },

  sand_dollar(c) {
    const h = 35 + c.p * 25
    const rx = 28 + c.a * 8
    const ry = 27 + c.b * 8
    const d = blob(ring(50, 50, rx, ry, 18))
    let petals = ''
    for (let i = 0; i < 5; i++) {
      const a = -90 + i * 72
      petals += `<g transform="rotate(${a} 50 50)"><path d="M50 50C${f(50 + 6 + c.k * 0.4)} ${f(50 - 7)} ${f(50 + 6 + c.k * 0.4)} ${f(50 - 18 - c.m)} 50 ${f(50 - 21 - c.m)}C${f(50 - 6 - c.k * 0.4)} ${f(50 - 18 - c.m)} ${f(50 - 6 - c.k * 0.4)} ${f(50 - 7)} 50 50Z" fill="none" stroke="${hsl(h - 8, 26, 52, 0.75)}" stroke-width="1.2" stroke-dasharray="1.1 1.2"/></g>`
    }
    let notches = ''
    for (let i = 0; i < 5; i++) {
      const a = -54 + i * 72
      const rad = (a * Math.PI) / 180
      notches += `<ellipse cx="${f(50 + Math.cos(rad) * rx * 0.72)}" cy="${f(50 + Math.sin(rad) * ry * 0.72)}" rx="${f(1.3 + c.m * 0.3)}" ry="${f(2.8 + c.m * 0.3)}" fill="${hsl(h - 6, 22, 42)}" transform="rotate(${a + 90} ${f(50 + Math.cos(rad) * rx * 0.72)} ${f(50 + Math.sin(rad) * ry * 0.72)})"/>`
    }
    return {
      outline: d,
      defs: radial(`${c.id}c`, [[0, hsl(h + 6, 42, 92)], [0.7, hsl(h, 36, 80 + c.shade * 3)], [1, hsl(h - 4, 30, 58)]]),
      body: `<path d="${d}" fill="url(#${c.id}c)"/>${petals}${notches}<circle cx="50" cy="50" r="2" fill="${hsl(h - 6, 24, 48)}"/>`,
    }
  },

  branch_coral(c) {
    const h = c.p * 50 - 15
    const depth = 3 + (c.k % 2)
    const spread = 0.34 + c.a * 0.3
    let seg = ''
    const grow = (x: number, y: number, a: number, l: number, w: number, level: number) => {
      const x2 = x + Math.cos(a) * l
      const y2 = y + Math.sin(a) * l
      seg += `<path d="M${f(x)} ${f(y)}L${f(x2)} ${f(y2)}" stroke="${hsl(h, 72, 52 + c.shade * 5 + level * 4)}" stroke-width="${f(w)}" stroke-linecap="round"/>`
      seg += `<path d="M${f(x - 0.6)} ${f(y)}L${f(x2 - 0.6)} ${f(y2)}" stroke="${hsl(h + 12, 90, 84, 0.42)}" stroke-width="${f(w * 0.28)}" stroke-linecap="round"/>`
      if (level >= depth) {
        seg += `<circle cx="${f(x2)}" cy="${f(y2)}" r="${f(w * 0.68)}" fill="${hsl(h + 8, 86, 78)}"/>`
        return
      }
      const branches = c.r() > 0.76 - c.m * 0.05 ? 3 : 2
      for (let i = 0; i < branches; i++) {
        const t = (i / (branches - 1) - 0.5) * 2
        grow(x2, y2, a + t * spread + (c.r() - 0.5) * 0.26, l * (0.66 + c.r() * 0.18), w * 0.72, level + 1)
      }
    }
    grow(50, 88, -Math.PI / 2 + (c.b - 0.5) * 0.3, 21 + c.b * 5, 6.5, 0)
    return { body: seg }
  },

  brain_coral(c) {
    const h = 30 + c.p * 70
    const rx = 28 + c.a * 8
    const ry = 25 + c.b * 8
    const d = blob(ring(50, 50, rx, ry, 16))
    let maze = ''
    const rows = 5 + c.k % 4
    for (let row = 0; row < rows; row++) {
      const y = 50 - ry + ((row + 0.5) * ry * 2) / rows
      let path = `M${f(50 - rx)} ${f(y)}`
      const wig = 6 + c.m * 2
      for (let i = 0; i < wig; i++) {
        const x = 50 - rx + ((i + 1) * rx * 2) / wig
        path += `Q${f(x - rx / wig)} ${f(y + (i % 2 ? 1 : -1) * (5 + c.r() * 5))} ${f(x)} ${f(y + (c.r() - 0.5) * 3)}`
      }
      maze += `<path d="${path}" fill="none" stroke="${hsl(h - 12, 44, 30, 0.72)}" stroke-width="2.5" stroke-linecap="round"/>`
      maze += `<path d="${path}" fill="none" stroke="${hsl(h + 6, 66, 86, 0.5)}" stroke-width=".8" transform="translate(-.7 -1.1)"/>`
    }
    return {
      outline: d,
      defs: radial(`${c.id}c`, [[0, hsl(h + 8, 62, 80 + c.shade * 3)], [1, hsl(h - 6, 46, 42)]]),
      body: `<path d="${d}" fill="url(#${c.id}c)"/><g clip-path="url(#${c.id}o)">${maze}</g>`,
    }
  },

  sea_glass(c) {
    const h = [150, 170, 200, 215, 120, 40, 300, 18, 90][c.t.palette % 9] + (c.p * 20 - 10)
    const d = blob(ring(50, 50, 21 + c.a * 13, 18 + c.b * 13, 7, c.k * 0.3, 0.42, c.r))
    let frost = ''
    for (let i = 0; i < 60 + c.m * 20; i++) {
      frost += `<circle cx="${f(16 + c.r() * 68)}" cy="${f(16 + c.r() * 68)}" r="${f(0.25 + c.r() * 0.8)}" fill="#fff" opacity="${f(0.1 + c.r() * 0.3)}"/>`
    }
    return {
      outline: d,
      defs: radial(`${c.id}c`, [[0, hsl(h, 50, 84, 0.92)], [0.65, hsl(h, 54, 58 + c.shade * 6, 0.86)], [1, hsl(h, 58, 36, 0.92)]]),
      body: `<path d="${d}" fill="url(#${c.id}c)"/><g clip-path="url(#${c.id}o)">${frost}</g><path d="${d}" fill="none" stroke="#fff" stroke-opacity=".4" stroke-width="1.4"/>`,
    }
  },

  abalone(c) {
    const h = c.p * 360
    const rx = 30 + c.a * 7
    const ry = 22 + c.b * 8
    const d = blob([[50 - rx, 50 - 2], [50 - rx * 0.45, 50 - ry], [50 + rx * 0.55, 50 - ry * 0.92], [50 + rx, 50 - 1], [50 + rx * 0.5, 50 + ry * 0.9], [50 - rx * 0.5, 50 + ry]])
    let swirl = ''
    for (let i = 0; i < 8 + c.k; i++) {
      const k = 0.2 + (i / (8 + c.k)) * 0.95
      swirl += `<ellipse cx="${f(50 + rx * 0.34 - k * 20)}" cy="${f(50 - k * 3)}" rx="${f(rx * k)}" ry="${f(ry * k)}" fill="none" stroke="${hsl(h + i * 42, 86, 66, 0.72)}" stroke-width="${f(1.4 + c.r() * 2.8)}"/>`
    }
    let holes = ''
    const count = 4 + c.m
    for (let i = 0; i < count; i++) {
      const u = i / count
      holes += `<ellipse cx="${f(50 - rx * 0.72 + u * rx * 1.5)}" cy="${f(50 - ry * 0.74 - Math.sin(u * 3) * 2)}" rx="1.9" ry="1.3" fill="#1b1a24"/>`
    }
    return {
      outline: d,
      defs: radial(`${c.id}c`, [[0, hsl(h + 180, 50, 76 + c.shade * 4)], [1, hsl(h + 120, 60, 26)]], 0.62, 0.52),
      body: `<path d="${d}" fill="url(#${c.id}c)"/><g clip-path="url(#${c.id}o)">${swirl}${holes}</g>`,
    }
  },

  driftwood_knot(c) {
    const h = 24 + c.p * 16
    const d = blob(ring(50, 50, 28 + c.a * 8, 21 + c.b * 9, 10, 0.5, 0.38, c.r))
    let grain = ''
    for (let i = 0; i < 6 + c.k; i++) {
      const k = 0.24 + (i / (6 + c.k)) * 1.05
      grain += `<ellipse cx="${f(48 + c.m)}" cy="${f(52 - c.m)}" rx="${f(26 * k + c.r() * 2)}" ry="${f(17 * k + c.r() * 2)}" fill="none" stroke="${hsl(h - 4, 22, 24 + c.r() * 10, 0.68)}" stroke-width="${f(0.6 + c.r() * 0.9)}" transform="rotate(${f(c.r() * 10 - 5)} 50 50)"/>`
    }
    return {
      outline: d,
      defs: linear(`${c.id}c`, [[0, hsl(h, 22, 72 + c.shade * 4)], [0.6, hsl(h, 26, 52 + c.shade * 3)], [1, hsl(h - 4, 30, 30)]]),
      body: `<path d="${d}" fill="url(#${c.id}c)"/><g clip-path="url(#${c.id}o)">${grain}<ellipse cx="${f(48 + c.m)}" cy="${f(52 - c.m)}" rx="4" ry="2.6" fill="${hsl(h, 34, 16)}"/></g>`,
    }
  },

  ships_coin(c) {
    const metals: [number, number][] = [[44, 72], [36, 56], [28, 60], [190, 12], [150, 32], [18, 62]]
    const [h, s] = metals[c.t.palette % metals.length]
    const R = 27 + c.a * 8
    const edge = 26 + c.k * 3
    const d = poly(ring(50, 50, R, R * (0.96 + c.b * 0.05), edge, 0.1, 0.04, c.r))
    const mark = c.m
    const emblem =
      mark === 0
        ? `<path d="M${f(50 - R * 0.42)} ${f(50 + R * 0.24)}Q50 ${f(50 + R * 0.5)} ${f(50 + R * 0.42)} ${f(50 + R * 0.24)}L${f(50 + R * 0.3)} ${f(50 + R * 0.08)}H${f(50 - R * 0.3)}ZM50 ${f(50 + R * 0.05)}V${f(50 - R * 0.5)}L${f(50 + R * 0.3)} ${f(50 - R * 0.05)}Z"/>`
        : mark === 1
          ? `<path d="M${f(50 - R * 0.46)} ${f(50 - R * 0.46)}L${f(50 + R * 0.46)} ${f(50 + R * 0.46)}M${f(50 + R * 0.46)} ${f(50 - R * 0.46)}L${f(50 - R * 0.46)} ${f(50 + R * 0.46)}" stroke="currentColor" stroke-width="${f(R * 0.12)}" stroke-linecap="round"/>`
          : mark === 2
            ? `<path d="M50 ${f(50 - R * 0.52)}V${f(50 + R * 0.52)}M${f(50 - R * 0.52)} 50H${f(50 + R * 0.52)}" stroke="currentColor" stroke-width="${f(R * 0.12)}" stroke-linecap="round"/>`
            : `<path d="${poly(ring(50, 50, R * 0.52, R * 0.52, 8).map(([x, y], i) => (i % 2 ? [50 + (x - 50) * 0.45, 50 + (y - 50) * 0.45] : [x, y]) as Pt))}"/>`
    return {
      outline: d,
      defs: radial(`${c.id}c`, [[0, hsl(h + 4, s, 80)], [0.6, hsl(h, s, 52 + c.shade * 6)], [1, hsl(h - 6, s + 4, 26)]]),
      body:
        `<path d="${d}" fill="url(#${c.id}c)"/>` +
        `<circle cx="50" cy="50" r="${f(R * 0.8)}" fill="none" stroke="${hsl(h, s, 22, 0.5)}" stroke-width="1.2" stroke-dasharray="1.2 1.6"/>` +
        `<g color="${hsl(h, s, 22, 0.75)}" fill="${hsl(h, s, 22, 0.75)}">${emblem}</g>`,
    }
  },

  brass_key(c) {
    const metals: [number, number][] = [[42, 62], [34, 48], [190, 8], [150, 26], [24, 54]]
    const [h, s] = metals[c.t.palette % metals.length]
    const bow = 11 + c.a * 5
    const len = 40 + c.b * 8
    const teeth = 2 + c.k % 3
    const shaftTop = 18 + bow * 2 - 3
    const shaftBot = shaftTop + len
    const w = 3.2 + (c.m % 2) * 0.7
    let t = ''
    for (let i = 0; i < teeth; i++) {
      const y = shaftBot - 3 - i * 6.5
      const reach = 6 + ((c.t.facets + i * 3) % 4) * 2
      t += `<rect x="${f(50 + w)}" y="${f(y - 2)}" width="${reach}" height="4" fill="url(#${c.id}c)"/>`
    }
    const hole = bow * (0.42 + (c.m > 1 ? 0.1 : 0))
    const d = `M50 ${f(18)}m${f(-bow)} ${f(bow)}a${f(bow)} ${f(bow)} 0 1 0 ${f(bow * 2)} 0a${f(bow)} ${f(bow)} 0 1 0 ${f(-bow * 2)} 0ZM${f(50 - w)} ${f(shaftTop)}H${f(50 + w + 15)}V${f(shaftBot)}H${f(50 - w)}Z`
    return {
      outline: d,
      defs: linear(`${c.id}c`, [[0, hsl(h + 6, s, 76)], [0.5, hsl(h, s, 50 + c.shade * 6)], [1, hsl(h - 6, s + 6, 26)]]),
      body:
        `<rect x="${f(50 - w)}" y="${f(shaftTop)}" width="${f(w * 2)}" height="${f(len)}" rx="1" fill="url(#${c.id}c)"/>${t}` +
        `<circle cx="50" cy="${f(18 + bow)}" r="${f(bow - hole / 2)}" fill="none" stroke="url(#${c.id}c)" stroke-width="${f(hole)}"/>` +
        `<rect x="${f(50 - w - 2)}" y="${f(shaftTop + 3)}" width="${f(w * 2 + 4)}" height="2.6" rx="1" fill="${hsl(h, s, 34)}"/>`,
    }
  },

  compass_rose(c) {
    const metals = [[42, 62], [32, 44], [195, 12], [160, 30], [15, 56], [220, 30]]
    const [h, s] = metals[c.t.palette % metals.length]
    const R = 30 + c.a * 7
    const major = 4
    const minor = c.k % 2 ? 4 : 8
    const rot = -Math.PI / 2 + (c.b - 0.5) * 0.4
    let star = ''
    const needle = (n: number, len: number, w: number, offset: number, dark: string, light: string) => {
      for (let i = 0; i < n; i++) {
        const a = rot + offset + (i / n) * Math.PI * 2
        const tip: Pt = [50 + Math.cos(a) * len, 50 + Math.sin(a) * len]
        const l: Pt = [50 + Math.cos(a - Math.PI / 2) * w, 50 + Math.sin(a - Math.PI / 2) * w]
        const r: Pt = [50 + Math.cos(a + Math.PI / 2) * w, 50 + Math.sin(a + Math.PI / 2) * w]
        star += `<path d="${poly([[50, 50], tip, l])}" fill="${dark}"/><path d="${poly([[50, 50], tip, r])}" fill="${light}"/>`
      }
    }
    needle(minor, R * 0.62, R * 0.11, Math.PI / minor, hsl(h, s, 34), hsl(h, s, 58))
    needle(major, R * 0.92, R * 0.15, 0, hsl(h, s + 8, 26 + c.shade * 4), hsl(h + 6, s, 76))
    const d = `M${f(50 - R)} 50a${f(R)} ${f(R)} 0 1 0 ${f(R * 2)} 0a${f(R)} ${f(R)} 0 1 0 ${f(-R * 2)} 0Z`
    const tickCount = 12 + c.m * 12
    const ticks = Array.from({ length: tickCount }, (_, i) => {
      const a = (i / tickCount) * Math.PI * 2
      return `<path d="M${f(50 + Math.cos(a) * R * 0.92)} ${f(50 + Math.sin(a) * R * 0.92)}L${f(50 + Math.cos(a) * R * 0.99)} ${f(50 + Math.sin(a) * R * 0.99)}" stroke="${hsl(h, s, 22)}" stroke-width=".7"/>`
    }).join('')
    return {
      outline: d,
      defs: radial(`${c.id}c`, [[0, hsl(h + 8, 40, 92)], [1, hsl(h, 46, 72)]], 0.5, 0.5),
      body:
        `<path d="${d}" fill="url(#${c.id}c)"/><circle cx="50" cy="50" r="${f(R)}" fill="none" stroke="${hsl(h, s, 26)}" stroke-width="1.8"/>${ticks}${star}` +
        `<circle cx="50" cy="50" r="2.2" fill="${hsl(h, s, 22)}"/>`,
    }
  },

  anchor_charm(c) {
    const metals = [[42, 60], [34, 46], [196, 10], [155, 26], [22, 55], [0, 0]]
    const [h, s] = metals[c.t.palette % metals.length]
    const w = 4 + c.m * 0.4
    const span = 20 + c.a * 8
    const top = 18
    const bottom = 76 + c.b * 6
    const curve = 13 + c.k % 4
    const shape =
      `<circle cx="50" cy="${top}" r="6" fill="none" stroke="url(#${c.id}c)" stroke-width="${f(w * 0.72)}"/>` +
      `<path d="M50 ${top + 6}V${f(bottom)}" stroke="url(#${c.id}c)" stroke-width="${f(w)}" stroke-linecap="round"/>` +
      `<path d="M${f(50 - 13 - c.m)} ${top + 16}H${f(50 + 13 + c.m)}" stroke="url(#${c.id}c)" stroke-width="${f(w * 0.85)}" stroke-linecap="round"/>` +
      `<path d="M${f(50 - span)} ${f(bottom - curve - 3)}Q${f(50 - span + 3)} ${f(bottom + 2)} 50 ${f(bottom)}Q${f(50 + span - 3)} ${f(bottom + 2)} ${f(50 + span)} ${f(bottom - curve - 3)}" fill="none" stroke="url(#${c.id}c)" stroke-width="${f(w)}" stroke-linecap="round"/>` +
      `<path d="${poly([[50 - span - 4, bottom - curve + 3], [50 - span, bottom - curve - 8], [50 - span + 6, bottom - curve + 1]])}" fill="url(#${c.id}c)"/>` +
      `<path d="${poly([[50 + span + 4, bottom - curve + 3], [50 + span, bottom - curve - 8], [50 + span - 6, bottom - curve + 1]])}" fill="url(#${c.id}c)"/>`
    return {
      defs: `<linearGradient id="${c.id}c" gradientUnits="userSpaceOnUse" x1="20" y1="10" x2="80" y2="90"><stop offset="0" stop-color="${hsl(h + 6, s, 80)}"/><stop offset=".5" stop-color="${hsl(h, s, 50 + c.shade * 6)}"/><stop offset="1" stop-color="${hsl(h - 6, s, 26)}"/></linearGradient>`,
      body: shape,
    }
  },

  amphora_shard(c) {
    const h = 14 + c.p * 16
    const pts: Pt[] = ring(50, 50, 28 + c.a * 8, 24 + c.b * 9, 5 + c.k % 3, c.m * 0.4, 0.46, c.r)
    const d = poly(pts)
    const painted = hsl(h - 8, 28, 13)
    const motif = c.m
    let band = ''
    for (let i = 0; i < 3; i++) {
      const y = 36 + i * (10 + c.k * 0.8)
      band += `<path d="M6 ${f(y)}Q50 ${f(y + 12)} 94 ${f(y)}" fill="none" stroke="${painted}" stroke-width="${i === 1 ? 5.5 : 1.8}"/>`
    }
    if (motif < 2) {
      for (let x = 22; x < 80; x += 9) {
        band += `<path d="M${x} 51l4.5 -5 4.5 5" fill="none" stroke="${hsl(h, 60, 62)}" stroke-width="1.1"/>`
      }
    } else {
      for (let x = 20; x < 82; x += 10) {
        band += `<circle cx="${x}" cy="${f(49 + Math.sin(x) * 2)}" r="1.4" fill="${hsl(h, 60, 62)}"/>`
      }
    }
    return {
      outline: d,
      defs: linear(`${c.id}c`, [[0, hsl(h + 6, 62, 58 + c.shade * 5)], [1, hsl(h - 4, 58, 34)]]),
      body:
        `<path d="${d}" fill="url(#${c.id}c)"/><g clip-path="url(#${c.id}o)">${band}</g>` +
        `<path d="${d}" fill="none" stroke="${hsl(h + 10, 40, 80, 0.5)}" stroke-width="1.2"/>`,
    }
  },

  glass_float(c) {
    const h = 160 + c.p * 70
    const R = 25 + c.a * 8
    const d = `M${f(50 - R)} 50a${f(R)} ${f(R)} 0 1 0 ${f(R * 2)} 0a${f(R)} ${f(R)} 0 1 0 ${f(-R * 2)} 0Z`
    let net = ''
    const cols = 4 + c.k % 4
    for (let i = 0; i < cols; i++) {
      const k = ((i + 1) / (cols + 1)) * 2 - 1
      net += `<path d="M50 ${f(50 - R)}Q${f(50 + k * R * 1.5)} 50 50 ${f(50 + R)}" fill="none" stroke="${hsl(32, 30, 40, 0.86)}" stroke-width="1"/>`
    }
    for (let i = 1; i < 3 + c.m; i++) {
      const y = 50 - R + (i * R * 2) / (3 + c.m)
      const half = Math.sqrt(Math.max(0, R * R - (y - 50) * (y - 50)))
      net += `<path d="M${f(50 - half)} ${f(y)}Q50 ${f(y + 4 + c.b * 3)} ${f(50 + half)} ${f(y)}" fill="none" stroke="${hsl(32, 30, 40, 0.86)}" stroke-width="1"/>`
    }
    return {
      outline: d,
      defs: radial(`${c.id}c`, [[0, hsl(h, 60, 92, 0.94)], [0.55, hsl(h, 62, 58 + c.shade * 6, 0.82)], [1, hsl(h + 10, 70, 28, 0.94)]]),
      body:
        `<path d="${d}" fill="url(#${c.id}c)"/><g clip-path="url(#${c.id}o)">${net}</g>` +
        `<ellipse cx="${f(50 - R * 0.34)}" cy="${f(50 - R * 0.46)}" rx="${f(R * 0.26)}" ry="${f(R * 0.14)}" fill="#fff" opacity=".78" transform="rotate(-30 50 50)"/>` +
        `<circle cx="50" cy="${f(50 + R)}" r="2.4" fill="${hsl(h, 50, 28)}"/>`,
    }
  },
}

// ── texture and finish: over every family, inside its outline ──────────────
function texture(c: Ctx): string {
  const kind = c.t.texture % 6
  const strength = 0.1 + ((Math.floor(c.t.texture / 6) + 1) / 4) * 0.24
  const white = `rgba(255,255,255,${f(strength)})`
  const dark = `rgba(0,0,0,${f(strength)})`
  let out = ''
  switch (kind) {
    case 0: // veins
      for (let i = 0; i < 4; i++) {
        let x = 10 + c.r() * 80
        let y = 10
        let d = `M${f(x)} ${f(y)}`
        while (y < 90) {
          x += (c.r() - 0.5) * 22
          y += 8 + c.r() * 10
          d += `L${f(x)} ${f(y)}`
        }
        out += `<path d="${d}" fill="none" stroke="${white}" stroke-width="${f(0.5 + c.r())}"/>`
      }
      break
    case 1: // bands
      for (let i = 0; i < 6; i++) {
        const y = 12 + i * 15
        out += `<path d="M0 ${f(y)}Q50 ${f(y + (c.r() - 0.5) * 26)} 100 ${f(y)}" fill="none" stroke="${i % 2 ? white : dark}" stroke-width="${f(1 + c.r() * 2)}"/>`
      }
      break
    case 2: // speckle
      for (let i = 0; i < 40; i++) {
        out += `<circle cx="${f(c.r() * 100)}" cy="${f(c.r() * 100)}" r="${f(0.3 + c.r() * 0.9)}" fill="${c.r() > 0.5 ? white : dark}"/>`
      }
      break
    case 3: // hatch
      for (let i = -2; i < 12; i++) {
        out += `<path d="M${i * 11} 0L${i * 11 + 50} 100" stroke="${white}" stroke-width=".7"/>`
      }
      break
    case 4: // rings
      for (let i = 1; i < 7; i++) {
        out += `<circle cx="${f(50 + (c.r() - 0.5) * 6)}" cy="${f(50 + (c.r() - 0.5) * 6)}" r="${i * 8}" fill="none" stroke="${i % 2 ? white : dark}" stroke-width=".8"/>`
      }
      break
    default: // clouds
      for (let i = 0; i < 7; i++) {
        out += `<ellipse cx="${f(c.r() * 100)}" cy="${f(c.r() * 100)}" rx="${f(6 + c.r() * 14)}" ry="${f(3 + c.r() * 7)}" fill="${white}"/>`
      }
  }
  return out
}

function finish(c: Ctx): string {
  switch (c.t.finish) {
    case 1: // wet gloss
      return `<ellipse cx="38" cy="30" rx="15" ry="6.5" fill="#fff" opacity=".42" transform="rotate(-22 38 30)"/>`
    case 2: // sparkle
      return ''
    case 3: // sand dust
      return Array.from({ length: 34 }, () =>
        `<circle cx="${f(c.r() * 100)}" cy="${f(60 + c.r() * 40)}" r="${f(0.3 + c.r() * 0.5)}" fill="#f3dfb5" opacity=".75"/>`,
      ).join('')
    case 4: // rim of light
      return `<path d="M10 40Q50 2 90 40" fill="none" stroke="#fff" stroke-width="3" opacity=".32"/>`
    case 5: // sun shaft
      return `<path d="M26 0L46 0L74 100L54 100Z" fill="#fff" opacity=".13"/>`
    case 6: // frost
      return `<rect width="100" height="100" fill="#eef7ff" opacity=".13"/>`
    case 7: // gold flecks
      return Array.from({ length: 14 }, () =>
        `<circle cx="${f(c.r() * 100)}" cy="${f(c.r() * 100)}" r="${f(0.4 + c.r() * 0.7)}" fill="#ffd978"/>`,
      ).join('')
    default:
      return ''
  }
}

/** One gem, as a complete <svg>. Safe to inject: only numbers and constants. */
export function drawGem(seed: number): string {
  const t = decodeSeed(seed)
  const id = `g${encodeSeed(t).toString(36)}`
  const c: Ctx = {
    id,
    t,
    r: mulberry32(encodeSeed(t)),
    a: (t.silhouette % 8) / 7,
    b: Math.floor(t.silhouette / 8) / 5,
    k: t.facets % 6,
    m: Math.floor(t.facets / 6),
    p: t.palette / 36,
    shade: (t.palette % 3) - 1,
  }
  const drawn = DRAW[t.family](c)
  const spark =
    t.finish === 2
      ? glint(30 + c.r() * 40, 24 + c.r() * 22, 6 + c.r() * 2) + glint(46 + c.r() * 22, 56 + c.r() * 18, 3.4, 0.75)
      : ''
  const clip = drawn.outline
    ? `<clipPath id="${id}o"><path d="${drawn.outline}"/></clipPath>`
    : `<mask id="${id}m" style="mask-type:alpha"><use href="#${id}b"/></mask>`
  const over = drawn.outline ? `clip-path="url(#${id}o)"` : `mask="url(#${id}m)"`
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" aria-hidden="true">` +
    `<defs>${clip}${drawn.defs ?? ''}</defs>` +
    `<g id="${id}b">${drawn.body}</g>` +
    `<g ${over}>${texture(c)}${finish(c)}</g>` +
    spark +
    `</svg>`
  )
}
