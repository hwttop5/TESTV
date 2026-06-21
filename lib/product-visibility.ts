export const NON_CATALOG_PRODUCT_EXCLUSIONS = [
  {
    id: 'cmqgahf74000980unhnz2nbjs',
    reason: 'TESTV 2025年度总结',
  },
  {
    id: 'cmqgahgjd001i80unrjnttzl6',
    reason: '2024年度最答辩产品总结',
  },
  {
    id: 'cmqgb8pde00gkksunb27itkxj',
    reason: 'TESTV 2023年度总结',
  },
  {
    id: 'cmqgb8pde00gnksunhzxdcin3',
    reason: 'TESTV 年度产品榜单',
  },
  {
    id: 'cmqgb8pdd003iksunu7zqdb7n',
    reason: '2021年度大总结',
  },
  {
    id: 'cmqgb8pde00haksun1r1ze24t',
    reason: 'TESTV 2018年度大回顾',
  },
  {
    id: 'cmqgb8pde00a9ksuntn7yl11e',
    reason: 'TESTV 2017年度回顾盛典',
  },
] as const

export const NON_CATALOG_PRODUCT_IDS = new Set<string>(
  NON_CATALOG_PRODUCT_EXCLUSIONS.map((product) => product.id),
)

export function isPublicCatalogProductId(id: string): boolean {
  return !NON_CATALOG_PRODUCT_IDS.has(id)
}

export function getPublicCatalogProductWhere() {
  return {
    id: {
      notIn: [...NON_CATALOG_PRODUCT_IDS],
    },
  }
}
