import type { Metadata } from 'next'
import { Suspense } from 'react'
import ProductList from './components/ProductList'
import InstallPrompt from './components/InstallPrompt'
import ThemeToggle from './components/ThemeToggle'
import GitHubLink from './components/GitHubLink'
import { getProductCatalogPage, normalizePageSize, normalizeSortMode } from '@/lib/product-catalog'
import { getProductCategoryLabel, normalizeProductCategoryKey } from '@/lib/product-category'
import type { ProductListItem } from '@/lib/review-types'
import { getPublicCatalogProductCount } from '@/lib/public-catalog-store'
import {
  buildHomeCanonical,
  buildHomeDescription,
  buildItemListJsonLd,
  buildOrganizationJsonLd,
  buildWebSiteJsonLd,
  SITE_NAME,
  jsonLdScript,
} from '@/lib/seo'

type HomeSearchParams = Promise<{
  sort?: string | string[]
  q?: string | string[]
  page?: string | string[]
  category?: string | string[]
  pageSize?: string | string[]
}>

const emptySyncStats = {
  products: 0,
}

type HomeCatalog = {
  products: ProductListItem[]
  total: number
  totalPages: number
  page: number
  pageSize: number
}

function firstParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] || ''
  return value || ''
}

function readPage(value: string): number {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams: HomeSearchParams
}): Promise<Metadata> {
  const params = await searchParams
  const q = firstParam(params.q).trim()
  const page = readPage(firstParam(params.page))
  const category = normalizeProductCategoryKey(firstParam(params.category))
  const categoryLabel = getProductCategoryLabel(category)

  const description = buildHomeDescription({ categoryLabel, q })
  const canonical = buildHomeCanonical({ category, page })
  const shouldIndex = !q && page <= 1

  const titleParts: string[] = []
  if (category !== 'all') titleParts.push(categoryLabel)
  if (q) titleParts.push(`搜索“${q}”`)
  if (page > 1) titleParts.push(`第 ${page} 页`)

  const title = titleParts.length > 0 ? titleParts.join(' · ') : undefined

  return {
    ...(title ? { title } : {}),
    description,
    alternates: { canonical },
    robots: shouldIndex ? undefined : { index: false, follow: true },
    openGraph: {
      title: title ? `${title} | ${SITE_NAME}` : SITE_NAME,
      description,
      url: canonical,
    },
  }
}

async function getSyncStats() {
  return {
    products: getPublicCatalogProductCount(),
  }
}

async function StatsCard() {
  let stats = emptySyncStats

  try {
    stats = await getSyncStats()
  } catch (error) {
    console.error('Failed to load home stats:', error)
  }

  return (
    <div className="animate-fade-up rounded-panel border border-foreground/10 bg-foreground/[0.02] p-5 [animation-delay:0.25s]">
      <p className="text-xs font-medium uppercase tracking-[0.14em] text-foreground/45">当前数据</p>
      <div className="mt-4 overflow-hidden rounded-card border border-foreground/10 bg-background px-3 py-4 text-center">
        <p className="font-display text-2xl text-foreground">{stats.products}</p>
        <p className="mt-1 text-xs text-foreground/50">产品数</p>
      </div>
    </div>
  )
}

function StatsCardSkeleton() {
  return (
    <div className="animate-pulse rounded-panel border border-foreground/10 bg-foreground/[0.02] p-5 [animation-delay:0.25s]">
      <div className="h-3 w-20 rounded-full bg-foreground/10" />
      <div className="mt-4 overflow-hidden rounded-card border border-foreground/10 bg-background px-3 py-4 text-center">
        <div className="mx-auto h-8 w-16 rounded-full bg-foreground/10" />
        <div className="mx-auto mt-2 h-3 w-12 rounded-full bg-foreground/10" />
      </div>
    </div>
  )
}

function SkeletonBlock({ className }: { className: string }) {
  return <div className={`rounded-control bg-stone-200/80 dark:bg-stone-800 ${className}`} />
}

function ProductCardSkeleton() {
  return (
    <div className="rounded-card border border-stone-300/70 bg-white p-4 shadow-card dark:border-white/10 dark:bg-stone-900">
      <article className="grid gap-4 sm:grid-cols-[200px_minmax(0,1fr)] sm:items-start lg:grid-cols-[224px_minmax(0,1fr)_124px]">
        <SkeletonBlock className="aspect-video w-full" />
        <div className="min-w-0 space-y-3">
          <div className="flex gap-2">
            <SkeletonBlock className="h-6 w-20 rounded-full" />
            <SkeletonBlock className="h-6 w-24 rounded-full" />
            <SkeletonBlock className="h-6 w-16 rounded-full" />
          </div>
          <SkeletonBlock className="h-7 w-4/5" />
          <SkeletonBlock className="h-4 w-3/5" />
          <div className="grid gap-2 sm:grid-cols-2">
            <SkeletonBlock className="h-[68px]" />
            <SkeletonBlock className="h-[68px]" />
          </div>
        </div>
        <SkeletonBlock className="h-[86px] sm:col-span-2 lg:col-span-1 lg:min-h-[124px] lg:min-w-[124px]" />
      </article>
    </div>
  )
}

function ProductListSkeleton() {
  return (
    <section className="animate-pulse space-y-6" aria-hidden="true">
      <div className="rounded-panel border border-stone-300/70 bg-white p-4 shadow-card dark:border-white/10 dark:bg-stone-900 sm:p-5">
        <div className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_170px_150px_auto]">
          <div className="space-y-1.5">
            <SkeletonBlock className="h-3 w-10" />
            <SkeletonBlock className="h-11 w-full" />
          </div>
          <div className="space-y-1.5">
            <SkeletonBlock className="h-3 w-10" />
            <SkeletonBlock className="h-11 w-full" />
          </div>
          <div className="space-y-1.5">
            <SkeletonBlock className="h-3 w-10" />
            <SkeletonBlock className="h-11 w-full" />
          </div>
          <SkeletonBlock className="h-11 w-full sm:col-span-2 lg:col-span-1" />
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-stone-200 pt-4 dark:border-stone-800">
          <SkeletonBlock className="h-4 w-56" />
          <SkeletonBlock className="h-4 w-16" />
        </div>
      </div>

      <div className="grid gap-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <ProductCardSkeleton key={index} />
        ))}
      </div>

      <div className="flex flex-col gap-4 rounded-panel border border-stone-300/70 bg-white px-4 py-4 shadow-card dark:border-white/10 dark:bg-stone-900 sm:flex-row sm:items-center sm:justify-between">
        <SkeletonBlock className="h-10 w-36" />
        <SkeletonBlock className="h-10 w-52" />
        <SkeletonBlock className="h-10 w-40" />
      </div>
    </section>
  )
}

async function CatalogSection({
  searchParams,
}: {
  searchParams: HomeSearchParams
}) {
  const params = await searchParams
  const sort = normalizeSortMode(firstParam(params.sort))
  const q = firstParam(params.q).trim()
  const page = readPage(firstParam(params.page))
  const category = normalizeProductCategoryKey(firstParam(params.category))
  const pageSize = normalizePageSize(firstParam(params.pageSize))

  let catalog: HomeCatalog = {
    products: [],
    total: 0,
    totalPages: 1,
    page: 1,
    pageSize,
  }

  try {
    catalog = await getProductCatalogPage({
      sort,
      q,
      page,
      pageSize,
      category,
    })
  } catch (error) {
    console.error('Failed to load home catalog:', error)
  }

  const jsonLd = [
    buildWebSiteJsonLd(),
    buildOrganizationJsonLd(),
    buildItemListJsonLd(catalog.products.map((product, index) => ({
      name: product.displayName,
      path: `/products/${product.id}`,
      position: (catalog.page - 1) * catalog.pageSize + index + 1,
    }))),
  ]

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(jsonLd) }}
      />
      <ProductList
        sort={sort}
        q={q}
        page={catalog.page}
        pageSize={catalog.pageSize}
        category={category}
        products={catalog.products}
        total={catalog.total}
        totalPages={catalog.totalPages}
      />
    </>
  )
}

export default function Home({
  searchParams,
}: {
  searchParams: HomeSearchParams
}) {
  return (
    <main className="min-h-screen">
      <div className="mx-auto max-w-6xl px-4 py-8 pb-28 sm:px-6 lg:px-8">
        <header className="mb-10">
          <div className="flex animate-fade-in items-center justify-between gap-4">
            <div className="inline-flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-control bg-brand text-xs font-bold text-white">
                TV
              </span>
              <span className="text-sm font-medium tracking-tight text-foreground/80">TESTV</span>
            </div>

            <div className="flex items-center gap-2">
              <ThemeToggle />
              <GitHubLink />
            </div>
          </div>

          <div className="mt-10 grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-end">
            <div>
              <h1 className="font-display max-w-3xl animate-fade-up text-5xl leading-[1.08] tracking-tight text-foreground [animation-delay:0.05s] sm:text-6xl">
                TESTV 值不值得买
              </h1>
              <p className="mt-5 max-w-2xl animate-fade-up text-lg leading-8 text-foreground/60 [animation-delay:0.15s]">
                Bunny try before you buy.
              </p>
            </div>

            <Suspense fallback={<StatsCardSkeleton />}>
              <StatsCard />
            </Suspense>
          </div>
        </header>

        <Suspense fallback={<ProductListSkeleton />}>
          <CatalogSection searchParams={searchParams} />
        </Suspense>
        <InstallPrompt />
      </div>
    </main>
  )
}
