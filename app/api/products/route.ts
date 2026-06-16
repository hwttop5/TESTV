import { Prisma } from '@prisma/client'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { toProductSummary, type ProductSummary } from '@/lib/review-types'

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
  const sort = searchParams.get('sort') === 'date' ? 'date' : 'score'
  const q = (searchParams.get('q') || '').trim()
  const page = readPositiveInt(searchParams.get('page'), 1, 10_000)
  const pageSize = readPositiveInt(searchParams.get('pageSize'), 20, 50)

  try {
    const where: Prisma.ProductWhereInput = {
      published: true,
      ...(q
        ? {
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
        : {}),
    }

    const orderBy: Prisma.ProductOrderByWithRelationInput[] = sort === 'date'
      ? [{ video: { publishedAt: 'desc' } }, { normalizedScore: 'desc' }]
      : [{ normalizedScore: { sort: 'desc', nulls: 'last' } }, { video: { publishedAt: 'desc' } }]

    const products = await prisma.product.findMany({
      where,
      orderBy,
      include: {
        video: {
          select: {
            youtubeId: true,
            publishedAt: true,
            thumbnailUrl: true,
            videoUrl: true,
          },
        },
      },
    })

    const serializedProducts: ProductSummary[] = products.flatMap((product) => {
      const summary = toProductSummary(product)
      return summary ? [summary] : []
    })
    const total = serializedProducts.length
    const paginatedProducts = serializedProducts.slice((page - 1) * pageSize, page * pageSize)

    return NextResponse.json({
      products: paginatedProducts,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    })
  } catch (error) {
    console.error('Failed to fetch products:', error)
    return NextResponse.json(
      { error: '产品列表读取失败' },
      { status: 500 }
    )
  }
}
