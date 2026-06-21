import 'dotenv/config'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { prisma } from '../lib/prisma'
import {
  buildProductGapReviewRow,
  productGapRowsToCsv,
  productGapRowsToSummary,
} from '../lib/product-backfill-review'
import { isPublicCatalogProductId } from '../lib/product-visibility'

const OUTPUT_DIR = path.join(process.cwd(), 'data', 'backfill-review')
const JSONL_PATH = path.join(OUTPUT_DIR, 'product-gaps.jsonl')
const CSV_PATH = path.join(OUTPUT_DIR, 'product-gaps.csv')

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function matchesTarget(product: {
  id: string
  productName: string
  productNameZh: string | null
  videoTitleZh: string | null
  video: {
    youtubeId: string
    title: string
  }
}, target: string): boolean {
  if (!target) return true
  const haystack = [
    product.id,
    product.productName,
    product.productNameZh,
    product.videoTitleZh,
    product.video.youtubeId,
    product.video.title,
  ].filter(Boolean).join(' ').toLowerCase()

  return haystack.includes(target.toLowerCase())
}

async function main() {
  const limit = parsePositiveInt(process.env.LIMIT, Number.MAX_SAFE_INTEGER)
  const offset = Number.parseInt(process.env.OFFSET || '0', 10) || 0
  const target = (process.env.TARGET_PRODUCT || '').trim()

  const products = await prisma.product.findMany({
    include: {
      video: {
        include: {
          transcripts: {
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      },
    },
    orderBy: {
      video: {
        publishedAt: 'desc',
      },
    },
  })

  const selectedProducts = products
    .filter((product) => isPublicCatalogProductId(product.id))
    .filter((product) => matchesTarget(product, target))
    .slice(offset, offset + limit)
  const rows = selectedProducts.map((product) => buildProductGapReviewRow(product))
  const summary = productGapRowsToSummary(rows)

  await mkdir(OUTPUT_DIR, { recursive: true })
  await writeFile(JSONL_PATH, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8')
  await writeFile(CSV_PATH, productGapRowsToCsv(rows), 'utf8')

  console.log('=== Product Gap Audit ===')
  console.log(JSON.stringify({
    outputJsonl: JSONL_PATH,
    outputCsv: CSV_PATH,
    totalProductsInDb: products.length,
    selected: selectedProducts.length,
    target: target || null,
    offset,
    limit: limit === Number.MAX_SAFE_INTEGER ? null : limit,
    ...summary,
  }, null, 2))
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
