import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NON_CATALOG_PRODUCT_IDS } from '../lib/product-visibility'

const originalSiteUrl = process.env.NEXT_PUBLIC_APP_URL
const findMany = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    product: {
      findMany,
    },
  },
}))

const { default: sitemap } = await import('../app/sitemap')

describe('sitemap product visibility', () => {
  beforeEach(() => {
    findMany.mockReset()
    process.env.NEXT_PUBLIC_APP_URL = 'https://testv.example.com'
  })

  afterEach(() => {
    if (originalSiteUrl === undefined) {
      delete process.env.NEXT_PUBLIC_APP_URL
    } else {
      process.env.NEXT_PUBLIC_APP_URL = originalSiteUrl
    }
  })

  it('excludes non-catalog products from product urls', async () => {
    findMany.mockResolvedValueOnce([
      {
        id: 'visible-product',
        updatedAt: new Date('2026-01-02T00:00:00Z'),
        video: {
          publishedAt: new Date('2026-01-01T00:00:00Z'),
        },
      },
    ])

    const entries = await sitemap()

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: {
          notIn: [...NON_CATALOG_PRODUCT_IDS],
        },
      },
    }))
    expect(entries.map((entry) => entry.url)).toContain('https://testv.example.com/products/visible-product')
    expect(entries.map((entry) => entry.url)).not.toContain('https://testv.example.com/products/cmqgahf74000980unhnz2nbjs')
  })
})
