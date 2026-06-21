import { beforeEach, describe, expect, it, vi } from 'vitest'

const findMany = vi.fn()

vi.mock('../lib/prisma', () => ({
  prisma: {
    product: {
      findMany,
    },
  },
}))

const { getProductCatalogPage } = await import('../lib/product-catalog')

function createProduct(input: {
  id: string
  productNameZh: string
  publishedAt: string
  scoreValue?: number | null
}) {
  return {
    id: input.id,
    productName: input.productNameZh,
    productNameZh: input.productNameZh,
    videoTitleZh: `${input.productNameZh} 测试`,
    scoreValue: input.scoreValue ?? null,
    scoreRaw: input.scoreValue == null ? null : `${input.scoreValue}/10`,
    priceRaw: null,
    priceValue: null,
    priceCurrency: null,
    priceType: null,
    priceContext: null,
    priceConfidence: null,
    confidence: 0.82,
    contentStatus: 'complete',
    prosZh: ['优点明确'],
    consZh: ['缺点明确'],
    video: {
      youtubeId: input.id,
      title: `${input.productNameZh} 测试`,
      publishedAt: new Date(input.publishedAt),
      thumbnailUrl: null,
      videoUrl: `https://www.youtube.com/watch?v=${input.id}`,
      transcripts: [],
    },
  }
}

describe('product catalog visibility', () => {
  beforeEach(() => {
    findMany.mockReset()
  })

  it('filters non-catalog products from totals and page ids', async () => {
    const visible = createProduct({
      id: 'visible-product',
      productNameZh: 'DJI Pocket 3 相机',
      publishedAt: '2026-01-02T00:00:00Z',
      scoreValue: 8,
    })
    const excluded = createProduct({
      id: 'cmqgahf74000980unhnz2nbjs',
      productNameZh: 'TESTV 2025年度总结',
      publishedAt: '2026-03-18T00:00:00Z',
    })

    findMany
      .mockResolvedValueOnce([visible])
      .mockResolvedValueOnce([visible])

    const result = await getProductCatalogPage({
      sort: 'date',
      q: '',
      page: 1,
      pageSize: 20,
      category: 'all',
    })

    expect(result.total).toBe(1)
    expect(result.products.map((product) => product.id)).toEqual(['visible-product'])
    expect(findMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: {
        id: {
          notIn: expect.arrayContaining([excluded.id]),
        },
      },
    }))
    expect(findMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: {
        id: {
          in: ['visible-product'],
        },
      },
    }))
  })

  it('keeps the exclusion when searching by keyword', async () => {
    findMany.mockResolvedValueOnce([])

    const result = await getProductCatalogPage({
      sort: 'date',
      q: '年度总结',
      page: 1,
      pageSize: 20,
      category: 'all',
    })

    expect(result.total).toBe(0)
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: {
          notIn: expect.arrayContaining(['cmqgahf74000980unhnz2nbjs']),
        },
        OR: expect.any(Array),
      }),
    }))
  })
})
