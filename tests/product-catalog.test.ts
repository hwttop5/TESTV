import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PublicCatalogProduct, PublicCatalogSnapshot } from '../lib/public-catalog-store'

const originalCatalogPath = process.env.PUBLIC_CATALOG_PATH
let tempDir = ''

function createProduct(input: {
  id: string
  displayName: string
  publishedAt: string
  scoreValue?: number | null
  categoryKey?: PublicCatalogProduct['categoryKey']
  displayVideoTitle?: string
  searchIndex?: string[]
}): PublicCatalogProduct {
  const scoreValue = input.scoreValue ?? null

  return {
    id: input.id,
    displayName: input.displayName,
    displayVideoTitle: input.displayVideoTitle || `${input.displayName} 测试`,
    scoreRaw: scoreValue == null ? null : `${scoreValue}/10`,
    scoreValue,
    displayPrice: '',
    priceRaw: null,
    priceValue: null,
    priceCurrency: null,
    priceType: null,
    priceContext: null,
    priceConfidence: null,
    displayPros: ['优点明确'],
    displayCons: ['缺点明确'],
    prosCount: 1,
    consCount: 1,
    confidence: 0.82,
    contentStatus: 'complete',
    statusLabel: '信息完整',
    statusDescription: '',
    hasTranscript: true,
    categoryKey: input.categoryKey ?? 'lifestyle-other',
    categoryLabel: input.categoryKey === 'phone' ? '手机' : '生活/其他',
    video: {
      youtubeId: input.id,
      publishedAt: input.publishedAt,
      thumbnailUrl: null,
      videoUrl: `https://www.youtube.com/watch?v=${input.id}`,
    },
    displayTranscriptParagraphs: ['测试字幕段落。'],
    videoLinks: {
      youtube: `https://www.youtube.com/watch?v=${input.id}`,
    },
    updatedAt: input.publishedAt,
    affiliateLinks: [],
    searchIndex: input.searchIndex,
  }
}

function writeSnapshot(products: PublicCatalogProduct[]) {
  tempDir = mkdtempSync(path.join(tmpdir(), 'testv-public-catalog-'))
  const snapshotPath = path.join(tempDir, 'products.json')
  const snapshot: PublicCatalogSnapshot = {
    version: 1,
    generatedAt: '2026-01-01T00:00:00.000Z',
    source: { type: 'test' },
    products,
  }

  writeFileSync(snapshotPath, `${JSON.stringify(snapshot)}\n`, 'utf8')
  process.env.PUBLIC_CATALOG_PATH = snapshotPath
}

describe('product catalog visibility', () => {
  beforeEach(() => {
    tempDir = ''
    vi.resetModules()
  })

  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true })
    if (originalCatalogPath === undefined) {
      delete process.env.PUBLIC_CATALOG_PATH
    } else {
      process.env.PUBLIC_CATALOG_PATH = originalCatalogPath
    }
    vi.resetModules()
  })

  it('filters non-catalog products from totals and page ids', async () => {
    const visible = createProduct({
      id: 'visible-product',
      displayName: 'DJI Pocket 3 相机',
      publishedAt: '2026-01-02T00:00:00.000Z',
      scoreValue: 8,
    })
    const excluded = createProduct({
      id: 'cmqgahf74000980unhnz2nbjs',
      displayName: 'TESTV 2025 年度总结',
      publishedAt: '2026-03-18T00:00:00.000Z',
    })

    writeSnapshot([excluded, visible])

    const { getProductCatalogPage } = await import('../lib/product-catalog')
    const result = await getProductCatalogPage({
      sort: 'date',
      q: '',
      page: 1,
      pageSize: 20,
      category: 'all',
    })

    expect(result.total).toBe(1)
    expect(result.products.map((product) => product.id)).toEqual(['visible-product'])

    const item = result.products[0] as Record<string, unknown>
    expect(item).toHaveProperty('displayName', 'DJI Pocket 3 相机')
    expect(item).toHaveProperty('displayPros')
    expect(item).not.toHaveProperty('displayTranscriptParagraphs')
    expect(item).not.toHaveProperty('videoLinks')
    expect(item).not.toHaveProperty('affiliateLinks')
    expect(item).not.toHaveProperty('searchIndex')
    expect(item).not.toHaveProperty('updatedAt')
  })

  it('keeps the exclusion when searching by keyword', async () => {
    writeSnapshot([
      createProduct({
        id: 'cmqgahf74000980unhnz2nbjs',
        displayName: 'TESTV 2025 年度总结',
        publishedAt: '2026-03-18T00:00:00.000Z',
      }),
    ])

    const { getProductCatalogPage } = await import('../lib/product-catalog')
    const result = await getProductCatalogPage({
      sort: 'date',
      q: '年度总结',
      page: 1,
      pageSize: 20,
      category: 'all',
    })

    expect(result.total).toBe(0)
    expect(result.products).toEqual([])
  })

  it('sorts by score with nulls last and filters by exported category', async () => {
    writeSnapshot([
      createProduct({
        id: 'old-phone',
        displayName: '旧手机',
        publishedAt: '2026-01-01T00:00:00.000Z',
        scoreValue: null,
        categoryKey: 'phone',
      }),
      createProduct({
        id: 'new-camera',
        displayName: '新相机',
        publishedAt: '2026-03-01T00:00:00.000Z',
        scoreValue: 9.1,
      }),
      createProduct({
        id: 'good-phone',
        displayName: '好手机',
        publishedAt: '2026-02-01T00:00:00.000Z',
        scoreValue: 8.8,
        categoryKey: 'phone',
      }),
    ])

    const { getProductCatalogPage } = await import('../lib/product-catalog')
    const result = await getProductCatalogPage({
      sort: 'score',
      q: '',
      page: 1,
      pageSize: 20,
      category: 'phone',
    })

    expect(result.total).toBe(2)
    expect(result.products.map((product) => product.id)).toEqual(['good-phone', 'old-phone'])
  })

  it('keeps search compatible with the old product-name Prisma scope', async () => {
    writeSnapshot([
      createProduct({
        id: 'apple-in-title-only',
        displayName: 'AirPods 4 ANC',
        displayVideoTitle: 'Apple keyword only in video title',
        publishedAt: '2026-01-01T00:00:00.000Z',
      }),
      createProduct({
        id: 'apple-youtube-id-only',
        displayName: 'Wireless Earbuds',
        publishedAt: '2026-01-02T00:00:00.000Z',
      }),
      createProduct({
        id: 'product-name-match',
        displayName: 'iPhone 16 Pro',
        publishedAt: '2026-01-03T00:00:00.000Z',
        searchIndex: ['苹果 iPhone 16 Pro'],
      }),
    ])

    const { getProductCatalogPage } = await import('../lib/product-catalog')
    const englishResult = await getProductCatalogPage({
      sort: 'date',
      q: 'apple',
      page: 1,
      pageSize: 20,
      category: 'all',
    })

    expect(englishResult.total).toBe(0)

    const chineseResult = await getProductCatalogPage({
      sort: 'date',
      q: '苹果',
      page: 1,
      pageSize: 20,
      category: 'all',
    })

    expect(chineseResult.total).toBe(1)
    expect(chineseResult.products.map((product) => product.id)).toEqual(['product-name-match'])
  })
})
