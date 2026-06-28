import Image from 'next/image'
import Link from 'next/link'
import type { ProductListItem } from '@/lib/review-types'
import { formatScoreValue } from '@/lib/scoring'

function scoreTone(score: number | null): string {
  if (score == null) return 'border-stone-200 bg-stone-50 text-stone-500 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-400'
  if (score >= 8.5) return 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700/60 dark:bg-emerald-950/40 dark:text-emerald-300'
  if (score >= 7) return 'border-stone-300 bg-stone-100 text-stone-800 dark:border-stone-600 dark:bg-stone-800 dark:text-stone-200'
  return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-300'
}

// Text verdict so rating is not conveyed by color alone (a11y)
function scoreVerdict(score: number | null): string {
  if (score == null) return '待评分'
  if (score >= 8.5) return '推荐'
  if (score >= 7) return '不错'
  return '一般'
}

function statusTone(status: ProductListItem['contentStatus']): string {
  if (status === 'complete') return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
  if (status === 'partial') return 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300'
  return 'bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300'
}

export default function ProductCard({ product }: { product: ProductListItem }) {
  const date = new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(product.video.publishedAt))
  const scoreText = product.scoreValue === null ? '-' : formatScoreValue(product.scoreValue)

  return (
    <Link
      href={`/products/${product.id}`}
      className="group block rounded-card border border-stone-300/70 bg-white p-4 transition duration-200 hover:-translate-y-0.5 hover:border-brand hover:shadow-card dark:border-white/10 dark:bg-stone-900 dark:hover:border-brand/60"
    >
      <article className="grid gap-4 sm:grid-cols-[200px_minmax(0,1fr)] sm:items-start lg:grid-cols-[224px_minmax(0,1fr)_124px]">
        <div className="relative aspect-video overflow-hidden rounded-control bg-stone-100 dark:bg-stone-800">
          {product.video.thumbnailUrl ? (
            <Image
              src={product.video.thumbnailUrl}
              alt={product.displayName}
              fill
              unoptimized
              sizes="(max-width: 640px) 100vw, (max-width: 1024px) 200px, 224px"
              className="object-cover transition duration-300 group-hover:scale-[1.03]"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-stone-400 dark:text-stone-500">
              暂无缩略图
            </div>
          )}
        </div>

        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs text-stone-600 dark:text-stone-400">
            <span>{date}</span>
            <span className={`rounded-full px-2.5 py-1 ${statusTone(product.contentStatus)}`}>
              {product.statusLabel}
            </span>
            <span className="rounded-full bg-stone-100 px-2.5 py-1 text-stone-600 dark:bg-stone-800 dark:text-stone-300">
              {product.categoryLabel}
            </span>
          </div>

          <h3 className="mt-3 line-clamp-2 font-display text-xl font-medium leading-snug text-stone-950 dark:text-stone-50">
            {product.displayName}
          </h3>

          <p className="mt-2 line-clamp-1 text-sm text-stone-600 dark:text-stone-400">
            来源：{product.displayVideoTitle}
          </p>

          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <div className="rounded-control border border-emerald-100 bg-emerald-50/70 px-3 py-3 dark:border-emerald-800/50 dark:bg-emerald-950/30">
              <p className="text-[11px] uppercase tracking-[0.12em] text-emerald-700/80 dark:text-emerald-400/90">优点</p>
              <p className="mt-1 text-sm font-medium text-emerald-950 dark:text-emerald-200">{product.prosCount} 条</p>
            </div>
            <div className="rounded-control border border-rose-100 bg-rose-50/70 px-3 py-3 dark:border-rose-800/50 dark:bg-rose-950/30">
              <p className="text-[11px] uppercase tracking-[0.12em] text-rose-700/80 dark:text-rose-400/90">缺点</p>
              <p className="mt-1 text-sm font-medium text-rose-950 dark:text-rose-200">{product.consCount} 条</p>
            </div>
          </div>

          {product.statusDescription && (
            <p className="mt-4 line-clamp-2 text-sm leading-6 text-stone-600 dark:text-stone-400">
              {product.statusDescription}
            </p>
          )}
        </div>

        <div className={`flex items-center justify-center gap-3 rounded-card border px-4 py-3 sm:col-span-2 lg:col-span-1 lg:min-h-[124px] lg:min-w-[124px] lg:flex-col lg:gap-0 lg:px-3 lg:py-4 ${scoreTone(product.scoreValue)}`}>
          <span className="text-3xl font-semibold leading-none">
            {scoreText}
          </span>
          <span className="text-[11px] font-medium lg:mt-0.5">/ 10</span>
          <span className="text-[11px] font-semibold lg:mt-1">{scoreVerdict(product.scoreValue)}</span>
          {product.displayPrice && (
            <span className="mt-2 w-full border-t border-current/15 pt-2 text-center text-xs font-semibold leading-4">
              {product.displayPrice}
            </span>
          )}
        </div>
      </article>
    </Link>
  )
}
