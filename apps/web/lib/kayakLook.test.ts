import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { drawKayak } from './kayakArt'
import { COLORS, DECK_ITEMS, DEFAULT_LOOK, PADDLE_STYLES, PATTERNS, VESSELS, lookKey } from './kayakLook'

const sql = readFileSync(resolve(__dirname, '../../../supabase/migrations/063_kayak_voyages.sql'), 'utf8')
const check = sql.slice(sql.indexOf('FUNCTION public.check_kayak_look'), sql.indexOf('-- ─── owner RPCs'))

// Every quoted word in the IN (...) that follows `marker`.
const listAfter = (marker: string) => {
  const from = check.indexOf(marker)
  const open = check.indexOf('(', check.indexOf('IN', from))
  return [...check.slice(open, check.indexOf(')', open)).matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort()
}

describe('the look lists match check_kayak_look', () => {
  it('vessels', () => expect(listAfter("(p_look ->> 'vessel') NOT")).toEqual([...VESSELS].sort()))
  it('patterns', () => expect(listAfter("COALESCE(p_look ->> 'pattern'")).toEqual([...PATTERNS].sort()))
  it('paddles', () => expect(listAfter("(p_look ->> 'paddle') NOT")).toEqual([...PADDLE_STYLES].sort()))
  it('deck items', () => expect(listAfter('v_item NOT')).toEqual([...DECK_ITEMS].sort()))
})

describe('lookKey', () => {
  it('ignores key order and empty slots, as the database reorders both', () => {
    expect(lookKey({ deck: { stern: 'cat', bow: 'flag' } })).toBe(lookKey({ deck: { bow: 'flag', mid: null, stern: 'cat' } }))
    expect(lookKey({ pattern: 'none' })).toBe(lookKey({}))
  })
  it('tells different looks apart', () => {
    expect(lookKey({ color: 'rose_pale' })).not.toBe(lookKey({ color: 'rose_soft' }))
    expect(lookKey({ deck: { bow: 'cat' } })).not.toBe(lookKey({ deck: { mid: 'cat' } }))
  })
})

describe('drawKayak', () => {
  it('has the 36 Atelier pastels', () => expect(COLORS).toHaveLength(36))

  it.each(VESSELS.map((v) => [v]))('%s draws every deck item, pattern and paddle', (vessel) => {
    for (const pattern of PATTERNS) {
      for (const paddle of PADDLE_STYLES) {
        expect(drawKayak({ vessel, pattern, paddle, color: 'rose_pale' })).not.toMatch(/NaN|undefined/)
      }
    }
    for (const item of DECK_ITEMS) {
      const svg = drawKayak({ vessel, paddle: 'double_blade', color: 'rose_pale', deck: { bow: item, mid: item, stern: item } })
      expect(svg).not.toMatch(/NaN|undefined/)
    }
  })

  it('falls back instead of breaking on a bad look', () => {
    const svg = drawKayak({ vessel: 'tank', color: '</svg><script>', pattern: 'x', paddle: 'y', deck: { bow: 'z' } } as never)
    expect(svg).not.toContain('script')
    expect(svg).not.toMatch(/NaN|undefined/)
    expect(drawKayak(null)).toContain('<svg')
    expect(DEFAULT_LOOK.color).toBe('butter_deep')
  })

  it('shows a gem pile that shrinks, and none when empty', () => {
    const count = (svg: string) => (svg.match(/hsl\(\d+ 70% 58%\)/g) ?? []).length
    expect(count(drawKayak(null, { aboard: 0 }))).toBe(0)
    expect(count(drawKayak(null, { aboard: 1 }))).toBeGreaterThan(0)
    expect(count(drawKayak(null, { aboard: 30 }))).toBeGreaterThan(count(drawKayak(null, { aboard: 5 })))
  })
})
