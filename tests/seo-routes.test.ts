import { describe, expect, it } from 'vitest'
import { buildRobotsMetadata, canonicalUrl } from '../lib/seo'

describe('seo metadata routes', () => {
  it('builds robots with sitemap url', async () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://testv.example.com'

    expect(buildRobotsMetadata()).toMatchObject({
      rules: {
        userAgent: '*',
        allow: '/',
      },
      sitemap: 'https://testv.example.com/sitemap.xml',
    })
  })

  it('builds sitemap urls without localhost when site url is configured', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://testv.example.com'

    expect(canonicalUrl('/')).toBe('https://testv.example.com/')
    expect(canonicalUrl('/products/product-1')).toBe('https://testv.example.com/products/product-1')
  })
})
