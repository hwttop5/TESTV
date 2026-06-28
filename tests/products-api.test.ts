import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PublicCatalogProduct, PublicCatalogSnapshot } from '../lib/public-catalog-store'

const originalCatalogPath = process.env.PUBLIC_CATALOG_PATH
let tempDir = ''

function createProduct(input: {
  id: string
  displayName: string
  publishedAt: string
}): PublicCatalogProduct {
  return {
    id: input.id,
    displayName: input.displayName,
    displayVideoTitle: `${input.displayName} 测评`,
    scoreRaw: '8.6/10',
    scoreValue: 8.6,
    displayPrice: '899元',
    priceRaw: '售价899元',
    priceValue: 899,
    priceCurrency: 'CNY',
    priceType: 'listed',
    priceContext: '视频中提到售价899元。',
    priceConfidence: 0.82,
    displayPros: ['优点明确'],
    displayCons: ['缺点明确'],
    prosCount: 1,
    consCount: 1,
    confidence: 0.9,
    contentStatus: 'complete',
    statusLabel: '信息完整',
    statusDescription: '',
    hasTranscript: true,
    categoryKey: 'office-peripheral',
    categoryLabel: '办公/外设',
    video: {
      youtubeId: input.id,
      publishedAt: input.publishedAt,
      thumbnailUrl: null,
      videoUrl: `https://www.youtube.com/watch?v=${input.id}`,
    },
    displayTranscriptParagraphs: Array.from({ length: 20 }, (_, index) => `第 ${index + 1} 段字幕。`),
    videoLinks: {
      youtube: `https://www.youtube.com/watch?v=${input.id}`,
    },
    updatedAt: input.publishedAt,
    affiliateLinks: [
      {
        id: 'link-1',
        platform: 'jd',
        url: 'https://example.com/product',
      },
    ],
    searchIndex: ['测试搜索词'],
  }
}

function writeSnapshot(products: PublicCatalogProduct[]) {
  tempDir = mkdtempSync(path.join(tmpdir(), 'testv-products-api-'))
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

describe('/api/products', () => {
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

  it('returns paginated list summaries without detail-only fields', async () => {
    writeSnapshot([
      createProduct({
        id: 'summary-product',
        displayName: '便携式显示器',
        publishedAt: '2026-01-02T00:00:00.000Z',
      }),
    ])

    const { GET } = await import('../app/api/products/route')
    const response = await GET(new NextRequest('http://test.local/api/products?sort=date'))
    const body = await response.json()
    const item = body.products[0] as Record<string, unknown>

    expect(response.status).toBe(200)
    expect(body.pagination).toMatchObject({
      page: 1,
      pageSize: 20,
      total: 1,
      totalPages: 1,
    })
    expect(item).toHaveProperty('displayName', '便携式显示器')
    expect(item).toHaveProperty('displayPros')
    expect(item).toHaveProperty('displayCons')
    expect(item).not.toHaveProperty('displayTranscriptParagraphs')
    expect(item).not.toHaveProperty('videoLinks')
    expect(item).not.toHaveProperty('affiliateLinks')
    expect(item).not.toHaveProperty('searchIndex')
    expect(item).not.toHaveProperty('updatedAt')
  })
})
