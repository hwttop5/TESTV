import type { MetadataRoute } from 'next'
import { canonicalUrl } from '@/lib/seo'
import { getPublicCatalogProducts, type PublicCatalogProduct } from '@/lib/public-catalog-store'
import { isPublicCatalogProductId } from '@/lib/product-visibility'

export const dynamic = 'force-dynamic'

function compareProductsForSitemap(left: PublicCatalogProduct, right: PublicCatalogProduct): number {
  const publishedAtComparison = (
    new Date(right.video.publishedAt).getTime() - new Date(left.video.publishedAt).getTime()
  )
  if (publishedAtComparison !== 0) return publishedAtComparison

  if (typeof left.sitemapOrder === 'number' || typeof right.sitemapOrder === 'number') {
    return (left.sitemapOrder ?? Number.MAX_SAFE_INTEGER) - (right.sitemapOrder ?? Number.MAX_SAFE_INTEGER)
  }

  return 0
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const products = getPublicCatalogProducts()
    .filter((product) => isPublicCatalogProductId(product.id))
    .sort(compareProductsForSitemap)

  return [
    {
      url: canonicalUrl('/'),
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 1,
    },
    ...products.map((product) => ({
      url: canonicalUrl(`/products/${product.id}`),
      lastModified: product.updatedAt || product.video.publishedAt,
      changeFrequency: 'weekly' as const,
      priority: 0.7,
    })),
  ]
}
