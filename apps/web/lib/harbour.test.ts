import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { HULLS, PADDLES } from './harbour'

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
