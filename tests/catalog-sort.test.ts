import { describe, expect, it } from 'vitest'
import { DEFAULT_SORT_MODE, normalizeSortMode } from '../lib/catalog-sort'

describe('catalog sort mode', () => {
  it('defaults product lists to date sorting', () => {
    expect(DEFAULT_SORT_MODE).toBe('date')
    expect(normalizeSortMode(undefined)).toBe('date')
    expect(normalizeSortMode(null)).toBe('date')
    expect(normalizeSortMode('date')).toBe('date')
    expect(normalizeSortMode('unknown')).toBe('date')
  })

  it('keeps explicit score sorting available', () => {
    expect(normalizeSortMode('score')).toBe('score')
  })
})
