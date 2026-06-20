import { describe, expect, it } from 'vitest'
import {
  extractPriceFromTranscript,
  formatDisplayPrice,
  normalizeAiPriceExtractionResult,
} from '../lib/price-extraction'

describe('price extraction', () => {
  it('extracts listed yuan prices from transcript text', () => {
    const result = extractPriceFromTranscript({
      productNameZh: '小米空气净化器2S',
      transcript: '小米空气净化器2S 这款机器售价899元，过滤效果还不错。',
    })

    expect(result).toMatchObject({
      priceRaw: '售价899元',
      priceValue: 899,
      priceCurrency: 'CNY',
      priceType: 'listed',
    })
  })

  it('extracts approximate prices', () => {
    const result = extractPriceFromTranscript({
      productNameZh: '索尼积木音箱',
      transcript: '索尼积木音箱的价格接近4000元，设计很特别。',
    })

    expect(result?.priceValue).toBe(4000)
    expect(result?.priceRaw).toContain('接近4000元')
    expect(result?.priceType).toBe('approximate')
  })

  it('extracts symbol prices', () => {
    const result = extractPriceFromTranscript({
      productNameZh: '绿联 DX4600 NAS',
      transcript: '绿联 DX4600 NAS 到手价 ¥1999，适合家用备份。',
    })

    expect(result?.priceValue).toBe(1999)
    expect(result?.priceRaw).toContain('到手价')
  })

  it('does not extract durations, quantities, discounts, or scores as product prices', () => {
    const text = '这段测试 10 分钟，里面有 5 个配件，综合评分 7.5 分，优惠便宜了 500 块。'

    expect(extractPriceFromTranscript({
      productNameZh: '测试产品',
      transcript: text,
    })).toBeNull()
  })

  it('does not extract foreign currency, dimensions, deltas, or accessory lists as product prices', () => {
    const samples = [
      'HomePod 目前售价为 349 美元，海淘大约 2500 元人民币。',
      '目前价格 36 毫米 1988 元，40 毫米 2108 元。',
      '两者价格差了 2000 块。',
      '快门线 168 元，摄影包 1399 元，所有配件原价53863元。',
      '新款电池官方售价749，续航表现不错。',
      '原价299元，618价格178元，随手拽全功能数据线原价69元。',
    ]

    for (const transcript of samples) {
      expect(extractPriceFromTranscript({
        productNameZh: '测试产品',
        transcript,
      })).toBeNull()
    }
  })

  it('skips collection videos by default', () => {
    expect(extractPriceFromTranscript({
      productNameZh: 'HIFI发烧入坑？设备安利大合集',
      transcript: '售价 1099 元。解码耳放一体，造型小巧。',
    })).toBeNull()

    expect(extractPriceFromTranscript({
      productNameZh: '寝室好物？废物！20-200元',
      transcript: '小熊迷你洗衣机 178 元，另一个台灯 69 元。',
    })).toBeNull()
  })

  it('prefers product-name-adjacent price candidates', () => {
    const result = extractPriceFromTranscript({
      productNameZh: '小米空气净化器2S',
      transcript: '其他产品售价1999元。小米空气净化器2S 的售价899元，性价比更高。',
    })

    expect(result?.priceValue).toBe(899)
  })

  it('formats fallback display price', () => {
    expect(formatDisplayPrice({ priceValue: 6499 })).toBe('6499元')
    expect(formatDisplayPrice({ priceRaw: '售价6499元', priceValue: 6499 })).toBe('6499元')
    expect(formatDisplayPrice({ priceRaw: '原价3.2万元' })).toBe('32000元')
    expect(formatDisplayPrice({})).toBe('')
  })

  it('normalizes AI price extraction JSON', () => {
    expect(normalizeAiPriceExtractionResult({
      hasPrice: true,
      priceRaw: '售价899元',
      priceValue: 899,
      priceCurrency: 'CNY',
      priceType: 'listed',
      priceContext: '这台便携式显示器售价899元。',
      priceConfidence: 0.86,
    })).toMatchObject({
      priceRaw: '售价899元',
      priceValue: 899,
      priceCurrency: 'CNY',
      priceType: 'listed',
      priceContext: '这台便携式显示器售价899元。',
      priceConfidence: 0.86,
    })

    expect(normalizeAiPriceExtractionResult({
      hasPrice: true,
      priceRaw: '原价3.2万元',
      priceValue: null,
      priceCurrency: 'CNY',
      priceType: 'original',
      priceContext: '它的原价3.2万元。',
      priceConfidence: 0.9,
    })?.priceValue).toBe(32000)
  })

  it('rejects AI results without confirmed yuan prices', () => {
    expect(normalizeAiPriceExtractionResult({ hasPrice: false })).toBeNull()
    expect(normalizeAiPriceExtractionResult({
      hasPrice: true,
      priceRaw: '349 美元',
      priceValue: 349,
      priceCurrency: 'USD',
      priceType: 'listed',
      priceConfidence: 0.8,
    })).toBeNull()
    expect(normalizeAiPriceExtractionResult({
      hasPrice: true,
      priceRaw: '99美元',
      priceValue: 708.3,
      priceCurrency: 'CNY',
      priceType: 'mentioned',
      priceContext: '作为一个卖价99美元的手柄',
      priceConfidence: 0.98,
    })).toBeNull()
    expect(normalizeAiPriceExtractionResult({
      hasPrice: true,
      priceRaw: '优惠 20 元',
      priceValue: 20,
      priceCurrency: 'CNY',
      priceType: 'mentioned',
      priceConfidence: 0.8,
    })).toBeNull()
  })
})
