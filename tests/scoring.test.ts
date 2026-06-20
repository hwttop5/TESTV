import { describe, expect, it } from 'vitest'
import { compareScoreValueDesc, formatScoreValue, normalizeScore, parseScore } from '../lib/scoring'

describe('score parsing', () => {
  it('parses ten-point scores', () => {
    expect(parseScore('8.5/10')).toMatchObject({
      scoreRaw: '8.5/10',
      scoreValue: 8.5,
      scoreScale: '10',
    })
  })

  it('formats score values without trailing zeroes', () => {
    expect(formatScoreValue(9)).toBe('9')
    expect(formatScoreValue(7.5)).toBe('7.5')
    expect(formatScoreValue(7.25)).toBe('7.25')
  })

  it('sorts score values descending with nulls last', () => {
    const sorted = [null, 7.25, 9, 7.5].sort(compareScoreValueDesc)

    expect(sorted).toEqual([9, 7.5, 7.25, null])
  })

  it('clamps out-of-range normalized scores', () => {
    expect(normalizeScore('12/10', 12, '10')).toBe(100)
  })
})
