import 'dotenv/config'
import { appendFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { buildOpenAiHeaders, buildOpenAiUrl } from '../lib/openai-client'
import { resolveOpenAiRuntimeConfigs, type OpenAiRuntimeConfig } from '../lib/openai-runtime-config'
import { prisma } from '../lib/prisma'
import {
  buildProductGapReviewRow,
  buildRuleSuggestion,
  createFailedSuggestion,
  normalizeSuggestion,
  safeParseSuggestionJson,
  selectTranscriptParagraphsForReview,
  type ProductBackfillSuggestion,
  type ProductGapReviewRow,
} from '../lib/product-backfill-review'
import { isPublicCatalogProductId } from '../lib/product-visibility'

const DEFAULT_AUDIT_FILE = path.join(process.cwd(), 'data', 'backfill-review', 'product-gaps.jsonl')
const DEFAULT_OUTPUT_FILE = path.join(process.cwd(), 'data', 'backfill-review', 'product-suggestions.jsonl')

function isEnabled(value: string | undefined, fallback = false): boolean {
  if (value == null) return fallback
  return value === '1' || value.toLowerCase() === 'true'
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

async function readAuditRows(filePath: string): Promise<ProductGapReviewRow[]> {
  const content = await readFile(filePath, 'utf8')
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ProductGapReviewRow)
}

async function loadProduct(productId: string) {
  return prisma.product.findUnique({
    where: { id: productId },
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
}

async function callAiSuggestion(input: {
  product: NonNullable<Awaited<ReturnType<typeof loadProduct>>>
  row: ProductGapReviewRow
  ruleSuggestion: ProductBackfillSuggestion
  config: OpenAiRuntimeConfig
}): Promise<ProductBackfillSuggestion> {
  const response = await fetch(buildOpenAiUrl('/v1/chat/completions', input.config.baseUrl), {
    method: 'POST',
    headers: {
      ...buildOpenAiHeaders(input.config.apiKey),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: input.config.model,
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: [
            '你负责从 TESTV 产品评测字幕中整理缺失数据。',
            '必须只返回严格 JSON，不要 Markdown。',
            '所有公开文字必须是简体中文；品牌、型号、TESTV、YouTube、Bilibili 可以保留英文。',
            '不要虚构字幕里没有的观点；没有明确依据时返回空数组或 null。',
            '多分数视频必须优先匹配当前产品名；无法确认分数归属时 needsHumanReview 必须为 true。',
          ].join('\n'),
        },
        {
          role: 'user',
          content: JSON.stringify({
            outputSchema: {
              productId: input.product.id,
              missingFields: ['score', 'pros', 'cons', 'transcript'],
              suggestedScoreValue: 'number | null，必须是 10 分制',
              suggestedScoreRaw: 'string | null，例如 7.25/10',
              prosZh: ['最多 3 条，每条一句话，15 到 28 个中文字符左右'],
              consZh: ['最多 3 条，每条一句话，15 到 28 个中文字符左右'],
              confidence: '0 到 1',
              needsHumanReview: 'boolean',
              reason: '说明依据或需要人工复核的原因',
            },
            rules: [
              '只补 missingFields 中缺失的字段；已有字段可作为上下文但不要覆盖。',
              '评分必须来自字幕评分候选或字幕文字中的明确评分。',
              '如果同一字幕出现多个产品评分，优先当前产品名附近的评分。',
              '如果只有最终综合、合集、对比总结而无法绑定当前产品，标记 needsHumanReview=true。',
              '优缺点必须来自字幕或规则候选，不要新增观点。',
            ],
            video: {
              youtubeId: input.product.video.youtubeId,
              title: input.product.video.title,
              publishedAt: input.product.video.publishedAt.toISOString(),
            },
            currentProduct: {
              productId: input.product.id,
              productName: input.product.productName,
              productNameZh: input.product.productNameZh,
              videoTitleZh: input.product.videoTitleZh,
              scoreRaw: input.product.scoreRaw,
              scoreValue: input.product.scoreValue,
              prosZh: input.product.prosZh,
              consZh: input.product.consZh,
              contentStatus: input.product.contentStatus,
            },
            audit: {
              missingFields: input.row.missingFields,
              scoreCandidates: input.row.scoreCandidates.map((candidate) => ({
                value: candidate.value,
                raw: candidate.raw,
                scoreRaw: candidate.scoreRaw,
                context: candidate.context,
                matchedProductTokens: candidate.matchedProductTokens,
                matchScore: candidate.matchScore,
                signals: candidate.signals,
              })),
              ruleSuggestion: input.ruleSuggestion,
            },
            transcriptParagraphs: selectTranscriptParagraphsForReview(input.product),
          }),
        },
      ],
    }),
    signal: AbortSignal.timeout(parsePositiveInt(process.env.AI_BACKFILL_TIMEOUT_MS, 20_000)),
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
  const parsed = safeParseSuggestionJson(payload.choices?.[0]?.message?.content || '')

  return normalizeSuggestion({
    ...parsed,
    productId: input.product.id,
    youtubeId: input.product.video.youtubeId,
    missingFields: input.row.missingFields,
    source: 'ai',
  })
}

async function main() {
  const auditFile = process.env.AUDIT_FILE || DEFAULT_AUDIT_FILE
  const outputFile = process.env.OUTPUT_FILE || DEFAULT_OUTPUT_FILE
  const limit = parsePositiveInt(process.env.LIMIT, 50)
  const offset = Number.parseInt(process.env.OFFSET || '0', 10) || 0
  const target = (process.env.TARGET_PRODUCT || '').trim()
  const onlyMissing = isEnabled(process.env.ONLY_MISSING, true)
  const useAi = isEnabled(process.env.USE_AI, true)
  const appendOutput = isEnabled(process.env.APPEND_OUTPUT, false)
  const configs = useAi
    ? await resolveOpenAiRuntimeConfigs({
        testConnection: isEnabled(process.env.AI_BACKFILL_TEST_CONFIG, true),
        codexManagerCandidateLimit: parsePositiveInt(process.env.CODEX_MANAGER_AI_CANDIDATES, 10),
      })
    : []

  if (useAi && configs.length === 0) {
    console.warn('未找到可用 OpenAI 兼容配置，将只输出规则建议。')
  } else if (configs.length > 0) {
    console.log(`AI 配置候选：${configs.map((config) => `${config.label}/${config.model}`).join('；')}`)
  }

  const auditRows = await readAuditRows(auditFile)
  const selectedRows = auditRows
    .filter((row) => isPublicCatalogProductId(row.productId))
    .filter((row) => !target || [
      row.productId,
      row.youtubeId,
      row.productName,
      row.productNameZh,
      row.videoTitle,
      row.videoTitleZh,
    ].filter(Boolean).join(' ').toLowerCase().includes(target.toLowerCase()))
    .filter((row) => !onlyMissing || row.missingFields.length > 0)
    .slice(offset, offset + limit)

  const suggestions: ProductBackfillSuggestion[] = []
  let aiSuccess = 0
  let aiFailed = 0
  let ruleOnly = 0

  await mkdir(path.dirname(outputFile), { recursive: true })
  if (!appendOutput) {
    await rm(outputFile, { force: true })
  }

  for (const row of selectedRows) {
    const product = await loadProduct(row.productId)
    if (!product) {
      const failedSuggestion = createFailedSuggestion({
        productId: row.productId,
        youtubeId: row.youtubeId,
        missingFields: row.missingFields,
        error: '产品不存在。',
      })
      suggestions.push(failedSuggestion)
      await appendFile(outputFile, `${JSON.stringify(failedSuggestion)}\n`, 'utf8')
      continue
    }

    const freshRow = buildProductGapReviewRow(product)
    const ruleSuggestion = buildRuleSuggestion(product, freshRow)
    let suggestion: ProductBackfillSuggestion | null = null
    const errors: string[] = []

    for (const config of configs) {
      try {
        suggestion = await callAiSuggestion({
          product,
          row: freshRow,
          ruleSuggestion,
          config,
        })
        aiSuccess++
        break
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        errors.push(`${config.label}: ${message}`)
        console.warn(`${row.productId} AI 失败：${message}`)
      }
    }

    if (!suggestion) {
      ruleOnly++
      if (errors.length > 0) aiFailed++
      suggestion = errors.length > 0
        ? {
            ...ruleSuggestion,
            source: 'mixed',
            error: errors.slice(0, 3).join(' | '),
          }
        : ruleSuggestion
    }

    const normalizedSuggestion = normalizeSuggestion(suggestion)
    suggestions.push(normalizedSuggestion)
    await appendFile(outputFile, `${JSON.stringify(normalizedSuggestion)}\n`, 'utf8')
  }

  if (suggestions.length === 0 && !appendOutput) {
    await writeFile(outputFile, '', 'utf8')
  }

  console.log('=== Product Backfill Suggestions ===')
  console.log(JSON.stringify({
    auditFile,
    outputFile,
    selected: selectedRows.length,
    written: suggestions.length,
    target: target || null,
    offset,
    limit,
    onlyMissing,
    useAi,
    appendOutput,
    aiSuccess,
    aiFailed,
    ruleOnly,
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
