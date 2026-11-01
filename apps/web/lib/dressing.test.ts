import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BOTTLE_SHAPES } from './bottleShapes'
import { CURRENTS, DEFAULT_LOOK, allowedStyle, bottleLook, canUse, resolveLook, seaDress, type AtelierPiece } from './dressing'

const piece = (kind: AtelierPiece['kind'], id: string, sort: number, look: AtelierPiece['look'] = {}, retired = false): AtelierPiece => ({
  kind, id, name: id, tier: sort === 0 ? 'free' : 'keeper', look, sort, retired,
})
const pieces: AtelierPiece[] = [
  piece('shape', 'classic', 0),
  piece('shape', 'fish', 1),
  piece('glass', 'clear', 0, { tint: 't0', edge: 'e0' }),
  piece('glass', 'seafoam', 1, { tint: 't1', edge: 'e1' }),
  piece('glass', 'amber', 2, { tint: 't2', edge: 'e2' }),
  piece('glass', 'cobalt', 3, { tint: 't3', edge: 'e3' }, true),
  piece('seal', 'gold', 2, { wax: '#D4A537' }),
]

describe('allowedStyle', () => {
  it('keeps Keeper pieces for a Keeper', () => {
    expect(allowedStyle({ glass: 'amber', seal: 'gold' }, pieces, true)).toEqual({ glass: 'amber', seal: 'gold' })
  })
  it('drops every piece after a lapse', () => {
    expect(allowedStyle({ glass: 'amber', seal: 'gold' }, pieces, false)).toEqual({})
  })
  it('drops defaults and pieces no longer in the catalog', () => {
    expect(allowedStyle({ glass: 'clear', seal: 'gone' }, pieces, true)).toEqual({})
  })
  it('sends nothing before the catalog loads', () => {
    expect(allowedStyle({ glass: 'seafoam' }, undefined, true)).toEqual({})
  })
})

describe('resolveLook', () => {
  it('fills unset kinds with the classic look', () => {
    expect(resolveLook({ glass: 'seafoam' }, pieces)).toEqual({ ...DEFAULT_LOOK, tint: 't1', edge: 'e1' })
  })
  it('renders a lapsed Keeper’s sent bottle as it was dressed', () => {
    expect(resolveLook({ seal: 'gold' }, pieces).wax).toBe('#D4A537')
  })
  it('is the classic bottle for undressed or pre-042 bottles', () => {
    expect(resolveLook(null, pieces)).toBe(DEFAULT_LOOK)
  })
})

describe('canUse', () => {
  const by = (id: string) => pieces.find((p) => p.id === id)!
  it('gives free users only the plain defaults', () => {
    expect(canUse(by('clear'), false)).toBe(true)
    expect(canUse(by('seafoam'), false)).toBe(false)
  })
  it('gives Keepers every piece', () => {
    for (const p of pieces) expect(canUse(p, true)).toBe(true)
  })
})

describe('bottleLook', () => {
  it('keeps a free viewer plain', () => {
    expect(bottleLook({ id: 'a-bottle', style: null }, pieces, false)).toBe(DEFAULT_LOOK)
  })
  it('shows a Keeper what the sender chose', () => {
    expect(bottleLook({ id: 'a-bottle', style: { glass: 'seafoam' } }, pieces, true)).toEqual({
      ...DEFAULT_LOOK,
      tint: 't1',
      edge: 'e1',
    })
  })
  it('sea-dresses an undressed bottle for a Keeper, the same every time', () => {
    const look = bottleLook({ id: 'a-bottle', style: null }, pieces, true)
    expect(look).toEqual(bottleLook({ id: 'a-bottle', style: null }, pieces, true))
    expect(look.wax).toBe('#D4A537')
    expect(look.shape).toBe('classic')
  })
  it('never sea-dresses with a free piece', () => {
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f']) {
      expect(['seafoam', 'amber']).toContain(seaDress(id, pieces).glass)
    }
  })
  it('stays plain before the catalog loads', () => {
    expect(bottleLook({ id: 'a-bottle', style: null }, undefined, true)).toBe(DEFAULT_LOOK)
  })
})

describe('currents', () => {
  // The list lives in the code, in 060's CHECKs and in the spark function.
  const read = (p: string) => readFileSync(join(__dirname, '../../..', p), 'utf8')
  const ids = (text: string) => [...text.matchAll(/'([a-z]+_[a-z]+)'/g)].map((m) => m[1])

  it('match the database', () => {
    const sql = read('supabase/migrations/060_more_currents.sql')
    for (const table of sql.split('ADD CONSTRAINT').slice(1)) {
      expect(ids(table.split('));')[0])).toEqual([...CURRENTS])
    }
  })

  it('match the spark function', () => {
    const spark = read('supabase/functions/spark/spark.ts')
    expect(ids(spark.slice(spark.indexOf('const CURRENTS'), spark.indexOf('] as const', spark.indexOf('const CURRENTS'))))).toEqual([...CURRENTS])
  })
})

describe('shapes', () => {
  const sql = readFileSync(join(__dirname, '../../../supabase/migrations/061_shapes_and_pastels.sql'), 'utf8')

  it('match the catalogue, classic plus 25', () => {
    const block = sql.slice(sql.indexOf('FROM (VALUES'), sql.indexOf(') AS s(id'))
    const ids = [...block.matchAll(/\('([a-z]+)',/g)].map((m) => m[1])
    expect(ids).toHaveLength(26)
    expect(ids.sort()).toEqual(Object.keys(BOTTLE_SHAPES).sort())
  })

  it('resolve for a Keeper piece, and fall back to classic', () => {
    expect(resolveLook({ shape: 'fish' }, pieces).shape).toBe('fish')
    expect(resolveLook({ shape: 'gone' }, pieces).shape).toBe('classic')
    expect(resolveLook({ shape: 'constructor' }, pieces).shape).toBe('classic')
  })

  it('are withheld with the rest of the style: a free viewer gets the generic bottle', () => {
    expect(bottleLook({ id: 'a', style: null }, pieces, false)).toBe(DEFAULT_LOOK)
  })

  it('never come from the sea', () => {
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
      expect(seaDress(id, pieces)).not.toHaveProperty('shape')
    }
  })

  it('a free user cannot keep one in a draft', () => {
    expect(allowedStyle({ shape: 'fish' }, pieces, false)).toEqual({})
    expect(allowedStyle({ shape: 'fish' }, pieces, true)).toEqual({ shape: 'fish' })
  })
})

describe('retired pieces', () => {
  it('still resolve on bottles wearing them', () => {
    expect(resolveLook({ glass: 'cobalt' }, pieces).tint).toBe('t3')
  })
  it('leave drafts and the sea', () => {
    expect(allowedStyle({ glass: 'cobalt' }, pieces, true)).toEqual({})
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) expect(seaDress(id, pieces).glass).not.toBe('cobalt')
  })
})
