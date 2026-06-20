import { inferProductCategory, type ProductCategoryKey } from './product-category'
import { simplifyOpinionList } from './product-detail-runtime'
import { formatDisplayPrice } from './price-extraction'
import {
  containsCjk,
  hasEnglishSentence,
  isCleanPublicText,
  isPlaceholderDisplayText,
  normalizePublicList,
  normalizePublicText,
} from './text-normalization'
import { buildTranscriptParagraphs, deriveProsConsFromTranscript } from './transcript-insights'

export interface TranscriptSegment {
  text: string
  start: number
  duration: number
}

export type ProductContentStatus = 'complete' | 'partial' | 'placeholder'

type DateLike = Date | string

interface PublicVideoRecord {
  youtubeId: string
  title?: string | null
  publishedAt: DateLike
  thumbnailUrl: string | null
  videoUrl: string
  transcripts?: Array<{
    id: string
    content?: string
    segments?: unknown
  }>
}

type TranscriptRecord = NonNullable<PublicVideoRecord['transcripts']>[number]

export interface PublicProductRecord {
  id: string
  productName: string
  productNameZh: string | null
  videoTitleZh: string | null
  scoreRaw: string | null
  scoreValue: number | null
  priceRaw?: string | null
  priceValue?: number | null
  priceCurrency?: string | null
  priceType?: string | null
  priceContext?: string | null
  priceConfidence?: number | null
  prosZh: unknown
  consZh: unknown
  confidence: number | null
  contentStatus: string | null
  video: PublicVideoRecord
}

export interface ProductSummary {
  id: string
  displayName: string
  displayVideoTitle: string
  scoreRaw: string | null
  scoreValue: number | null
  displayPrice: string
  priceRaw: string | null
  priceValue: number | null
  priceCurrency: string | null
  priceType: string | null
  priceContext: string | null
  priceConfidence: number | null
  displayPros: string[]
  displayCons: string[]
  prosCount: number
  consCount: number
  confidence: number | null
  contentStatus: ProductContentStatus
  statusLabel: string
  statusDescription: string
  hasTranscript: boolean
  categoryKey: ProductCategoryKey
  categoryLabel: string
  video: {
    youtubeId: string
    publishedAt: string
    thumbnailUrl: string | null
    videoUrl: string
  }
}

export interface ProductDetail extends ProductSummary {
  displayTranscriptParagraphs: string[]
  videoLinks: {
    youtube: string
    bilibili?: string
  }
}

const PRODUCT_HINT_RE = /(耳机|风扇|净饮机|净水器|吸尘器|音箱|手机|相机|电源|显示器|平板|手表|鼠标|键盘|投影仪|路由器|咖啡机|洗碗机|制冰机|学习机|游戏机|掌机|MacBook|iPhone|iPad|DJI|Switch|索尼|小米|米家|红米|OPPO|vivo|华为|荣耀|Bruno|Sony|Nintendo)/i
const PUBLIC_OPINION_LIMIT = 3

function cleanString(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function containsChinese(value: string): boolean {
  return containsCjk(value)
}

function isUntranslatedEnglishLine(value: string): boolean {
  const normalized = cleanString(value)
  if (!normalized) return false

  const chineseCount = (normalized.match(/[\u3400-\u9fff]/g) || []).length
  const englishWordCount = (normalized.match(/[A-Za-z]+/g) || []).length
  const hasModelSignal = /(?:\d|iPhone|iPad|MacBook|AirPods?|DJI|Sony|SONY|Redmi|OPPO|vivo|Huawei|GoPro|Nintendo|Switch|Kindle|Apple|Pixel|Galaxy|OnePlus)/i.test(normalized)

  if (chineseCount === 0 && englishWordCount >= 2 && !hasModelSignal) return true
  return hasEnglishSentence(normalized) || (chineseCount <= 2 && englishWordCount >= 4)
}

function cleanDisplayCandidate(value: string | null | undefined, maxLength: number): string {
  const normalized = normalizePublicText(value, {
    allowEmpty: true,
    maxLength,
  })

  if (!normalized || !isCleanPublicText(normalized) || isPlaceholderDisplayText(normalized)) {
    return ''
  }

  return normalized
}

function toIsoString(value: DateLike): string {
  return value instanceof Date ? value.toISOString() : value
}

export function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []

  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => normalizePublicText(item, { allowEmpty: true }))
    .filter(Boolean)
}

export function toChineseStringArray(value: unknown): string[] {
  return toStringArray(value).filter((item) => containsChinese(item) || PRODUCT_HINT_RE.test(item))
}

function getStatusText(
  status: ProductContentStatus,
  hasTranscript: boolean,
): {
  label: string
  description: string
} {
  switch (status) {
    case 'complete':
      return {
        label: '信息完整',
        description: '',
      }
    case 'partial':
      return {
        label: '部分待补全',
        description: hasTranscript ? '已有字幕，部分字段仍在补全。' : '字段不完整，正在补全。',
      }
    case 'placeholder':
    default:
      return {
        label: hasTranscript ? '等待抽取' : '等待字幕',
        description: hasTranscript ? '已有字幕，正在整理产品信息。' : '暂未拿到字幕，先按视频标题建档。',
      }
  }
}

function fallbackDisplayName(
  product: Pick<PublicProductRecord, 'productName' | 'productNameZh' | 'video'>,
): string {
  const chineseName = cleanDisplayCandidate(product.productNameZh, 64)
  if (chineseName && !isUntranslatedEnglishLine(chineseName)) return chineseName

  const rawName = cleanDisplayCandidate(product.productName, 64)
  if (rawName && !isUntranslatedEnglishLine(rawName)) return rawName

  const rawVideoTitle = cleanDisplayCandidate(product.video.title, 64)
  if (rawVideoTitle && containsChinese(rawVideoTitle)) {
    return rawVideoTitle
  }

  return `产品信息待补充（${product.video.youtubeId}）`
}

function fallbackVideoTitle(value: string | null): string {
  const title = cleanDisplayCandidate(value, 96)
  if (!title || isUntranslatedEnglishLine(title)) return '视频标题待补充'
  return title
}

function buildPendingList(kind: 'pros' | 'cons', hasTranscript: boolean): string[] {
  if (!hasTranscript) {
    return [kind === 'pros' ? '暂无字幕，无法整理优点。' : '暂无字幕，无法整理缺点。']
  }

  if (kind === 'pros') {
    return ['字幕中未提到明确优点。']
  }

  return ['字幕中未提到明确缺点。']
}

export function computeContentStatus(input: {
  scoreValue: number | null
  prosZh: unknown
  consZh: unknown
  hasTranscript: boolean
}): ProductContentStatus {
  const hasPros = toChineseStringArray(input.prosZh).length > 0
  const hasCons = toChineseStringArray(input.consZh).length > 0

  if (input.scoreValue !== null && hasPros && hasCons) {
    return 'complete'
  }

  if (input.hasTranscript) {
    return 'partial'
  }

  return 'placeholder'
}

function getTranscriptRecord(product: PublicProductRecord): TranscriptRecord | undefined {
  return Array.isArray(product.video.transcripts) ? product.video.transcripts[0] : undefined
}

export function resolveOpinionCandidates(product: PublicProductRecord): {
  prosCandidates: string[]
  consCandidates: string[]
  displayPros: string[]
  displayCons: string[]
  prosCount: number
  consCount: number
} {
  const transcript = getTranscriptRecord(product)
  const hasTranscript = Boolean(transcript)

  const storedPros = normalizePublicList(toChineseStringArray(product.prosZh), {
    maxItems: PUBLIC_OPINION_LIMIT,
    maxLength: 64,
  })
  const storedCons = normalizePublicList(toChineseStringArray(product.consZh), {
    maxItems: PUBLIC_OPINION_LIMIT,
    maxLength: 64,
  })
  const derived = transcript
    ? deriveProsConsFromTranscript({
        content: transcript.content,
        segments: transcript.segments,
      })
    : { pros: [], cons: [] }

  const prosCandidates = storedPros.length > 0 ? storedPros : derived.pros
  const consCandidates = storedCons.length > 0 ? storedCons : derived.cons
  const publicProsCandidates = normalizePublicList(simplifyOpinionList(prosCandidates), {
    maxItems: PUBLIC_OPINION_LIMIT,
    maxLength: 42,
  })
  const publicConsCandidates = normalizePublicList(simplifyOpinionList(consCandidates), {
    maxItems: PUBLIC_OPINION_LIMIT,
    maxLength: 42,
  })

  return {
    prosCandidates: publicProsCandidates,
    consCandidates: publicConsCandidates,
    displayPros: publicProsCandidates.length > 0 ? publicProsCandidates : buildPendingList('pros', hasTranscript),
    displayCons: publicConsCandidates.length > 0 ? publicConsCandidates : buildPendingList('cons', hasTranscript),
    prosCount: publicProsCandidates.length,
    consCount: publicConsCandidates.length,
  }
}

export function toProductSummary(product: PublicProductRecord): ProductSummary {
  const hasTranscript = Array.isArray(product.video.transcripts) && product.video.transcripts.length > 0
  const contentStatus = computeContentStatus({
    scoreValue: product.scoreValue,
    prosZh: product.prosZh,
    consZh: product.consZh,
    hasTranscript,
  })
  const statusText = getStatusText(contentStatus, hasTranscript)
  const opinions = resolveOpinionCandidates(product)
  const category = inferProductCategory({
    productNameZh: product.productNameZh,
    productName: product.productName,
    videoTitleZh: product.videoTitleZh,
    videoTitle: product.video.title,
  })

  return {
    id: product.id,
    displayName: normalizePublicText(fallbackDisplayName(product), { fallback: '产品信息待补充', maxLength: 64 }),
    displayVideoTitle: normalizePublicText(fallbackVideoTitle(product.videoTitleZh), { fallback: '视频标题待补充', maxLength: 96 }),
    scoreRaw: product.scoreRaw,
    scoreValue: product.scoreValue,
    displayPrice: formatDisplayPrice({
      priceRaw: product.priceRaw,
      priceValue: product.priceValue,
      priceCurrency: product.priceCurrency,
    }),
    priceRaw: product.priceRaw ?? null,
    priceValue: product.priceValue ?? null,
    priceCurrency: product.priceCurrency ?? null,
    priceType: product.priceType ?? null,
    priceContext: cleanDisplayCandidate(product.priceContext, 120) || null,
    priceConfidence: product.priceConfidence ?? null,
    displayPros: opinions.displayPros,
    displayCons: opinions.displayCons,
    prosCount: opinions.prosCount,
    consCount: opinions.consCount,
    confidence: product.confidence,
    contentStatus,
    statusLabel: statusText.label,
    statusDescription: statusText.description,
    hasTranscript,
    categoryKey: category.categoryKey,
    categoryLabel: category.categoryLabel,
    video: {
      youtubeId: product.video.youtubeId,
      publishedAt: toIsoString(product.video.publishedAt),
      thumbnailUrl: product.video.thumbnailUrl,
      videoUrl: product.video.videoUrl,
    },
  }
}

export function toProductDetail(product: PublicProductRecord): ProductDetail {
  const summary = toProductSummary(product)
  const transcript = getTranscriptRecord(product)
  const displayTranscriptParagraphs = buildTranscriptParagraphs({
    content: transcript?.content,
    segments: transcript?.segments,
  })

  return {
    ...summary,
    displayTranscriptParagraphs: displayTranscriptParagraphs.length > 0
      ? normalizePublicList(displayTranscriptParagraphs, { maxLength: 220 })
      : ['暂无字幕文字版。'],
    videoLinks: {
      youtube: summary.video.videoUrl,
    },
  }
}

export function shouldPublishChineseProduct(input: {
  scoreValue: number | null
  prosZh: string[]
  consZh: string[]
  hasTranscript?: boolean
}): boolean {
  return computeContentStatus({
    scoreValue: input.scoreValue,
    prosZh: input.prosZh,
    consZh: input.consZh,
    hasTranscript: input.hasTranscript ?? true,
  }) === 'complete'
}

export function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback

  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}
