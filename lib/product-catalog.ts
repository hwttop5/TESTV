import { normalizeProductCategoryKey, type ProductCategoryKey } from './product-category'
import { compareScoreValueDesc } from './scoring'
import type { ProductSummary } from './review-types'
import type { SortMode } from './catalog-sort'
import { getPublicCatalogProducts, type PublicCatalogProduct } from './public-catalog-store'
import { isPublicCatalogProductId } from './product-visibility'

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

function toTimestamp(value: string): number {
  return new Date(value).getTime()
}

function compareBaseProducts(left: PublicCatalogProduct, right: PublicCatalogProduct, sort: SortMode): number {
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

function normalizeSearchText(value: string): string {
  return value.trim().toLocaleLowerCase()
}

function matchesSearch(product: PublicCatalogProduct, q: string): boolean {
  const keyword = normalizeSearchText(q)
  if (!keyword) return true

  return [
    product.displayName,
    ...(product.searchIndex || []),
  ].some((value) => normalizeSearchText(value).includes(keyword))
}

export async function getProductCatalogPage(query: ProductCatalogQuery): Promise<ProductCatalogPage> {
  const category = normalizeProductCategoryKey(query.category)

  const filteredProducts = getPublicCatalogProducts()
    .filter((product) => isPublicCatalogProductId(product.id))
    .filter((product) => matchesSearch(product, query.q))
    .filter((product) => category === 'all' || product.categoryKey === category)
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

  return {
    products: pageIds
      .map((id) => filteredProducts.find((product) => product.id === id))
      .filter((product): product is PublicCatalogProduct => Boolean(product)),
    total,
    totalPages,
    page: safePage,
    pageSize: query.pageSize,
  }
}
