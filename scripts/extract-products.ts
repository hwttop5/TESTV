import 'dotenv/config'
import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { createPlaceholderExtraction, extractProductInfo } from '../lib/extraction'
import { parsePositiveInt, shouldPublishChineseProduct, toChineseStringArray, type ProductContentStatus } from '../lib/review-types'

function isEnabled(value: string | undefined): boolean {
  return value === '1' || value?.toLowerCase() === 'true'
}

function productNeedsReprocess(product: {
  contentStatus: string | null
  scoreValue: number | null
  prosZh: unknown
  consZh: unknown
}): boolean {
  if (!product.contentStatus) return true
  if (product.contentStatus !== 'complete') return true
  return product.scoreValue === null || toChineseStringArray(product.prosZh).length === 0 || toChineseStringArray(product.consZh).length === 0
}

function normalizeContentStatus(status: string | null | undefined): ProductContentStatus {
  if (status === 'complete' || status === 'partial' || status === 'placeholder') {
    return status
  }

  return 'placeholder'
}

async function buildProductData(video: {
  id: string
  title: string
  transcripts: Array<{
    content: string
    segments: unknown
  }>
}) {
  const transcript = video.transcripts[0]

  if (!transcript) {
    const placeholder = createPlaceholderExtraction(video.title)
    return {
      extracted: placeholder,
      contentStatus: placeholder.contentStatus,
      shouldPublish: false,
      lastError: '暂无字幕，已创建占位产品',
    }
  }

  const transcriptSegments = Array.isArray(transcript.segments)
    ? transcript.segments as unknown as Array<{ text: string; start: number; duration: number }>
    : undefined

  const extracted = await extractProductInfo(transcript.content, {
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || process.env.OPENAI_API_BASE_URL,
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    videoTitle: video.title,
    transcriptSegments,
  })

  const contentStatus = normalizeContentStatus(extracted.contentStatus)
  const shouldPublish = shouldPublishChineseProduct({
    scoreValue: extracted.scoreValue,
    prosZh: extracted.prosZh,
    consZh: extracted.consZh,
    hasTranscript: true,
  })

  return {
    extracted,
    contentStatus,
    shouldPublish,
    lastError: contentStatus === 'complete' ? null : '产品信息待补全',
  }
}

async function extractProducts() {
  console.log('开始抽取产品信息...')

  const maxAttempts = parsePositiveInt(process.env.EXTRACTION_MAX_ATTEMPTS, 3)
  const batchSize = parsePositiveInt(process.env.EXTRACTION_BATCH_SIZE, 10)
  const continuousMode = isEnabled(process.env.CONTINUOUS_MODE)
  const reprocessExisting = isEnabled(process.env.REPROCESS_ALL_PRODUCTS) || isEnabled(process.env.REPROCESS_MISSING_CHINESE)
  const forceRetryFailed = isEnabled(process.env.FORCE_RETRY_FAILED_EXTRACTIONS)

  let totalSuccess = 0
  let totalFailed = 0
  let iteration = 0

  do {
    iteration++
    console.log(`\n--- 第 ${iteration} 轮 ---`)

    const candidateVideos = await prisma.video.findMany({
      where: {
        ...(forceRetryFailed
          ? {}
          : {
              extractionAttempts: {
                lt: maxAttempts,
              },
            }),
      },
      include: {
        transcripts: {
          take: 1,
          orderBy: { createdAt: 'desc' },
        },
        product: true,
      },
      orderBy: {
        publishedAt: 'desc',
      },
      take: batchSize * 5,
    })

    const videos = candidateVideos
      .filter((video) => {
        if (!reprocessExisting) {
          return !video.product
        }

        if (!video.product) return true
        return productNeedsReprocess(video.product)
      })
      .sort((left, right) => {
        const leftHasTranscript = left.transcripts.length > 0 ? 1 : 0
        const rightHasTranscript = right.transcripts.length > 0 ? 1 : 0

        if (leftHasTranscript !== rightHasTranscript) {
          return rightHasTranscript - leftHasTranscript
        }

        return right.publishedAt.getTime() - left.publishedAt.getTime()
      })
      .slice(0, batchSize)

    console.log(`待处理视频：${videos.length}`)

    if (videos.length === 0) {
      console.log('没有待处理视频。')
      break
    }

    let successCount = 0
    let failedCount = 0

    for (const video of videos) {
      console.log(`处理：${video.title}`)

      try {
        const nextAttempts = forceRetryFailed ? video.extractionAttempts + 1 : undefined

        await prisma.video.update({
          where: { id: video.id },
          data: {
            extractionAttempts: nextAttempts ? nextAttempts : { increment: 1 },
            lastError: null,
          },
        })

        const { extracted, contentStatus, shouldPublish, lastError } = await buildProductData(video)

        const productData = {
          productName: extracted.productName,
          productNameZh: extracted.productNameZh,
          videoTitleZh: extracted.videoTitleZh,
          scoreRaw: extracted.scoreRaw,
          scoreValue: extracted.scoreValue,
          scoreScale: extracted.scoreScale,
          normalizedScore: extracted.normalizedScore,
          priceRaw: extracted.priceRaw,
          priceValue: extracted.priceValue,
          priceCurrency: extracted.priceCurrency,
          priceType: extracted.priceType,
          priceContext: extracted.priceContext,
          priceConfidence: extracted.priceConfidence,
          pros: extracted.pros as unknown as Prisma.InputJsonValue,
          cons: extracted.cons as unknown as Prisma.InputJsonValue,
          prosZh: extracted.prosZh as unknown as Prisma.InputJsonValue,
          consZh: extracted.consZh as unknown as Prisma.InputJsonValue,
          evidenceSegments: extracted.evidenceSegments as unknown as Prisma.InputJsonValue,
          evidenceSegmentsZh: extracted.evidenceSegmentsZh as unknown as Prisma.InputJsonValue,
          confidence: extracted.confidence,
          published: shouldPublish,
          contentStatus,
        }

        if (video.product) {
          await prisma.product.update({
            where: { id: video.product.id },
            data: productData,
          })
        } else {
          await prisma.product.create({
            data: {
              videoId: video.id,
              ...productData,
            },
          })
        }

        await prisma.video.update({
          where: { id: video.id },
          data: {
            syncStatus: 'extracted',
            lastExtractedAt: new Date(),
            lastError,
          },
        })

        console.log(`  产品：${extracted.productNameZh || extracted.productName}`)
        console.log(`  状态：${contentStatus}`)
        console.log(`  评分：${extracted.scoreRaw || '暂无评分'} (${extracted.scoreValue ?? 'N/A'}/10)`)
        successCount++
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.error(`  失败：${message}`)

        await prisma.video.update({
          where: { id: video.id },
          data: {
            syncStatus: 'failed',
            lastError: message,
          },
        })

        failedCount++
      }

      const delayMs = video.transcripts[0] ? 600 : 0
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs))
      }
    }

    totalSuccess += successCount
    totalFailed += failedCount

    console.log(`本轮完成：${successCount} 成功，${failedCount} 失败`)

    if (!continuousMode) {
      break
    }
  } while (true)

  console.log('\n=== 产品抽取汇总 ===')
  console.log(`成功：${totalSuccess}`)
  console.log(`失败：${totalFailed}`)
}

extractProducts()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
