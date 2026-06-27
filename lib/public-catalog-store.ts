import { readFileSync } from 'node:fs'
import defaultPublicCatalogSnapshot from '../public-catalog/products.json'
import type { ProductDetail } from './review-types'

export interface PublicCatalogAffiliateLink {
  id: string
  platform: string
  url: string | null
}

export interface PublicCatalogProduct extends ProductDetail {
  updatedAt: string
  affiliateLinks: PublicCatalogAffiliateLink[]
  searchIndex?: string[]
  sitemapOrder?: number
}

export interface PublicCatalogSnapshot {
  version: 1
  generatedAt: string | null
  source: {
    type: string
    note?: string
    [key: string]: unknown
  }
  products: PublicCatalogProduct[]
}

let cachedSnapshot: PublicCatalogSnapshot | null = null

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function assertSnapshot(value: unknown): asserts value is PublicCatalogSnapshot {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.products)) {
    throw new Error('Invalid public catalog snapshot: expected version 1 with products array')
  }

  const productIds = new Set<string>()
  const youtubeIds = new Set<string>()

  for (const product of value.products) {
    if (!isRecord(product) || typeof product.id !== 'string' || !isRecord(product.video)) {
      throw new Error('Invalid public catalog snapshot: product records must include id and video')
    }

    const youtubeId = product.video.youtubeId
    if (typeof youtubeId !== 'string') {
      throw new Error(`Invalid public catalog snapshot: product ${product.id} is missing video.youtubeId`)
    }

    if (productIds.has(product.id)) {
      throw new Error(`Invalid public catalog snapshot: duplicate product id ${product.id}`)
    }
    if (youtubeIds.has(youtubeId)) {
      throw new Error(`Invalid public catalog snapshot: duplicate youtube id ${youtubeId}`)
    }

    productIds.add(product.id)
    youtubeIds.add(youtubeId)
  }
}

export function loadPublicCatalogSnapshot(): PublicCatalogSnapshot {
  if (cachedSnapshot) return cachedSnapshot

  const parsed = process.env.PUBLIC_CATALOG_PATH
    ? JSON.parse(readFileSync(process.env.PUBLIC_CATALOG_PATH, 'utf8')) as unknown
    : defaultPublicCatalogSnapshot

  assertSnapshot(parsed)
  cachedSnapshot = parsed
  return cachedSnapshot
}

export function getPublicCatalogProducts(): PublicCatalogProduct[] {
  return loadPublicCatalogSnapshot().products
}

export function getPublicCatalogProduct(id: string): PublicCatalogProduct | null {
  return getPublicCatalogProducts().find((product) => product.id === id) || null
}

export function getPublicCatalogProductCount(): number {
  return getPublicCatalogProducts().length
}

export function clearPublicCatalogCacheForTests(): void {
  cachedSnapshot = null
}
