import { createElement, type AnchorHTMLAttributes, type ImgHTMLAttributes } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import ProductCard from '../app/components/ProductCard'

vi.mock('@/lib/scoring', () => ({
  formatScoreValue: (score: number | null) => (score == null ? '-' : `${score}`),
}))

vi.mock('next/image', () => ({
  default: (props: ImgHTMLAttributes<HTMLImageElement>) => {
    const { alt, src } = props
    return createElement('span', {
      'data-alt': alt,
      'data-src': typeof src === 'string' ? src : '',
    })
  },
}))

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    createElement('a', { href, ...props }, children)
  ),
}))

describe('ProductCard', () => {
  it('renders only one public score value on the homepage card', () => {
    const html = renderToStaticMarkup(
      createElement(ProductCard, {
        product: {
          id: 'product-1',
          displayName: '便携式显示器',
          displayVideoTitle: '便携式显示器测评',
          scoreRaw: '9/10',
          scoreValue: 9,
          displayPrice: '899元',
          priceRaw: '售价899元',
          priceValue: 899,
          priceCurrency: 'CNY',
          priceType: 'listed',
          priceContext: '这台便携式显示器售价899元。',
          priceConfidence: 0.86,
          displayPros: ['色彩表现明亮'],
          displayCons: ['屏幕反光比较明显'],
          prosCount: 1,
          consCount: 1,
          confidence: 0.9,
          contentStatus: 'complete',
          statusLabel: '信息完整',
          statusDescription: '已整理评分、优点和缺点。',
          hasTranscript: true,
          categoryKey: 'office-peripheral',
          categoryLabel: '办公/外设',
          video: {
            youtubeId: 'abc123',
            publishedAt: '2026-06-01T00:00:00.000Z',
            thumbnailUrl: null,
            videoUrl: 'https://www.youtube.com/watch?v=abc123',
          },
        },
      }),
    )

    expect(html).toContain('/ 10')
    expect(html).not.toContain('9/10')
    expect(html).not.toContain('视频提到价')
    expect(html).not.toContain('售价899元')
    expect(html).toContain('899元')
  })

  it('renders homepage counts from shared candidate totals', () => {
    const html = renderToStaticMarkup(
      createElement(ProductCard, {
        product: {
          id: 'product-2',
          displayName: '蓝牙耳机',
          displayVideoTitle: '蓝牙耳机测评',
          scoreRaw: null,
          scoreValue: null,
          displayPrice: '',
          priceRaw: null,
          priceValue: null,
          priceCurrency: null,
          priceType: null,
          priceContext: null,
          priceConfidence: null,
          displayPros: ['优点整理中。'],
          displayCons: ['缺点整理中。'],
          prosCount: 0,
          consCount: 0,
          confidence: null,
          contentStatus: 'partial',
          statusLabel: '部分待补全',
          statusDescription: '已有字幕，部分字段仍在补全。',
          hasTranscript: true,
          categoryKey: 'audio',
          categoryLabel: '耳机/音频',
          video: {
            youtubeId: 'xyz789',
            publishedAt: '2026-06-02T00:00:00.000Z',
            thumbnailUrl: null,
            videoUrl: 'https://www.youtube.com/watch?v=xyz789',
          },
        },
      }),
    )

    expect(html).toContain('优点')
    expect(html).toContain('缺点')
    expect(html).toContain('0 条')
    expect(html).toContain('耳机/音频')
    expect(html).not.toContain('视频未提到价格')
    expect(html).not.toContain('视频提到价')
  })
})
