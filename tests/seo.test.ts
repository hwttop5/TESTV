import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_PROD_SITE_URL,
  absoluteImageUrl,
  absoluteUrl,
  buildHomeDescription,
  buildWebSiteJsonLd,
  canonicalUrl,
  getSiteUrl,
  jsonLdScript,
} from '../lib/seo'

const originalSiteUrl = process.env.NEXT_PUBLIC_APP_URL

afterEach(() => {
  vi.unstubAllEnvs()

  if (originalSiteUrl === undefined) {
    delete process.env.NEXT_PUBLIC_APP_URL
  } else {
    process.env.NEXT_PUBLIC_APP_URL = originalSiteUrl
  }
})

describe('seo helpers', () => {
  it('normalizes configured site url', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://testv.example.com/path/'

    expect(getSiteUrl()).toBe('https://testv.example.com')
    expect(absoluteUrl('/products/abc')).toBe('https://testv.example.com/products/abc')
  })

  it('does not fall back to localhost in production', () => {
    delete process.env.NEXT_PUBLIC_APP_URL
    vi.stubEnv('NODE_ENV', 'production')

    expect(getSiteUrl()).toBe(DEFAULT_PROD_SITE_URL)
  })

  it('builds canonical urls without query or hash', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://testv.example.com/'

    expect(canonicalUrl('/products/abc?x=1#section')).toBe('https://testv.example.com/products/abc')
  })

  it('normalizes image urls for metadata and structured data', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://testv.example.com/'

    expect(absoluteImageUrl('/opengraph-image')).toBe('https://testv.example.com/opengraph-image')
    expect(absoluteImageUrl('https://img.example.com/a.jpg')).toBe('https://img.example.com/a.jpg')
  })

  it('escapes json ld script payload', () => {
    expect(jsonLdScript({ name: '<script>alert(1)</script>' })).toContain('\\u003cscript>')
  })

  it('builds concise Chinese home description', () => {
    const description = buildHomeDescription({
      total: 705,
      categoryLabel: '手机',
      q: 'OPPO',
    })

    expect(description).toContain('705')
    expect(description).toContain('手机')
    expect(description.length).toBeLessThanOrEqual(155)
  })

  it('builds website search action schema', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://testv.example.com'
    const schema = buildWebSiteJsonLd()

    expect(schema['@type']).toBe('WebSite')
    expect(schema.url).toBe('https://testv.example.com/')
    expect(schema.potentialAction).toMatchObject({
      '@type': 'SearchAction',
      'query-input': 'required name=search_term_string',
    })
  })
})
