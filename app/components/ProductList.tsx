'use client'

import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useMemo, useState, useTransition } from 'react'
import type { ProductSummary } from '@/lib/review-types'
import {
  PRODUCT_CATEGORY_OPTIONS,
  type ProductCategoryKey,
} from '@/lib/product-category'
import type { SortMode } from '@/lib/product-catalog'
import { PAGE_SIZE_OPTIONS } from '@/lib/pagination'
import ProductCard from './ProductCard'

interface ProductListProps {
  sort: SortMode
  q: string
  page: number
  pageSize: number
  category: ProductCategoryKey
  products: ProductSummary[]
  total: number
  totalPages: number
}

function buildHref(params: {
  sort: SortMode
  q: string
  page: number
  pageSize: number
  category: ProductCategoryKey
}): string {
  const searchParams = new URLSearchParams()
  searchParams.set('sort', params.sort)
  searchParams.set('page', String(params.page))

  if (params.q) {
    searchParams.set('q', params.q)
  }

  if (params.category !== 'all') {
    searchParams.set('category', params.category)
  }

  if (params.pageSize !== PAGE_SIZE_OPTIONS[0]) {
    searchParams.set('pageSize', String(params.pageSize))
  }

  return `/?${searchParams.toString()}`
}

export default function ProductList({
  sort,
  q,
  page,
  pageSize,
  category,
  products,
  total,
  totalPages,
}: ProductListProps) {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()
  const [keyword, setKeyword] = useState(q)

  const currentPage = Math.min(Math.max(page, 1), Math.max(totalPages, 1))
  const hasFilters = Boolean(q) || category !== 'all'

  const navigateWith = useCallback((patch: Record<string, string | null>) => {
    const nextParams = new URLSearchParams(searchParams?.toString() || '')

    for (const [key, value] of Object.entries(patch)) {
      if (!value) {
        nextParams.delete(key)
      } else {
        nextParams.set(key, value)
      }
    }

    const href = nextParams.toString() ? `${pathname}?${nextParams.toString()}` : pathname
    startTransition(() => {
      router.replace(href, { scroll: false })
    })
  }, [pathname, router, searchParams])

  const currentCategoryLabel = useMemo(
    () => PRODUCT_CATEGORY_OPTIONS.find((option) => option.key === category)?.label || '全部',
    [category],
  )

  function handleSearchSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    navigateWith({
      q: keyword.trim() || null,
      page: '1',
    })
  }

  function handlePageSizeChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const nextSize = event.target.value
    navigateWith({
      pageSize: nextSize === String(PAGE_SIZE_OPTIONS[0]) ? null : nextSize,
      page: '1',
    })
  }

  function handleJumpSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const raw = Number.parseInt(String(data.get('jumpPage') || ''), 10)

    if (!Number.isFinite(raw)) return

    const target = Math.min(Math.max(raw, 1), totalPages)
    navigateWith({ page: String(target) })
  }

  return (
    <section className="space-y-6">
      <div className="animate-fade-up rounded-panel border border-stone-300/70 bg-white p-4 shadow-card dark:border-white/10 dark:bg-stone-900 sm:p-5">
        <form onSubmit={handleSearchSubmit} className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_170px_150px_auto]">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-stone-500 dark:text-stone-400">搜索</span>
            <input
              type="search"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="搜索产品名称"
              aria-label="搜索产品名称"
              className="h-11 w-full rounded-control border border-stone-300/80 bg-white px-4 text-sm text-stone-950 outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-50"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-stone-500 dark:text-stone-400">分类</span>
            <select
              name="category"
              value={category}
              aria-label="按分类筛选"
              onChange={(event) => {
                navigateWith({
                  category: event.target.value === 'all' ? null : event.target.value,
                  page: '1',
                })
              }}
              className="h-11 w-full rounded-control border border-stone-300/80 bg-white px-4 text-sm text-stone-950 outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-50"
            >
              {PRODUCT_CATEGORY_OPTIONS.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-stone-500 dark:text-stone-400">排序</span>
            <select
              value={sort}
              aria-label="排序方式"
              onChange={(event) => {
                navigateWith({
                  sort: event.target.value,
                  page: '1',
                })
              }}
              className="h-11 w-full rounded-control border border-stone-300/80 bg-white px-4 text-sm text-stone-950 outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-50"
            >
              <option value="score">按评分</option>
              <option value="date">按日期</option>
            </select>
          </label>

          <button
            type="submit"
            className="h-11 rounded-control bg-brand px-6 text-sm font-medium text-white transition hover:bg-brand-strong sm:col-span-2 lg:col-span-1"
          >
            搜索
          </button>
        </form>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-stone-200 pt-4 text-sm text-stone-500 dark:border-stone-800 dark:text-stone-400">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span>{total > 0 ? `共 ${total} 个产品` : '暂无产品记录'}</span>
            <span className="text-stone-300 dark:text-stone-600">·</span>
            <span>
              当前筛选：
              <span className="font-medium text-stone-950 dark:text-stone-50">{currentCategoryLabel}</span>
            </span>
            {isPending && (
              <span className="rounded-full bg-brand-soft px-2.5 py-1 text-xs font-medium text-brand-strong dark:text-brand" aria-live="polite">
                更新中
              </span>
            )}
          </div>
          {hasFilters && (
            <button
              type="button"
              onClick={() => {
                setKeyword('')
                navigateWith({
                  q: null,
                  category: null,
                  sort,
                  page: '1',
                })
              }}
              className="font-medium text-brand transition hover:text-brand-strong"
            >
              清除筛选
            </button>
          )}
        </div>
      </div>

      {products.length === 0 ? (
        <div className="rounded-panel border border-dashed border-stone-300 bg-white p-10 text-center dark:border-stone-700 dark:bg-stone-900">
          <p className="text-base font-medium text-stone-950 dark:text-stone-50">
            {hasFilters ? '没有找到匹配的产品' : '还没有可展示的产品'}
          </p>
          <p className="mt-2 text-sm text-stone-500 dark:text-stone-400">
            {hasFilters ? '换个关键词或类目再试试。' : '完成同步和抽取后，产品会出现在这里。'}
          </p>
        </div>
      ) : (
        <div
          className={`cards-enter grid gap-4 transition-opacity duration-200 ${isPending ? 'pointer-events-none opacity-60' : 'opacity-100'}`}
          aria-busy={isPending}
        >
          {products.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      )}

      <footer className="flex flex-col gap-4 rounded-panel border border-stone-300/70 bg-white px-4 py-4 shadow-card dark:border-white/10 dark:bg-stone-900 sm:flex-row sm:items-center sm:justify-between">
        <label className="flex items-center gap-2 text-sm text-stone-500 dark:text-stone-400">
          <span className="shrink-0">每页显示</span>
          <select
            value={pageSize}
            aria-label="每页显示数量"
            onChange={handlePageSizeChange}
            className="h-10 rounded-control border border-stone-300/80 bg-white px-3 text-sm text-stone-950 outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-50"
          >
            {PAGE_SIZE_OPTIONS.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
          <span className="shrink-0">条</span>
        </label>

        <nav className="flex items-center justify-center gap-2" aria-label="分页导航">
          {currentPage <= 1 ? (
            <span className="rounded-control border border-stone-200 px-4 py-2 text-sm font-medium text-stone-300 dark:border-stone-700 dark:text-stone-600">
              上一页
            </span>
          ) : (
            <Link
              href={buildHref({ sort, q, page: currentPage - 1, pageSize, category })}
              className="rounded-control border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 transition hover:border-brand hover:text-brand dark:border-stone-700 dark:text-stone-200 dark:hover:bg-stone-800"
            >
              上一页
            </Link>
          )}

          <span className="px-1 text-sm text-stone-500 dark:text-stone-400">
            第 {currentPage} / {totalPages} 页
          </span>

          {currentPage >= totalPages ? (
            <span className="rounded-control border border-stone-200 px-4 py-2 text-sm font-medium text-stone-300 dark:border-stone-700 dark:text-stone-600">
              下一页
            </span>
          ) : (
            <Link
              href={buildHref({ sort, q, page: currentPage + 1, pageSize, category })}
              className="rounded-control border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 transition hover:border-brand hover:text-brand dark:border-stone-700 dark:text-stone-200 dark:hover:bg-stone-800"
            >
              下一页
            </Link>
          )}
        </nav>

        <form
          onSubmit={handleJumpSubmit}
          className="flex items-center justify-center gap-2 text-sm text-stone-500 dark:text-stone-400"
        >
          <span className="shrink-0">跳转到</span>
          <input
            key={currentPage}
            type="number"
            name="jumpPage"
            min={1}
            max={totalPages}
            defaultValue={currentPage}
            aria-label="跳转到指定页"
            className="h-10 w-16 rounded-control border border-stone-300/80 bg-white px-3 text-center text-sm text-stone-950 outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-50"
          />
          <span className="shrink-0">页</span>
          <button
            type="submit"
            className="h-10 rounded-control bg-brand px-4 text-sm font-medium text-white transition hover:bg-brand-strong"
          >
            跳转
          </button>
        </form>
      </footer>
    </section>
  )
}
