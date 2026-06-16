import { describe, expect, it } from 'vitest'
import { normalizeScore, parseScore } from '../lib/scoring'

describe('score parsing', () => {
  it('normalizes slash scores', () => {
    expect(parseScore('8.5/10')).toMatchObject({
      scoreValue: 8.5,
      scoreScale: '10',
      normalizedScore: 85,
    })
  })

  it('normalizes percent scores', () => {
    expect(parseScore('92%')).toMatchObject({
      scoreValue: 92,
      scoreScale: '100',
      normalizedScore: 92,
    })
  })

  it('clamps out-of-range normalized scores', () => {
    expect(normalizeScore('12/10', 12, '10')).toBe(100)
  })
})
