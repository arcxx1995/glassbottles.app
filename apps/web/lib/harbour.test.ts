import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CURRENTS, CURRENT_INFO } from './dressing'
import { HULLS, LIGHTS, PADDLES, currentLight, hex, lightAt, ringLayout, type Light } from './harbour'

// The palettes live twice: here and in 056's CHECKs on public.kayaks.
const sql = readFileSync(join(__dirname, '../../../supabase/migrations/056_harbour.sql'), 'utf8')
const checkList = (col: string) =>
  [...sql.match(new RegExp(`CHECK \\(${col} IN \\(([^)]*)\\)`))![1].matchAll(/'([a-z]+)'/g)].map((m) => m[1])

describe('kayak palettes', () => {
  it('match the database', () => {
    expect(checkList('hull')).toEqual([...HULLS])
    expect(checkList('paddle')).toEqual([...PADDLES])
  })
})

describe('ringLayout', () => {
  it.each([1, 2, 5, 12])('keeps %i kayaks on the stage, bows to the centre', (n) => {
    const ring = ringLayout(n)
    expect(ring).toHaveLength(n)
    for (const k of ring) {
      // Whole hull inside the stage.
      expect(Math.min(k.x, k.y) - k.length / 2).toBeGreaterThanOrEqual(0)
      expect(Math.max(k.x, k.y) + k.length / 2).toBeLessThanOrEqual(1)
      if (n > 1) {
        // Bow direction (rotate 0 = up) points roughly at the centre.
        const rad = (k.rotate * Math.PI) / 180
        const bow = { x: Math.sin(rad), y: -Math.cos(rad) }
        const toCentre = { x: 0.5 - k.x, y: 0.5 - k.y }
        expect(bow.x * toCentre.x + bow.y * toCentre.y).toBeGreaterThan(0)
      }
    }
  })
  it('never lets two hulls sit on top of each other', () => {
    const ring = ringLayout(12)
    for (let i = 0; i < ring.length; i++)
      for (let j = i + 1; j < ring.length; j++)
        expect(Math.hypot(ring[i].x - ring[j].x, ring[i].y - ring[j].y)).toBeGreaterThan(ring[0].length * 0.25)
  })
})

describe('lightAt', () => {
  it('follows the hour', () => {
    expect([4, 5, 9, 17, 20].map(lightAt)).toEqual(['night', 'dawn', 'day', 'dusk', 'night'])
  })
})

describe('currentLight', () => {
  const brightness = (h: string) => hex(h).reduce((a, b) => a + b, 0)
  const lights = Object.keys(LIGHTS) as Light[]

  it('gives valid colours for every current at every hour', () => {
    for (const c of CURRENTS) {
      for (const l of lights) {
        const w = currentLight(CURRENT_INFO[c].sea, l)
        for (const v of [w.deep, w.shallow, w.caustic, w.glint]) expect(v, `${c} ${l}`).toMatch(/^#[0-9a-f]{6}$/i)
      }
    }
  })

  it('takes colour from the current and brightness from the hour', () => {
    for (const c of CURRENTS) {
      const sea = CURRENT_INFO[c].sea
      expect(currentLight(sea, 'day').shallow.toLowerCase()).toBe(sea.water.shallow.toLowerCase())
      expect(brightness(currentLight(sea, 'night').shallow)).toBeLessThan(brightness(currentLight(sea, 'dusk').shallow))
      expect(brightness(currentLight(sea, 'dusk').shallow)).toBeLessThan(brightness(currentLight(sea, 'day').shallow))
      expect(currentLight(sea, 'night').glintAmt).toBe(LIGHTS.night.glintAmt)
    }
  })
})
