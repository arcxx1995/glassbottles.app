import { describe, expect, it } from 'vitest'
import { cityFromHeader } from './city'

describe('cityFromHeader', () => {
  it.each([
    ['Lisbon', 'Lisbon'],
    ['S%C3%A3o%20Paulo', 'São Paulo'],
    ['New%20York', 'New York'],
    ["Val-d'Or", "Val-d'Or"],
    ['St.%20John%27s', "St. John's"],
  ])('reads %s', (raw, city) => expect(cityFromHeader(raw)).toBe(city))

  it.each([null, undefined, '', '%E0%A4%A', '<script>', 'a@b.com', 'x'.repeat(81), '12345'])('drops %s', (raw) =>
    expect(cityFromHeader(raw)).toBeNull())
})
