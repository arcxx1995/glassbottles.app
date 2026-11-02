import { describe, expect, it } from 'vitest'
import { CURRENTS, CURRENT_INFO } from './dressing'
import { LIGHTS, MAST, atMast, bowOf, currentLight, hex, kayakStatus, lightAt, mastMooring, visitorMooring, type Light } from './harbour'

describe('kayakStatus', () => {
  it('names the city only while visiting', () => {
    expect(kayakStatus({ state: 'visiting', city: 'Lisbon' })).toBe('Your Kayak is somewhere near Lisbon')
    expect(kayakStatus({ state: 'visiting', city: null })).toBe('Your Kayak is sailing')
    expect(kayakStatus({ state: 'sailing', city: 'Lisbon' })).toBe('Your Kayak is sailing')
    expect(kayakStatus({ state: 'returning', city: null })).toBe('Your Kayak is sailing home')
    expect(kayakStatus({ state: 'home', city: null })).toBe('Tied to the mast')
  })

  it('counts screening as still at the mast', () => {
    expect(atMast({ state: 'screening' })).toBe(true)
    expect(atMast({ state: 'home' })).toBe(true)
    expect(atMast({ state: 'sailing' })).toBe(false)
  })
})

describe('moorings', () => {
  it.each([0, 1, 2])('Kayak %i ties up on the stage, bow nearer the mast than its stern', (i) => {
    const m = mastMooring(i)
    expect(Math.min(m.x, m.y) - m.length * 0.34).toBeGreaterThanOrEqual(0)
    expect(Math.max(m.x, m.y) + m.length * 0.34).toBeLessThanOrEqual(1)
    const bow = bowOf(m)
    const dist = (p: { x: number; y: number }) => Math.hypot(p.x - MAST.x, p.y - MAST.y)
    expect(dist(bow)).toBeLessThan(dist(m))
  })

  it('keeps tied-up Kayaks apart, and the mast low enough to sit by the Build button', () => {
    const tied = [0, 1, 2].map(mastMooring)
    tied.forEach((a, i) => tied.slice(i + 1).forEach((b) => expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(0.3)))
    expect(MAST.x).toBe(0.5)
    expect(MAST.y).toBeGreaterThan(0.8)
    for (const m of tied) expect(Math.hypot(m.x - MAST.x, m.y - MAST.y)).toBeGreaterThan(0.2)
  })

  it('never puts a visitor on top of a tied-up Kayak', () => {
    for (const a of [0, 1, 2].map(mastMooring)) {
      for (const b of [0, 1, 2].map(visitorMooring)) {
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(0.16)
      }
    }
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
