export const DEFAULT_DEV_SITE_URL = 'http://localhost:3000'
export const DEFAULT_PROD_SITE_URL = 'https://example.test'
const SITE_NAME = 'TESTV值不值得买'
const SITE_DESCRIPTION = 'TESTV 产品评测目录，收录视频评分、优缺点、文字版和购买参考，支持搜索、分类筛选和按评分排序。'
const SITE_KEYWORDS = [
  'TESTV',
  '值不值得买',
  '产品评测',
  '数码产品',
  '产品评分',
  '购买建议',
  '视频文字版',
]

export function getSiteUrl(): string {
  const configured = (process.env.NEXT_PUBLIC_APP_URL || '').trim()
  const fallback = process.env.NODE_ENV === 'production' ? DEFAULT_PROD_SITE_URL : DEFAULT_DEV_SITE_URL
  const value = configured || fallback

  try {
    const url = new URL(value)
    return url.origin.replace(/\/+$/, '')
  } catch {
    return fallback
  }
}

export function absoluteUrl(path = '/'): string {
  const base = getSiteUrl()
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return `${base}${normalizedPath}`
}

export function absoluteImageUrl(value: string | null | undefined, fallback = '/opengraph-image'): string {
  const image = (value || fallback).trim()
  if (!image) return absoluteUrl(fallback)

  try {
    return new URL(image).toString()
  } catch {
    return absoluteUrl(image)
  }
}

export function canonicalUrl(path = '/'): string {
  const url = new URL(absoluteUrl(path))
  url.search = ''
  url.hash = ''
  const value = url.toString()
  return value.endsWith('/') && url.pathname !== '/' ? value.slice(0, -1) : value
}

export function jsonLdScript(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c')
}

export function truncateMetaDescription(value: string, maxLength = 155): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) return normalized
  return normalized.slice(0, maxLength - 1).replace(/[，。！？；：,.!?;:\s]+$/u, '')
}

/**
 * Build the canonical URL for the home/listing page.
 *
 * Only `category` and `page` define distinct indexable content, so they are
 * preserved. Volatile facets (`q`, `sort`, `pageSize`) are dropped to avoid
 * duplicate-content variants competing for the same ranking.
 */
export function buildHomeCanonical(options: { category?: string; page?: number } = {}): string {
  const params = new URLSearchParams()

  if (options.category && options.category !== 'all') {
    params.set('category', options.category)
  }

  if (options.page && options.page > 1) {
    params.set('page', String(options.page))
  }

  const base = canonicalUrl('/')
  const query = params.toString()
  return query ? `${base}?${query}` : base
}

/** Derive a plausible brand from a product name, or undefined for CJK-only names. */
export function deriveBrandName(name: string): string | undefined {
  const match = name.match(/^[A-Za-z][A-Za-z0-9&.\-]*(?:\s+[A-Za-z0-9&.\-]+)?/)
  const token = match?.[0]?.trim().split(/\s+/)[0]
  return token && token.length >= 2 ? token : undefined
}

export function buildHomeDescription(options: {
  total?: number
  categoryLabel?: string
  q?: string
} = {}): string {
  const parts = [
    'TESTV 产品评测目录',
    options.total ? `收录 ${options.total} 个产品` : '收录视频评分、优缺点和文字版',
    options.categoryLabel && options.categoryLabel !== '全部' ? `当前分类：${options.categoryLabel}` : '',
    options.q ? `搜索：${options.q}` : '',
    '支持按评分、日期和类型筛选。',
  ].filter(Boolean)

  return truncateMetaDescription(parts.join('，'))
}

export function buildWebSiteJsonLd(): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SITE_NAME,
    alternateName: 'TESTV',
    url: canonicalUrl('/'),
    description: SITE_DESCRIPTION,
    inLanguage: 'zh-CN',
    potentialAction: {
      '@type': 'SearchAction',
      target: `${canonicalUrl('/')}?q={search_term_string}`,
      'query-input': 'required name=search_term_string',
    },
  }
}

export function buildOrganizationJsonLd(): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'TESTV',
    url: canonicalUrl('/'),
    logo: absoluteUrl('/icon'),
    sameAs: [
      'https://space.bilibili.com/11336264',
    ],
  }
}

export function buildBreadcrumbJsonLd(items: Array<{ name: string; path: string }>): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: canonicalUrl(item.path),
    })),
  }
}

export function buildItemListJsonLd(items: Array<{
  name: string
  path: string
  position: number
}>): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    itemListElement: items.map((item) => ({
      '@type': 'ListItem',
      position: item.position,
      url: canonicalUrl(item.path),
      name: item.name,
    })),
  }
}

export function buildRobotsMetadata(): {
  rules: {
    userAgent: string
    allow: string
  }
  sitemap: string
} {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
    },
    sitemap: absoluteUrl('/sitemap.xml'),
  }
}

export { SITE_DESCRIPTION, SITE_KEYWORDS, SITE_NAME }
