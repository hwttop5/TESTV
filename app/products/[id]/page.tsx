import Image from 'next/image'
import Link from 'next/link'
import { cache } from 'react'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getPublicCatalogProduct } from '@/lib/public-catalog-store'
import { formatScoreValue } from '@/lib/scoring'
import {
  absoluteImageUrl,
  buildBreadcrumbJsonLd,
  canonicalUrl,
  deriveBrandName,
  jsonLdScript,
  SITE_NAME,
  truncateMetaDescription,
} from '@/lib/seo'
import { isPublicCatalogProductId } from '@/lib/product-visibility'

// The local Windows sandbox can fail on the ISR/prerender worker path with
// `spawn EPERM`, so keep detail pages request-rendered from stored data.
export const dynamic = 'force-dynamic'

type ProductPageProps = {
  params: Promise<{ id: string }>
}

function statusTone(status: 'complete' | 'partial' | 'placeholder'): string {
  if (status === 'complete') return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
  if (status === 'partial') return 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300'
  return 'bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300'
}

function YouTubeLogo() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4 shrink-0">
      <path
        fill="currentColor"
        d="M21.6 7.2a3 3 0 0 0-2.1-2.12C17.64 4.6 12 4.6 12 4.6s-5.64 0-7.5.48A3 3 0 0 0 2.4 7.2 31.2 31.2 0 0 0 1.9 12a31.2 31.2 0 0 0 .5 4.8 3 3 0 0 0 2.1 2.12c1.86.48 7.5.48 7.5.48s5.64 0 7.5-.48a3 3 0 0 0 2.1-2.12 31.2 31.2 0 0 0 .5-4.8 31.2 31.2 0 0 0-.5-4.8ZM10 15.45v-6.9L15.75 12 10 15.45Z"
      />
    </svg>
  )
}

const getProductForPage = cache(async (id: string) => {
  return getPublicCatalogProduct(id)
})

export async function generateMetadata({ params }: ProductPageProps): Promise<Metadata> {
  const { id } = await params
  if (!isPublicCatalogProductId(id)) {
    return {
      title: `产品不存在 | ${SITE_NAME}`,
      robots: { index: false, follow: false },
    }
  }

  const product = await getProductForPage(id)

  if (!product) {
    return {
      title: `产品不存在 | ${SITE_NAME}`,
      robots: { index: false, follow: false },
    }
  }

  const detail = product
  const scoreText = detail.scoreValue === null ? '暂无评分' : `${formatScoreValue(detail.scoreValue)}/10`
  const description = truncateMetaDescription(
    `${detail.displayName} TESTV 评测整理，视频评分 ${scoreText}，包含优点、缺点、字幕文字版和原视频链接。`,
  )
  const url = canonicalUrl(`/products/${id}`)
  const image = absoluteImageUrl(detail.video.thumbnailUrl)

  return {
    title: `${detail.displayName} 值不值得买`,
    description,
    alternates: {
      canonical: url,
    },
    openGraph: {
      title: `${detail.displayName} 值不值得买`,
      description,
      url,
      siteName: SITE_NAME,
      type: 'article',
      locale: 'zh_CN',
      images: [
        {
          url: image,
          alt: detail.displayName,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: `${detail.displayName} 值不值得买`,
      description,
      images: [image],
    },
  }
}

export default async function ProductPage({ params }: ProductPageProps) {
  const { id } = await params
  if (!isPublicCatalogProductId(id)) {
    notFound()
  }

  const product = await getProductForPage(id)

  if (!product) {
    notFound()
  }

  const detail = product
  const date = new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(detail.video.publishedAt))

  const affiliateLinks = product.affiliateLinks.filter((link) => Boolean(link.url))
  const scoreText = detail.scoreValue === null ? '-' : formatScoreValue(detail.scoreValue)
  const productUrl = canonicalUrl(`/products/${id}`)
  const productImage = absoluteImageUrl(detail.video.thumbnailUrl)
  const reviewBody = [...detail.displayPros, ...detail.displayCons].join('；')
  const videoDescription = truncateMetaDescription(`${detail.displayName} 的 TESTV 视频评测文字版。`)
  const rating = detail.scoreValue === null
    ? undefined
    : {
        '@type': 'Rating',
        ratingValue: detail.scoreValue,
        bestRating: 10,
        worstRating: 0,
      }
  const aggregateRating = rating
    ? {
        '@type': 'AggregateRating',
        ratingValue: detail.scoreValue,
        bestRating: 10,
        worstRating: 0,
        reviewCount: 1,
      }
    : undefined
  const productOffer = detail.priceValue == null
    ? undefined
    : {
        '@type': 'Offer',
        price: detail.priceValue,
        priceCurrency: detail.priceCurrency || 'CNY',
        availability: 'https://schema.org/InStock',
        url: productUrl,
      }
  const brand = deriveBrandName(detail.displayName)

  let youtubeId = ''
  try {
    youtubeId = new URL(detail.video.videoUrl).searchParams.get('v') || ''
  } catch {
    youtubeId = ''
  }

  const jsonLd = [
    buildBreadcrumbJsonLd([
      { name: SITE_NAME, path: '/' },
      { name: detail.displayName, path: `/products/${id}` },
    ]),
    {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: detail.displayName,
      image: [productImage],
      description: truncateMetaDescription(`${detail.displayName} 的 TESTV 评测整理，包含评分、优点、缺点和字幕文字版。`),
      category: detail.categoryLabel,
      url: productUrl,
      ...(brand ? { brand: { '@type': 'Brand', name: brand } } : {}),
      ...(aggregateRating ? { aggregateRating } : {}),
      ...(productOffer ? { offers: productOffer } : {}),
      review: {
        '@type': 'Review',
        name: `${detail.displayName} 值不值得买`,
        reviewBody,
        inLanguage: 'zh-CN',
        author: {
          '@type': 'Organization',
          name: 'TESTV',
        },
        ...(rating ? { reviewRating: rating } : {}),
      },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'VideoObject',
      name: detail.displayVideoTitle,
      description: videoDescription,
      thumbnailUrl: [productImage],
      uploadDate: detail.video.publishedAt,
      embedUrl: youtubeId ? `https://www.youtube.com/embed/${youtubeId}` : detail.video.videoUrl,
      contentUrl: detail.video.videoUrl,
      url: detail.video.videoUrl,
      inLanguage: 'zh-CN',
    },
  ]

  return (
    <main className="min-h-screen bg-background">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(jsonLd) }}
      />
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 rounded-control border border-foreground/15 bg-white px-4 py-2 text-sm font-medium text-foreground/80 transition hover:border-foreground/30 hover:bg-white dark:bg-stone-900 dark:hover:bg-stone-800"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-4 w-4"
            aria-hidden="true"
          >
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          返回列表
        </Link>

        <section className="mt-6 overflow-hidden rounded-panel border border-foreground/10 bg-white p-5 shadow-card dark:border-white/10 dark:bg-stone-900 sm:p-6">
          <div className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
            <div className="relative aspect-video overflow-hidden rounded-card bg-stone-100 dark:bg-stone-800">
              {detail.video.thumbnailUrl ? (
                <Image
                  src={detail.video.thumbnailUrl}
                  alt={detail.displayName}
                  fill
                  priority
                  unoptimized
                  sizes="(max-width: 1024px) 100vw, 360px"
                  className="object-cover"
                />
              ) : (
                <div className="flex h-full items-center justify-center text-stone-400 dark:text-stone-500">
                  暂无缩略图
                </div>
              )}
            </div>

            <div className="min-w-0">
              <div className="inline-flex items-center gap-2 rounded-full border border-foreground/10 bg-background px-3 py-2 text-xs font-medium uppercase tracking-[0.14em] text-foreground/70 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand text-[10px] text-white">TV</span>
                TESTV
              </div>

              <h1 className="mt-4 font-display text-3xl font-medium leading-tight text-foreground sm:text-4xl">
                {detail.displayName}
              </h1>

              <div className="mt-4 flex flex-wrap items-center gap-2 text-sm text-foreground/60 dark:text-stone-400">
                <span className={`rounded-full px-2.5 py-1 ${statusTone(detail.contentStatus)}`}>
                  {detail.statusLabel}
                </span>
                <span className="rounded-full bg-background px-2.5 py-1 text-foreground/70 dark:bg-stone-800 dark:text-stone-300">
                  {detail.categoryLabel}
                </span>
                {detail.statusDescription && <span>{detail.statusDescription}</span>}
              </div>

              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                <div className="rounded-card border border-foreground/10 bg-background px-5 py-4 dark:border-stone-700 dark:bg-stone-800">
                  <p className="text-sm text-foreground/60 dark:text-stone-400">视频评分</p>
                  <p className="mt-1 text-4xl font-semibold text-foreground">
                    {scoreText}
                    <span className="text-lg font-medium text-foreground/50 dark:text-stone-400"> / 10</span>
                  </p>
                </div>

                <div className="rounded-card border border-foreground/10 bg-background px-5 py-4 dark:border-stone-700 dark:bg-stone-800">
                  <p className="text-sm text-foreground/60 dark:text-stone-400">抽取置信度</p>
                  <p className="mt-1 text-4xl font-semibold text-foreground">
                    {detail.confidence === null ? '-' : `${(detail.confidence * 100).toFixed(0)}%`}
                  </p>
                </div>
              </div>

              {detail.displayPrice && (
                <div className="mt-3 rounded-card border border-foreground/10 bg-background px-5 py-4 dark:border-stone-700 dark:bg-stone-800">
                  <p className="font-display text-2xl font-semibold text-foreground">
                    {detail.displayPrice}
                  </p>
                </div>
              )}

              <div className="mt-5 space-y-1 text-sm text-foreground/60 dark:text-stone-400">
                <p>来源视频：{detail.displayVideoTitle}</p>
                <p>发布日期：{date}</p>
              </div>

              <div className="mt-6 flex flex-wrap gap-2">
                <a
                  href={detail.videoLinks.youtube}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-control bg-brand px-5 py-2.5 text-sm font-medium text-white transition hover:bg-brand-strong"
                >
                  <YouTubeLogo />
                  YouTube 视频
                </a>
                {affiliateLinks.map((link) => (
                  <a
                    key={link.id}
                    href={link.url || undefined}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex rounded-control border border-emerald-200 bg-emerald-50 px-5 py-2.5 text-sm font-medium text-emerald-800 transition hover:bg-emerald-100 dark:border-emerald-800/50 dark:bg-emerald-950/30 dark:text-emerald-300 dark:hover:bg-emerald-950/50"
                  >
                    {link.platform === 'jd' ? '京东链接' : link.platform === 'taobao' ? '淘宝链接' : '购买链接'}
                  </a>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="mt-6 grid gap-5 md:grid-cols-2">
          <div className="rounded-card border border-emerald-200 bg-white p-5 shadow-card dark:border-emerald-800/40 dark:bg-stone-900">
            <h2 className="font-display text-xl font-medium text-foreground">优点</h2>
            <ul className="mt-4 space-y-3">
              {detail.displayPros.map((pro, index) => (
                <li key={index} className="rounded-control border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm leading-6 text-emerald-950 dark:border-emerald-800/40 dark:bg-emerald-950/30 dark:text-emerald-200">
                  {pro}
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-card border border-rose-200 bg-white p-5 shadow-card dark:border-rose-800/40 dark:bg-stone-900">
            <h2 className="font-display text-xl font-medium text-foreground">缺点</h2>
            <ul className="mt-4 space-y-3">
              {detail.displayCons.map((con, index) => (
                <li key={index} className="rounded-control border border-rose-100 bg-rose-50 px-4 py-3 text-sm leading-6 text-rose-950 dark:border-rose-800/40 dark:bg-rose-950/30 dark:text-rose-200">
                  {con}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="mt-6 rounded-card border border-foreground/10 bg-white p-5 shadow-card dark:border-white/10 dark:bg-stone-900">
          <h2 className="font-display text-xl font-medium text-foreground">纯文字版</h2>
          <div className="mt-4 rounded-card bg-background px-4 py-4 text-sm leading-8 text-foreground/75 dark:bg-stone-800 dark:text-stone-300">
            {detail.displayTranscriptParagraphs.map((paragraph, index) => (
              <p key={index}>{paragraph}</p>
            ))}
          </div>
        </section>
      </div>
    </main>
  )
}
