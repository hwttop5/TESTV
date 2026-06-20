import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  refineOpinionSummary,
  resolveProductVideoLinks,
  simplifyOpinionLine,
} from '../lib/product-detail-runtime'

describe('product detail runtime helpers', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('compresses verbose opinion lines into short conclusions', () => {
    expect(simplifyOpinionLine('不过它的重量还是偏大，长时间背着会累，日常通勤会有一点压力。')).toBe('重量还是偏大')
    expect(simplifyOpinionLine('我觉得自动模式其实很稳，而且日常用起来非常省心。')).toBe('自动模式其实很稳')
    expect(simplifyOpinionLine('不是吧我就拿来在裤兜里揣了两下，这个塑料机身就有划痕了，做工确实不太行。')).toBe('做工确实不太行')
  })

  it('falls back to local rewrite when no usable API key is configured', async () => {
    const result = await refineOpinionSummary({
      productName: '便携式显示器',
      videoTitle: '便携式显示器测评',
      pros: ['我觉得屏幕亮度其实够用，而且日常办公很省心。'],
      cons: ['不过它的反光还是比较明显，户外看会吃亏。'],
      apiKey: 'your_openai_api_key_here',
    })

    expect(result.source).toBe('local')
    expect(result.pros).toEqual(['屏幕亮度其实够用'])
    expect(result.cons).toEqual(['反光还是比较明显'])
  })

  it('limits local fallback to at most three items per side', async () => {
    const result = await refineOpinionSummary({
      productName: '蓝牙耳机',
      videoTitle: '蓝牙耳机测评',
      pros: ['降噪很强，而且通勤很省心。', '连接稳定，切换设备也快。', '佩戴舒服，长时间戴着也不累。', '续航也不错。'],
      cons: ['价格偏贵。', '塑料感有点重。', '机盖松动明显。', '人声降噪一般。'],
      apiKey: 'your_openai_api_key_here',
    })

    expect(result.pros).toHaveLength(3)
    expect(result.cons).toHaveLength(3)
  })

  it('uses AI rewrite when a usable key is provided and preserves counts', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                pros: ['亮度够用', '连接方便'],
                cons: ['反光明显'],
              }),
            },
          },
        ],
      }),
    }))

    const result = await refineOpinionSummary({
      productName: '便携式显示器',
      videoTitle: '便携式显示器测评',
      pros: ['屏幕亮度其实够用，而且日常办公很省心。', 'USB-C 连接简单，切换很方便。'],
      cons: ['不过它的反光还是比较明显，户外看会吃亏。'],
      apiKey: 'test-key',
      baseUrl: 'https://example.com/v1',
      model: 'gpt-4o-mini',
    })

    expect(result.source).toBe('ai')
    expect(result.pros).toEqual(['亮度够用', '连接方便'])
    expect(result.cons).toEqual(['反光明显'])
  })

  it('returns a bilibili link only when matcher succeeds with a high-confidence result', async () => {
    const links = await resolveProductVideoLinks({
      youtube: 'https://www.youtube.com/watch?v=abc123',
      title: '请把iPhone16 Pro卖给真正需要的人【值不值得买第671期】',
      matcher: vi.fn().mockResolvedValue({
        query: '值不值得买 第671期',
        score: 182,
        bvid: 'BV1xx411c7mD',
        aid: 12345,
        title: '请把iPhone16 Pro卖给真正需要的人【值不值得买第671期】',
        author: 'TESTV官方频道',
        mid: 11336264,
        url: 'https://www.bilibili.com/video/BV1xx411c7mD',
        confidence: 'high',
        episodeMatched: true,
        titleOverlap: 0.74,
        preferredMidMatched: true,
      }),
      timeoutMs: 100,
    })

    expect(links).toEqual({
      youtube: 'https://www.youtube.com/watch?v=abc123',
      bilibili: 'https://www.bilibili.com/video/BV1xx411c7mD',
    })
  })

  it('hides the bilibili link when matcher fails or times out', async () => {
    const links = await resolveProductVideoLinks({
      youtube: 'https://www.youtube.com/watch?v=abc123',
      title: 'iPhone 16 值不值得买',
      matcher: vi.fn().mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve(null), 50)),
      ),
      timeoutMs: 10,
    })

    expect(links).toEqual({
      youtube: 'https://www.youtube.com/watch?v=abc123',
    })
  })
})
