import 'dotenv/config'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { buildOpenAiHeaders, buildOpenAiUrl } from '../lib/openai-client'
import { resolveOpenAiRuntimeConfigs, type OpenAiRuntimeConfig } from '../lib/openai-runtime-config'
import { normalizeOpinionGroups } from '../lib/opinion-polarity'
import { simplifyOpinionList } from '../lib/product-detail-runtime'
import {
  computeContentStatus,
  resolveOpinionCandidates,
  toChineseStringArray,
  type ProductContentStatus,
} from '../lib/review-types'
import { formatScoreValue } from '../lib/scoring'
import { buildTranscriptParagraphs } from '../lib/transcript-insights'
import {
  hasPublicTextIssue,
  isCleanPublicText,
  isPlaceholderDisplayText,
  normalizePublicList,
  normalizePublicText,
  normalizeToSimplifiedChinese,
} from '../lib/text-normalization'

const AiBackfillSchema = z.object({
  productNameZh: z.string().default(''),
  videoTitleZh: z.string().default(''),
  prosZh: z.array(z.string()).default([]),
  consZh: z.array(z.string()).default([]),
  contentStatus: z.enum(['complete', 'partial', 'placeholder']).optional(),
})

type ProductForBackfill = Prisma.ProductGetPayload<{
  include: {
    video: {
      include: {
        transcripts: {
          orderBy: { createdAt: 'desc' }
          take: 1
        }
      }
    }
  }
}>

type BackfillResult = z.infer<typeof AiBackfillSchema>

function isEnabled(value: string | undefined, fallback = false): boolean {
  if (value == null) return fallback
  return value === '1' || value.toLowerCase() === 'true'
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
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

function normalizeStatus(value: string | null | undefined, hasTranscript: boolean, scoreValue: number | null, prosZh: string[], consZh: string[]): ProductContentStatus {
  if (value === 'complete' || value === 'partial' || value === 'placeholder') {
    return value
  }

  return computeContentStatus({
    scoreValue,
    prosZh,
    consZh,
    hasTranscript,
  })
}

function productMatchesTarget(product: ProductForBackfill, target: string): boolean {
  if (!target) return true
  const haystack = [
    product.id,
    product.productName,
    product.productNameZh,
    product.videoTitleZh,
    product.video.title,
    product.video.youtubeId,
  ].filter(Boolean).join(' ')

  return haystack.toLowerCase().includes(target.toLowerCase())
}

function getCurrentCandidates(product: ProductForBackfill): {
  pros: string[]
  cons: string[]
} {
  const opinions = resolveOpinionCandidates(product)
  return {
    pros: normalizePublicList(opinions.prosCandidates, { maxItems: 3, maxLength: 42 }),
    cons: normalizePublicList(opinions.consCandidates, { maxItems: 3, maxLength: 42 }),
  }
}

function listHasIssue(values: string[]): boolean {
  return values.some((value) => hasPublicTextIssue(value) || value.length > 42)
}

function getCleanupReasons(product: ProductForBackfill): string[] {
  const reasons: string[] = []
  const transcript = product.video.transcripts[0]
  const hasTranscript = Boolean(transcript)
  const storedPros = normalizePublicList(toChineseStringArray(product.prosZh), { maxItems: 3, maxLength: 42 })
  const storedCons = normalizePublicList(toChineseStringArray(product.consZh), { maxItems: 3, maxLength: 42 })
  const display = getCurrentCandidates(product)
  const name = normalizePublicText(product.productNameZh || product.productName, { allowEmpty: true })
  const title = normalizePublicText(product.videoTitleZh || product.video.title, { allowEmpty: true })

  if (!name || hasPublicTextIssue(product.productNameZh || product.productName)) reasons.push('产品名需整理')
  if (!title || hasPublicTextIssue(product.videoTitleZh || product.video.title)) reasons.push('标题需整理')
  if (storedPros.length === 0) reasons.push('缺优点')
  if (storedCons.length === 0) reasons.push('缺缺点')
  if (display.pros.length === 0 && hasTranscript) reasons.push('展示优点为空')
  if (display.cons.length === 0 && hasTranscript) reasons.push('展示缺点为空')
  if (listHasIssue(storedPros) || listHasIssue(display.pros)) reasons.push('优点含脏文本')
  if (listHasIssue(storedCons) || listHasIssue(display.cons)) reasons.push('缺点含脏文本')
  if ([...display.pros, ...display.cons].some(isPlaceholderDisplayText)) reasons.push('含待补全文案')

  return [...new Set(reasons)]
}

function trimTitleNoise(value: string): string {
  return normalizeToSimplifiedChinese(value)
    .replace(/【值不值得买[^】]*】/g, '')
    .replace(/《值不值得买》/g, '')
    .replace(/\[[^\]]*]/g, '')
    .replace(/^[\s"'“”]+|[\s"'“”]+$/g, '')
    .replace(/^(?:Worth Buying\??|Good Buy or Goodbye|Bunny try before u buy|Bunny try before you buy|TESTV)\s*(?:Episode|EP|No\.?|N°)?\s*\d*\s*[:：-]?\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function deriveTitleFromVideoTitle(videoTitle: string): string {
  const title = trimTitleNoise(videoTitle)
  if (!title) return ''

  const match = title.match(/(?:第\s*\d+\s*期[：:\s_-]*)?(.+)/u)
  return match?.[1]?.trim() || title
}

function deriveNameFromVideoTitle(videoTitle: string): string {
  const title = deriveTitleFromVideoTitle(videoTitle)
  if (!title) return ''

  const modelMatch = title.match(/\b(?:iPhone|iPad|MacBook|AirPods?|DJI|Sony|SONY|Redmi|OPPO|vivo|Huawei|Honor|HONOR|GoPro|Nintendo|Switch|Kindle|Apple|Pixel|Galaxy|OnePlus|Xiaomi|Nothing|HTC|Lenovo|Garmin|Parrot|Bose|Beats|Fujifilm|FUJIFILM)\s+[A-Za-z0-9+.\- ]{1,36}/i)
  if (modelMatch?.[0]) {
    return modelMatch[0].trim()
  }

  const parts = title
    .split(/[？?！!：:|_—-]+/u)
    .map((part) => part.trim())
    .filter(Boolean)

  return (parts.length > 1 ? parts[parts.length - 1] : title)
    .replace(/^(?:上|中|下)\s*/u, '')
    .trim()
}

function hasModelSignal(value: string): boolean {
  return /(?:\d|iPhone|iPad|MacBook|AirPods?|DJI|Sony|SONY|Redmi|OPPO|vivo|Huawei|GoPro|Nintendo|Switch|Kindle|Apple|Pixel|Galaxy|OnePlus|Xiaomi|MIUI|ThinkPad|Bose|Beats|Razer|Logitech|Bruno|Ugreen|Baseus|Anker|ROG|BOOX|Kindle|Mavic|Osmo|FX\d+)/i.test(value)
}

function isAcceptableProductNameCandidate(value: string): boolean {
  if (!isCleanPublicText(value)) return false
  if (isPlaceholderDisplayText(value)) return false
  if (/值得买|值不值得买|不错的选择|是个不错的选择|真的值得买|产品评测|视频标题|年度总结|番外篇|体验|测评|总结|开箱|故事|经历|帮你选|帮你看|选择|推荐|不推荐|还叫手机吗|怎么老是你|能不能|到底|究竟|别买|不要买/u.test(value)) return false

  const chineseCount = (value.match(/[\u3400-\u9fff]/g) || []).length
  const wordCount = (value.match(/[A-Za-z]+/g) || []).length

  if (chineseCount === 0 && !hasModelSignal(value)) return false
  if (wordCount >= 6 && !hasModelSignal(value)) return false

  return true
}

function trimProductNameNoise(value: string): string {
  return normalizeToSimplifiedChinese(value)
    .replace(/^(?:手机|耳机|平板|相机|手表|音箱|风扇|净饮机|净水器|吸尘器|洗碗机|电磁炉|键盘|鼠标|稳定器|镜头|显微镜|纸飞机|空气净化器|洗衣机|充电站|行李箱|电动自行车|独轮车|手持稳定器)\s*/u, '')
    .replace(/^(?:让|那|这|这个|这台|这款|一台|一个|一款|一支|一副|一部|一台)/u, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function selectCleanPublicText(values: Array<string | null | undefined>, options: {
  fallback: string
  maxLength: number
}): string {
  for (const value of values) {
    const normalized = normalizePublicText(value, {
      allowEmpty: true,
      maxLength: options.maxLength,
    })
    if (normalized && isCleanPublicText(normalized) && !isPlaceholderDisplayText(normalized)) {
      return normalized
    }
  }

  return options.fallback
}

function selectCleanProductName(values: Array<string | null | undefined>, options: {
  fallback: string
  maxLength: number
}): string {
  let firstCleanCandidate = ''

  for (const value of values) {
    const normalized = normalizePublicText(value, {
      allowEmpty: true,
      maxLength: options.maxLength,
    })
    if (normalized) {
      if (!firstCleanCandidate && isCleanPublicText(normalized) && !isPlaceholderDisplayText(normalized)) {
        firstCleanCandidate = trimProductNameNoise(normalized)
      }
      const trimmed = trimProductNameNoise(normalized)
      if (isAcceptableProductNameCandidate(trimmed)) {
        return trimmed
      }
    }
  }

  return firstCleanCandidate || options.fallback
}

function buildLocalResult(product: ProductForBackfill): BackfillResult {
  const transcript = product.video.transcripts[0]
  const candidates = getCurrentCandidates(product)
  const title = selectCleanPublicText([
    product.videoTitleZh,
    deriveTitleFromVideoTitle(product.video.title),
    product.video.title,
  ], {
    fallback: '视频标题待补充',
    maxLength: 96,
  })
  const name = selectCleanProductName([
    product.productNameZh,
    product.productName,
    deriveNameFromVideoTitle(product.video.title),
    title,
  ], {
    fallback: '产品信息待补充',
    maxLength: 64,
  })

  const status = computeContentStatus({
    scoreValue: product.scoreValue,
    prosZh: candidates.pros,
    consZh: candidates.cons,
    hasTranscript: Boolean(transcript),
  })

  return {
    productNameZh: name,
    videoTitleZh: title,
    ...(() => {
      const groups = normalizeOpinionGroups({
        pros: candidates.pros,
        cons: candidates.cons,
        maxItems: 3,
        maxLength: 42,
      })

      return {
        prosZh: groups.pros,
        consZh: groups.cons,
      }
    })(),
    contentStatus: status,
  }
}

const REVIEW_SIGNAL_RE = /(优点|缺点|优势|不足|问题|槽点|但是|不过|可惜|遗憾|推荐|不推荐|值得买|不值得买|评分|打分|分|体验|结论|总结|购买|预算|价格|发热|续航|屏幕|拍照|音质|做工|手感|性能|噪音|重量|便携|稳定|延迟|兼容|售后|性价比)/u

function selectTranscriptParagraphsForAi(paragraphs: string[]): string[] {
  const normalized = normalizePublicList(paragraphs, {
    maxLength: 260,
  })

  if (normalized.length <= 44) return normalized

  const selected = new Map<number, string>()
  const addRange = (start: number, end: number) => {
    const safeStart = Math.max(0, start)
    const safeEnd = Math.min(normalized.length, end)
    for (let index = safeStart; index < safeEnd; index += 1) {
      selected.set(index, normalized[index])
    }
  }

  addRange(0, 8)
  addRange(normalized.length - 18, normalized.length)

  normalized.forEach((paragraph, index) => {
    if (REVIEW_SIGNAL_RE.test(paragraph)) {
      addRange(index - 1, index + 2)
    }
  })

  return [...selected.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, paragraph]) => paragraph)
    .slice(0, 54)
}

async function callAiBackfill(product: ProductForBackfill, config: OpenAiRuntimeConfig): Promise<BackfillResult> {
  const transcript = product.video.transcripts[0]
  const transcriptParagraphs = buildTranscriptParagraphs({
    content: transcript?.content,
    segments: transcript?.segments,
  })
  const currentCandidates = getCurrentCandidates(product)
  const scoreText = product.scoreValue == null ? null : `${formatScoreValue(product.scoreValue)}/10`

  const response = await fetch(buildOpenAiUrl('/v1/chat/completions', config.baseUrl), {
    method: 'POST',
    headers: {
      ...buildOpenAiHeaders(config.apiKey),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.model,
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: [
            '你负责把 TESTV 产品评测整理成可公开展示的简体中文数据。',
            '必须只返回严格 JSON，不要 Markdown。',
            '保留 TESTV、YouTube、Bilibili、品牌名和型号英文；普通说明文字不要写英文整句。',
            '不要输出繁体字，不要输出“整理中”“待补全”。',
            '不要虚构字幕里不存在的观点；没有明确优点或缺点时返回空数组。',
          ].join('\n'),
        },
        {
          role: 'user',
          content: JSON.stringify({
            outputSchema: {
              productNameZh: '简体中文产品名，品牌型号英文可保留',
              videoTitleZh: '简体中文视频标题，去掉无关括号和系列噪音',
              prosZh: ['最多 3 条，每条一句话，15 到 28 个中文字符左右'],
              consZh: ['最多 3 条，每条一句话，15 到 28 个中文字符左右'],
              contentStatus: 'complete | partial | placeholder',
            },
            rules: [
              '优点和缺点必须来自字幕或当前候选，不新增观点。',
              '每条尽量短，保留“特性名词 + 判断”主干。',
              '如果候选句太长，请压缩成一句简洁结论。',
              '如果只有优点没有明确缺点，consZh 返回空数组；反之亦然。',
              'contentStatus 有评分且两侧都有优缺点为 complete；有字幕但字段不全为 partial；无字幕为 placeholder。',
            ],
            video: {
              youtubeId: product.video.youtubeId,
              title: product.video.title,
              publishedAt: product.video.publishedAt.toISOString(),
            },
            currentProduct: {
              productName: product.productName,
              productNameZh: product.productNameZh,
              videoTitleZh: product.videoTitleZh,
              score: scoreText,
              prosZh: product.prosZh,
              consZh: product.consZh,
              contentStatus: product.contentStatus,
            },
            currentCandidates,
            transcriptParagraphs: selectTranscriptParagraphsForAi(transcriptParagraphs),
          }),
        },
      ],
    }),
    signal: AbortSignal.timeout(parsePositiveInt(process.env.AI_BACKFILL_TIMEOUT_MS, 90_000)),
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
  const parsed = AiBackfillSchema.parse(safeJsonParse(content))

  const prosZh = normalizePublicList(simplifyOpinionList(parsed.prosZh), {
    maxItems: 3,
    maxLength: 42,
  })
  const consZh = normalizePublicList(simplifyOpinionList(parsed.consZh), {
    maxItems: 3,
    maxLength: 42,
  })
  const opinionGroups = normalizeOpinionGroups({
    pros: prosZh,
    cons: consZh,
    maxItems: 3,
    maxLength: 42,
  })
  const hasTranscript = Boolean(transcript)

  return {
    productNameZh: selectCleanProductName([
      parsed.productNameZh,
      product.productNameZh,
      product.productName,
      deriveNameFromVideoTitle(product.video.title),
    ], {
      fallback: '产品信息待补充',
      maxLength: 64,
    }),
    videoTitleZh: selectCleanPublicText([
      parsed.videoTitleZh,
      product.videoTitleZh,
      deriveTitleFromVideoTitle(product.video.title),
      product.video.title,
    ], {
      fallback: '视频标题待补充',
      maxLength: 96,
    }),
    prosZh: opinionGroups.pros,
    consZh: opinionGroups.cons,
    contentStatus: normalizeStatus(parsed.contentStatus, hasTranscript, product.scoreValue, opinionGroups.pros, opinionGroups.cons),
  }
}

async function main() {
  const dryRun = isEnabled(process.env.DRY_RUN, true)
  const limit = parsePositiveInt(process.env.LIMIT, 20)
  const offset = Number.parseInt(process.env.OFFSET || '0', 10) || 0
  const force = isEnabled(process.env.FORCE, false)
  const target = (process.env.TARGET_PRODUCT || '').trim()
  const useAi = isEnabled(process.env.USE_AI, true)
  const configs = useAi
    ? await resolveOpenAiRuntimeConfigs({
        testConnection: isEnabled(process.env.AI_BACKFILL_TEST_CONFIG, true),
        codexManagerCandidateLimit: parsePositiveInt(process.env.CODEX_MANAGER_AI_CANDIDATES, 10),
      })
    : []

  if (useAi && configs.length === 0) {
    console.warn('未找到可用 OpenAI 兼容配置，将只做本地简体化和候选整理。')
  } else if (configs.length > 0) {
    console.log(`AI 配置候选：${configs.map((config) => `${config.label}/${config.model}`).join('；')}`)
  }

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

  const candidates = products
    .filter((product) => productMatchesTarget(product, target))
    .map((product) => ({
      product,
      reasons: getCleanupReasons(product),
    }))
    .filter((item) => force || item.reasons.length > 0)
    .slice(offset, offset + limit)

  console.log(JSON.stringify({
    dryRun,
    totalProducts: products.length,
    selected: candidates.length,
    limit,
    offset,
    target: target || null,
    force,
  }, null, 2))

  let success = 0
  let failed = 0

  for (const { product, reasons } of candidates) {
    console.log(`\n处理：${product.video.title}`)
    console.log(`原因：${reasons.length > 0 ? reasons.join('、') : '强制重跑'}`)

    try {
      let result: BackfillResult | null = null
      const errors: string[] = []

      for (const config of configs) {
        try {
          console.log(`尝试 AI：${config.label}`)
          result = await callAiBackfill(product, config)
          break
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          errors.push(`${config.label}: ${message}`)
          console.warn(`  AI 失败：${message}`)
        }
      }

      if (!result) {
        result = buildLocalResult(product)
        if (errors.length > 0) {
          console.warn(`  已回退本地整理：${errors.slice(0, 3).join(' | ')}`)
        }
      }

      console.log(JSON.stringify({
        productNameZh: result.productNameZh,
        videoTitleZh: result.videoTitleZh,
        prosZh: result.prosZh,
        consZh: result.consZh,
        contentStatus: result.contentStatus,
      }, null, 2))

      if (!dryRun) {
        await prisma.product.update({
          where: { id: product.id },
          data: {
            productNameZh: result.productNameZh,
            videoTitleZh: result.videoTitleZh,
            prosZh: result.prosZh as unknown as Prisma.InputJsonValue,
            consZh: result.consZh as unknown as Prisma.InputJsonValue,
            contentStatus: result.contentStatus,
            confidence: product.confidence == null ? 0.7 : Math.max(product.confidence, configs.length > 0 ? 0.82 : 0.68),
          },
        })
      }

      success++
    } catch (error) {
      failed++
      const message = error instanceof Error ? error.message : String(error)
      console.error(`失败：${message}`)
    }
  }

  console.log(JSON.stringify({
    dryRun,
    success,
    failed,
    written: dryRun ? 0 : success,
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
