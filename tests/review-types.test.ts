import { describe, expect, it } from 'vitest'
import {
  computeContentStatus,
  resolveOpinionCandidates,
  shouldPublishChineseProduct,
  toProductDetail,
  toProductSummary,
} from '../lib/review-types'

describe('public product display', () => {
  it('builds simplified Chinese fallback summaries when fields are missing', () => {
    const summary = toProductSummary({
      id: 'product-1',
      productName: 'Portable Monitor',
      productNameZh: null,
      videoTitleZh: null,
      scoreRaw: '8/10',
      scoreValue: 8,
      priceRaw: null,
      priceValue: null,
      priceCurrency: null,
      priceType: null,
      priceContext: null,
      priceConfidence: null,
      prosZh: null,
      consZh: null,
      confidence: 0.9,
      contentStatus: null,
      video: {
        youtubeId: 'abc123',
        publishedAt: new Date('2026-06-01T00:00:00Z'),
        thumbnailUrl: null,
        videoUrl: 'https://www.youtube.com/watch?v=abc123',
        transcripts: [{ id: 't1' }],
      },
    })

    expect(summary.contentStatus).toBe('partial')
    expect(summary.displayName).toBe('产品信息待补充（abc123）')
    expect(summary.displayPrice).toBe('')
    expect(summary.displayPros).toEqual(['字幕中未提到明确优点。'])
    expect(summary.displayCons).toEqual(['字幕中未提到明确缺点。'])
    expect(summary.prosCount).toBe(0)
    expect(summary.consCount).toBe(0)
  })

  it('builds summaries from Chinese display fields and derives category', () => {
    const summary = toProductSummary({
      id: 'product-1',
      productName: 'Portable Monitor',
      productNameZh: '便携式显示器',
      videoTitleZh: '便携式显示器测评',
      scoreRaw: '8/10',
      scoreValue: 8,
      priceRaw: '售价899元',
      priceValue: 899,
      priceCurrency: 'CNY',
      priceType: 'listed',
      priceContext: '这台便携式显示器售价899元。',
      priceConfidence: 0.86,
      prosZh: ['色彩表现明亮', 'USB-C 连接简单'],
      consZh: ['屏幕反光比较明显'],
      confidence: 0.9,
      contentStatus: 'complete',
      video: {
        youtubeId: 'abc123',
        publishedAt: new Date('2026-06-01T00:00:00Z'),
        thumbnailUrl: null,
        videoUrl: 'https://www.youtube.com/watch?v=abc123',
        transcripts: [{ id: 't1' }],
      },
    })

    expect(summary).toMatchObject({
      displayName: '便携式显示器',
      displayVideoTitle: '便携式显示器测评',
      scoreValue: 8,
      displayPrice: '899元',
      priceValue: 899,
      priceCurrency: 'CNY',
      priceContext: '这台便携式显示器售价899元。',
      displayPros: ['色彩表现明亮', 'USB-C 连接简单'],
      displayCons: ['屏幕反光比较明显'],
      prosCount: 2,
      consCount: 1,
      contentStatus: 'complete',
      categoryKey: 'office-peripheral',
      categoryLabel: '办公/外设',
    })
  })

  it('keeps English model names only when there is Chinese category context', () => {
    const summary = toProductSummary({
      id: 'product-1',
      productName: 'SONY WH-1000XM6',
      productNameZh: 'SONY WH-1000XM6 耳机',
      videoTitleZh: '索尼耳机测评',
      scoreRaw: '8/10',
      scoreValue: 8,
      prosZh: ['降噪强'],
      consZh: ['价格高'],
      confidence: 0.9,
      contentStatus: 'complete',
      video: {
        youtubeId: 'abc123',
        publishedAt: new Date('2026-06-01T00:00:00Z'),
        thumbnailUrl: null,
        videoUrl: 'https://www.youtube.com/watch?v=abc123',
        transcripts: [{ id: 't1' }],
      },
    })

    expect(summary.displayName).toBe('SONY WH-1000XM6 耳机')
    expect(summary.categoryKey).toBe('audio')
  })

  it('derives summary counts from transcript candidates when stored fields are empty', () => {
    const summary = toProductSummary({
      id: 'product-3',
      productName: 'Portable Monitor',
      productNameZh: '便携式显示器',
      videoTitleZh: '便携式显示器测评',
      scoreRaw: '7.25/10',
      scoreValue: 7.25,
      prosZh: [],
      consZh: [],
      confidence: 0.9,
      contentStatus: 'partial',
      video: {
        youtubeId: 'abc123',
        publishedAt: new Date('2026-06-01T00:00:00Z'),
        thumbnailUrl: null,
        videoUrl: 'https://www.youtube.com/watch?v=abc123',
        transcripts: [{
          id: 't1',
          content: '这台机器很方便，自动模式也很稳定。缺点是重量偏大，背久了会累。',
          segments: [
            { text: '这台机器很方便，自动模式也很稳定。', start: 0, duration: 1 },
            { text: '缺点是重量偏大，背久了会累。', start: 2, duration: 1 },
          ],
        }],
      },
    })

    expect(summary.prosCount).toBe(1)
    expect(summary.consCount).toBe(1)
    expect(summary.displayPros).toEqual(['自动模式也很稳定'])
    expect(summary.displayCons).toEqual(['重量偏大'])
  })

  it('normalizes detail transcript paragraphs to simplified Chinese', () => {
    const detail = toProductDetail({
      id: 'product-1',
      productName: 'Portable Monitor',
      productNameZh: '便携式显示器',
      videoTitleZh: '便携式显示器测评',
      scoreRaw: '7.25/10',
      scoreValue: 7.25,
      prosZh: ['色彩表现明亮'],
      consZh: ['屏幕反光比较明显'],
      confidence: 0.9,
      contentStatus: 'complete',
      video: {
        youtubeId: 'abc123',
        publishedAt: new Date('2026-06-01T00:00:00Z'),
        thumbnailUrl: null,
        videoUrl: 'https://www.youtube.com/watch?v=abc123',
        transcripts: [{
          id: 't1',
          content: '第一段。第二段。',
          segments: [
            { text: '第一段。', start: 0, duration: 1 },
            { text: '這個螢幕質感很好。', start: 3.2, duration: 1 },
          ],
        }],
      },
    })

    expect(detail.scoreValue).toBe(7.25)
    expect(detail).not.toHaveProperty('normalizedScore')
    expect(detail).not.toHaveProperty('displayEvidence')
    expect(detail.displayTranscriptParagraphs).toEqual(['第一段。这个屏幕质感很好。'])
    expect(detail.videoLinks).toEqual({
      youtube: 'https://www.youtube.com/watch?v=abc123',
    })
  })

  it('supplements only the missing side from transcript candidates', () => {
    const detail = toProductDetail({
      id: 'product-2',
      productName: 'Portable Monitor',
      productNameZh: '便携式显示器',
      videoTitleZh: '便携式显示器测评',
      scoreRaw: '7.25/10',
      scoreValue: 7.25,
      prosZh: ['官方整理优点'],
      consZh: [],
      confidence: 0.9,
      contentStatus: 'partial',
      video: {
        youtubeId: 'abc123',
        publishedAt: new Date('2026-06-01T00:00:00Z'),
        thumbnailUrl: null,
        videoUrl: 'https://www.youtube.com/watch?v=abc123',
        transcripts: [{
          id: 't1',
          content: '自动模式很稳。不过它的重量偏大，长时间移动会累。',
          segments: [
            { text: '自动模式很稳。', start: 0, duration: 1 },
            { text: '不过它的重量偏大，长时间移动会累。', start: 2, duration: 1 },
          ],
        }],
      },
    })

    expect(detail.displayPros).toEqual(['官方整理优点'])
    expect(detail.displayCons).toEqual(['重量偏大'])
  })

  it('exposes shared opinion candidates for summary and detail', () => {
    const candidates = resolveOpinionCandidates({
      id: 'product-4',
      productName: 'Portable Monitor',
      productNameZh: '便携式显示器',
      videoTitleZh: '便携式显示器测评',
      scoreRaw: null,
      scoreValue: null,
      prosZh: [],
      consZh: [],
      confidence: null,
      contentStatus: 'partial',
      video: {
        youtubeId: 'xyz',
        publishedAt: new Date('2026-06-01T00:00:00Z'),
        thumbnailUrl: null,
        videoUrl: 'https://www.youtube.com/watch?v=xyz',
        transcripts: [{
          id: 't1',
          content: '屏幕亮度够用。反光比较明显。',
          segments: [
            { text: '屏幕亮度够用。', start: 0, duration: 1 },
            { text: '反光比较明显。', start: 2, duration: 1 },
          ],
        }],
      },
    })

    expect(candidates.prosCandidates).toEqual(['屏幕亮度够用'])
    expect(candidates.consCandidates).toEqual(['反光比较明显'])
    expect(candidates.prosCount).toBe(1)
    expect(candidates.consCount).toBe(1)
  })

  it('computes content status correctly', () => {
    expect(computeContentStatus({
      scoreValue: 8,
      prosZh: ['色彩表现明亮'],
      consZh: ['屏幕反光比较明显'],
      hasTranscript: true,
    })).toBe('complete')

    expect(computeContentStatus({
      scoreValue: null,
      prosZh: ['色彩表现明亮'],
      consZh: [],
      hasTranscript: true,
    })).toBe('partial')

    expect(computeContentStatus({
      scoreValue: null,
      prosZh: [],
      consZh: [],
      hasTranscript: false,
    })).toBe('placeholder')
  })

  it('publishes only complete products', () => {
    expect(shouldPublishChineseProduct({
      scoreValue: 8,
      prosZh: ['色彩表现明亮'],
      consZh: [],
      hasTranscript: true,
    })).toBe(false)

    expect(shouldPublishChineseProduct({
      scoreValue: 8,
      prosZh: ['色彩表现明亮'],
      consZh: ['屏幕反光比较明显'],
      hasTranscript: true,
    })).toBe(true)
  })
})
