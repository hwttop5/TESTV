import Link from 'next/link'
import { Prisma } from '@prisma/client'
import ProductCard from './ProductCard'
import { prisma } from '@/lib/prisma'
import { toProductSummary, type ProductSummary } from '@/lib/review-types'

type SortMode = 'score' | 'date'

interface ProductListProps {
  sort: SortMode
  q: string
  page: number
}

const PAGE_SIZE = 12

function buildHref(params: { sort: SortMode; q: string; page: number }): string {
  const searchParams = new URLSearchParams()
  searchParams.set('sort', params.sort)
  searchParams.set('page', String(params.page))

  if (params.q) {
    searchParams.set('q', params.q)
  }

  return `/?${searchParams.toString()}`
}

async function getProducts({
  sort,
  q,
  page,
}: ProductListProps): Promise<{
  products: ProductSummary[]
  total: number
  totalPages: number
}> {
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

  const displayProducts = products.flatMap((product) => {
    const summary = toProductSummary(product)
    return summary ? [summary] : []
  })
  const total = displayProducts.length

  return {
    products: displayProducts.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    total,
    totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  }
}

export default async function ProductList({ sort, q, page }: ProductListProps) {
  const { products, total, totalPages } = await getProducts({ sort, q, page })

  return (
    <section className="space-y-5">
      <div className="rounded-[8px] border border-stone-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <form action="/" className="flex min-w-0 flex-1 gap-2">
            <input type="hidden" name="sort" value={sort} />
            <input type="hidden" name="page" value="1" />
            <input
              type="search"
              name="q"
              defaultValue={q}
              placeholder="搜索产品名称"
              className="min-w-0 flex-1 rounded-[8px] border border-stone-300 bg-white px-4 py-2 text-sm text-stone-950 outline-none transition focus:border-red-500 focus:ring-2 focus:ring-red-100"
            />
            <button
              type="submit"
              className="rounded-[8px] bg-stone-950 px-5 py-2 text-sm font-medium text-white transition hover:bg-stone-800"
            >
              搜索
            </button>
          </form>

          <div className="grid grid-cols-2 gap-2 rounded-[8px] bg-stone-100 p-1 sm:flex">
            <Link
              href={buildHref({ sort: 'score', q, page: 1 })}
              className={`rounded-[6px] px-4 py-2 text-center text-sm font-medium transition ${
                sort === 'score'
                  ? 'bg-white text-stone-950 shadow-sm'
                  : 'text-stone-600 hover:text-stone-950'
              }`}
            >
              按分数
            </Link>
            <Link
              href={buildHref({ sort: 'date', q, page: 1 })}
              className={`rounded-[6px] px-4 py-2 text-center text-sm font-medium transition ${
                sort === 'date'
                  ? 'bg-white text-stone-950 shadow-sm'
                  : 'text-stone-600 hover:text-stone-950'
              }`}
            >
              按日期
            </Link>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-stone-500">
          <span>{total > 0 ? `共 ${total} 个产品` : '暂无可公开展示的中文产品'}</span>
          {q && (
            <Link href={buildHref({ sort, q: '', page: 1 })} className="font-medium text-red-600 hover:text-red-700">
              清除搜索：{q}
            </Link>
          )}
        </div>
      </div>

      {products.length === 0 ? (
        <div className="rounded-[8px] border border-dashed border-stone-300 bg-white p-10 text-center">
          <p className="text-base font-medium text-stone-950">
            {q ? '没有找到匹配的产品' : '还没有可展示的中文产品'}
          </p>
          <p className="mt-2 text-sm text-stone-500">
            {q ? '换一个关键词试试。' : '运行同步和中文抽取后，满足发布规则的产品会出现在这里。'}
          </p>
        </div>
      ) : (
        <div className="grid gap-4">
          {products.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <nav className="flex items-center justify-between rounded-[8px] border border-stone-200 bg-white px-4 py-3">
          {page <= 1 ? (
            <span className="rounded-[8px] border border-stone-200 px-4 py-2 text-sm font-medium text-stone-300">
              上一页
            </span>
          ) : (
            <Link
              href={buildHref({ sort, q, page: page - 1 })}
              className="rounded-[8px] border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 transition hover:bg-stone-100"
            >
              上一页
            </Link>
          )}

          <span className="text-sm text-stone-500">
            第 {page} / {totalPages} 页
          </span>

          {page >= totalPages ? (
            <span className="rounded-[8px] border border-stone-200 px-4 py-2 text-sm font-medium text-stone-300">
              下一页
            </span>
          ) : (
            <Link
              href={buildHref({ sort, q, page: page + 1 })}
              className="rounded-[8px] border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 transition hover:bg-stone-100"
            >
              下一页
            </Link>
          )}
        </nav>
      )}
    </section>
  )
}
