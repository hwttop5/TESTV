import 'dotenv/config'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { extractPriceFromTranscript } from '../lib/price-extraction'
import { computeContentStatus } from '../lib/review-types'
import { normalizePublicList, normalizePublicText, normalizeToSimplifiedChinese } from '../lib/text-normalization'
import { deriveProsConsFromTranscript } from '../lib/transcript-insights'

type StatusRecord = {
  videoId: string
  youtubeId: string
  title: string
  publishedAt: string
  hasTranscript?: boolean
  source?: string | null
  transcriptStage?: string | null
  lastError?: string | null
}

type TranscriptRecord = {
  transcriptId: string
  videoId: string
  youtubeId: string
  title?: string
  publishedAt?: string
  language?: string | null
  source?: string | null
  content?: string | null
  segments?: unknown
}

type GapRecord = {
  productId: string
  youtubeId: string
  productName?: string | null
  productNameZh?: string | null
  videoTitle?: string | null
  videoTitleZh?: string | null
  publishedAt?: string | null
  suggestedScoreValue?: number | null
  suggestedScoreRaw?: string | null
}

type SuggestionRecord = {
  productId: string
  youtubeId: string
  suggestedScoreValue?: number | null
  suggestedScoreRaw?: string | null
  prosZh?: string[] | null
  consZh?: string[] | null
  confidence?: number | null
}

function isEnabled(value: string | undefined, fallback = false): boolean {
  if (!value) return fallback
  return value === '1' || value.toLowerCase() === 'true'
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

async function readJsonl<T>(filePath: string): Promise<T[]> {
  const raw = await readFile(filePath, 'utf8')

  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T)
}

function toThumbnailUrl(youtubeId: string): string {
  return `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`
}

function toVideoUrl(youtubeId: string): string {
  return `https://www.youtube.com/watch?v=${youtubeId}`
}

function normalizeNullableText(value: string | null | undefined, maxLength: number): string | null {
  const normalized = normalizePublicText(value, {
    allowEmpty: true,
    maxLength,
  })

  return normalized || null
}

function normalizeRawText(value: string | null | undefined, fallback = ''): string {
  const normalized = normalizeToSimplifiedChinese(value || '').trim()
  return normalized || fallback
}

function normalizeOpinionSeed(values: string[] | null | undefined): string[] {
  return normalizePublicList(Array.isArray(values) ? values : [], {
    maxItems: 3,
    maxLength: 42,
  })
}

async function main() {
  const dryRun = isEnabled(process.env.DRY_RUN, true)
  const force = isEnabled(process.env.FORCE_REIMPORT, false)
  const limit = parsePositiveInt(process.env.LIMIT, 1000)
  const baseDir = path.join(process.cwd(), 'data')
  const statusPath = path.join(baseDir, 'transcript-export', 'video-transcript-status.jsonl')
  const transcriptPath = path.join(baseDir, 'transcript-export', 'all-transcripts.jsonl')
  const gapsPath = path.join(baseDir, 'backfill-review', 'product-gaps.jsonl')
  const suggestionsPath = path.join(baseDir, 'backfill-review', 'product-suggestions.jsonl')

  const [statuses, transcripts, gaps, suggestions] = await Promise.all([
    readJsonl<StatusRecord>(statusPath),
    readJsonl<TranscriptRecord>(transcriptPath),
    readJsonl<GapRecord>(gapsPath),
    readJsonl<SuggestionRecord>(suggestionsPath),
  ])

  const existingVideoCount = await prisma.video.count()
  const existingProductCount = await prisma.product.count()

  if ((existingVideoCount > 0 || existingProductCount > 0) && !force) {
    throw new Error(`本地库已有数据：video=${existingVideoCount}, product=${existingProductCount}。如需覆盖，请显式传入 FORCE_REIMPORT=true。`)
  }

  if (!dryRun && force) {
    await prisma.affiliateLink.deleteMany()
    await prisma.product.deleteMany()
    await prisma.transcript.deleteMany()
    await prisma.video.deleteMany()
    await prisma.syncRun.deleteMany()
  }

  const statusByYoutubeId = new Map(statuses.map((item) => [item.youtubeId, item]))
  const transcriptByVideoId = new Map(transcripts.map((item) => [item.videoId, item]))
  const suggestionByProductId = new Map(suggestions.map((item) => [item.productId, item]))

  const selectedGaps = gaps.slice(0, limit)
  let importedVideos = 0
  let importedTranscripts = 0
  let importedProducts = 0

  for (const gap of selectedGaps) {
    const status = statusByYoutubeId.get(gap.youtubeId)
    if (!status) continue

    const transcript = transcriptByVideoId.get(status.videoId)
    const suggestion = suggestionByProductId.get(gap.productId)
    const transcriptContent = transcript?.content || ''

    const derivedOpinions = transcriptContent
      ? deriveProsConsFromTranscript({
          content: transcriptContent,
          segments: transcript?.segments,
        })
      : { pros: [], cons: [] }

    const prosZh = normalizeOpinionSeed(suggestion?.prosZh)
    const consZh = normalizeOpinionSeed(suggestion?.consZh)
    const finalProsZh = prosZh.length > 0 ? prosZh : derivedOpinions.pros
    const finalConsZh = consZh.length > 0 ? consZh : derivedOpinions.cons

    const scoreValue =
      typeof suggestion?.suggestedScoreValue === 'number' && Number.isFinite(suggestion.suggestedScoreValue)
        ? suggestion.suggestedScoreValue
        : typeof gap.suggestedScoreValue === 'number' && Number.isFinite(gap.suggestedScoreValue)
          ? gap.suggestedScoreValue
          : null

    const scoreRaw =
      normalizeNullableText(suggestion?.suggestedScoreRaw || gap.suggestedScoreRaw, 24) ||
      (scoreValue == null ? null : `${scoreValue}/10`)

    const price = transcriptContent
      ? extractPriceFromTranscript({
          productNameZh: gap.productNameZh,
          productName: gap.productName,
          videoTitleZh: gap.videoTitleZh,
          videoTitle: status.title,
          transcript: transcriptContent,
          transcriptSegments: transcript?.segments,
        })
      : null

    const contentStatus = computeContentStatus({
      scoreValue,
      prosZh: finalProsZh,
      consZh: finalConsZh,
      hasTranscript: Boolean(transcriptContent),
    })

    const videoData = {
      id: status.videoId,
      youtubeId: status.youtubeId,
      title: normalizeRawText(status.title, gap.videoTitle || gap.productName || status.youtubeId),
      publishedAt: new Date(status.publishedAt),
      thumbnailUrl: toThumbnailUrl(status.youtubeId),
      videoUrl: toVideoUrl(status.youtubeId),
      syncStatus: 'extracted',
      transcriptStage: status.transcriptStage || (transcriptContent ? 'synced' : 'pending'),
      lastTranscriptAt: transcriptContent ? new Date(status.publishedAt) : null,
      lastExtractedAt: new Date(status.publishedAt),
      lastError: normalizeNullableText(status.lastError, 400),
      isAvailable: true,
      unavailableReason: null,
    } satisfies Prisma.VideoUncheckedCreateInput

    const transcriptData = transcript
      ? {
          id: transcript.transcriptId,
          videoId: status.videoId,
          content: normalizeToSimplifiedChinese(transcriptContent),
          source: transcript.source || status.source || 'yt_dlp_subtitle',
          language: transcript.language || 'unknown',
          segments: transcript.segments as Prisma.InputJsonValue,
        } satisfies Prisma.TranscriptUncheckedCreateInput
      : null

    const productData = {
      id: gap.productId,
      videoId: status.videoId,
      productName: normalizeRawText(gap.productName, gap.videoTitle || status.title),
      productNameZh: normalizeNullableText(gap.productNameZh, 64),
      videoTitleZh: normalizeNullableText(gap.videoTitleZh, 96),
      scoreRaw,
      scoreValue,
      scoreScale: scoreValue == null ? null : '10',
      normalizedScore: scoreValue == null ? null : Math.round(scoreValue * 100) / 10,
      priceRaw: price?.priceRaw || null,
      priceValue: price?.priceValue || null,
      priceCurrency: price?.priceCurrency || null,
      priceType: price?.priceType || null,
      priceContext: price?.priceContext || null,
      priceConfidence: price?.priceConfidence || null,
      pros: [] as Prisma.InputJsonValue,
      cons: [] as Prisma.InputJsonValue,
      evidenceSegments: Prisma.DbNull,
      prosZh: finalProsZh as Prisma.InputJsonValue,
      consZh: finalConsZh as Prisma.InputJsonValue,
      evidenceSegmentsZh: Prisma.DbNull,
      confidence:
        typeof suggestion?.confidence === 'number' && Number.isFinite(suggestion.confidence)
          ? suggestion.confidence
          : transcriptContent
            ? 0.72
            : 0.42,
      published: contentStatus === 'complete',
      contentStatus,
    } satisfies Prisma.ProductUncheckedCreateInput

    if (dryRun) {
      console.log(JSON.stringify({
        action: 'dry-run',
        videoId: status.videoId,
        youtubeId: status.youtubeId,
        productId: gap.productId,
        contentStatus,
        scoreValue,
        priceRaw: price?.priceRaw || null,
      }))
      importedVideos += 1
      if (transcriptData) importedTranscripts += 1
      importedProducts += 1
      continue
    }

    await prisma.video.upsert({
      where: { id: status.videoId },
      update: videoData,
      create: videoData,
    })
    importedVideos += 1

    if (transcriptData) {
      await prisma.transcript.upsert({
        where: { id: transcriptData.id },
        update: transcriptData,
        create: transcriptData,
      })
      importedTranscripts += 1
    }

    await prisma.product.upsert({
      where: { id: gap.productId },
      update: productData,
      create: productData,
    })
    importedProducts += 1
  }

  console.log(JSON.stringify({
    dryRun,
    force,
    selected: selectedGaps.length,
    importedVideos,
    importedTranscripts,
    importedProducts,
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
