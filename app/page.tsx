import ProductList from './components/ProductList'
import { prisma } from '@/lib/prisma'
import { toProductSummary } from '@/lib/review-types'

type HomeSearchParams = Promise<{
  sort?: string | string[]
  q?: string | string[]
  page?: string | string[]
}>

function firstParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] || ''
  return value || ''
}

function readPage(value: string): number {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1
}

async function getSyncStats() {
  const [videos, transcripts, products] = await Promise.all([
    prisma.video.count(),
    prisma.transcript.count(),
    prisma.product.findMany({
      where: { published: true },
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
    }),
  ])

  return {
    videos,
    transcripts,
    displayableProducts: products.filter((product) => toProductSummary(product)).length,
  }
}

export default async function Home({
  searchParams,
}: {
  searchParams: HomeSearchParams
}) {
  const params = await searchParams
  const sort = firstParam(params.sort) === 'date' ? 'date' : 'score'
  const q = firstParam(params.q).trim()
  const page = readPage(firstParam(params.page))
  const stats = await getSyncStats()

  return (
    <main className="min-h-screen bg-stone-50">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <header className="mb-8 border-b border-stone-200 pb-6">
          <p className="text-sm font-medium text-red-600">YouTube 产品评测数据站</p>
          <div className="mt-3 grid gap-4 lg:grid-cols-[1fr_320px] lg:items-end">
            <div>
              <h1 className="max-w-3xl text-4xl font-semibold leading-tight text-stone-950 sm:text-5xl">
                自动整理产品评分、优点和缺点
              </h1>
              <p className="mt-4 max-w-2xl text-base leading-7 text-stone-600">
                同步指定播放列表，提取字幕和转写内容，用结构化抽取生成可排序、可搜索的中文产品测评清单。
              </p>
            </div>
            <div className="rounded-[8px] border border-stone-200 bg-white p-4 text-sm text-stone-600 shadow-sm">
              <p className="font-medium text-stone-950">当前规则</p>
              <p className="mt-2">按 0-100 分归一化；只展示中文字段齐全的公开记录。</p>
              <div className="mt-4 grid grid-cols-3 gap-2 border-t border-stone-100 pt-3 text-center">
                <div>
                  <p className="text-lg font-semibold text-stone-950">{stats.videos}</p>
                  <p className="mt-1 text-xs text-stone-500">视频</p>
                </div>
                <div>
                  <p className="text-lg font-semibold text-stone-950">{stats.transcripts}</p>
                  <p className="mt-1 text-xs text-stone-500">字幕</p>
                </div>
                <div>
                  <p className="text-lg font-semibold text-stone-950">{stats.displayableProducts}</p>
                  <p className="mt-1 text-xs text-stone-500">产品</p>
                </div>
              </div>
            </div>
          </div>
        </header>

        <ProductList sort={sort} q={q} page={page} />
      </div>
    </main>
  )
}
