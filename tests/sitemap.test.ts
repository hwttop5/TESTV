import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PublicCatalogProduct, PublicCatalogSnapshot } from '../lib/public-catalog-store'

const originalSiteUrl = process.env.NEXT_PUBLIC_APP_URL
const originalCatalogPath = process.env.PUBLIC_CATALOG_PATH
let tempDir = ''

function createProduct(id: string, sitemapOrder?: number): PublicCatalogProduct {
  return {
    id,
    displayName: id,
    displayVideoTitle: `${id} 测试`,
    scoreRaw: null,
    scoreValue: null,
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
    confidence: 0.8,
    contentStatus: 'complete',
    statusLabel: '信息完整',
    statusDescription: '',
    hasTranscript: true,
    categoryKey: 'lifestyle-other',
    categoryLabel: '生活/其他',
    video: {
      youtubeId: id,
      publishedAt: '2026-01-01T00:00:00.000Z',
      thumbnailUrl: null,
      videoUrl: `https://www.youtube.com/watch?v=${id}`,
    },
    displayTranscriptParagraphs: ['测试字幕段落。'],
    videoLinks: {
      youtube: `https://www.youtube.com/watch?v=${id}`,
    },
    updatedAt: '2026-01-02T00:00:00.000Z',
    affiliateLinks: [],
    sitemapOrder,
  }
}

function writeSnapshot(products: PublicCatalogProduct[]) {
  tempDir = mkdtempSync(path.join(tmpdir(), 'testv-sitemap-catalog-'))
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

describe('sitemap product visibility', () => {
  beforeEach(() => {
    tempDir = ''
    process.env.NEXT_PUBLIC_APP_URL = 'https://testv.example.com'
    vi.resetModules()
  })

  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true })
    if (originalSiteUrl === undefined) {
      delete process.env.NEXT_PUBLIC_APP_URL
    } else {
      process.env.NEXT_PUBLIC_APP_URL = originalSiteUrl
    }
    if (originalCatalogPath === undefined) {
      delete process.env.PUBLIC_CATALOG_PATH
    } else {
      process.env.PUBLIC_CATALOG_PATH = originalCatalogPath
    }
    vi.resetModules()
  })

  it('excludes non-catalog products from product urls', async () => {
    writeSnapshot([
      createProduct('visible-product'),
      createProduct('cmqgahf74000980unhnz2nbjs'),
    ])

    const { default: sitemap } = await import('../app/sitemap')
    const entries = await sitemap()

    expect(entries.map((entry) => entry.url)).toContain('https://testv.example.com/products/visible-product')
    expect(entries.map((entry) => entry.url)).not.toContain('https://testv.example.com/products/cmqgahf74000980unhnz2nbjs')
  })

  it('uses recovered sitemap order for products with the same published date', async () => {
    writeSnapshot([
      createProduct('second-product', 2),
      createProduct('first-product', 1),
    ])

    const { default: sitemap } = await import('../app/sitemap')
    const entries = await sitemap()

    expect(entries.map((entry) => entry.url)).toEqual([
      'https://testv.example.com/',
      'https://testv.example.com/products/first-product',
      'https://testv.example.com/products/second-product',
    ])
  })
})
