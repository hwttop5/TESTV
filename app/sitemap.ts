import type { MetadataRoute } from 'next'
import { canonicalUrl } from '@/lib/seo'
import { prisma } from '@/lib/prisma'
import { getPublicCatalogProductWhere } from '@/lib/product-visibility'

export const dynamic = 'force-dynamic'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const products = await prisma.product.findMany({
    where: getPublicCatalogProductWhere(),
    select: {
      id: true,
      updatedAt: true,
      video: {
        select: {
          publishedAt: true,
        },
      },
    },
    orderBy: {
      video: {
        publishedAt: 'desc',
      },
    },
  })

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
