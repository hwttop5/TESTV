import { describe, expect, it } from 'vitest'
import { finalizeExtraction, extractProductInfo } from '../lib/extraction'

describe('extraction finalization', () => {
  it('fills score fields from scoreRaw when the model omits them', () => {
    const result = finalizeExtraction({
      productName: 'Test Camera',
      productNameZh: '测试相机',
      videoTitleZh: '测试相机测评',
      scoreRaw: '4.5 out of 5',
      priceRaw: '售价899元',
      priceValue: 899,
      priceCurrency: 'CNY',
      priceType: 'listed',
      priceContext: '测试相机售价899元。',
      priceConfidence: 0.9,
      pros: [' Sharp image '],
      cons: ['Expensive'],
      prosZh: ['画面清晰'],
      consZh: ['价格较高'],
      confidence: 0.8,
    })

    expect(result.scoreRaw).toBe('4.5 out of 5')
    expect(result.scoreValue).toBe(4.5)
    expect(result.scoreScale).toBe('5')
    expect(result.priceRaw).toBe('售价899元')
    expect(result.priceValue).toBe(899)
    expect(result.priceCurrency).toBe('CNY')
    expect(result.priceType).toBe('listed')
    expect(result.pros).toEqual(['Sharp image'])
    expect(result.cons).toEqual(['Expensive'])
    expect(result.prosZh).toEqual(['画面清晰'])
    expect(result.consZh).toEqual(['价格较高'])
  })

  it('keeps score empty when there is no explicit score', () => {
    const result = finalizeExtraction({
      productName: 'Test Speaker',
      pros: ['Compact'],
      cons: ['Thin bass'],
      confidence: 0.7,
    })

    expect(result.scoreValue).toBeNull()
    expect(result.scoreScale).toBeNull()
    expect(result.scoreRaw).toBeNull()
    expect(result.priceValue).toBeNull()
    expect(result.priceRaw).toBeNull()
  })

  it('falls back to rules when no API key is available', async () => {
    const result = await extractProductInfo(
      '米家台式净饮机制冰版 TESTV主观综合评分8分。米家台式净饮机制冰版售价2499元。论价格，小米这款虽然不便宜，但在制冰净饮机这个品类里，也算是性价比很高的了。它设计简约，功能简单，过滤热水制冰有一些小毛病，但也不是不能接受。',
      {
        videoTitle: '多少有点大冰-米家净饮机制冰版【值不值得买第730期】',
        transcriptSegments: [
          { text: '米家台式净饮机制冰版', start: 675.859, duration: 2.141 },
          { text: 'TESTV主观综合评分8分', start: 678.099, duration: 2.421 },
          { text: '米家台式净饮机制冰版售价2499元。', start: 620.979, duration: 2 },
          { text: '论价格，小米这款虽然不便宜，但在制冰净饮机这个品类里，也算是性价比很高的了。', start: 622.979, duration: 2 },
          { text: '它设计简约，功能简单，过滤热水制冰有一些小毛病，但也不是不能接受。', start: 629.26, duration: 2.18 },
        ],
      }
    )

    expect(result.scoreRaw).toBe('8/10')
    expect(result.scoreValue).toBe(8)
    expect(result.scoreScale).toBe('10')
    expect(result.priceValue).toBe(2499)
    expect(result.priceRaw).toBe('售价2499元')
    expect(result.productNameZh).toContain('米家')
    expect(result.prosZh.length).toBeGreaterThan(0)
    expect(result.consZh.length).toBeGreaterThan(0)
  })
})
