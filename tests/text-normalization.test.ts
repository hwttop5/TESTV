import { describe, expect, it } from 'vitest'
import {
  hasEnglishSentence,
  hasPublicTextIssue,
  isLikelyTraditionalText,
  normalizePublicList,
  normalizePublicText,
  normalizeToSimplifiedChinese,
} from '../lib/text-normalization'

describe('text normalization', () => {
  it('converts traditional Chinese to simplified Chinese with mainland wording', () => {
    expect(normalizeToSimplifiedChinese('咱們這個螢幕質感很好，後殼溫度也穩。')).toBe('咱们这个屏幕质感很好，后壳温度也稳。')
  })

  it('keeps brand and model English tokens while rejecting English sentences', () => {
    expect(normalizePublicText('Redmi K90 Max 屏幕观感不错')).toBe('Redmi K90 Max 屏幕观感不错')
    expect(normalizePublicText('iPhone 16 Pro 影像稳定')).toBe('iPhone 16 Pro 影像稳定')
    expect(normalizePublicText('This product has good screen and battery life', { allowEmpty: true })).toBe('')
    expect(hasEnglishSentence('This product has good screen and battery life')).toBe(true)
  })

  it('detects public text issues and filters lists', () => {
    expect(isLikelyTraditionalText('這個螢幕很好')).toBe(true)
    expect(hasPublicTextIssue('优点整理中。')).toBe(true)
    expect(normalizePublicList([
      '這個螢幕很好',
      'This product has good screen and battery life',
      'Redmi K90 Max 性能释放稳定',
    ])).toEqual([
      '这个屏幕很好',
      'Redmi K90 Max 性能释放稳定',
    ])
  })
})
