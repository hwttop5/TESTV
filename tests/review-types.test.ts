import { describe, expect, it } from 'vitest'
import { shouldPublishChineseProduct, toProductSummary } from '../lib/review-types'

describe('public product display', () => {
  it('does not fall back to English fields for public summaries', () => {
    const summary = toProductSummary({
      id: 'product-1',
      productNameZh: null,
      videoTitleZh: null,
      scoreRaw: '8/10',
      normalizedScore: 80,
      prosZh: null,
      consZh: null,
      confidence: 0.9,
      video: {
        youtubeId: 'abc123',
        publishedAt: new Date('2026-06-01T00:00:00Z'),
        thumbnailUrl: null,
        videoUrl: 'https://www.youtube.com/watch?v=abc123',
      },
    })

    expect(summary).toBeNull()
  })

  it('builds summaries only from Chinese display fields', () => {
    const summary = toProductSummary({
      id: 'product-1',
      productNameZh: '便携式显示器',
      videoTitleZh: '便携式显示器测评',
      scoreRaw: '8/10',
      normalizedScore: 80,
      prosZh: ['色彩表现明亮', 'USB-C 连接简单'],
      consZh: ['屏幕反光比较明显'],
      confidence: 0.9,
      video: {
        youtubeId: 'abc123',
        publishedAt: new Date('2026-06-01T00:00:00Z'),
        thumbnailUrl: null,
        videoUrl: 'https://www.youtube.com/watch?v=abc123',
      },
    })

    expect(summary).toMatchObject({
      displayName: '便携式显示器',
      displayVideoTitle: '便携式显示器测评',
      displayPros: ['色彩表现明亮', 'USB-C 连接简单'],
      displayCons: ['屏幕反光比较明显'],
    })
  })

  it('rejects English-only display names', () => {
    const summary = toProductSummary({
      id: 'product-1',
      productNameZh: 'Portable Monitor',
      videoTitleZh: '便携式显示器测评',
      scoreRaw: '8/10',
      normalizedScore: 80,
      prosZh: ['色彩表现明亮'],
      consZh: ['屏幕反光比较明显'],
      confidence: 0.9,
      video: {
        youtubeId: 'abc123',
        publishedAt: new Date('2026-06-01T00:00:00Z'),
        thumbnailUrl: null,
        videoUrl: 'https://www.youtube.com/watch?v=abc123',
      },
    })

    expect(summary).toBeNull()
  })

  it('requires both Chinese pros and cons before publishing', () => {
    expect(shouldPublishChineseProduct({
      productNameZh: '便携式显示器',
      normalizedScore: 80,
      confidence: 0.9,
      prosZh: ['色彩表现明亮'],
      consZh: [],
    })).toBe(false)

    expect(shouldPublishChineseProduct({
      productNameZh: '便携式显示器',
      normalizedScore: 80,
      confidence: 0.9,
      prosZh: ['色彩表现明亮'],
      consZh: ['屏幕反光比较明显'],
    })).toBe(true)
  })
})
