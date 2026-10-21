import { describe, expect, it } from 'vitest'
import { SPARK_DECK, nextSpark } from './sparks'
import { cleanQuestion, sparkContext, sparkRequest } from '../../../supabase/functions/spark/spark'

describe('spark deck', () => {
  it('never repeats the question showing', () => {
    for (let i = 0; i < 50; i++) expect(nextSpark(SPARK_DECK[0])).not.toBe(SPARK_DECK[0])
  })
})

describe('spark function helpers', () => {
  it('keeps only known context values (the body is user input)', () => {
    expect(sparkContext({ weather: 'stormy', vibe: 'hack', current: 'night_owl', extra: 1 })).toEqual({
      weather: 'stormy',
      vibe: undefined,
      current: 'night_owl',
    })
    expect(sparkContext('nonsense')).toEqual({ weather: undefined, vibe: undefined, current: undefined })
  })
  it('describes the mood without asking anything identifying', () => {
    expect(sparkRequest({ weather: 'foggy', current: 'heavy_water' })).toBe(
      'Their sky today feels foggy. They sail the current for grief and hard days.',
    )
    expect(sparkRequest({})).toBe('No mood given.')
  })
  it('accepts a short question and rejects anything else', () => {
    expect(cleanQuestion({ question: '“What softened today?”' })).toBe('What softened today?')
    expect(cleanQuestion({ question: '' })).toBeNull()
    expect(cleanQuestion({ question: 'word '.repeat(30) })).toBeNull()
    expect(cleanQuestion({ nope: 1 })).toBeNull()
    expect(cleanQuestion(null)).toBeNull()
  })
})
