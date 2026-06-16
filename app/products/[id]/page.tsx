import Image from 'next/image'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { toProductDetail } from '@/lib/review-types'

export const dynamic = 'force-dynamic'

export default async function ProductPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const product = await prisma.product.findUnique({
    where: { id },
    include: {
      video: true,
      affiliateLinks: true,
    },
  })

  if (!product || !product.published) {
    notFound()
  }

  const detail = toProductDetail(product)
  if (!detail) {
    notFound()
  }

  const date = new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(detail.video.publishedAt))

  const affiliateLinks = product.affiliateLinks.filter((link) => Boolean(link.url))

  return (
    <main className="min-h-screen bg-stone-50">
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <Link
          href="/"
          className="inline-flex rounded-[8px] border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-700 transition hover:bg-stone-100"
        >
          返回榜单
        </Link>

        <section className="mt-6 rounded-[8px] border border-stone-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
            <div className="relative aspect-video overflow-hidden rounded-[8px] bg-stone-100">
              {detail.video.thumbnailUrl ? (
                <Image
                  src={detail.video.thumbnailUrl}
                  alt={detail.displayName}
                  fill
                  unoptimized
                  sizes="(max-width: 1024px) 100vw, 360px"
                  className="object-cover"
                />
              ) : (
                <div className="flex h-full items-center justify-center text-stone-400">
                  无缩略图
                </div>
              )}
            </div>

            <div>
              <p className="text-sm font-medium text-red-600">产品详情</p>
              <h1 className="mt-2 text-3xl font-semibold leading-tight text-stone-950">
                {detail.displayName}
              </h1>

              <div className="mt-5 flex flex-wrap gap-3">
                <div className="rounded-[8px] border border-stone-200 bg-stone-50 px-5 py-4">
                  <p className="text-sm text-stone-500">归一化评分</p>
                  <p className="mt-1 text-4xl font-bold text-stone-950">
                    {detail.normalizedScore === null ? '-' : detail.normalizedScore.toFixed(0)}
                    <span className="text-lg font-medium text-stone-500"> / 100</span>
                  </p>
                  {detail.scoreRaw && (
                    <p className="mt-1 text-sm text-stone-500">原始评分：{detail.scoreRaw}</p>
                  )}
                </div>

                <div className="rounded-[8px] border border-stone-200 bg-stone-50 px-5 py-4">
                  <p className="text-sm text-stone-500">抽取置信度</p>
                  <p className="mt-1 text-4xl font-bold text-stone-950">
                    {detail.confidence === null ? '-' : `${(detail.confidence * 100).toFixed(0)}%`}
                  </p>
                </div>
              </div>

              <div className="mt-5 space-y-1 text-sm text-stone-600">
                <p>来源视频：{detail.displayVideoTitle || '暂无中文标题'}</p>
                <p>发布日期：{date}</p>
              </div>

              <div className="mt-5 flex flex-wrap gap-2">
                <a
                  href={detail.video.videoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex rounded-[8px] bg-red-600 px-5 py-2 text-sm font-medium text-white transition hover:bg-red-700"
                >
                  观看 YouTube 原视频
                </a>
                {affiliateLinks.map((link) => (
                  <a
                    key={link.id}
                    href={link.url || undefined}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex rounded-[8px] border border-stone-300 bg-white px-5 py-2 text-sm font-medium text-stone-700 transition hover:bg-stone-100"
                  >
                    {link.platform === 'jd' ? '京东链接' : link.platform === 'taobao' ? '淘宝链接' : '购买链接'}
                  </a>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="mt-6 grid gap-5 md:grid-cols-2">
          <div className="rounded-[8px] border border-emerald-200 bg-white p-5 shadow-sm">
            <h2 className="text-xl font-semibold text-emerald-800">优点</h2>
            <ul className="mt-4 space-y-3">
              {detail.displayPros.map((pro, index) => (
                <li key={index} className="rounded-[8px] bg-emerald-50 px-4 py-3 text-sm leading-6 text-emerald-950">
                  {pro}
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-[8px] border border-rose-200 bg-white p-5 shadow-sm">
            <h2 className="text-xl font-semibold text-rose-800">缺点</h2>
            <ul className="mt-4 space-y-3">
              {detail.displayCons.map((con, index) => (
                <li key={index} className="rounded-[8px] bg-rose-50 px-4 py-3 text-sm leading-6 text-rose-950">
                  {con}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {detail.displayEvidence.length > 0 && (
          <section className="mt-6 rounded-[8px] border border-stone-200 bg-white p-5 shadow-sm">
            <h2 className="text-xl font-semibold text-stone-950">关键证据片段</h2>
            <div className="mt-4 grid gap-3">
              {detail.displayEvidence.map((segment, index) => (
                <blockquote key={index} className="rounded-[8px] bg-stone-100 px-4 py-3 text-sm leading-6 text-stone-700">
                  <p>{segment.text}</p>
                  {segment.timestamp && (
                    <footer className="mt-2 text-xs text-stone-500">
                      时间点：{segment.timestamp}
                    </footer>
                  )}
                </blockquote>
              ))}
            </div>
          </section>
        )}
      </div>
    </main>
  )
}
