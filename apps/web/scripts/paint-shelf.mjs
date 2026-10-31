// Paints the Shelf's art into public/shelf/*.webp, in headless Chromium so the
// app ships plain images rather than running these filters on every phone.
//   cd apps/web && node scripts/paint-shelf.mjs
// Seeded: the same code paints the same picture.
import { mkdirSync, writeFileSync } from 'node:fs'
import { chromium } from '@playwright/test'

const OUT = new URL('../public/shelf/', import.meta.url)

function seeded(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Long soft dabs of paint, the texture of everything broad.
function dabs(r, n, { x0, x1, y0, y1, colors, len, thick, opacity, tilt = 0.02 }) {
  let out = ''
  for (let i = 0; i < n; i++) {
    const x = x0 + r() * (x1 - x0)
    const y = y0 + r() * (y1 - y0)
    const c = colors[Math.floor(r() * colors.length)]
    const a = (r() - 0.5) * tilt * 180
    out += `<ellipse cx="${x}" cy="${y}" rx="${len * (0.5 + r())}" ry="${thick * (0.5 + r())}" fill="${c}" opacity="${opacity * (0.5 + r() * 0.8)}" transform="rotate(${a} ${x} ${y})"/>`
  }
  return out
}

function fence(r, w, top, bottom) {
  const pw = w / 26
  let out = `<rect x="0" y="${top + (bottom - top) * 0.2}" width="${w}" height="${pw * 0.42}" fill="#2c2a26"/>`
  out += `<rect x="0" y="${top + (bottom - top) * 0.72}" width="${w}" height="${pw * 0.42}" fill="#26241f"/>`
  for (let x = -pw * 0.3; x < w; x += pw * (1.12 + r() * 0.2)) {
    const t = top + r() * (bottom - top) * 0.1
    const tone = ['#34312b', '#2d2b26', '#3a362e', '#28261f'][Math.floor(r() * 4)]
    out += `<path d="M${x} ${bottom} L${x} ${t + pw * 0.3} L${x + pw / 2} ${t} L${x + pw} ${t + pw * 0.3} L${x + pw} ${bottom} Z" fill="${tone}"/>`
    out += dabs(r, 5, { x0: x + 2, x1: x + pw - 2, y0: t + pw * 0.5, y1: bottom, colors: ['#4a453b', '#1d1c18'], len: 1.6, thick: 26, opacity: 0.5 })
  }
  return out
}

// An old rowing boat hauled up the beach, oar left in it.
function boat(x, y, s) {
  const rim = `M${x} ${y - 46 * s} Q${x + 120 * s} ${y - 20 * s} ${x + 232 * s} ${y - 40 * s}`
  const hull = `${rim} Q${x + 226 * s} ${y + 2 * s} ${x + 190 * s} ${y + 6 * s} L${x + 58 * s} ${y + 6 * s} Q${x + 18 * s} ${y + 2 * s} ${x} ${y - 46 * s} Z`
  const planks = [0.3, 0.55, 0.78]
    .map((k) => `<path d="M${x + 8 * s * (1 + k)} ${y - 36 * s * (1 - k)} Q${x + 120 * s} ${y - 12 * s * (1 - k) + 4 * s} ${x + 226 * s * (1 - k * 0.04)} ${y - 32 * s * (1 - k)}" stroke="#16242c" stroke-width="${2.2 * s}" fill="none"/>`)
    .join('')
  return `
    <ellipse cx="${x + 122 * s}" cy="${y + 8 * s}" rx="${128 * s}" ry="${10 * s}" fill="#05090c" opacity=".75"/>
    <path d="M${x + 60 * s} ${y - 92 * s} L${x + 178 * s} ${y - 8 * s}" stroke="#6f6248" stroke-width="${4.4 * s}" stroke-linecap="round"/>
    <path d="M${x + 60 * s} ${y - 92 * s} L${x + 46 * s} ${y - 110 * s}" stroke="#8a7a5a" stroke-width="${10 * s}" stroke-linecap="round"/>
    <path d="${rim} Q${x + 120 * s} ${y - 48 * s} ${x} ${y - 46 * s} Z" fill="#0e171d"/>
    <path d="${hull}" fill="#2f4752"/>
    ${planks}
    <path d="${rim}" stroke="#7d9aa3" stroke-width="${4 * s}" fill="none" stroke-linecap="round"/>`
}

function net(r, x0, x1, y0, y1) {
  const cols = 16
  const rows = 11
  const sag = (i) => Math.sin((i / cols) * Math.PI) * (y1 - y0) * 0.1
  const pt = (i, j) => {
    const v = j / rows
    return [x0 + ((x1 - x0) * i) / cols + (r() - 0.5) * 3, y0 + (y1 - y0) * v + sag(i) * v]
  }
  let lines = ''
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const a = pt(i + (j % 2) * 0.5, j)
      const b = pt(i + 0.5 + (j % 2) * 0.5, j + 1)
      const c = pt(i + (j % 2) * 0.5 - 0.5, j + 1)
      lines += `<path d="M${a} L${b} M${a} L${c}"/>`
    }
  }
  let floats = ''
  for (let i = 0; i <= cols; i += 3) {
    const [x, y] = pt(i, rows)
    floats += `<ellipse cx="${x}" cy="${y}" rx="11" ry="7" fill="#a78756"/><ellipse cx="${x - 3}" cy="${y - 2}" rx="5" ry="2.4" fill="#cdb07c" opacity=".7"/>`
  }
  return `
    <path d="M${x0 - 8} ${y0} L${x1 + 8} ${y0}" stroke="#8b7a58" stroke-width="5" stroke-linecap="round"/>
    <g stroke="#9a9378" stroke-width="1.8" fill="none" opacity=".62">${lines}</g>
    ${floats}`
}

function buoy(x, y, rx, ry, color, band) {
  return `
    <path d="M${x} ${y - ry} L${x} ${y - ry - 34}" stroke="#8b7a58" stroke-width="4"/>
    <ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="${color}"/>
    <path d="M${x - rx * 0.97} ${y - ry * 0.18} Q${x} ${y + ry * 0.05} ${x + rx * 0.97} ${y - ry * 0.18} L${x + rx * 0.96} ${y + ry * 0.2} Q${x} ${y + ry * 0.42} ${x - rx * 0.96} ${y + ry * 0.2} Z" fill="${band}"/>
    <ellipse cx="${x + rx * 0.28}" cy="${y + ry * 0.05}" rx="${rx * 0.72}" ry="${ry * 0.95}" fill="#05090c" opacity=".36"/>
    <ellipse cx="${x - rx * 0.38}" cy="${y - ry * 0.45}" rx="${rx * 0.26}" ry="${ry * 0.24}" fill="#fff4dc" opacity=".3"/>`
}

function rope(x, y, s) {
  let out = ''
  for (let i = 0; i < 5; i++) {
    const k = 1 - i * 0.05
    const shape = `cx="${x}" cy="${y - i * 11 * s}" rx="${58 * s * k}" ry="${17 * s * k}" fill="none"`
    out += `<ellipse ${shape} stroke="#4f4530" stroke-width="${11 * s}"/>`
    out += `<ellipse ${shape} stroke="#a08e66" stroke-width="${8 * s}" stroke-dasharray="${5 * s} ${4 * s}"/>`
  }
  return out + `<ellipse cx="${x}" cy="${y - 44 * s}" rx="${32 * s}" ry="${8 * s}" fill="#0d1113"/>`
}

function lantern(x, top, y, s) {
  return `
    <path d="M${x} ${top} L${x} ${y - 44 * s}" stroke="#7d6c4e" stroke-width="${3.4 * s}"/>
    <circle cx="${x}" cy="${y}" r="${150 * s}" fill="url(#lanternGlow)"/>
    <path d="M${x - 15 * s} ${y - 28 * s} Q${x} ${y - 62 * s} ${x + 15 * s} ${y - 28 * s}" fill="none" stroke="#3a3128" stroke-width="${4 * s}"/>
    <path d="M${x - 22 * s} ${y - 21 * s} L${x} ${y - 38 * s} L${x + 22 * s} ${y - 21 * s} Z" fill="#2b2620"/>
    <rect x="${x - 20 * s}" y="${y - 21 * s}" width="${40 * s}" height="${48 * s}" rx="${5 * s}" fill="#ffb95f"/>
    <rect x="${x - 11 * s}" y="${y - 13 * s}" width="${22 * s}" height="${32 * s}" rx="${9 * s}" fill="#ffe7ad"/>
    <path d="M${x - 20 * s} ${y - 21 * s} L${x - 20 * s} ${y + 27 * s} M${x} ${y - 21 * s} L${x} ${y + 27 * s} M${x + 20 * s} ${y - 21 * s} L${x + 20 * s} ${y + 27 * s}" stroke="#2b2620" stroke-width="${3 * s}"/>
    <rect x="${x - 25 * s}" y="${y + 26 * s}" width="${50 * s}" height="${7 * s}" rx="${2 * s}" fill="#2b2620"/>`
}

// The backyard, composed separately for each shape of screen: the shelf covers
// the middle, so the props live where its gaps and margins show them.
function backyard(w, h, portrait) {
  const r = seeded(portrait ? 11 : 23)
  const horizon = h * (portrait ? 0.27 : 0.36)
  const shore = h * (portrait ? 0.41 : 0.53)
  const fenceTop = h * (portrait ? 0.53 : 0.6)
  const fenceBottom = h * (portrait ? 0.82 : 0.86)
  const moon = portrait ? [w * 0.86, h * 0.165] : [w * 0.78, h * 0.13]
  const m = Math.max(w, h)

  const stars = Array.from({ length: 90 }, () =>
    `<circle cx="${r() * w}" cy="${r() * horizon * 0.95}" r="${0.8 + r() * 1.7}" fill="#e8e4d0" opacity="${0.2 + r() * 0.5}"/>`,
  ).join('')
  const glint = dabs(r, 46, {
    x0: moon[0] - m * 0.022, x1: moon[0] + m * 0.022, y0: horizon + 4, y1: shore - 8,
    colors: ['#cfd6c8', '#9fb6b4'], len: m * 0.018, thick: 2.2, opacity: 0.5, tilt: 0.004,
  })

  const props = portrait
    ? `
      ${net(r, w * 0.04, w * 0.5, fenceTop + h * 0.03, fenceTop + h * 0.2)}
      ${buoy(w * 0.62, fenceTop + h * 0.075, 34, 46, '#8c3e36', '#d9c9a4')}
      ${buoy(w * 0.76, fenceTop + h * 0.09, 40, 40, '#b09a72', '#3f6f70')}
      ${buoy(w * 0.9, fenceTop + h * 0.07, 30, 50, '#3f7473', '#d9c9a4')}
      ${rope(w * 0.78, fenceBottom + h * 0.035, 1.5)}`
    : `
      ${net(r, w * 0.83, w * 0.985, fenceTop + h * 0.015, fenceTop + h * 0.22)}
      ${buoy(w * 0.035, fenceTop + h * 0.1, 30, 40, '#8c3e36', '#d9c9a4')}
      ${buoy(w * 0.09, fenceTop + h * 0.125, 36, 36, '#b09a72', '#3f6f70')}
      ${buoy(w * 0.15, fenceTop + h * 0.095, 27, 44, '#3f7473', '#d9c9a4')}
      ${rope(w * 0.08, fenceBottom + h * 0.055, 1.3)}`

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <defs>
      <linearGradient id="sky" x2="0" y2="1"><stop offset="0" stop-color="#050c1a"/><stop offset="1" stop-color="#17324f"/></linearGradient>
      <linearGradient id="sea" x2="0" y2="1"><stop offset="0" stop-color="#17404f"/><stop offset="1" stop-color="#0a2231"/></linearGradient>
      <linearGradient id="land" x2="0" y2="1"><stop offset="0" stop-color="#2a2c28"/><stop offset="1" stop-color="#0d1113"/></linearGradient>
      <radialGradient id="moonGlow"><stop offset="0" stop-color="#e7e4cc" stop-opacity=".42"/><stop offset=".22" stop-color="#e7e4cc" stop-opacity=".16"/><stop offset=".55" stop-color="#e7e4cc" stop-opacity=".04"/><stop offset="1" stop-color="#e7e4cc" stop-opacity="0"/></radialGradient>
      <radialGradient id="lanternGlow"><stop offset="0" stop-color="#ffc06e" stop-opacity=".62"/><stop offset=".4" stop-color="#ff9f4a" stop-opacity=".18"/><stop offset="1" stop-color="#ff9f4a" stop-opacity="0"/></radialGradient>
      <radialGradient id="dim" cx=".5" cy=".62" r=".62"><stop offset="0" stop-color="#040a14" stop-opacity=".5"/><stop offset=".6" stop-color="#040a14" stop-opacity=".3"/><stop offset="1" stop-color="#040a14" stop-opacity=".08"/></radialGradient>
      <filter id="wobble" x="-5%" y="-5%" width="110%" height="110%">
        <feTurbulence type="fractalNoise" baseFrequency=".014" numOctaves="3" seed="7"/>
        <feDisplacementMap in="SourceGraphic" scale="${m * 0.009}" xChannelSelector="R" yChannelSelector="G"/>
      </filter>
      <filter id="fine" x="-5%" y="-5%" width="110%" height="110%">
        <feTurbulence type="fractalNoise" baseFrequency=".05" numOctaves="2" seed="3"/>
        <feDisplacementMap in="SourceGraphic" scale="${m * 0.0035}" xChannelSelector="R" yChannelSelector="G"/>
      </filter>
      <filter id="brush" x="0" y="0" width="100%" height="100%">
        <feTurbulence type="fractalNoise" baseFrequency=".004 .11" numOctaves="4" seed="5"/>
        <feColorMatrix values="0 0 0 0 .5  0 0 0 0 .5  0 0 0 0 .5  1.6 0 0 0 -.5"/>
      </filter>
      <filter id="grain" x="0" y="0" width="100%" height="100%">
        <feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves="2" seed="9"/>
        <feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  .7 0 0 0 -.28"/>
      </filter>
    </defs>

    <g filter="url(#wobble)">
      <rect x="-40" y="-40" width="${w + 80}" height="${horizon + 60}" fill="url(#sky)"/>
      ${dabs(r, 340, { x0: 0, x1: w, y0: 0, y1: horizon, colors: ['#0d2240', '#16304f', '#0a1a30', '#23405e', '#091526'], len: m * 0.07, thick: m * 0.008, opacity: 0.42 })}
      ${stars}
      <circle cx="${moon[0]}" cy="${moon[1]}" r="${m * 0.12}" fill="url(#moonGlow)"/>
      <circle cx="${moon[0]}" cy="${moon[1]}" r="${m * 0.021}" fill="#e9e6cf"/>
      <rect x="-40" y="${horizon}" width="${w + 80}" height="${shore - horizon + 30}" fill="url(#sea)"/>
      ${dabs(r, 300, { x0: 0, x1: w, y0: horizon, y1: shore, colors: ['#0f3446', '#1c5163', '#0c2b3d', '#256070'], len: m * 0.05, thick: m * 0.0035, opacity: 0.55, tilt: 0.006 })}
      ${glint}
      <path d="M-40 ${horizon + 6} Q${w * 0.12} ${horizon - h * 0.04} ${w * 0.3} ${horizon + 4} L-40 ${horizon + 10} Z" fill="#0a1824"/>
      <rect x="-40" y="${shore}" width="${w + 80}" height="${h - shore + 40}" fill="url(#land)"/>
      ${dabs(r, 300, { x0: 0, x1: w, y0: shore, y1: h, colors: ['#3a3a33', '#23251f', '#14181a', '#464338'], len: m * 0.045, thick: m * 0.006, opacity: 0.4, tilt: 0.05 })}
    </g>

    <g filter="url(#fine)">
      ${portrait ? boat(w * 0.5, shore + h * 0.045, 2.1) : boat(w * 0.815, shore + h * 0.03, 1.25)}
      ${fence(r, w, fenceTop, fenceBottom)}
      <rect x="-20" y="${fenceBottom}" width="${w + 40}" height="${h - fenceBottom + 20}" fill="#0f1416"/>
      ${dabs(r, 150, { x0: 0, x1: w, y0: fenceBottom, y1: h, colors: ['#23261f', '#191d1b', '#2e2d25'], len: m * 0.018, thick: m * 0.004, opacity: 0.6, tilt: 0.12 })}
      ${props}
      ${portrait ? lantern(w * 0.635, -10, h * 0.125, 1.7) : lantern(w * 0.15, -10, h * 0.33, 1.25)}
    </g>

    <rect width="${w}" height="${h}" fill="url(#dim)"/>
    <rect width="${w}" height="${h}" filter="url(#brush)" opacity=".14" style="mix-blend-mode:soft-light"/>
    <rect width="${w}" height="${h}" filter="url(#grain)" opacity=".05"/>
  </svg>`
}

// Grain as coloured noise that wraps at the tile's edges.
function wood(id, freq, seed, box) {
  return `<filter id="${id}" filterUnits="userSpaceOnUse" x="${box[0]}" y="${box[1]}" width="${box[2]}" height="${box[3]}">
    <feTurbulence type="fractalNoise" baseFrequency="${freq}" numOctaves="4" seed="${seed}" stitchTiles="stitch"/>
    <feColorMatrix values=".5 0 0 0 .03  .32 0 0 0 .02  .19 0 0 0 .015  0 0 0 0 1"/>
  </filter>`
}

// One shelf row at 2×: the shadow of the plank above, open air, then a plank.
function plankRow() {
  const w = 1024
  const h = 304
  const plank = 48
  const top = h - plank
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <defs>
      ${wood('plank', '.0078125 .25', 12, [0, top, w, plank])}
      <linearGradient id="shade" x2="0" y2="1"><stop offset="0" stop-color="#03070d" stop-opacity=".62"/><stop offset="1" stop-color="#03070d" stop-opacity="0"/></linearGradient>
      <linearGradient id="face" x2="0" y2="1"><stop offset="0" stop-color="#fff0d0" stop-opacity=".26"/><stop offset=".14" stop-color="#fff0d0" stop-opacity=".02"/><stop offset=".72" stop-color="#000" stop-opacity=".05"/><stop offset="1" stop-color="#000" stop-opacity=".55"/></linearGradient>
    </defs>
    <rect width="${w}" height="34" fill="url(#shade)"/>
    <rect y="${top}" width="${w}" height="${plank}" filter="url(#plank)"/>
    <rect y="${top}" width="${w}" height="${plank}" fill="url(#face)"/>
  </svg>`
}

function post() {
  const w = 48
  const h = 384
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <defs>
      ${wood('post', '.2 .0078125', 31, [0, 0, w, h])}
      <linearGradient id="round"><stop offset="0" stop-color="#000" stop-opacity=".62"/><stop offset=".3" stop-color="#fff0d0" stop-opacity=".1"/><stop offset=".65" stop-color="#000" stop-opacity=".08"/><stop offset="1" stop-color="#000" stop-opacity=".72"/></linearGradient>
    </defs>
    <rect width="${w}" height="${h}" filter="url(#post)"/>
    <rect width="${w}" height="${h}" fill="url(#round)"/>
  </svg>`
}

const ART = [
  ['backyard-portrait', backyard(1080, 1920, true), 1080, 1920, 0.8, false],
  ['backyard-landscape', backyard(1920, 1200, false), 1920, 1200, 0.8, false],
  ['plank-row', plankRow(), 1024, 304, 0.86, true],
  ['post', post(), 48, 384, 0.86, true],
]

mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch()
for (const [name, svg, width, height, quality, alpha] of ART) {
  const page = await browser.newPage({ viewport: { width, height } })
  await page.setContent(`<!doctype html><body style="margin:0;background:transparent">${svg}</body>`)
  const png = await page.screenshot({ omitBackground: alpha, type: 'png' })
  const webp = await page.evaluate(
    async ({ b64, width, height, quality }) => {
      const img = new Image()
      img.src = `data:image/png;base64,${b64}`
      await img.decode()
      const canvas = Object.assign(document.createElement('canvas'), { width, height })
      canvas.getContext('2d').drawImage(img, 0, 0)
      return canvas.toDataURL('image/webp', quality).split(',')[1]
    },
    { b64: png.toString('base64'), width, height, quality },
  )
  const bytes = Buffer.from(webp, 'base64')
  writeFileSync(new URL(`${name}.webp`, OUT), bytes)
  console.log(`${name}.webp ${Math.round(bytes.length / 1024)} KB`)
  await page.close()
}
await browser.close()
