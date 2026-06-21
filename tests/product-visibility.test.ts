import { describe, expect, it } from 'vitest'
import {
  NON_CATALOG_PRODUCT_EXCLUSIONS,
  NON_CATALOG_PRODUCT_IDS,
  getPublicCatalogProductWhere,
  isPublicCatalogProductId,
} from '../lib/product-visibility'

describe('product visibility', () => {
  it('tracks the non-catalog annual summary exclusions', () => {
    expect(NON_CATALOG_PRODUCT_EXCLUSIONS).toHaveLength(7)
    expect(isPublicCatalogProductId('cmqgahf74000980unhnz2nbjs')).toBe(false)
    expect(isPublicCatalogProductId('cmqgahgjd001i80unrjnttzl6')).toBe(false)
    expect(isPublicCatalogProductId('cmqgb8pde00gnksunhzxdcin3')).toBe(false)
    expect(isPublicCatalogProductId('cmqgahg2g001g80unr7a8x6c9')).toBe(true)
  })

  it('builds a Prisma where clause that excludes only hidden catalog ids', () => {
    expect(getPublicCatalogProductWhere()).toEqual({
      id: {
        notIn: [...NON_CATALOG_PRODUCT_IDS],
      },
    })
  })
})
