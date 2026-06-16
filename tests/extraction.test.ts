import { describe, expect, it } from 'vitest'
import { finalizeExtraction } from '../lib/extraction'

describe('extraction finalization', () => {
  it('fills normalized score from scoreRaw when the model omits it', () => {
    const result = finalizeExtraction({
      productName: 'Test Camera',
      productNameZh: '测试相机',
      videoTitleZh: '测试相机测评',
      scoreRaw: '4.5 out of 5',
      pros: [' Sharp image '],
      cons: ['Expensive'],
      prosZh: ['画面清晰'],
      consZh: ['价格较高'],
      confidence: 0.8,
    })

    expect(result.normalizedScore).toBe(90)
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

    expect(result.normalizedScore).toBeNull()
    expect(result.scoreRaw).toBeNull()
  })
})
