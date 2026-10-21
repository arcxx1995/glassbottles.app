import { describe, expect, it } from 'vitest'
import { DEFAULT_LOOK, allowedStyle, resolveLook, type AtelierPiece } from './dressing'

const pieces: AtelierPiece[] = [
  { kind: 'glass', id: 'clear', name: 'Clear', tier: 'free', look: { tint: 't0', edge: 'e0' }, sort: 0 },
  { kind: 'glass', id: 'seafoam', name: 'Seafoam', tier: 'free', look: { tint: 't1', edge: 'e1' }, sort: 1 },
  { kind: 'glass', id: 'amber', name: 'Amber', tier: 'keeper', look: { tint: 't2', edge: 'e2' }, sort: 2 },
  { kind: 'seal', id: 'gold', name: 'Gold wax', tier: 'keeper', look: { wax: '#D4A537' }, sort: 2 },
  { kind: 'ink', id: 'sepia', name: 'Sepia', tier: 'free', look: { color: '#E8C9A0' }, sort: 1 },
  { kind: 'ink', id: 'lavender', name: 'Lavender', tier: 'coin', look: { color: '#CDB8F5' }, sort: 6, coin_cost: 15 },
]

describe('allowedStyle', () => {
  it('keeps Keeper pieces for a Keeper', () => {
    expect(allowedStyle({ glass: 'amber', seal: 'gold' }, pieces, true)).toEqual({ glass: 'amber', seal: 'gold' })
  })
  it('drops Keeper pieces after a lapse, keeping free ones', () => {
    expect(allowedStyle({ glass: 'amber', ink: 'sepia' }, pieces, false)).toEqual({ ink: 'sepia' })
  })
  it('drops defaults and pieces no longer in the catalog', () => {
    expect(allowedStyle({ glass: 'clear', ink: 'gone' }, pieces, true)).toEqual({})
  })
  it('allows a coin piece once unlocked, or for a Keeper', () => {
    expect(allowedStyle({ ink: 'lavender' }, pieces, false)).toEqual({})
    expect(allowedStyle({ ink: 'lavender' }, pieces, false, ['ink:lavender'])).toEqual({ ink: 'lavender' })
    expect(allowedStyle({ ink: 'lavender' }, pieces, true)).toEqual({ ink: 'lavender' })
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
