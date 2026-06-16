import Image from 'next/image'
import Link from 'next/link'
import type { ProductSummary } from '@/lib/review-types'

function scoreTone(score: number | null): string {
  if (score == null) return 'border-stone-200 bg-stone-50 text-stone-500'
  if (score >= 85) return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  if (score >= 70) return 'border-amber-200 bg-amber-50 text-amber-700'
  return 'border-rose-200 bg-rose-50 text-rose-700'
}

export default function ProductCard({ product }: { product: ProductSummary }) {
  const date = new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(product.video.publishedAt))

  return (
    <Link
      href={`/products/${product.id}`}
      className="group block rounded-[8px] border border-stone-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-stone-300 hover:shadow-md"
    >
      <article className="grid gap-4 sm:grid-cols-[176px_1fr_auto] sm:items-start">
        <div className="relative aspect-video overflow-hidden rounded-[8px] bg-stone-100">
          {product.video.thumbnailUrl ? (
            <Image
              src={product.video.thumbnailUrl}
              alt={product.displayName}
              fill
              unoptimized
              sizes="(max-width: 640px) 100vw, 176px"
              className="object-cover transition duration-300 group-hover:scale-105"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-stone-400">
              无缩略图
            </div>
          )}
        </div>

        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs text-stone-500">
            <span>{date}</span>
            {product.confidence !== null && (
              <span>置信度 {(product.confidence * 100).toFixed(0)}%</span>
            )}
          </div>

          <h3 className="mt-2 line-clamp-2 text-lg font-semibold leading-snug text-stone-950">
            {product.displayName}
          </h3>

          <p className="mt-1 line-clamp-1 text-sm text-stone-500">
            来源：{product.displayVideoTitle || '暂无中文标题'}
          </p>

          <div className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
            <p className="rounded-[8px] bg-emerald-50 px-3 py-2 text-emerald-800">
              优点 {product.displayPros.length} 条
            </p>
            <p className="rounded-[8px] bg-rose-50 px-3 py-2 text-rose-800">
              缺点 {product.displayCons.length} 条
            </p>
          </div>
        </div>

        <div className={`flex h-24 min-w-24 flex-col items-center justify-center rounded-[8px] border ${scoreTone(product.normalizedScore)}`}>
          <span className="text-3xl font-bold leading-none">
            {product.normalizedScore === null ? '-' : product.normalizedScore.toFixed(0)}
          </span>
          <span className="mt-1 text-xs font-medium">/ 100</span>
          {product.scoreRaw && (
            <span className="mt-1 max-w-20 truncate text-xs opacity-80" title={product.scoreRaw}>
              {product.scoreRaw}
            </span>
          )}
        </div>
      </article>
    </Link>
  )
}
