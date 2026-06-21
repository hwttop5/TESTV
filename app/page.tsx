import type { Metadata } from 'next'
import ProductList from './components/ProductList'
import InstallPrompt from './components/InstallPrompt'
import ThemeToggle from './components/ThemeToggle'
import GitHubLink from './components/GitHubLink'
import { getProductCatalogPage, normalizePageSize, normalizeSortMode } from '@/lib/product-catalog'
import { getProductCategoryLabel, normalizeProductCategoryKey } from '@/lib/product-category'
import type { ProductSummary } from '@/lib/review-types'
import { prisma } from '@/lib/prisma'
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
  products: ProductSummary[]
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
  const count = await prisma.product.count()

  return {
    products: count,
  }
}

export default async function Home({
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

  let stats = emptySyncStats
  let catalog: HomeCatalog = {
    products: [],
    total: 0,
    totalPages: 1,
    page: 1,
    pageSize,
  }

  try {
    ;[stats, catalog] = await Promise.all([
      getSyncStats(),
      getProductCatalogPage({
        sort,
        q,
        page,
        pageSize,
        category,
      }),
    ])
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
    <main className="min-h-screen">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(jsonLd) }}
      />
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

            <div className="animate-fade-up rounded-panel border border-foreground/10 bg-foreground/[0.02] p-5 [animation-delay:0.25s]">
              <p className="text-xs font-medium uppercase tracking-[0.14em] text-foreground/45">当前数据</p>
              <div className="mt-4 overflow-hidden rounded-card border border-foreground/10 bg-background px-3 py-4 text-center">
                <p className="font-display text-2xl text-foreground">{stats.products}</p>
                <p className="mt-1 text-xs text-foreground/50">产品数</p>
              </div>
            </div>
          </div>
        </header>

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
        <InstallPrompt />
      </div>
    </main>
  )
}
