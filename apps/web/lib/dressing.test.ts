import { describe, expect, it } from 'vitest'
import { DEFAULT_LOOK, allowedStyle, bottleLook, canUse, resolveLook, seaDress, type AtelierPiece } from './dressing'

const pieces: AtelierPiece[] = [
  { kind: 'glass', id: 'clear', name: 'Clear', tier: 'free', look: { tint: 't0', edge: 'e0' }, sort: 0 },
  { kind: 'glass', id: 'seafoam', name: 'Seafoam', tier: 'keeper', look: { tint: 't1', edge: 'e1' }, sort: 1 },
  { kind: 'glass', id: 'amber', name: 'Amber', tier: 'keeper', look: { tint: 't2', edge: 'e2' }, sort: 2 },
  { kind: 'seal', id: 'gold', name: 'Gold wax', tier: 'keeper', look: { wax: '#D4A537' }, sort: 2 },
  { kind: 'ink', id: 'sand', name: 'Sand', tier: 'free', look: { color: '#F7E7CE' }, sort: 0 },
  { kind: 'ink', id: 'sepia', name: 'Sepia', tier: 'keeper', look: { color: '#E8C9A0' }, sort: 1 },
]

describe('allowedStyle', () => {
  it('keeps Keeper pieces for a Keeper', () => {
    expect(allowedStyle({ glass: 'amber', seal: 'gold' }, pieces, true)).toEqual({ glass: 'amber', seal: 'gold' })
  })
  it('drops every piece after a lapse', () => {
    expect(allowedStyle({ glass: 'amber', ink: 'sepia' }, pieces, false)).toEqual({})
  })
  it('drops defaults and pieces no longer in the catalog', () => {
    expect(allowedStyle({ glass: 'clear', ink: 'gone' }, pieces, true)).toEqual({})
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
    expect(look.paper).toBe(DEFAULT_LOOK.paper)
    expect(look.ink).toBe(DEFAULT_LOOK.ink)
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
