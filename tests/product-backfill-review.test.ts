import { describe, expect, it } from 'vitest'
import {
  buildApplyPlan,
  extractScoreCandidates,
  safeParseSuggestionJson,
  suggestScoreFromCandidates,
  type BackfillProductInput,
} from '../lib/product-backfill-review'

function product(overrides: Partial<BackfillProductInput> = {}): BackfillProductInput {
  return {
    id: 'product-1',
    productName: '小米智能蒸发式冷风扇',
    productNameZh: '小米智能蒸发式冷风扇',
    videoTitleZh: '小米冷风扇还是戴森风扇',
    scoreRaw: null,
    scoreValue: null,
    scoreScale: null,
    normalizedScore: null,
    prosZh: [],
    consZh: [],
    confidence: null,
    contentStatus: 'partial',
    video: {
      youtubeId: 'yt-1',
      title: '小米冷风扇还是戴森风扇？我都买了！【值不值得买第604期】',
      publishedAt: new Date('2026-06-01T00:00:00Z'),
      thumbnailUrl: null,
      videoUrl: 'https://www.youtube.com/watch?v=yt-1',
      transcripts: [{
        id: 't1',
        content: '',
        source: 'yt_dlp_subtitle',
        language: 'zh',
      }],
    },
    ...overrides,
  }
}

describe('product backfill review score extraction', () => {
  it('extracts common ten-point score formats', () => {
    const input = product()
    const text = [
      '这个产品 TESTV主观综合评分7.5分。',
      '另一种写法是综合评分 6.75/10。',
      '最后还得到了7.25分。',
    ].join('')

    const candidates = extractScoreCandidates(text, input)

    expect(candidates.map((candidate) => candidate.scoreRaw)).toContain('7.5/10')
    expect(candidates.map((candidate) => candidate.scoreRaw)).toContain('6.75/10')
    expect(candidates.map((candidate) => candidate.scoreRaw)).toContain('7.25/10')
  })

  it('prefers product-name matched score in multi-score videos', () => {
    const input = product()
    const candidates = extractScoreCandidates(
      '小米智能蒸发式冷风扇主观综合评分 7.25 分。戴森AM07无叶风扇主观综合评分 5.75 分。',
      input,
    )
    const suggestion = suggestScoreFromCandidates({ product: input, candidates })

    expect(candidates).toHaveLength(2)
    expect(suggestion.needsHumanReview).toBe(false)
    expect(suggestion.scoreValue).toBe(7.25)
    expect(suggestion.reason).toContain('产品名')
  })

  it('marks unclear multi-product score ownership for human review', () => {
    const input = product({
      productName: '网络热门风扇',
      productNameZh: '网络热门风扇',
      videoTitleZh: '网络热门风扇鉴定',
      video: {
        ...product().video,
        title: '网络热门风扇鉴定，几款风扇到底哪个好？',
      },
    })
    const candidates = extractScoreCandidates(
      '第一款综合评分6分。第二款综合评分7.5分。最后TESTV综合评分6分。',
      input,
    )
    const suggestion = suggestScoreFromCandidates({ product: input, candidates })

    expect(candidates.length).toBeGreaterThanOrEqual(3)
    expect(suggestion.needsHumanReview).toBe(true)
    expect(suggestion.scoreValue).toBeNull()
  })
})

describe('product backfill suggestion parsing and apply planning', () => {
  it('throws on invalid AI JSON without producing a suggestion', () => {
    expect(() => safeParseSuggestionJson('不是 JSON')).toThrow(/不是合法 JSON/)
  })

  it('builds dry-run apply plans without requiring writes', () => {
    const plan = buildApplyPlan({
      current: {
        id: 'product-1',
        scoreValue: null,
        prosZh: [],
        consZh: [],
        confidence: null,
        video: { transcripts: [{ id: 't1', content: '字幕', source: 'test' }] },
      },
      suggestion: {
        productId: 'product-1',
        missingFields: ['score', 'pros', 'cons'],
        suggestedScoreValue: 7.25,
        suggestedScoreRaw: '7.25/10',
        prosZh: ['风感更自然'],
        consZh: ['水箱清洁麻烦'],
        confidence: 0.82,
        needsHumanReview: false,
        reason: '规则匹配。',
      },
    })

    expect(plan.shouldWrite).toBe(true)
    expect(plan.data).toMatchObject({
      scoreRaw: '7.25/10',
      scoreValue: 7.25,
      scoreScale: '10',
      normalizedScore: 72.5,
      prosZh: ['风感更自然'],
      consZh: ['水箱清洁麻烦'],
      contentStatus: 'complete',
      confidence: 0.82,
    })
  })

  it('skips human-review suggestions by default', () => {
    const plan = buildApplyPlan({
      current: {
        id: 'product-1',
        scoreValue: null,
        prosZh: [],
        consZh: [],
        confidence: null,
      },
      suggestion: {
        productId: 'product-1',
        missingFields: ['score'],
        suggestedScoreValue: 6,
        suggestedScoreRaw: '6/10',
        prosZh: [],
        consZh: [],
        confidence: 0.35,
        needsHumanReview: true,
        reason: '多产品归属不清。',
      },
    })

    expect(plan.shouldWrite).toBe(false)
    expect(plan.skipReason).toContain('人工复核')
  })
})
