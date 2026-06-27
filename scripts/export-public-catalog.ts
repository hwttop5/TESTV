import 'dotenv/config'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import {
  type PublicCatalogProduct,
  type PublicCatalogSnapshot,
} from '../lib/public-catalog-store'
import { getPublicCatalogProductWhere } from '../lib/product-visibility'
import { toProductDetail } from '../lib/review-types'
import {
  hasEnglishSentence,
  isLikelyMojibake,
  isLikelyTraditionalText,
} from '../lib/text-normalization'

const publicCatalogInclude = {
  video: {
    include: {
      transcripts: {
        select: {
          id: true,
          content: true,
          segments: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
  },
  affiliateLinks: {
    select: {
      id: true,
      platform: true,
      url: true,
    },
  },
} satisfies Prisma.ProductInclude

type ExportProduct = Prisma.ProductGetPayload<{ include: typeof publicCatalogInclude }>

function isEnabled(value: string | undefined, fallback = false): boolean {
  if (!value) return fallback
  return value === '1' || value.toLowerCase() === 'true'
}

function getOutputPath(): string {
  return process.env.PUBLIC_CATALOG_PATH || path.join(process.cwd(), 'public-catalog', 'products.json')
}

function toPublicCatalogProduct(product: ExportProduct, sitemapOrder: number): PublicCatalogProduct {
  const detail = toProductDetail(product)

  return {
    ...detail,
    updatedAt: product.updatedAt.toISOString(),
    affiliateLinks: product.affiliateLinks.map((link) => ({
      id: link.id,
      platform: link.platform,
      url: link.url,
    })),
    searchIndex: [
      product.productName,
      product.productNameZh,
    ].filter((value): value is string => Boolean(value)),
    sitemapOrder,
  }
}

function collectDisplayTexts(product: PublicCatalogProduct): string[] {
  return [
    product.displayName,
    product.displayVideoTitle,
    product.displayPrice,
    product.statusLabel,
    product.statusDescription,
    product.categoryLabel,
    ...product.displayPros,
    ...product.displayCons,
    ...product.displayTranscriptParagraphs,
  ].filter(Boolean)
}

function validateSnapshot(snapshot: PublicCatalogSnapshot, sourceProducts: ExportProduct[]): string[] {
  const failures: string[] = []
  const productIds = new Set<string>()
  const videoIds = new Set<string>()
  const youtubeIds = new Set<string>()

  for (const product of sourceProducts) {
    if (videoIds.has(product.videoId)) {
      failures.push(`duplicate source videoId: ${product.videoId}`)
    }
    videoIds.add(product.videoId)
  }

  for (const product of snapshot.products) {
    if (productIds.has(product.id)) {
      failures.push(`duplicate product id: ${product.id}`)
    }
    if (youtubeIds.has(product.video.youtubeId)) {
      failures.push(`duplicate youtube id: ${product.video.youtubeId}`)
    }

    productIds.add(product.id)
    youtubeIds.add(product.video.youtubeId)

    for (const text of collectDisplayTexts(product)) {
      if (isLikelyMojibake(text)) failures.push(`mojibake text in ${product.id}: ${text.slice(0, 80)}`)
      if (isLikelyTraditionalText(text)) failures.push(`traditional text in ${product.id}: ${text.slice(0, 80)}`)
      if (hasEnglishSentence(text)) failures.push(`english sentence in ${product.id}: ${text.slice(0, 80)}`)
    }
  }

  const serialized = JSON.stringify(snapshot)
  const forbiddenPatterns: Array<[RegExp, string]> = [
    [/\b[A-Za-z]:[\\/]/, 'absolute Windows path'],
    [/(^|[^A-Za-z])\/(?:Users|home|srv|opt)\//, 'absolute Unix path'],
    [/data[\\/](?:asr|browser|bilibili|ytdlp|transcript-export|backfill-review)/i, 'raw data artifact path'],
    [/(?:SESSDATA|bili_jct|DedeUserID|youtube-cookies|cookie file)/i, 'cookie marker'],
    [/\.env(?:\.|")/i, '.env marker'],
  ]

  for (const [pattern, label] of forbiddenPatterns) {
    if (pattern.test(serialized)) failures.push(`forbidden ${label} found in public catalog snapshot`)
  }

  return failures
}

async function main() {
  const dryRun = isEnabled(process.env.DRY_RUN, false)
  const outputPath = getOutputPath()

  const sourceProducts = await prisma.product.findMany({
    where: getPublicCatalogProductWhere(),
    include: publicCatalogInclude,
    orderBy: {
      video: {
        publishedAt: 'desc',
      },
    },
  })

  const snapshot: PublicCatalogSnapshot = {
    version: 1,
    generatedAt: new Date().toISOString(),
    source: {
      type: 'prisma',
      productCount: sourceProducts.length,
    },
    products: sourceProducts.map((product, index) => toPublicCatalogProduct(product, index)),
  }

  const failures = validateSnapshot(snapshot, sourceProducts)
  if (failures.length > 0) {
    console.error('Public catalog export failed validation:')
    for (const failure of failures.slice(0, 80)) {
      console.error(`- ${failure}`)
    }
    if (failures.length > 80) {
      console.error(`- ... ${failures.length - 80} more`)
    }
    process.exitCode = 1
    return
  }

  console.log(JSON.stringify({
    dryRun,
    outputPath,
    products: snapshot.products.length,
    generatedAt: snapshot.generatedAt,
  }, null, 2))

  if (dryRun) return

  await mkdir(path.dirname(outputPath), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8')
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
