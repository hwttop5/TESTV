import { Prisma } from '@prisma/client'
import { matchesProductCategory, normalizeProductCategoryKey, type ProductCategoryKey } from './product-category'
import { prisma } from './prisma'
import { compareScoreValueDesc } from './scoring'
import { toProductSummary, type ProductSummary } from './review-types'
import type { SortMode } from './catalog-sort'

export { DEFAULT_SORT_MODE, normalizeSortMode } from './catalog-sort'
export type { SortMode } from './catalog-sort'

// Re-export pagination constants from the dependency-free module so existing
// server-side imports from this file keep working.
export { PAGE_SIZE_OPTIONS, DEFAULT_PAGE_SIZE, normalizePageSize } from './pagination'

export interface ProductCatalogQuery {
  sort: SortMode
  q: string
  page: number
  pageSize: number
  category: ProductCategoryKey
}

type ProductCatalogPage = {
  products: ProductSummary[]
  total: number
  totalPages: number
  page: number
  pageSize: number
}

const baseListSelect = {
  id: true,
  productName: true,
  productNameZh: true,
  videoTitleZh: true,
  scoreValue: true,
  scoreRaw: true,
  priceRaw: true,
  priceValue: true,
  priceCurrency: true,
  priceType: true,
  priceContext: true,
  priceConfidence: true,
  confidence: true,
  contentStatus: true,
  prosZh: true,
  consZh: true,
  video: {
    select: {
      title: true,
      publishedAt: true,
    },
  },
} satisfies Prisma.ProductSelect

const pageDetailInclude = {
  video: {
    select: {
      youtubeId: true,
      title: true,
      publishedAt: true,
      thumbnailUrl: true,
      videoUrl: true,
      transcripts: {
        select: {
          id: true,
          content: true,
          segments: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
  },
} satisfies Prisma.ProductInclude

type BaseListProduct = Prisma.ProductGetPayload<{ select: typeof baseListSelect }>
type PageDetailProduct = Prisma.ProductGetPayload<{ include: typeof pageDetailInclude }>

function toTimestamp(value: Date | string): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime()
}

function compareBaseProducts(left: BaseListProduct, right: BaseListProduct, sort: SortMode): number {
  const leftPublishedAt = toTimestamp(left.video.publishedAt)
  const rightPublishedAt = toTimestamp(right.video.publishedAt)
  const scoreComparison = compareScoreValueDesc(left.scoreValue, right.scoreValue)

  if (sort === 'date') {
    if (rightPublishedAt !== leftPublishedAt) {
      return rightPublishedAt - leftPublishedAt
    }

    return scoreComparison
  }

  if (scoreComparison !== 0) {
    return scoreComparison
  }

  return rightPublishedAt - leftPublishedAt
}

function buildWhere(q: string): Prisma.ProductWhereInput {
  if (!q) return {}

  return {
    OR: [
      {
        productNameZh: {
          contains: q,
          mode: 'insensitive',
        },
      },
      {
        productName: {
          contains: q,
          mode: 'insensitive',
        },
      },
    ],
  }
}

export async function getProductCatalogPage(query: ProductCatalogQuery): Promise<ProductCatalogPage> {
  const category = normalizeProductCategoryKey(query.category)
  const where = buildWhere(query.q)

  const baseProducts = await prisma.product.findMany({
    where,
    select: baseListSelect,
  })

  const filteredProducts = baseProducts
    .filter((product) => matchesProductCategory({
      productNameZh: product.productNameZh,
      productName: product.productName,
      videoTitleZh: product.videoTitleZh,
      videoTitle: product.video.title,
    }, category))
    .sort((left, right) => compareBaseProducts(left, right, query.sort))

  const total = filteredProducts.length
  const totalPages = Math.max(1, Math.ceil(total / query.pageSize))
  const safePage = Math.min(Math.max(query.page, 1), totalPages)
  const pageIds = filteredProducts
    .slice((safePage - 1) * query.pageSize, safePage * query.pageSize)
    .map((product) => product.id)

  if (pageIds.length === 0) {
    return {
      products: [],
      total,
      totalPages,
      page: safePage,
      pageSize: query.pageSize,
    }
  }

  const pageProducts = await prisma.product.findMany({
    where: {
      id: {
        in: pageIds,
      },
    },
    include: pageDetailInclude,
  })

  const productMap = new Map(pageProducts.map((product) => [product.id, product]))

  return {
    products: pageIds
      .map((id) => productMap.get(id))
      .filter((product): product is PageDetailProduct => Boolean(product))
      .map((product) => toProductSummary(product)),
    total,
    totalPages,
    page: safePage,
    pageSize: query.pageSize,
  }
}
