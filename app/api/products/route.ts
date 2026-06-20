import { NextRequest, NextResponse } from 'next/server'
import { getProductCatalogPage, type SortMode } from '@/lib/product-catalog'
import { normalizeProductCategoryKey } from '@/lib/product-category'

export const dynamic = 'force-dynamic'

function readPositiveInt(value: string | null, fallback: number, max: number): number {
  const parsed = Number.parseInt(value || '', 10)

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback
  }

  return Math.min(parsed, max)
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const sort: SortMode = searchParams.get('sort') === 'date' ? 'date' : 'score'
  const q = (searchParams.get('q') || '').trim()
  const page = readPositiveInt(searchParams.get('page'), 1, 10_000)
  const pageSize = readPositiveInt(searchParams.get('pageSize'), 20, 50)
  const category = normalizeProductCategoryKey(searchParams.get('category'))

  try {
    const result = await getProductCatalogPage({
      sort,
      q,
      page,
      pageSize,
      category,
    })

    return NextResponse.json({
      products: result.products,
      pagination: {
        page: result.page,
        pageSize: result.pageSize,
        total: result.total,
        totalPages: result.totalPages,
      },
    })
  } catch (error) {
    console.error('Failed to fetch products:', error)
    return NextResponse.json(
      { error: '产品列表读取失败' },
      { status: 500 },
    )
  }
}
