import 'dotenv/config'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type {
  PublicCatalogProduct,
  PublicCatalogSnapshot,
} from '../lib/public-catalog-store'

type PublicProductsApiResponse = {
  products: Array<Omit<PublicCatalogProduct, 'updatedAt' | 'affiliateLinks' | 'displayTranscriptParagraphs' | 'videoLinks'>>
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
}

const DEFAULT_TRANSCRIPT_FALLBACK = '\u6682\u65e0\u5b57\u5e55\u6587\u5b57\u7248\u3002'
const DETAIL_FETCH_CONCURRENCY = 8
const SEARCH_RECOVERY_TERMS = [
  '\u82f9\u679c',
  '\u534e\u4e3a',
  '\u5c0f\u7c73',
  '\u7ea2\u7c73',
  '\u7d22\u5c3c',
  '\u4e09\u661f',
  '\u5927\u7586',
  '\u4efb\u5929\u5802',
  '\u8033\u673a',
  '\u624b\u673a',
  '\u76f8\u673a',
  '\u5e73\u677f',
  '\u7535\u89c6',
]
const REQUEST_RETRY_COUNT = 8

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

async function fetchWithRetry(url: URL): Promise<Response> {
  let lastError: unknown

  for (let attempt = 1; attempt <= REQUEST_RETRY_COUNT; attempt += 1) {
    try {
      return await fetch(url)
    } catch (error) {
      lastError = error
      await sleep(500 * attempt)
    }
  }

  throw lastError
}

function isEnabled(value: string | undefined, fallback = false): boolean {
  if (!value) return fallback
  return value === '1' || value.toLowerCase() === 'true'
}

function getOutputPath(): string {
  return process.env.PUBLIC_CATALOG_PATH || path.join(process.cwd(), 'public-catalog', 'products.json')
}

function getSourceBaseUrl(): string {
  const value = (process.env.PUBLIC_CATALOG_SOURCE_URL || '').trim()
  if (!value) {
    throw new Error('PUBLIC_CATALOG_SOURCE_URL is required for public catalog recovery')
  }

  const url = new URL(value)
  url.pathname = ''
  url.search = ''
  url.hash = ''
  return url.origin
}

async function fetchProductsPage(baseUrl: string, page: number, pageSize: number): Promise<PublicProductsApiResponse> {
  const url = new URL('/api/products', baseUrl)
  url.searchParams.set('sort', 'date')
  url.searchParams.set('page', String(page))
  url.searchParams.set('pageSize', String(pageSize))

  const response = await fetchWithRetry(url)
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url.pathname}: HTTP ${response.status}`)
  }

  return await response.json() as PublicProductsApiResponse
}

async function fetchSearchMatches(baseUrl: string, term: string): Promise<Set<string>> {
  const matches = new Set<string>()
  let page = 1
  let totalPages = 1

  do {
    const url = new URL('/api/products', baseUrl)
    url.searchParams.set('q', term)
    url.searchParams.set('sort', 'score')
    url.searchParams.set('page', String(page))
    url.searchParams.set('pageSize', '50')

    const response = await fetchWithRetry(url)
    if (!response.ok) {
      throw new Error(`Failed to fetch search matches for ${term}: HTTP ${response.status}`)
    }

    const result = await response.json() as PublicProductsApiResponse
    for (const product of result.products) {
      matches.add(product.id)
    }
    totalPages = result.pagination.totalPages
    page += 1
  } while (page <= totalPages)

  return matches
}

async function fetchSitemapOrder(baseUrl: string): Promise<Map<string, number>> {
  const url = new URL('/sitemap.xml', baseUrl)
  const response = await fetchWithRetry(url)
  if (!response.ok) {
    throw new Error(`Failed to fetch sitemap order: HTTP ${response.status}`)
  }

  const order = new Map<string, number>()
  const html = await response.text()
  for (const match of html.matchAll(/<loc>(.*?)<\/loc>/g)) {
    const productId = /\/products\/([^/?#<]+)/.exec(match[1])?.[1]
    if (productId && !order.has(productId)) {
      order.set(productId, order.size)
    }
  }

  return order
}

async function tryFetchSitemapOrder(baseUrl: string): Promise<Map<string, number>> {
  try {
    return await fetchSitemapOrder(baseUrl)
  } catch (error) {
    console.warn('Failed to recover sitemap order; continuing without sitemapOrder:', error)
    return new Map<string, number>()
  }
}

function decodeHtmlText(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

function extractTranscriptParagraphs(html: string): string[] {
  const heading = html.match(/<h2[^>]*>\s*\u7eaf\u6587\u5b57\u7248\s*<\/h2>/u)
  if (!heading || heading.index === undefined) return []

  const sectionStart = heading.index
  const sectionEnd = html.indexOf('</section>', sectionStart)
  const section = html.slice(sectionStart, sectionEnd === -1 ? undefined : sectionEnd)
  const paragraphs: string[] = []

  for (const match of section.matchAll(/<p(?:\s[^>]*)?>([\s\S]*?)<\/p>/g)) {
    const text = decodeHtmlText(match[1].replace(/<[^>]+>/g, ''))
    if (text && text !== DEFAULT_TRANSCRIPT_FALLBACK) {
      paragraphs.push(text)
    }
  }

  return paragraphs
}

async function fetchTranscriptParagraphs(baseUrl: string, productId: string): Promise<string[]> {
  const url = new URL(`/products/${productId}`, baseUrl)
  const response = await fetchWithRetry(url)
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }

  return extractTranscriptParagraphs(await response.text())
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let nextIndex = 0

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await mapper(items[index], index)
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  )

  return results
}

function toRecoveredProduct(
  product: PublicProductsApiResponse['products'][number],
  displayTranscriptParagraphs: string[],
  searchIndex: string[],
  sitemapOrder: number | undefined,
): PublicCatalogProduct {
  return {
    ...product,
    updatedAt: product.video.publishedAt,
    affiliateLinks: [],
    displayTranscriptParagraphs,
    videoLinks: {
      youtube: product.video.videoUrl,
    },
    searchIndex,
    sitemapOrder,
  }
}

function validateSnapshot(snapshot: PublicCatalogSnapshot): string[] {
  const failures: string[] = []
  const productIds = new Set<string>()
  const youtubeIds = new Set<string>()

  for (const product of snapshot.products) {
    if (productIds.has(product.id)) {
      failures.push(`duplicate product id: ${product.id}`)
    }
    if (youtubeIds.has(product.video.youtubeId)) {
      failures.push(`duplicate youtube id: ${product.video.youtubeId}`)
    }
    productIds.add(product.id)
    youtubeIds.add(product.video.youtubeId)
  }

  return failures
}

async function main() {
  const dryRun = isEnabled(process.env.DRY_RUN)
  const recoverDetailTranscripts = isEnabled(process.env.RECOVER_DETAIL_TRANSCRIPTS, true)
  const baseUrl = getSourceBaseUrl()
  const pageSize = 50
  const firstPage = await fetchProductsPage(baseUrl, 1, pageSize)
  const products = [...firstPage.products]

  for (let page = 2; page <= firstPage.pagination.totalPages; page += 1) {
    const result = await fetchProductsPage(baseUrl, page, pageSize)
    products.push(...result.products)
  }

  let recoveredTranscriptCount = 0
  let missingTranscriptCount = 0
  const transcriptParagraphsByProductId = new Map<string, string[]>()
  const searchTermsByProductId = new Map<string, Set<string>>()
  const sitemapOrderByProductId = await tryFetchSitemapOrder(baseUrl)

  if (recoverDetailTranscripts) {
    await mapWithConcurrency(products, DETAIL_FETCH_CONCURRENCY, async (product, index) => {
      if ((index + 1) % 50 === 0 || index + 1 === products.length) {
        console.error(`Recovered detail transcripts ${index + 1}/${products.length}`)
      }

      try {
        const paragraphs = await fetchTranscriptParagraphs(baseUrl, product.id)
        if (paragraphs.length > 0) {
          recoveredTranscriptCount += 1
          transcriptParagraphsByProductId.set(product.id, paragraphs)
        } else {
          missingTranscriptCount += 1
          transcriptParagraphsByProductId.set(product.id, [DEFAULT_TRANSCRIPT_FALLBACK])
        }
      } catch (error) {
        missingTranscriptCount += 1
        console.error(`Failed to recover detail transcript for ${product.id}:`, error)
        transcriptParagraphsByProductId.set(product.id, [DEFAULT_TRANSCRIPT_FALLBACK])
      }
    })
  } else {
    missingTranscriptCount = products.length
    for (const product of products) {
      transcriptParagraphsByProductId.set(product.id, [DEFAULT_TRANSCRIPT_FALLBACK])
    }
  }

  for (const term of SEARCH_RECOVERY_TERMS) {
    const matches = await fetchSearchMatches(baseUrl, term)
    for (const productId of matches) {
      const terms = searchTermsByProductId.get(productId) || new Set<string>()
      terms.add(term)
      searchTermsByProductId.set(productId, terms)
    }
  }

  const snapshot: PublicCatalogSnapshot = {
    version: 1,
    generatedAt: new Date().toISOString(),
    source: {
      type: 'public-api-recovery',
      productCount: products.length,
      recoveredTranscriptCount,
      missingTranscriptCount,
      note: recoverDetailTranscripts
        ? 'Recovered from existing public products API responses and public detail pages because the maintenance database was unavailable.'
        : 'Recovered from an existing public products API response because the maintenance database was unavailable.',
    },
    products: products.map((product) => toRecoveredProduct(
      product,
      transcriptParagraphsByProductId.get(product.id) || [DEFAULT_TRANSCRIPT_FALLBACK],
      [...(searchTermsByProductId.get(product.id) || new Set<string>())],
      sitemapOrderByProductId.get(product.id),
    )),
  }

  const failures = validateSnapshot(snapshot)
  if (failures.length > 0) {
    console.error('Public catalog recovery failed validation:')
    for (const failure of failures.slice(0, 80)) {
      console.error(`- ${failure}`)
    }
    if (failures.length > 80) {
      console.error(`- ... ${failures.length - 80} more`)
    }
    process.exitCode = 1
    return
  }

  const outputPath = getOutputPath()
  console.log(JSON.stringify({
    dryRun,
    outputPath,
    products: snapshot.products.length,
    expectedTotal: firstPage.pagination.total,
    recoveredTranscriptCount,
    missingTranscriptCount,
    generatedAt: snapshot.generatedAt,
  }, null, 2))

  if (dryRun) return

  await mkdir(path.dirname(outputPath), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
