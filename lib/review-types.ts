export interface TranscriptSegment {
  text: string
  start: number
  duration: number
}

export interface EvidenceSegment {
  text: string
  timestamp?: string
}

type DateLike = Date | string

interface PublicVideoRecord {
  youtubeId: string
  publishedAt: DateLike
  thumbnailUrl: string | null
  videoUrl: string
}

export interface PublicProductRecord {
  id: string
  productNameZh: string | null
  videoTitleZh: string | null
  scoreRaw: string | null
  normalizedScore: number | null
  prosZh: unknown
  consZh: unknown
  confidence: number | null
  video: PublicVideoRecord
}

export interface PublicProductDetailRecord extends PublicProductRecord {
  evidenceSegmentsZh: unknown
}

export interface ProductSummary {
  id: string
  displayName: string
  displayVideoTitle: string
  scoreRaw: string | null
  normalizedScore: number | null
  displayPros: string[]
  displayCons: string[]
  confidence: number | null
  video: {
    youtubeId: string
    publishedAt: string
    thumbnailUrl: string | null
    videoUrl: string
  }
}

export interface ProductDetail extends ProductSummary {
  displayEvidence: EvidenceSegment[]
}

const CJK_RE = /[\u3400-\u9fff]/

function cleanString(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function containsChinese(value: string): boolean {
  return CJK_RE.test(value)
}

function toIsoString(value: DateLike): string {
  return value instanceof Date ? value.toISOString() : value
}

export function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []

  return value
    .filter((item): item is string => typeof item === 'string')
    .map(cleanString)
    .filter(Boolean)
}

export function toChineseStringArray(value: unknown): string[] {
  return toStringArray(value).filter(containsChinese)
}

export function toEvidenceSegments(value: unknown): EvidenceSegment[] {
  if (!Array.isArray(value)) return []

  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []

    const record = item as Record<string, unknown>
    if (typeof record.text !== 'string' || !record.text.trim()) return []

    const text = cleanString(record.text)
    if (!containsChinese(text)) return []

    return [{
      text,
      ...(typeof record.timestamp === 'string' && record.timestamp.trim()
        ? { timestamp: cleanString(record.timestamp) }
        : {}),
    }]
  })
}

export function toProductSummary(product: PublicProductRecord): ProductSummary | null {
  const displayName = cleanString(product.productNameZh || '')
  const displayVideoTitle = cleanString(product.videoTitleZh || '')
  const displayPros = toChineseStringArray(product.prosZh)
  const displayCons = toChineseStringArray(product.consZh)

  if (!displayName || !containsChinese(displayName) || product.normalizedScore === null || displayPros.length === 0 || displayCons.length === 0) {
    return null
  }

  return {
    id: product.id,
    displayName,
    displayVideoTitle,
    scoreRaw: product.scoreRaw,
    normalizedScore: product.normalizedScore,
    displayPros,
    displayCons,
    confidence: product.confidence,
    video: {
      youtubeId: product.video.youtubeId,
      publishedAt: toIsoString(product.video.publishedAt),
      thumbnailUrl: product.video.thumbnailUrl,
      videoUrl: product.video.videoUrl,
    },
  }
}

export function toProductDetail(product: PublicProductDetailRecord): ProductDetail | null {
  const summary = toProductSummary(product)
  if (!summary) return null

  return {
    ...summary,
    displayEvidence: toEvidenceSegments(product.evidenceSegmentsZh),
  }
}

export function shouldPublishChineseProduct(input: {
  productNameZh: string
  normalizedScore: number | null
  confidence: number
  prosZh: string[]
  consZh: string[]
}): boolean {
  return Boolean(
    cleanString(input.productNameZh) &&
    containsChinese(input.productNameZh) &&
    input.normalizedScore !== null &&
    input.confidence >= 0.6 &&
    toChineseStringArray(input.prosZh).length > 0 &&
    toChineseStringArray(input.consZh).length > 0
  )
}

export function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback

  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}
