import 'dotenv/config'
import { prisma } from '../lib/prisma'
import { buildOpenAiHeaders, buildOpenAiUrl } from '../lib/openai-client'
import { resolveOpenAiRuntimeConfigs, type OpenAiRuntimeConfig } from '../lib/openai-runtime-config'
import {
  extractPriceFromTranscript,
  normalizeAiPriceExtractionResult,
  shouldSkipPriceExtraction,
  type PriceExtractionResult,
} from '../lib/price-extraction'
import { isPublicCatalogProductId } from '../lib/product-visibility'
import { parsePositiveInt } from '../lib/review-types'

function isEnabled(value: string | undefined, fallback = false): boolean {
  if (value == null || value === '') return fallback
  return value === '1' || value.toLowerCase() === 'true'
}

function safeJsonParse(content: string): unknown {
  const normalized = content.trim()
  const firstObjectStart = normalized.indexOf('{')
  const lastObjectEnd = normalized.lastIndexOf('}')
  const candidates = [
    normalized,
    normalized.match(/```json\s*([\s\S]*?)```/i)?.[1] || '',
    normalized.match(/```([\s\S]*?)```/i)?.[1] || '',
    firstObjectStart >= 0 && lastObjectEnd > firstObjectStart
      ? normalized.slice(firstObjectStart, lastObjectEnd + 1)
      : '',
  ].filter(Boolean)

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate)
    } catch {
      // try next candidate
    }
  }

  throw new Error(`AI 返回内容不是合法 JSON：${content.slice(0, 240)}`)
}

function truncateForAi(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) return normalized

  const half = Math.floor(maxLength / 2)
  return `${normalized.slice(0, half)}\n...\n${normalized.slice(-half)}`
}

async function callAiPriceExtraction(input: {
  config: OpenAiRuntimeConfig
  productName: string
  productNameZh: string | null
  videoTitle: string
  videoTitleZh: string | null
  transcript: string
  timeoutMs: number
  maxTranscriptChars: number
}): Promise<PriceExtractionResult | null> {
  const response = await fetch(buildOpenAiUrl('/v1/chat/completions', input.config.baseUrl), {
    method: 'POST',
    headers: {
      ...buildOpenAiHeaders(input.config.apiKey),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: input.config.model,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: [
            '你是 TESTV 字幕价格提取器，只返回严格 JSON，不要 Markdown。',
            '只能根据用户提供的字幕或转写提取价格，不要联网，不要用常识补价格。',
            '只提取当前产品本身的人民币价格；折扣、优惠券、配件价、外币价、评分、尺寸和时长都不是产品价。',
            '无法确认字幕明确提到当前产品价格时，返回 hasPrice=false。',
          ].join('\n'),
        },
        {
          role: 'user',
          content: JSON.stringify({
            outputSchema: {
              hasPrice: 'boolean',
              priceRaw: 'string | null，字幕中提到的最短价格片段',
              priceValue: 'number | null，统一换算为人民币元，例如 3.2 万返回 32000',
              priceCurrency: 'CNY | null',
              priceType: 'listed | official | launch | street | original | presale | approximate | mentioned | null',
              priceContext: 'string | null，包含价格的简短字幕上下文',
              priceConfidence: '0 到 1 的数字',
            },
            currentProduct: {
              productName: input.productName,
              productNameZh: input.productNameZh,
              videoTitle: input.videoTitle,
              videoTitleZh: input.videoTitleZh,
            },
            rules: [
              'priceValue 必须是人民币元数值，不要带货币符号。',
              '如果字幕里只有“便宜了 200 元”“优惠 500 元”“评分 8 分”等非价格信息，hasPrice=false。',
              '如果价格属于配件、套餐总价、外币或其他产品，hasPrice=false。',
              '如果存在多个候选，优先选择最接近当前产品名或视频标题主体的价格。',
            ],
            transcript: truncateForAi(input.transcript, input.maxTranscriptChars),
          }),
        },
      ],
    }),
    signal: AbortSignal.timeout(input.timeoutMs),
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`AI 请求失败：${response.status} ${text.slice(0, 240)}`)
  }

  const payload = await response.json() as {
    choices?: Array<{
      message?: {
        content?: string
      }
    }>
  }
  const content = payload.choices?.[0]?.message?.content || ''

  return normalizeAiPriceExtractionResult(safeJsonParse(content))
}

async function extractPriceWithAi(input: {
  configs: OpenAiRuntimeConfig[]
  productName: string
  productNameZh: string | null
  videoTitle: string
  videoTitleZh: string | null
  transcript: string
  timeoutMs: number
  maxTranscriptChars: number
}): Promise<{
  price: PriceExtractionResult | null
  errors: string[]
}> {
  const errors: string[] = []

  for (const config of input.configs) {
    try {
      const price = await callAiPriceExtraction({
        config,
        productName: input.productName,
        productNameZh: input.productNameZh,
        videoTitle: input.videoTitle,
        videoTitleZh: input.videoTitleZh,
        transcript: input.transcript,
        timeoutMs: input.timeoutMs,
        maxTranscriptChars: input.maxTranscriptChars,
      })

      if (price) return { price, errors }
      return { price: null, errors }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      errors.push(`${config.label}/${config.model}: ${message}`)
    }
  }

  return { price: null, errors }
}

async function main() {
  const dryRun = isEnabled(process.env.DRY_RUN, true)
  const limit = parsePositiveInt(process.env.LIMIT, 705)
  const offset = Number.parseInt(process.env.OFFSET || '0', 10) || 0
  const onlyMissing = isEnabled(process.env.ONLY_MISSING_PRICE, true)
  const minConfidence = Number.parseFloat(process.env.MIN_PRICE_CONFIDENCE || '0.7')
  const revalidateExisting = isEnabled(process.env.REVALIDATE_EXISTING, false)
  const useAiPriceExtraction = isEnabled(process.env.USE_AI_PRICE_EXTRACTION, false)
  const aiTimeoutMs = parsePositiveInt(process.env.AI_PRICE_TIMEOUT_MS, 60_000)
  const aiMaxTranscriptChars = parsePositiveInt(process.env.AI_PRICE_MAX_TRANSCRIPT_CHARS, 16_000)
  const aiConfigs = useAiPriceExtraction
    ? await resolveOpenAiRuntimeConfigs({
        testConnection: isEnabled(process.env.AI_BACKFILL_TEST_CONFIG, true),
        codexManagerCandidateLimit: parsePositiveInt(process.env.CODEX_MANAGER_AI_CANDIDATES, 10),
      })
    : []

  if (useAiPriceExtraction && aiConfigs.length === 0) {
    console.warn('未找到可用 OpenAI 兼容配置，将只使用本地规则提取价格。')
  } else if (aiConfigs.length > 0) {
    console.log(`AI 价格提取候选：${aiConfigs.map((config) => `${config.label}/${config.model}`).join('；')}`)
  }

  const products = await prisma.product.findMany({
    where: revalidateExisting
      ? {
          OR: [
            { priceValue: { not: null } },
            { priceRaw: { not: null } },
          ],
        }
      : onlyMissing
      ? {
          OR: [
            { priceValue: null },
            { priceRaw: null },
          ],
        }
      : {},
    orderBy: {
      video: {
        publishedAt: 'desc',
      },
    },
    skip: Math.max(0, offset),
    take: limit,
    include: {
      video: {
        include: {
          transcripts: {
            select: {
              content: true,
              segments: true,
            },
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      },
    },
  })

  const summary = {
    scanned: 0,
    extracted: 0,
    ruleExtracted: 0,
    aiAttempted: 0,
    aiExtracted: 0,
    aiFailed: 0,
    lowConfidence: 0,
    noTranscript: 0,
    noPrice: 0,
    wouldWrite: 0,
    written: 0,
    skippedExisting: 0,
  }

  for (const product of products) {
    if (!isPublicCatalogProductId(product.id)) {
      continue
    }

    summary.scanned += 1

    if (onlyMissing && product.priceValue != null && product.priceRaw) {
      summary.skippedExisting += 1
      continue
    }

    const transcript = product.video.transcripts[0]
    if (!transcript) {
      summary.noTranscript += 1
      if (revalidateExisting && !dryRun) {
        await prisma.product.update({
          where: { id: product.id },
          data: {
            priceRaw: null,
            priceValue: null,
            priceCurrency: null,
            priceType: null,
            priceContext: null,
            priceConfidence: null,
          },
        })
      }
      continue
    }

    let price = extractPriceFromTranscript({
      productNameZh: product.productNameZh,
      productName: product.productName,
      videoTitleZh: product.videoTitleZh,
      videoTitle: product.video.title,
      transcript: transcript.content,
      transcriptSegments: transcript.segments,
    })

    if (price) {
      summary.ruleExtracted += 1
    }

    if (!price && aiConfigs.length > 0 && !shouldSkipPriceExtraction({
      productNameZh: product.productNameZh,
      productName: product.productName,
      videoTitleZh: product.videoTitleZh,
      videoTitle: product.video.title,
    })) {
      summary.aiAttempted += 1
      const aiResult = await extractPriceWithAi({
        configs: aiConfigs,
        productName: product.productName,
        productNameZh: product.productNameZh,
        videoTitle: product.video.title,
        videoTitleZh: product.videoTitleZh,
        transcript: transcript.content,
        timeoutMs: aiTimeoutMs,
        maxTranscriptChars: aiMaxTranscriptChars,
      })
      price = aiResult.price

      if (price) {
        summary.aiExtracted += 1
      } else if (aiResult.errors.length > 0) {
        summary.aiFailed += 1
        console.warn(`${product.id} AI 价格提取失败：${aiResult.errors.slice(0, 2).join(' | ')}`)
      }
    }

    if (!price) {
      summary.noPrice += 1
      if (revalidateExisting) {
        const clearData = {
          priceRaw: null,
          priceValue: null,
          priceCurrency: null,
          priceType: null,
          priceContext: null,
          priceConfidence: null,
        }
        if (dryRun) {
          console.log(JSON.stringify({
            action: 'dry-run-clear',
            productId: product.id,
            youtubeId: product.video.youtubeId,
            productName: product.productNameZh || product.productName,
          }))
        } else {
          await prisma.product.update({
            where: { id: product.id },
            data: clearData,
          })
          console.log(JSON.stringify({
            action: 'cleared',
            productId: product.id,
            youtubeId: product.video.youtubeId,
            productName: product.productNameZh || product.productName,
          }))
        }
      }
      continue
    }

    summary.extracted += 1
    if (price.priceConfidence < minConfidence) {
      summary.lowConfidence += 1
      console.log(JSON.stringify({
        action: 'skip-low-confidence',
        productId: product.id,
        youtubeId: product.video.youtubeId,
        productName: product.productNameZh || product.productName,
        ...price,
      }))
      if (revalidateExisting && !dryRun) {
        await prisma.product.update({
          where: { id: product.id },
          data: {
            priceRaw: null,
            priceValue: null,
            priceCurrency: null,
            priceType: null,
            priceContext: null,
            priceConfidence: null,
          },
        })
      }
      continue
    }

    const data = {
      priceRaw: price.priceRaw,
      priceValue: price.priceValue,
      priceCurrency: price.priceCurrency,
      priceType: price.priceType,
      priceContext: price.priceContext,
      priceConfidence: price.priceConfidence,
    }

    if (dryRun) {
      summary.wouldWrite += 1
      console.log(JSON.stringify({
        action: 'dry-run',
        productId: product.id,
        youtubeId: product.video.youtubeId,
        productName: product.productNameZh || product.productName,
        ...data,
      }))
      continue
    }

    await prisma.product.update({
      where: { id: product.id },
      data,
    })
    summary.written += 1
    console.log(JSON.stringify({
      action: 'written',
      productId: product.id,
      youtubeId: product.video.youtubeId,
      productName: product.productNameZh || product.productName,
      ...data,
    }))
  }

  const totalProducts = await prisma.product.count()
  const productsWithPrice = await prisma.product.count({
    where: {
      priceValue: {
        not: null,
      },
    },
  })
  const lowConfidenceProducts = await prisma.product.count({
    where: {
      priceConfidence: {
        lt: 0.7,
        not: null,
      },
    },
  })

  console.log('=== Backfill Product Prices ===')
  console.log(JSON.stringify({
    dryRun,
    limit,
    offset,
    onlyMissing,
    minConfidence,
    revalidateExisting,
    useAiPriceExtraction,
    aiTimeoutMs,
    aiMaxTranscriptChars,
    totalProducts,
    productsWithPrice,
    productsWithoutPrice: totalProducts - productsWithPrice,
    lowConfidenceProducts,
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
