import 'dotenv/config'
import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { extractProductInfo } from '../lib/extraction'
import { parsePositiveInt, shouldPublishChineseProduct, toChineseStringArray } from '../lib/review-types'

function isEnabled(value: string | undefined): boolean {
  return value === '1' || value?.toLowerCase() === 'true'
}

function productNeedsChineseReprocess(product: {
  productNameZh: string | null
  normalizedScore: number | null
  prosZh: unknown
  consZh: unknown
}): boolean {
  return Boolean(
    !product.productNameZh?.trim() ||
    product.normalizedScore === null ||
    toChineseStringArray(product.prosZh).length === 0 ||
    toChineseStringArray(product.consZh).length === 0
  )
}

async function extractProducts() {
  console.log('Extracting product info from transcripts...')

  const apiKey = process.env.OPENAI_API_KEY
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini'

  if (!apiKey) {
    console.error('Missing OPENAI_API_KEY')
    process.exit(1)
  }

  const maxAttempts = parsePositiveInt(process.env.EXTRACTION_MAX_ATTEMPTS, 3)
  const batchSize = parsePositiveInt(process.env.EXTRACTION_BATCH_SIZE, 10)
  const continuousMode = isEnabled(process.env.CONTINUOUS_MODE)
  const reprocessMissingChinese = isEnabled(process.env.REPROCESS_MISSING_CHINESE)

  let totalSuccess = 0
  let totalFailed = 0
  let iteration = 0

  do {
    iteration++
    console.log(`\n--- Iteration ${iteration} ---`)

    const candidateVideos = await prisma.video.findMany({
      where: {
        transcripts: {
          some: {},
        },
        products: reprocessMissingChinese ? { some: {} } : { none: {} },
        extractionAttempts: {
          lt: maxAttempts,
        },
      },
      include: {
        transcripts: {
          take: 1,
          orderBy: { createdAt: 'desc' },
        },
        products: {
          take: 1,
          orderBy: { updatedAt: 'desc' },
        },
      },
      orderBy: {
        publishedAt: 'desc',
      },
      take: reprocessMissingChinese ? batchSize * 5 : batchSize,
    })

    const videos = reprocessMissingChinese
      ? candidateVideos.filter((video) => video.products.some(productNeedsChineseReprocess)).slice(0, batchSize)
      : candidateVideos

    console.log(`Found ${videos.length} videos to process`)

    if (videos.length === 0) {
      console.log('No more videos to process.')
      break
    }

    let successCount = 0
    let failedCount = 0

    for (const video of videos) {
      console.log(`Processing: ${video.title}`)

      const transcript = video.transcripts[0]
      if (!transcript) {
        console.log('  No transcript found')
        failedCount++
        continue
      }

      try {
        await prisma.video.update({
          where: { id: video.id },
          data: {
            extractionAttempts: { increment: 1 },
            lastError: null,
          },
        })

        const extracted = await extractProductInfo(transcript.content, apiKey, model, video.title)
        const shouldPublish = shouldPublishChineseProduct(extracted)
        const productData = {
          productName: extracted.productName,
          productNameZh: extracted.productNameZh,
          videoTitleZh: extracted.videoTitleZh,
          scoreRaw: extracted.scoreRaw,
          scoreValue: extracted.scoreValue,
          scoreScale: extracted.scoreScale,
          normalizedScore: extracted.normalizedScore,
          pros: extracted.pros as unknown as Prisma.InputJsonValue,
          cons: extracted.cons as unknown as Prisma.InputJsonValue,
          prosZh: extracted.prosZh as unknown as Prisma.InputJsonValue,
          consZh: extracted.consZh as unknown as Prisma.InputJsonValue,
          evidenceSegments: extracted.evidenceSegments as unknown as Prisma.InputJsonValue,
          evidenceSegmentsZh: extracted.evidenceSegmentsZh as unknown as Prisma.InputJsonValue,
          confidence: extracted.confidence,
          published: shouldPublish,
        }

        const existingProduct = video.products[0]
        if (existingProduct && reprocessMissingChinese) {
          await prisma.product.update({
            where: { id: existingProduct.id },
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
            lastError: shouldPublish ? null : 'Extracted product did not meet Chinese publish criteria',
          },
        })

        console.log(`  Product extracted: ${extracted.productNameZh || extracted.productName || '(empty)'}`)
        console.log(`  Score: ${extracted.scoreRaw || 'N/A'} (${extracted.normalizedScore ?? 'N/A'})`)
        console.log(`  Confidence: ${(extracted.confidence * 100).toFixed(1)}%`)
        console.log(`  Published: ${shouldPublish ? 'Yes' : 'No'}`)
        successCount++
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.error(`  Extraction failed: ${message}`)

        await prisma.video.update({
          where: { id: video.id },
          data: {
            syncStatus: 'failed',
            lastError: message,
          },
        })

        failedCount++
      }

      await new Promise((resolve) => setTimeout(resolve, 2000))
    }

    totalSuccess += successCount
    totalFailed += failedCount

    console.log(`Iteration ${iteration} complete: ${successCount} success, ${failedCount} failed`)

    if (!continuousMode) {
      break
    }
  } while (true)

  console.log(`\n=== Final Summary ===`)
  console.log(`Total success: ${totalSuccess}`)
  console.log(`Total failed: ${totalFailed}`)
}

extractProducts()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
