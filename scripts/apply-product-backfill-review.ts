import 'dotenv/config'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import {
  buildApplyPlan,
  normalizeSuggestion,
  type ProductBackfillSuggestion,
} from '../lib/product-backfill-review'
import { isPublicCatalogProductId } from '../lib/product-visibility'

const DEFAULT_REVIEW_FILE = path.join(process.cwd(), 'data', 'backfill-review', 'product-suggestions.jsonl')

function isEnabled(value: string | undefined, fallback = false): boolean {
  if (value == null) return fallback
  return value === '1' || value.toLowerCase() === 'true'
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

async function readSuggestions(filePath: string): Promise<ProductBackfillSuggestion[]> {
  const content = await readFile(filePath, 'utf8')
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => normalizeSuggestion(JSON.parse(line) as Partial<ProductBackfillSuggestion>))
}

async function main() {
  const reviewFile = process.env.REVIEW_FILE || DEFAULT_REVIEW_FILE
  const dryRun = isEnabled(process.env.DRY_RUN, true)
  const applyHumanReview = isEnabled(process.env.APPLY_HUMAN_REVIEW, false)
  const limit = parsePositiveInt(process.env.LIMIT, Number.MAX_SAFE_INTEGER)
  const offset = Number.parseInt(process.env.OFFSET || '0', 10) || 0
  const target = (process.env.TARGET_PRODUCT || '').trim()

  const suggestions = (await readSuggestions(reviewFile))
    .filter((suggestion) => isPublicCatalogProductId(suggestion.productId))
    .filter((suggestion) => !target || [
      suggestion.productId,
      suggestion.youtubeId,
      suggestion.reason,
    ].filter(Boolean).join(' ').toLowerCase().includes(target.toLowerCase()))
    .slice(offset, offset + limit)

  const summary = {
    reviewFile,
    dryRun,
    applyHumanReview,
    scanned: suggestions.length,
    wouldWrite: 0,
    written: 0,
    skipped: 0,
    reviewSkipped: 0,
    missingProduct: 0,
    errors: 0,
  }

  for (const suggestion of suggestions) {
    const product = await prisma.product.findUnique({
      where: { id: suggestion.productId },
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
    })

    if (!product) {
      summary.missingProduct++
      console.warn(`跳过 ${suggestion.productId}：产品不存在。`)
      continue
    }

    const plan = buildApplyPlan({
      current: product,
      suggestion,
      applyHumanReview,
    })

    if (!plan.shouldWrite) {
      summary.skipped++
      if (suggestion.needsHumanReview) summary.reviewSkipped++
      console.log(JSON.stringify({
        productId: product.id,
        youtubeId: product.video.youtubeId,
        action: 'skip',
        reason: plan.skipReason,
      }))
      continue
    }

    summary.wouldWrite++
    console.log(JSON.stringify({
      productId: product.id,
      youtubeId: product.video.youtubeId,
      action: dryRun ? 'dry-run' : 'write',
      data: plan.data,
    }))

    if (!dryRun) {
      try {
        await prisma.product.update({
          where: { id: product.id },
          data: {
            ...(plan.data.scoreRaw != null ? { scoreRaw: plan.data.scoreRaw } : {}),
            ...(plan.data.scoreValue != null ? { scoreValue: plan.data.scoreValue } : {}),
            ...(plan.data.scoreScale != null ? { scoreScale: plan.data.scoreScale } : {}),
            ...(plan.data.normalizedScore != null ? { normalizedScore: plan.data.normalizedScore } : {}),
            ...(plan.data.prosZh ? { prosZh: plan.data.prosZh as unknown as Prisma.InputJsonValue } : {}),
            ...(plan.data.consZh ? { consZh: plan.data.consZh as unknown as Prisma.InputJsonValue } : {}),
            ...(plan.data.contentStatus ? { contentStatus: plan.data.contentStatus } : {}),
            ...(plan.data.confidence != null ? { confidence: plan.data.confidence } : {}),
          },
        })
        summary.written++
      } catch (error) {
        summary.errors++
        const message = error instanceof Error ? error.message : String(error)
        console.error(`写入失败 ${product.id}：${message}`)
      }
    }
  }

  console.log('=== Apply Product Backfill Review ===')
  console.log(JSON.stringify(summary, null, 2))
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
