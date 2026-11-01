import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { FAMILIES, SEED_SPACE, decodeSeed, drawGem, encodeSeed, gemName } from './engine'

// Same digit order as load_gems (063).
const seedOf = (family: number, palette = 0, silhouette = 0, facets = 0, texture = 0, finish = 0) =>
  family + 30 * (palette + 36 * (silhouette + 48 * (facets + 24 * (texture + 24 * finish))))

describe('seeds', () => {
  it('cover exactly the space load_gems generates', () => {
    expect(SEED_SPACE).toBe(238878720)
    expect(decodeSeed(seedOf(29, 35, 47, 23, 23, 7))).toEqual({
      family: 'glass_float', palette: 35, silhouette: 47, facets: 23, texture: 23, finish: 7,
    })
    expect(seedOf(29, 35, 47, 23, 23, 7)).toBe(SEED_SPACE - 1)
  })

  it('decode and encode one to one, so a unique seed is a unique set of traits', () => {
    for (const seed of [0, 1, 29, 30, 1080, 51840, 12345678, 99999999, SEED_SPACE - 1]) {
      expect(encodeSeed(decodeSeed(seed))).toBe(seed)
    }
  })

  it('survive junk from the wire without throwing', () => {
    expect(() => drawGem(-1)).not.toThrow()
    expect(() => drawGem(NaN)).not.toThrow()
    expect(() => drawGem(SEED_SPACE)).not.toThrow()
    expect(() => drawGem('<script>' as unknown as number)).not.toThrow()
    expect(drawGem('<script>' as unknown as number)).not.toContain('script')
  })
})

describe('every family', () => {
  it('has 30', () => expect(FAMILIES).toHaveLength(30))

  it.each(FAMILIES.map((name, i) => [name, i] as const))('%s renders, is stable, and every digit shows', (_name, i) => {
    const base = seedOf(i, 7, 13, 9, 5, 0)
    const svg = drawGem(base)
    expect(svg.startsWith('<svg')).toBe(true)
    expect(svg).not.toMatch(/NaN|undefined|Infinity|null/)
    expect(drawGem(base)).toBe(svg) // deterministic

    // Changing any one digit changes the picture.
    const strip = (s: string) => s.replace(/\bg[0-9a-z]+(?=[oct"is)])/g, 'g')
    for (const other of [
      seedOf(i, 8, 13, 9, 5, 0),
      seedOf(i, 7, 14, 9, 5, 0),
      seedOf(i, 7, 13, 10, 5, 0),
      seedOf(i, 7, 13, 9, 6, 0),
      seedOf(i, 7, 13, 9, 5, 1),
    ]) {
      expect(strip(drawGem(other))).not.toBe(strip(svg))
    }
  })

  it('never produces a broken number across a wide sample', () => {
    for (let n = 0; n < 3000; n++) {
      const seed = (n * 79617) % SEED_SPACE
      const svg = drawGem(seed)
      if (/NaN|undefined|Infinity/.test(svg)) throw new Error(`broken gem at seed ${seed}`)
      expect(gemName(seed)).toMatch(/^\S.* \S/)
    }
  })

  it('stays inside the size a shelf of 30 can afford', () => {
    const biggest = Math.max(...FAMILIES.map((_, i) => drawGem(seedOf(i, 7, 47, 23, 2, 3)).length))
    expect(biggest).toBeLessThan(30000)
  })
})

describe('engine 1 is frozen', () => {
  // A member's gem must look the same forever. If this fails you changed a
  // released drawing: put it back, and ship the new look as engine 2.
  it('draws the same pictures it always has', () => {
    const hash = createHash('sha256')
    for (let i = 0; i < 30; i++) hash.update(drawGem(seedOf(i, 11, 21, 7, 13, i % 8)))
    expect(hash.digest('hex')).toBe('fc0cf91888dcd382138ae13fadc6eaffb5c65e1a102d42e35fd9386bf8660e78')
  })
})
