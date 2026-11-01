import { COLORS, DEFAULT_LOOK, type DeckItem, type DeckSlot, type KayakLook, type PaddleStyle, type Pattern, type Vessel } from './kayakLook'

// Painted, top-down Kayaks, bow up, in a 200×300 box. Pure, with no DOM. Every
// value from a look is used only as a key into the tables below, so a bad value
// falls back rather than ever reaching the markup.

type Paint = { hue: number; sat: number; light: number }
const f = (n: number) => (Math.round(n * 10) / 10).toString()
const hsl = (p: Paint, dl = 0, ds = 0, a = 1) => {
  const l = Math.max(0, Math.min(100, p.light + dl))
  const s = Math.max(0, Math.min(100, p.sat + ds))
  return a === 1 ? `hsl(${p.hue} ${f(s)}% ${f(l)}%)` : `hsl(${p.hue} ${f(s)}% ${f(l)}% / ${f(a * 100)}%)`
}
const PALE_WOOD: Paint = { hue: 34, sat: 44, light: 60 }
const DARK = '#1b1d21'

interface VesselArt {
  /** Outer hull. */
  hull: string
  /** Inside the gunwale or deck edge. */
  inner: string
  /** 'open' is a painted floor sunk below the gunwale; 'deck' is a closed top. */
  kind: 'open' | 'deck'
  /** Fittings drawn over the interior. */
  details: (paint: Paint, id: string) => string
  slots: Record<DeckSlot, [number, number]>
  hold: [number, number]
  /** The hull's own width at the paddle, for laying it across. */
  paddleY: number
}

const thwart = (y: number, x1: number, x2: number, h = 13) =>
  `<rect x="${x1}" y="${y}" width="${x2 - x1}" height="${h}" rx="2" fill="${hsl(PALE_WOOD)}"/>` +
  `<rect x="${x1}" y="${y}" width="${x2 - x1}" height="2.4" rx="1" fill="${hsl(PALE_WOOD, 16)}"/>` +
  `<rect x="${x1}" y="${y + h - 2.2}" width="${x2 - x1}" height="2.2" rx="1" fill="${hsl(PALE_WOOD, -18)}"/>`

const SEAM = 'rgba(58,38,18,.34)'

const ribs = (from: number, to: number, step: number, x1: number, x2: number) => {
  let out = ''
  for (let y = from; y < to; y += step) {
    out += `<path d="M${x1} ${y}Q100 ${y + 7} ${x2} ${y}" fill="none" stroke="${SEAM}" stroke-width="2.6"/>`
  }
  return out
}

const VESSEL_ART: Record<Vessel, VesselArt> = {
  sit_on_top: {
    hull: 'M100 6C118 34 137 98 138 152C139 206 124 262 100 294C76 262 61 206 62 152C63 98 82 34 100 6Z',
    inner: 'M100 24C113 47 129 103 130 152C131 201 119 251 100 278C81 251 69 201 70 152C71 103 87 47 100 24Z',
    kind: 'deck',
    details: (p) =>
      `<rect x="95" y="9" width="10" height="5" rx="2.5" fill="${DARK}"/><rect x="95" y="286" width="10" height="5" rx="2.5" fill="${DARK}"/>` +
      `<rect x="79" y="150" width="42" height="66" rx="17" fill="${hsl(p, -18)}"/><rect x="83" y="204" width="34" height="10" rx="5" fill="${hsl(p, -5)}"/>` +
      `<rect x="84" y="228" width="32" height="36" rx="10" fill="${hsl(p, -14)}"/><path d="M84 233L116 259M116 233L84 259" stroke="#15171A" stroke-width="1.6" stroke-linecap="round"/>`,
    slots: { bow: [100, 80], mid: [100, 178], stern: [100, 246] },
    hold: [100, 112],
    paddleY: 158,
  },
  sea_kayak: {
    hull: 'M100 2C110 40 125 110 126 158C127 212 114 268 100 298C86 268 73 212 74 158C75 110 90 40 100 2Z',
    inner: 'M100 26C108 58 118 114 119 158C120 208 110 258 100 280C90 258 80 208 81 158C82 114 92 58 100 26Z',
    kind: 'deck',
    details: (p) =>
      `<ellipse cx="100" cy="152" rx="17" ry="34" fill="${DARK}"/><ellipse cx="100" cy="152" rx="13" ry="29" fill="#2a2d32"/><ellipse cx="100" cy="152" rx="17" ry="34" fill="none" stroke="${hsl(p, 14)}" stroke-width="2"/>` +
      `<ellipse cx="100" cy="88" rx="9.5" ry="13" fill="${DARK}"/><ellipse cx="100" cy="222" rx="10" ry="15" fill="${DARK}"/>` +
      `<path d="M86 60L114 76M114 60L86 76M86 244L114 262M114 244L86 262" stroke="#15171A" stroke-width="1.5"/>`,
    slots: { bow: [100, 68], mid: [100, 152], stern: [100, 256] },
    hold: [100, 224],
    paddleY: 118,
  },
  canoe: {
    hull: 'M100 4C128 32 146 92 147 150C148 208 128 268 100 296C72 268 52 208 53 150C54 92 72 32 100 4Z',
    inner: 'M100 18C122 42 138 96 139 150C140 204 122 258 100 282C78 258 60 204 61 150C62 96 78 42 100 18Z',
    kind: 'open',
    details: () => ribs(46, 268, 18, 68, 132) + thwart(74, 69, 131) + thwart(150, 62, 138, 11) + thwart(224, 69, 131),
    slots: { bow: [100, 56], mid: [100, 118], stern: [100, 192] },
    hold: [100, 252],
    paddleY: 172,
  },
  rowing_boat: {
    hull: 'M100 8C136 34 158 92 158 156C158 212 150 256 138 284C124 290 76 290 62 284C50 256 42 212 42 156C42 92 64 34 100 8Z',
    inner: 'M100 22C129 44 150 96 150 156C150 208 143 248 132 274C120 279 80 279 68 274C57 248 50 208 50 156C50 96 71 44 100 22Z',
    kind: 'open',
    details: () =>
      ribs(58, 268, 19, 58, 142) + thwart(92, 58, 142) + thwart(160, 51, 149) + thwart(232, 58, 142, 15) +
      `<circle cx="48" cy="166" r="3.6" fill="#7b6b46"/><circle cx="152" cy="166" r="3.6" fill="#7b6b46"/>`,
    slots: { bow: [100, 66], mid: [100, 128], stern: [100, 200] },
    hold: [100, 255],
    paddleY: 166,
  },
  dinghy: {
    hull: 'M100 34C146 34 170 74 170 138C170 204 160 252 146 272C126 280 74 280 54 272C40 252 30 204 30 138C30 74 54 34 100 34Z',
    inner: 'M100 58C130 58 148 88 148 138C148 196 140 236 130 252C116 257 84 257 70 252C60 236 52 196 52 138C52 88 70 58 100 58Z',
    kind: 'open',
    details: () => thwart(118, 52, 148, 15) + thwart(198, 54, 146, 15),
    slots: { bow: [100, 84], mid: [100, 165], stern: [100, 228] },
    hold: [78, 224],
    paddleY: 145,
  },
  sailboat: {
    hull: 'M100 4C132 46 156 110 156 166C156 218 146 262 134 288C120 294 80 294 66 288C54 262 44 218 44 166C44 110 68 46 100 4Z',
    inner: 'M100 24C125 60 148 114 148 166C148 214 139 254 128 278C116 283 84 283 72 278C61 254 52 214 52 166C52 114 75 60 100 24Z',
    kind: 'open',
    details: (p) =>
      `<path d="M100 46L100 250" stroke="#7a6a50" stroke-width="5" stroke-linecap="round"/>` +
      `<path d="M92 116Q100 176 94 246L108 246Q114 176 108 116Z" fill="${hsl({ hue: 40, sat: 30, light: 92 })}" stroke="${hsl(p, -30)}" stroke-width="1"/>` +
      `<circle cx="100" cy="116" r="6.5" fill="#5c5038"/><circle cx="100" cy="116" r="3" fill="#a3916b"/>` +
      `<path d="M60 262Q100 270 140 262" fill="none" stroke="#5c5038" stroke-width="3"/>`,
    slots: { bow: [100, 76], mid: [74, 180], stern: [126, 226] },
    hold: [74, 238],
    paddleY: 204,
  },
  punt: {
    hull: 'M62 12H138Q146 12 147 22L156 276Q157 288 146 288H54Q43 288 44 276L53 22Q54 12 62 12Z',
    inner: 'M66 24H134Q138 24 138 30L147 270Q147 278 140 278H60Q53 278 53 270L62 30Q62 24 66 24Z',
    kind: 'open',
    details: () =>
      `<path d="M64 24L56 278M82 24L78 278M100 24V278M118 24L122 278M136 24L144 278" stroke="${SEAM}" stroke-width="1.4"/>` +
      thwart(72, 62, 138, 12) + thwart(212, 55, 145, 12),
    slots: { bow: [100, 50], mid: [100, 148], stern: [100, 248] },
    hold: [78, 180],
    paddleY: 118,
  },
  coracle: {
    hull: 'M100 42C154 42 172 92 172 150C172 208 154 258 100 258C46 258 28 208 28 150C28 92 46 42 100 42Z',
    inner: 'M100 56C142 56 158 100 158 150C158 200 142 244 100 244C58 244 42 200 42 150C42 100 58 56 100 56Z',
    kind: 'open',
    details: (_p, id) => {
      let weave = ''
      for (let i = -5; i <= 5; i++) {
        weave += `<path d="M${100 + i * 12} 56Q${100 + i * 15} 150 ${100 + i * 12} 244" fill="none" stroke="${SEAM}" stroke-width="2"/>`
        weave += `<path d="M42 ${150 + i * 16}Q100 ${150 + i * 20} 158 ${150 + i * 16}" fill="none" stroke="${SEAM}" stroke-width="2"/>`
      }
      return `<g clip-path="url(#${id}i)">${weave}</g>` + thwart(132, 44, 156, 14)
    },
    slots: { bow: [100, 90], mid: [64, 192], stern: [136, 192] },
    hold: [100, 212],
    paddleY: 172,
  },
  pirogue: {
    hull: 'M100 2C114 28 120 90 120 150C120 212 114 272 100 298C86 272 80 212 80 150C80 90 86 28 100 2Z',
    inner: 'M100 34C108 62 112 104 112 150C112 196 108 240 100 268C92 240 88 196 88 150C88 104 92 62 100 34Z',
    kind: 'open',
    details: () =>
      thwart(112, 86, 114, 8) + thwart(190, 86, 114, 8) +
      `<path d="M92 60Q100 150 92 244M108 60Q100 150 108 244" fill="none" stroke="${SEAM}" stroke-width="1"/>`,
    slots: { bow: [100, 76], mid: [100, 152], stern: [100, 226] },
    hold: [100, 248],
    paddleY: 130,
  },
  outrigger: {
    hull: 'M84 6C96 28 104 92 104 150C104 208 96 272 84 294C72 272 64 208 64 150C64 92 72 28 84 6Z',
    inner: 'M84 28C92 58 97 104 97 150C97 196 92 242 84 272C76 242 71 196 71 150C71 104 76 58 84 28Z',
    kind: 'open',
    details: (p) =>
      `<path d="M92 100L168 92M92 196L168 206" stroke="${hsl(PALE_WOOD, -10)}" stroke-width="6" stroke-linecap="round"/>` +
      `<path d="M168 42C176 68 178 110 178 150C178 192 176 232 168 258C160 232 158 192 158 150C158 110 160 68 168 42Z" fill="${hsl(p, -8)}" stroke="${hsl(p, -30)}" stroke-width="1.2"/>` +
      thwart(98, 72, 96, 10) + thwart(190, 72, 96, 10),
    slots: { bow: [84, 66], mid: [84, 146], stern: [84, 228] },
    hold: [84, 260],
    paddleY: 124,
  },
}

function pattern(kind: Pattern, p: Paint): string {
  switch (kind) {
    case 'stripes':
      return [46, 98, 150, 202, 254]
        .map((y) => `<rect x="0" y="${y}" width="200" height="22" fill="${hsl(p, -22, 8, 0.75)}"/>`)
        .join('')
    case 'waves': {
      let out = ''
      for (let y = 16; y < 300; y += 26) {
        out += `<path d="M0 ${y}${Array.from({ length: 10 }, (_, i) => `q10 ${i % 2 ? 9 : -9} 20 0`).join('')}" fill="none" stroke="${hsl(p, -24, 10, 0.72)}" stroke-width="4"/>`
      }
      return out
    }
    case 'scales': {
      let out = ''
      for (let y = 8; y < 300; y += 15) {
        for (let x = (y / 15) % 2 ? 14 : 0; x < 210; x += 28) {
          out += `<path d="M${x - 14} ${y}a14 14 0 0 0 28 0" fill="none" stroke="${hsl(p, -22, 8, 0.65)}" stroke-width="2"/>`
        }
      }
      return out
    }
    case 'stars': {
      let out = ''
      for (let y = 18; y < 300; y += 28) {
        for (let x = (y / 28) % 2 > 1 ? 16 : 34; x < 200; x += 36) {
          const r = 5.5
          out += `<path d="M${x} ${y - r}L${x + 1.6} ${y - 1.6}L${x + r} ${y}L${x + 1.6} ${y + 1.6}L${x} ${y + r}L${x - 1.6} ${y + 1.6}L${x - r} ${y}L${x - 1.6} ${y - 1.6}Z" fill="${hsl(p, 26, 0, 0.9)}"/>`
        }
      }
      return out
    }
    case 'woodgrain': {
      let out = ''
      for (let x = 14; x < 200; x += 9) {
        out += `<path d="M${x} 0Q${x + (x % 18 ? 5 : -5)} 150 ${x} 300" fill="none" stroke="${hsl({ hue: 28, sat: 42, light: 28 }, 0, 0, 0.42)}" stroke-width="${x % 27 ? 1 : 2.2}"/>`
      }
      return out
    }
    case 'faded': {
      let out = ''
      const spots: [number, number, number, number][] = [[70, 60, 24, 12], [130, 130, 30, 12], [76, 214, 26, 14], [120, 262, 20, 8], [102, 170, 18, 9]]
      for (const [x, y, rx, ry] of spots) {
        out += `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="#efe5d2" opacity=".5"/>`
      }
      return out
    }
    default:
      return ''
  }
}

// Each item is about 44 units wide, centred on 0,0, seen from above.
const DECK_ART: Record<DeckItem, string> = {
  lantern: `<circle r="24" fill="#FFC56B" opacity=".2"/><circle r="11" fill="#2b2e33"/><circle r="7.5" fill="#FFE7A8"/><circle r="3.5" fill="#fff"/><path d="M-11 0H11M0 -11V11" stroke="#2b2e33" stroke-width="1.4"/>`,
  flag: `<circle r="5" fill="#6b5a3c"/><path d="M0 0L28 -8L24 2L30 10L0 6Z" fill="#E96A5A" stroke="#a63d31" stroke-width="1"/><circle r="2.6" fill="#caa86a"/>`,
  plant: `<circle r="13" fill="#b5613d"/><circle r="10" fill="#3a2a1c"/>${Array.from({ length: 9 }, (_, i) => `<ellipse cx="11" rx="11" ry="4" fill="hsl(${110 + i * 8} 46% ${28 + (i % 3) * 8}%)" transform="rotate(${i * 40})"/>`).join('')}`,
  cat: `<ellipse cy="3" rx="13" ry="15" fill="#d78c48"/><path d="M-13 3C-22 -6 -8 -16 -3 -14" fill="none" stroke="#d78c48" stroke-width="5" stroke-linecap="round"/><circle cy="-12" r="8.5" fill="#d78c48"/><path d="M-8 -17L-7 -24L-1.5 -19ZM8 -17L7 -24L1.5 -19Z" fill="#c07634"/><path d="M-9 -2H9M-10 5H10M-7 12H7" stroke="#a7652c" stroke-width="2"/>`,
  dog: `<ellipse cy="4" rx="14" ry="19" fill="#8d6a4a"/><circle cy="-15" r="10" fill="#7c5b3f"/><ellipse cx="-10" cy="-14" rx="4" ry="8" fill="#5a4230"/><ellipse cx="10" cy="-14" rx="4" ry="8" fill="#5a4230"/><ellipse cy="-21" rx="4" ry="4.4" fill="#a98a6c"/><circle cy="-23" r="1.8" fill="#1b1a18"/><path d="M0 22q5 6 9 4" fill="none" stroke="#8d6a4a" stroke-width="4" stroke-linecap="round"/>`,
  books: `<rect x="-17" y="-13" width="32" height="24" rx="1.5" fill="#3b6a78" transform="rotate(-8)"/><rect x="-15" y="-11" width="30" height="22" rx="1.5" fill="#a84b3b" transform="rotate(6)"/><rect x="-13" y="-9" width="27" height="19" rx="1.2" fill="#e6d3a7" transform="rotate(-3)"/><path d="M-9 -4H9M-9 1H9M-9 5H4" stroke="#8a7a56" stroke-width="1" transform="rotate(-3)"/>`,
  gull: `<path d="M0 -4C-14 -14 -26 -10 -30 -2C-20 -6 -10 -2 0 6C10 -2 20 -6 30 -2C26 -10 14 -14 0 -4Z" fill="#f4f4f0" stroke="#a9aeb4" stroke-width=".8"/><ellipse cy="2" rx="4.4" ry="12" fill="#fff"/><circle cy="-10" r="3.6" fill="#fff"/><path d="M0 -13L-1.4 -18L1.4 -18Z" fill="#e8a33c"/><path d="M-5 10L0 18L5 10Z" fill="#a9aeb4"/>`,
  fishing_rod: `<path d="M-10 18L24 -30" stroke="#5c4a30" stroke-width="2.6" stroke-linecap="round"/><circle cx="-5" cy="11" r="5" fill="#8d8f93"/><circle cx="-5" cy="11" r="2" fill="#3b3d40"/><path d="M24 -30Q36 -10 30 12" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width=".8"/><circle cx="30" cy="13" r="2.6" fill="#E96A5A"/>`,
  crate: `<rect x="-18" y="-18" width="36" height="36" rx="2" fill="#a98352"/><path d="M-18 -6H18M-18 6H18" stroke="#6e5230" stroke-width="1.6"/><path d="M-18 -18L18 18M18 -18L-18 18" stroke="#7c5e38" stroke-width="2.4"/><rect x="-18" y="-18" width="36" height="36" rx="2" fill="none" stroke="#6e5230" stroke-width="2"/>`,
  rope: Array.from({ length: 4 }, (_, i) => `<circle r="${17 - i * 4.6}" fill="none" stroke="hsl(36 40% ${64 - i * 6}%)" stroke-width="4.2" stroke-dasharray="3.4 .7"/>`).join(''),
  teapot: `<circle r="14" fill="#7ea39a"/><circle r="4" fill="#e9dcc2"/><circle r="1.6" fill="#5e7f76"/><path d="M14 -2L25 -7L25 -1L14 6Z" fill="#7ea39a"/><path d="M-14 -7C-27 -9 -27 9 -14 7" fill="none" stroke="#5e7f76" stroke-width="3.4"/><circle r="14" fill="none" stroke="#5e7f76" stroke-width="1"/>`,
  parasol: `${Array.from({ length: 8 }, (_, i) => `<path d="M0 0L24 -10Q28 0 24 10Z" fill="${i % 2 ? '#f4ead5' : '#E96A5A'}" transform="rotate(${i * 45})"/>`).join('')}<circle r="2.6" fill="#7a6a50"/>`,
  guitar: `<g transform="rotate(30)"><ellipse cy="10" rx="13" ry="15" fill="#c98c4a"/><ellipse cy="-6" rx="9" ry="10" fill="#c98c4a"/><circle cy="4" r="4.4" fill="#2d2013"/><rect x="-2.4" y="-40" width="4.8" height="34" fill="#4a3320"/><rect x="-4" y="-46" width="8" height="8" rx="1" fill="#2d2013"/><path d="M-1 -40V14M1 -40V14" stroke="#e6e0d0" stroke-width=".5"/></g>`,
  blanket: `<rect x="-22" y="-16" width="44" height="32" rx="3" fill="#6f7fa8" transform="rotate(-6)"/><path d="M-22 -8H22M-22 2H22M-22 11H22" stroke="#e6dcc4" stroke-width="2.2" transform="rotate(-6)"/><path d="M-22 -16V16" stroke="#54618a" stroke-width="3" transform="rotate(-6)"/>`,
  shells: `<path d="M-8 6C-22 2 -16 -14 -6 -10C-2 -8 -2 2 -8 6Z" fill="#ecb7a1"/><circle cx="8" cy="-6" r="7" fill="#f2dfbc"/><path d="M8 -13V1M2 -9L14 -3M14 -9L2 -3" stroke="#c7ad80" stroke-width="1"/><path d="M0 14L10 4L16 14Z" fill="#e2a3b3"/><circle cx="-12" cy="13" r="3.4" fill="#d6cdb4"/>`,
  radio: `<rect x="-18" y="-11" width="36" height="22" rx="3" fill="#7d4a30"/><circle cx="-8" r="6.5" fill="#e0d3b4"/><path d="M-13 -3H-3M-13 0H-3M-13 3H-3" stroke="#7d4a30" stroke-width=".9"/><circle cx="9" cy="-3" r="2.6" fill="#caa86a"/><circle cx="9" cy="5" r="1.8" fill="#caa86a"/><path d="M14 -11L28 -24" stroke="#adb0b5" stroke-width="1.4"/>`,
}

function paddleArt(kind: PaddleStyle, p: Paint): string {
  const blade = (d: string, fill: string, edge: string) => `<path d="${d}" fill="${fill}" stroke="${edge}" stroke-width="1"/>`
  switch (kind) {
    case 'canoe_paddle':
      // One blade, one grip, laid along the side.
      return (
        `<rect x="26" y="156" width="124" height="5" rx="2.5" fill="#a98352"/><rect x="146" y="150" width="10" height="17" rx="3.5" fill="#6e5230"/>` +
        blade('M30 158C22 144 2 145 -4 158C2 171 22 172 30 158Z', '#a98352', '#6e5230')
      )
    case 'wooden_oars':
      // A pair, resting on the sides.
      return (
        `<g><rect x="-14" y="150" width="104" height="4.5" rx="2" fill="#a98352"/>${blade('M4 152C-4 142 -18 142 -26 152C-18 162 -4 162 4 152Z', '#c9a875', '#6e5230')}</g>` +
        `<g transform="rotate(180 100 160)"><rect x="-14" y="154" width="104" height="4.5" rx="2" fill="#a98352"/>${blade('M4 156C-4 146 -18 146 -26 156C-18 166 -4 166 4 156Z', '#c9a875', '#6e5230')}</g>`
      )
    case 'painted_tips':
      return (
        `<g transform="rotate(9 100 158)"><rect x="14" y="156" width="172" height="4" rx="2" fill="#a98352"/>` +
        blade('M30 158C22 148 6 148 0 158C6 168 22 168 30 158Z', '#c9a875', '#6e5230') +
        blade('M170 158C178 148 194 148 200 158C194 168 178 168 170 158Z', '#c9a875', '#6e5230') +
        blade('M12 158C8 151 4 151 0 158C4 165 8 165 12 158Z', hsl(p, -18, 10), hsl(p, -34)) +
        blade('M188 158C192 151 196 151 200 158C196 165 192 165 188 158Z', hsl(p, -18, 10), hsl(p, -34)) +
        `</g>`
      )
    default:
      return (
        `<g transform="rotate(9 100 158)"><rect x="14" y="156" width="172" height="4" rx="2" fill="#2B2E33"/><rect x="14" y="156" width="172" height="1.4" rx=".7" fill="#fff" fill-opacity=".25"/>` +
        blade('M30 158C22 148 6 148 0 158C6 168 22 168 30 158Z', hsl(p, -24, 12), hsl(p, -40)) +
        blade('M170 158C178 148 194 148 200 158C194 168 178 168 170 158Z', hsl(p, -24, 12), hsl(p, -40)) +
        `</g>`
      )
  }
}

/** A glinting heap in the hold: bigger with more aboard, gone at zero. */
function gemPile(aboard: number, x: number, y: number): string {
  if (aboard <= 0) return ''
  const count = Math.min(12, Math.ceil(aboard / 2.5))
  const hues = [168, 340, 200, 42, 280, 120]
  let out = `<ellipse cx="${x}" cy="${y}" rx="${f(5 + count * 1.1)}" ry="${f(4 + count * 0.8)}" fill="#000" opacity=".2"/>`
  for (let i = 0; i < count; i++) {
    const a = i * 2.4
    const r = Math.sqrt(i) * 3.6
    const px = x + Math.cos(a) * r
    const py = y + Math.sin(a) * r * 0.8
    const h = hues[i % hues.length]
    out += `<path d="M${f(px)} ${f(py - 3.6)}L${f(px + 3.4)} ${f(py)}L${f(px)} ${f(py + 3.6)}L${f(px - 3.4)} ${f(py)}Z" fill="hsl(${h} 70% 58%)" stroke="hsl(${h} 70% 82%)" stroke-width=".5"/>`
    if (i % 3 === 0) out += `<circle cx="${f(px - 1)}" cy="${f(py - 1.2)}" r=".9" fill="#fff"/>`
  }
  return out
}

/** Same look, same ids, so server and client render identical markup. */
const idOf = (text: string) => {
  let h = 5381
  for (let i = 0; i < text.length; i++) h = (h * 33 + text.charCodeAt(i)) | 0
  return `k${(h >>> 0).toString(36)}`
}

/** The hull outline, for the shadow on the seabed. */
export const hullPath = (look?: Partial<KayakLook> | null) =>
  (VESSEL_ART[look?.vessel as Vessel] ?? VESSEL_ART.sit_on_top).hull

/** One Kayak, as a complete <svg>. */
export function drawKayak(look: Partial<KayakLook> | null | undefined, opts: { aboard?: number } = {}): string {
  const l = { ...DEFAULT_LOOK, ...look }
  const v = VESSEL_ART[l.vessel] ?? VESSEL_ART.sit_on_top
  const paint = COLORS.find((c) => c.id === l.color) ?? COLORS.find((c) => c.id === DEFAULT_LOOK.color)!
  const id = idOf(JSON.stringify([l.vessel, l.color, l.pattern, l.paddle]))

  // Painted inside and out, so colour and pattern read on every vessel. The
  // pattern goes over the floor or deck; shading then sinks an open floor.
  const base =
    v.kind === 'open'
      ? `<path d="${v.inner}" fill="${hsl(paint, -9, 2)}"/>`
      : `<path d="${v.inner}" fill="url(#${id}h)"/>`
  const finish =
    v.kind === 'open'
      ? `<path d="${v.inner}" fill="url(#${id}d)"/><path d="${v.inner}" fill="none" stroke="${hsl(paint, -32)}" stroke-width="2.2"/>`
      : `<path d="${v.inner}" fill="none" stroke="${hsl(paint, -30, 0, 0.5)}" stroke-width="1.2"/>`

  let deck = ''
  const items = l.deck ?? {}
  for (const slot of ['bow', 'mid', 'stern'] as const) {
    const item = items[slot]
    const art = item ? DECK_ART[item] : null
    if (art) {
      const [x, y] = v.slots[slot]
      deck += `<g transform="translate(${x} ${y})">${art}</g>`
    }
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-30 -8 260 316" aria-hidden="true"><defs>` +
    `<linearGradient id="${id}h" x1="20" x2="180" y1="0" y2="0" gradientUnits="userSpaceOnUse">` +
    `<stop offset="0" stop-color="${hsl(paint, -34, 6)}"/><stop offset=".22" stop-color="${hsl(paint, -8)}"/><stop offset=".48" stop-color="${hsl(paint, 7)}"/><stop offset=".78" stop-color="${hsl(paint, -8)}"/><stop offset="1" stop-color="${hsl(paint, -36, 6)}"/></linearGradient>` +
    `<radialGradient id="${id}d" cx=".5" cy=".5" r=".62"><stop offset=".45" stop-color="#1c1208" stop-opacity="0"/><stop offset="1" stop-color="#1c1208" stop-opacity=".42"/></radialGradient>` +
    `<radialGradient id="${id}s" cx=".35" cy=".3" r=".55"><stop offset="0" stop-color="#fff" stop-opacity=".3"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>` +
    `<clipPath id="${id}c"><path d="${v.hull}"/></clipPath><clipPath id="${id}i"><path d="${v.inner}"/></clipPath>` +
    `<filter id="${id}b" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="2.2"/></filter>` +
    `</defs>` +
    // Where the hull meets the water: a thin bright wake.
    `<path d="${v.hull}" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="5" filter="url(#${id}b)"/>` +
    `<path d="${v.hull}" fill="url(#${id}h)"/>` +
    base +
    `<g clip-path="url(#${id}c)">${pattern(l.pattern ?? 'none', paint)}</g>` +
    finish +
    v.details(paint, id) +
    `<path d="${v.hull}" fill="url(#${id}s)"/>` +
    gemPile(opts.aboard ?? 0, v.hold[0], v.hold[1]) +
    `<g transform="translate(0 ${v.paddleY - 158})">${paddleArt(l.paddle, paint)}</g>` +
    deck +
    `</svg>`
  )
}
