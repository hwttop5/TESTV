import { clampScore, formatScoreValue, normalizeScore } from './scoring'
import { simplifyOpinionList } from './product-detail-runtime'
import {
  computeContentStatus,
  resolveOpinionCandidates,
  toChineseStringArray,
  type ProductContentStatus,
  type PublicProductRecord,
} from './review-types'
import { buildTranscriptParagraphs } from './transcript-insights'
import {
  normalizePublicList,
  normalizePublicText,
  normalizeToSimplifiedChinese,
} from './text-normalization'

export type MissingProductField = 'score' | 'pros' | 'cons' | 'transcript'

export interface BackfillTranscriptInput {
  id?: string
  content?: string | null
  source?: string | null
  language?: string | null
  segments?: unknown
}

export interface BackfillProductInput {
  id: string
  productName: string
  productNameZh?: string | null
  videoTitleZh?: string | null
  scoreRaw?: string | null
  scoreValue?: number | null
  scoreScale?: string | null
  normalizedScore?: number | null
  prosZh?: unknown
  consZh?: unknown
  confidence?: number | null
  contentStatus?: string | null
  video: {
    youtubeId: string
    title: string
    publishedAt: Date | string
    thumbnailUrl?: string | null
    videoUrl: string
    transcripts?: BackfillTranscriptInput[]
  }
}

export interface ScoreCandidate {
  value: number
  raw: string
  scoreRaw: string
  scoreScale: '10'
  normalizedScore: number
  context: string
  position: number
  matchedProductTokens: string[]
  matchScore: number
  signals: string[]
}

export interface ScoreSuggestion {
  scoreValue: number | null
  scoreRaw: string | null
  confidence: number
  needsHumanReview: boolean
  reason: string
  selectedCandidate?: ScoreCandidate
}

export interface ProductGapReviewRow {
  productId: string
  youtubeId: string
  productName: string
  productNameZh: string | null
  videoTitle: string
  videoTitleZh: string | null
  publishedAt: string
  transcriptSource: string | null
  transcriptLength: number
  missingFields: MissingProductField[]
  hasTranscript: boolean
  storedProsCount: number
  storedConsCount: number
  displayProsCount: number
  displayConsCount: number
  scoreCandidates: ScoreCandidate[]
  suggestedScoreValue: number | null
  suggestedScoreRaw: string | null
  scoreSuggestionConfidence: number
  needsHumanReview: boolean
  reason: string
}

export interface ProductBackfillSuggestion {
  productId: string
  youtubeId?: string
  missingFields: MissingProductField[]
  suggestedScoreValue: number | null
  suggestedScoreRaw: string | null
  prosZh: string[]
  consZh: string[]
  confidence: number
  needsHumanReview: boolean
  reason: string
  source?: 'rule' | 'ai' | 'mixed' | 'failed'
  error?: string
}

export interface ProductBackfillApplyPlan {
  productId: string
  shouldWrite: boolean
  skipReason: string | null
  data: {
    scoreRaw?: string
    scoreValue?: number
    scoreScale?: '10'
    normalizedScore?: number
    prosZh?: string[]
    consZh?: string[]
    contentStatus?: ProductContentStatus
    confidence?: number
  }
}

export interface ProductGapSummary {
  total: number
  missingScore: number
  missingScoreWithTranscript: number
  missingScoreWithScoreSignals: number
  missingPros: number
  missingCons: number
  missingProsOrCons: number
  missingTranscript: number
  completeScoreProsCons: number
  needsHumanReview: number
  suggestedScore: number
}

const SCORE_CONTEXT_RADIUS = 90
const SCORE_CONTEXT_MAX_LENGTH = 220
const PRODUCT_WORD_RE = /[A-Za-z][A-Za-z0-9+.-]*|\d+[A-Za-z0-9+.-]*|[\u3400-\u9fff]{2,}/g
const SCORE_RE = /(?:(?:TESTV\s*)?(?:主观\s*)?(?:综合评分|综合得分|综合打分|最终评分|最后评分|评分|打分|得分|分数|总分)\s*(?:为|是|:|：)?\s*([0-9](?:\.[0-9]{1,2})?|10(?:\.0{1,2})?)\s*(?:\/\s*10|分)?|([0-9](?:\.[0-9]{1,2})?|10(?:\.0{1,2})?)\s*\/\s*10|([0-9](?:\.[0-9]{1,2})?|10(?:\.0{1,2})?)\s*分(?!\s*(?:钟|鐘|分钟|分鐘|秒|块|塊|元|钱|個|个|台|张|張|天|岁|歲|毫|米|钟左右|鐘左右)))/gi
const SCORE_SIGNAL_RE = /(TESTV|主观|综合|评分|打分|得分|分数|总分|得到|获得|拿到|给到|给了|给它|最后|最终|\/\s*10)/
const NON_SCORE_CONTEXT_RE = /(分钟|分鐘|秒钟|小时|小時|价格|价钱|售价|原价|块钱|元钱|不到|十分之一|1\/10|一\/十|毫安|瓦|摄氏度|度左右)/
const GENERIC_PRODUCT_WORD_RE = /^(产品|视频|标题|评测|体验|开箱|值不值得|值得|不值得|购买|推荐|综合|主观|评分|打分|得分|这个|这款|这一|今天|我们|测试|对比|合集|网络|热门|最后|结尾|总结|手机|平板|电脑|耳机|相机|风扇|家电|设备|东西|机器)$/i
const MULTI_PRODUCT_HINT_RE = /(合集|对比|横评|鉴定|盘点|大战|还是|和|与|VS|vs|多个|几款|三款|四款|五款|年度|热门)/i
const FINAL_SUMMARY_RE = /(最终|最后|结尾|总的来说|综合实力|综合表现|最出色|最推荐|今天|对比下来|总体来看)/
const BRAND_ALIASES: Array<[RegExp, string[]]> = [
  [/小米|Xiaomi/i, ['小米', '米家', 'xiaomi']],
  [/米家|Mijia/i, ['米家', '小米', 'mijia']],
  [/红米|Redmi/i, ['红米', 'Redmi', 'redmi']],
  [/戴森|Dyson/i, ['戴森', 'Dyson', 'dyson']],
  [/苹果|Apple|iPhone|iPad|MacBook/i, ['苹果', 'Apple', 'apple']],
  [/索尼|Sony/i, ['索尼', 'Sony', 'sony']],
  [/大疆|DJI/i, ['大疆', 'DJI', 'dji']],
  [/华为|Huawei/i, ['华为', 'Huawei', 'huawei']],
  [/荣耀|Honor/i, ['荣耀', 'Honor', 'honor']],
  [/任天堂|Nintendo|Switch/i, ['任天堂', 'Nintendo', 'Switch', 'switch']],
]
const PRODUCT_TERM_RE = /(智能蒸发式冷风扇|蒸发式冷风扇|无叶风扇|冷风扇|净饮机|净水器|洗地机|吸尘器|空气净化器|电纸书|平板电脑|蓝牙耳机|降噪耳机|游戏掌机|显示器|投影仪|路由器|键盘|鼠标|音箱|相机|手机|平板|电脑|耳机)/g
const BRAND_PREFIX_RE = /^(小米|米家|红米|Redmi|Xiaomi|戴森|Dyson|苹果|Apple|索尼|Sony|大疆|DJI|华为|Huawei|荣耀|Honor)\s*/i

function cleanText(value: string | null | undefined): string {
  return normalizeToSimplifiedChinese(value || '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([，。！？；：,.!?;:])/g, '$1')
    .trim()
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function getLatestTranscript(product: BackfillProductInput): BackfillTranscriptInput | null {
  return product.video.transcripts?.[0] || null
}

function getTranscriptContent(product: BackfillProductInput): string {
  return cleanText(getLatestTranscript(product)?.content || '')
}

function toPublicProduct(product: BackfillProductInput): PublicProductRecord {
  return {
    id: product.id,
    productName: product.productName,
    productNameZh: product.productNameZh || null,
    videoTitleZh: product.videoTitleZh || null,
    scoreRaw: product.scoreRaw || null,
    scoreValue: product.scoreValue ?? null,
    prosZh: product.prosZh ?? null,
    consZh: product.consZh ?? null,
    confidence: product.confidence ?? null,
    contentStatus: product.contentStatus || null,
    video: {
      youtubeId: product.video.youtubeId,
      title: product.video.title,
      publishedAt: product.video.publishedAt,
      thumbnailUrl: product.video.thumbnailUrl || null,
      videoUrl: product.video.videoUrl,
      transcripts: product.video.transcripts?.map((transcript) => ({
        id: transcript.id || '',
        content: transcript.content || '',
        segments: transcript.segments,
      })) || [],
    },
  }
}

function normalizeToken(value: string): string {
  return cleanText(value).toLowerCase()
}

export function extractProductMatchTokens(
  product: Pick<BackfillProductInput, 'productName' | 'productNameZh' | 'videoTitleZh' | 'video'>,
): string[] {
  const identitySource = [
    product.productNameZh,
    product.productName,
    product.videoTitleZh,
    product.video.title,
  ].map((value) => cleanText(value || '')).find(Boolean) || ''
  const sourceWithoutBrand = identitySource.replace(BRAND_PREFIX_RE, '').trim()
  const rawTokens = identitySource.match(PRODUCT_WORD_RE) || []
  const result: string[] = []

  const addToken = (rawToken: string) => {
    const token = normalizeToken(rawToken)
    if (!token || token.length < 2 || GENERIC_PRODUCT_WORD_RE.test(token)) return
    if (/^\d+$/.test(token)) return
    if (result.includes(token)) return
    result.push(token)
  }

  for (const [pattern, aliases] of BRAND_ALIASES) {
    if (pattern.test(identitySource)) {
      aliases.forEach(addToken)
    }
  }

  rawTokens.forEach(addToken)

  if (sourceWithoutBrand && sourceWithoutBrand !== identitySource) {
    addToken(sourceWithoutBrand)
  }

  for (const match of identitySource.matchAll(PRODUCT_TERM_RE)) {
    addToken(match[0])
  }

  return result.slice(0, 24)
}

function compactScoreContext(text: string, index: number, length: number): string {
  const start = Math.max(0, index - SCORE_CONTEXT_RADIUS)
  const end = Math.min(text.length, index + length + SCORE_CONTEXT_RADIUS)
  return cleanText(text.slice(start, end)).slice(0, SCORE_CONTEXT_MAX_LENGTH)
}

function parseScoreValue(rawValue: string | undefined): number | null {
  const value = Number.parseFloat(rawValue || '')
  if (!Number.isFinite(value)) return null
  if (value < 0 || value > 10) return null
  return value
}

function scoreRaw(value: number): string {
  return `${formatScoreValue(value)}/10`
}

function candidateSignals(context: string, matchedTokens: string[]): string[] {
  const signals: string[] = []
  if (/TESTV/i.test(context)) signals.push('TESTV')
  if (/主观/.test(context)) signals.push('主观')
  if (/综合/.test(context)) signals.push('综合')
  if (/评分|打分|得分/.test(context)) signals.push('评分')
  if (/\/\s*10/.test(context)) signals.push('/10')
  if (FINAL_SUMMARY_RE.test(context)) signals.push('结尾总结')
  if (matchedTokens.length > 0) signals.push('产品名匹配')
  return signals
}

function computeCandidateMatchScore(
  context: string,
  productTokens: string[],
  matchIndex: number,
): {
  matchScore: number
  matchedProductTokens: string[]
} {
  const normalizedContext = normalizeToken(context)
  const matchedProductTokens = productTokens.filter((token) => normalizedContext.includes(token))
  let matchScore = matchedProductTokens.length * 10

  for (const token of matchedProductTokens) {
    const tokenIndex = normalizedContext.indexOf(token)
    if (tokenIndex >= 0) {
      matchScore += Math.max(0, 8 - Math.floor(Math.abs(tokenIndex - Math.min(matchIndex, normalizedContext.length)) / 12))
    }
  }

  if (/TESTV/i.test(context)) matchScore += 1
  if (/主观/.test(context)) matchScore += 1
  if (/综合/.test(context)) matchScore += 1
  if (/评分|打分|得分/.test(context)) matchScore += 1
  if (FINAL_SUMMARY_RE.test(context)) matchScore -= 2

  return {
    matchScore,
    matchedProductTokens,
  }
}

function isLikelyNonScoreContext(context: string, matchIndex: number, matchedLength: number): boolean {
  const localWindow = context.slice(Math.max(0, matchIndex - 48), matchIndex + matchedLength + 48)
  const after = context.slice(matchIndex + matchedLength, matchIndex + matchedLength + 8)

  if (!SCORE_SIGNAL_RE.test(localWindow)) return true
  if (/^\s*(钟|鐘|分钟|分鐘|秒|块|塊|元|钱|个|個|台|张|張|天|岁|歲|毫|米)/.test(after)) return true
  if (NON_SCORE_CONTEXT_RE.test(localWindow) && !/(TESTV|主观|综合|评分|打分|得分|总分|分数|\/\s*10)/.test(localWindow)) return true

  return false
}

export function extractScoreCandidates(
  transcriptText: string,
  product: Pick<BackfillProductInput, 'productName' | 'productNameZh' | 'videoTitleZh' | 'video'>,
): ScoreCandidate[] {
  const text = cleanText(transcriptText)
  if (!text) return []

  const productTokens = extractProductMatchTokens(product)
  const candidates: ScoreCandidate[] = []

  for (const match of text.matchAll(SCORE_RE)) {
    const value = parseScoreValue(match[1] || match[2] || match[3])
    if (value == null) continue

    const matchedText = match[0] || ''
    const index = match.index || 0
    const context = compactScoreContext(text, index, matchedText.length)
    const contextMatchIndex = Math.max(0, context.indexOf(matchedText))
    if (isLikelyNonScoreContext(context, contextMatchIndex, matchedText.length)) continue

    const matchInfo = computeCandidateMatchScore(context, productTokens, contextMatchIndex)
    const beforeMatchedText = context.slice(Math.max(0, contextMatchIndex - 16), contextMatchIndex)
    const isDirectOverallScore = /(TESTV|主观|综合|最终|最后|评分|打分|得分|\/\s*10)/.test(matchedText)
    const isSubScore = /(设计|功能|易用性|性价比|做工|外观|体验|价格)\s*$/.test(beforeMatchedText)
    const adjustedMatchScore = matchInfo.matchScore + (isDirectOverallScore ? 16 : 0) - (isSubScore ? 8 : 0)

    candidates.push({
      value,
      raw: cleanText(matchedText),
      scoreRaw: scoreRaw(value),
      scoreScale: '10',
      normalizedScore: clampScore(normalizeScore(scoreRaw(value), value, '10')),
      context,
      position: index,
      matchedProductTokens: matchInfo.matchedProductTokens,
      matchScore: adjustedMatchScore,
      signals: candidateSignals(context, matchInfo.matchedProductTokens),
    })
  }

  const seen = new Set<string>()
  return candidates.filter((candidate) => {
    const key = `${candidate.value}|${candidate.position}|${candidate.context.slice(0, 40)}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function suggestScoreFromCandidates(input: {
  product: Pick<BackfillProductInput, 'productName' | 'productNameZh' | 'videoTitleZh' | 'video'>
  candidates: ScoreCandidate[]
}): ScoreSuggestion {
  const candidates = [...input.candidates]
  if (candidates.length === 0) {
    return {
      scoreValue: null,
      scoreRaw: null,
      confidence: 0,
      needsHumanReview: false,
      reason: '字幕中未发现明确评分。',
    }
  }

  const sorted = candidates.sort((left, right) => {
    if (right.matchScore !== left.matchScore) return right.matchScore - left.matchScore
    return right.position - left.position
  })
  const best = sorted[0]
  const next = sorted[1]
  const hasAnyProductMatch = best.matchedProductTokens.length > 0
  const hasMultipleScores = new Set(candidates.map((candidate) => candidate.scoreRaw)).size > 1
  const titleLooksMultiProduct = MULTI_PRODUCT_HINT_RE.test([
    input.product.productNameZh,
    input.product.productName,
    input.product.videoTitleZh,
    input.product.video.title,
  ].filter(Boolean).join(' '))
  const closeMatch = next && best.matchScore - next.matchScore < 4

  if (hasAnyProductMatch && (!closeMatch || best.matchScore >= 12)) {
    return {
      scoreValue: best.value,
      scoreRaw: best.scoreRaw,
      confidence: Math.min(0.9, 0.62 + best.matchScore / 80),
      needsHumanReview: false,
      reason: `按产品名匹配到评分片段：${best.matchedProductTokens.join('、')}`,
      selectedCandidate: best,
    }
  }

  if (hasMultipleScores || titleLooksMultiProduct) {
    return {
      scoreValue: null,
      scoreRaw: null,
      confidence: 0.35,
      needsHumanReview: true,
      reason: '字幕中存在多个评分或疑似合集/对比视频，未能按当前产品名确认归属。',
      selectedCandidate: best,
    }
  }

  if (candidates.length === 1 && !FINAL_SUMMARY_RE.test(best.context)) {
    return {
      scoreValue: best.value,
      scoreRaw: best.scoreRaw,
      confidence: 0.58,
      needsHumanReview: false,
      reason: '字幕中仅发现一个明确评分片段。',
      selectedCandidate: best,
    }
  }

  return {
    scoreValue: null,
    scoreRaw: null,
    confidence: 0.35,
    needsHumanReview: true,
    reason: '只发现结尾总结类评分或产品名归属不清，需要人工复核。',
    selectedCandidate: best,
  }
}

export function getMissingFields(product: BackfillProductInput): MissingProductField[] {
  const transcript = getLatestTranscript(product)
  const storedPros = toChineseStringArray(product.prosZh)
  const storedCons = toChineseStringArray(product.consZh)
  const missing: MissingProductField[] = []

  if (product.scoreValue == null) missing.push('score')
  if (storedPros.length === 0) missing.push('pros')
  if (storedCons.length === 0) missing.push('cons')
  if (!transcript || !cleanText(transcript.content).trim()) missing.push('transcript')

  return missing
}

export function buildProductGapReviewRow(product: BackfillProductInput): ProductGapReviewRow {
  const transcript = getLatestTranscript(product)
  const transcriptContent = getTranscriptContent(product)
  const scoreCandidates = extractScoreCandidates(transcriptContent, product)
  const scoreSuggestion = product.scoreValue == null
    ? suggestScoreFromCandidates({ product, candidates: scoreCandidates })
    : {
        scoreValue: product.scoreValue,
        scoreRaw: product.scoreRaw || scoreRaw(product.scoreValue),
        confidence: product.confidence ?? 1,
        needsHumanReview: false,
        reason: '已有评分。',
      }
  const opinions = resolveOpinionCandidates(toPublicProduct(product))

  return {
    productId: product.id,
    youtubeId: product.video.youtubeId,
    productName: product.productName,
    productNameZh: product.productNameZh || null,
    videoTitle: product.video.title,
    videoTitleZh: product.videoTitleZh || null,
    publishedAt: toIsoString(product.video.publishedAt),
    transcriptSource: transcript?.source || null,
    transcriptLength: transcriptContent.length,
    missingFields: getMissingFields(product),
    hasTranscript: transcriptContent.length > 0,
    storedProsCount: toChineseStringArray(product.prosZh).length,
    storedConsCount: toChineseStringArray(product.consZh).length,
    displayProsCount: opinions.prosCount,
    displayConsCount: opinions.consCount,
    scoreCandidates,
    suggestedScoreValue: scoreSuggestion.scoreValue,
    suggestedScoreRaw: scoreSuggestion.scoreRaw,
    scoreSuggestionConfidence: scoreSuggestion.confidence,
    needsHumanReview: scoreSuggestion.needsHumanReview,
    reason: scoreSuggestion.reason,
  }
}

export function productGapRowsToSummary(rows: ProductGapReviewRow[]): ProductGapSummary {
  return rows.reduce<ProductGapSummary>((summary, row) => {
    summary.total += 1
    if (row.missingFields.includes('score')) summary.missingScore += 1
    if (row.missingFields.includes('score') && row.hasTranscript) summary.missingScoreWithTranscript += 1
    if (row.missingFields.includes('score') && row.scoreCandidates.length > 0) summary.missingScoreWithScoreSignals += 1
    if (row.missingFields.includes('pros')) summary.missingPros += 1
    if (row.missingFields.includes('cons')) summary.missingCons += 1
    if (row.missingFields.includes('pros') || row.missingFields.includes('cons')) summary.missingProsOrCons += 1
    if (row.missingFields.includes('transcript')) summary.missingTranscript += 1
    if (row.missingFields.length === 0) summary.completeScoreProsCons += 1
    if (row.needsHumanReview) summary.needsHumanReview += 1
    if (row.suggestedScoreValue != null) summary.suggestedScore += 1
    return summary
  }, {
    total: 0,
    missingScore: 0,
    missingScoreWithTranscript: 0,
    missingScoreWithScoreSignals: 0,
    missingPros: 0,
    missingCons: 0,
    missingProsOrCons: 0,
    missingTranscript: 0,
    completeScoreProsCons: 0,
    needsHumanReview: 0,
    suggestedScore: 0,
  })
}

export function csvEscape(value: unknown): string {
  if (value == null) return ''
  const text = Array.isArray(value) || typeof value === 'object'
    ? JSON.stringify(value)
    : String(value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function productGapRowsToCsv(rows: ProductGapReviewRow[]): string {
  const headers = [
    'productId',
    'youtubeId',
    'productName',
    'productNameZh',
    'videoTitle',
    'publishedAt',
    'missingFields',
    'transcriptSource',
    'transcriptLength',
    'scoreCandidates',
    'suggestedScoreValue',
    'suggestedScoreRaw',
    'needsHumanReview',
    'reason',
  ]

  const lines = [
    headers.join(','),
    ...rows.map((row) => headers.map((header) => {
      const value = header === 'scoreCandidates'
        ? row.scoreCandidates.map((candidate) => ({
            value: candidate.value,
            raw: candidate.raw,
            context: candidate.context,
            matchedProductTokens: candidate.matchedProductTokens,
          }))
        : header === 'missingFields'
          ? row.missingFields.join('|')
          : row[header as keyof ProductGapReviewRow]
      return csvEscape(value)
    }).join(',')),
  ]

  return `${lines.join('\n')}\n`
}

export function buildRuleSuggestion(product: BackfillProductInput, row: ProductGapReviewRow): ProductBackfillSuggestion {
  const opinions = resolveOpinionCandidates(toPublicProduct(product))
  const prosZh = row.missingFields.includes('pros')
    ? normalizePublicList(simplifyOpinionList(opinions.prosCandidates), { maxItems: 3, maxLength: 28 })
    : normalizePublicList(toChineseStringArray(product.prosZh), { maxItems: 3, maxLength: 28 })
  const consZh = row.missingFields.includes('cons')
    ? normalizePublicList(simplifyOpinionList(opinions.consCandidates), { maxItems: 3, maxLength: 28 })
    : normalizePublicList(toChineseStringArray(product.consZh), { maxItems: 3, maxLength: 28 })

  const suggestedScoreValue = row.missingFields.includes('score') && !row.needsHumanReview
    ? row.suggestedScoreValue
    : product.scoreValue ?? null
  const suggestedScoreRaw = suggestedScoreValue == null
    ? null
    : row.suggestedScoreRaw || scoreRaw(suggestedScoreValue)
  const fillsRulePros = row.missingFields.includes('pros') && prosZh.length > 0
  const fillsRuleCons = row.missingFields.includes('cons') && consZh.length > 0
  const opinionNeedsHumanReview = fillsRulePros || fillsRuleCons
  const reason = [
    row.reason,
    opinionNeedsHumanReview ? '优缺点为本地规则候选，写库前需要人工或 AI 复核。' : '',
  ].filter(Boolean).join(' ')

  return {
    productId: product.id,
    youtubeId: product.video.youtubeId,
    missingFields: row.missingFields,
    suggestedScoreValue,
    suggestedScoreRaw,
    prosZh,
    consZh,
    confidence: Math.max(
      row.scoreSuggestionConfidence,
      opinions.prosCount > 0 || opinions.consCount > 0 ? 0.58 : 0.35,
    ),
    needsHumanReview: row.needsHumanReview || opinionNeedsHumanReview,
    reason,
    source: 'rule',
  }
}

export function selectTranscriptParagraphsForReview(product: BackfillProductInput): string[] {
  const transcript = getLatestTranscript(product)
  const paragraphs = buildTranscriptParagraphs({
    content: transcript?.content,
    segments: transcript?.segments,
  })

  if (paragraphs.length <= 50) return paragraphs

  const selected = new Map<number, string>()
  const addRange = (start: number, end: number) => {
    for (let index = Math.max(0, start); index < Math.min(paragraphs.length, end); index += 1) {
      selected.set(index, paragraphs[index])
    }
  }

  addRange(0, 6)
  addRange(paragraphs.length - 16, paragraphs.length)

  paragraphs.forEach((paragraph, index) => {
    if (/(评分|打分|得分|优点|缺点|问题|不足|推荐|不推荐|值得|不值得|综合)/.test(paragraph)) {
      addRange(index - 1, index + 2)
    }
  })

  return [...selected.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, paragraph]) => paragraph)
    .slice(0, 60)
}

export function safeParseSuggestionJson(content: string): ProductBackfillSuggestion {
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
      return normalizeSuggestion(JSON.parse(candidate) as Partial<ProductBackfillSuggestion>)
    } catch {
      // try next candidate
    }
  }

  throw new Error(`AI 返回内容不是合法 JSON：${content.slice(0, 240)}`)
}

export function normalizeSuggestion(value: Partial<ProductBackfillSuggestion>): ProductBackfillSuggestion {
  const scoreValue = typeof value.suggestedScoreValue === 'number' && Number.isFinite(value.suggestedScoreValue)
    ? Math.min(10, Math.max(0, value.suggestedScoreValue))
    : null
  const scoreRawValue = scoreValue == null
    ? null
    : normalizePublicText(value.suggestedScoreRaw || scoreRaw(scoreValue), { allowEmpty: true, maxLength: 32 }) || scoreRaw(scoreValue)

  return {
    productId: String(value.productId || ''),
    youtubeId: value.youtubeId,
    missingFields: Array.isArray(value.missingFields)
      ? value.missingFields.filter((field): field is MissingProductField => field === 'score' || field === 'pros' || field === 'cons' || field === 'transcript')
      : [],
    suggestedScoreValue: scoreValue,
    suggestedScoreRaw: scoreRawValue,
    prosZh: normalizePublicList(simplifyOpinionList(Array.isArray(value.prosZh) ? value.prosZh : []), { maxItems: 3, maxLength: 28 }),
    consZh: normalizePublicList(simplifyOpinionList(Array.isArray(value.consZh) ? value.consZh : []), { maxItems: 3, maxLength: 28 }),
    confidence: typeof value.confidence === 'number' && Number.isFinite(value.confidence)
      ? Math.min(1, Math.max(0, value.confidence))
      : 0.5,
    needsHumanReview: Boolean(value.needsHumanReview),
    reason: normalizePublicText(value.reason || '', { allowEmpty: true, maxLength: 160 }) || '未提供原因。',
    source: value.source,
    error: value.error,
  }
}

export function createFailedSuggestion(input: {
  productId: string
  youtubeId?: string
  missingFields: MissingProductField[]
  error: string
}): ProductBackfillSuggestion {
  return {
    productId: input.productId,
    youtubeId: input.youtubeId,
    missingFields: input.missingFields,
    suggestedScoreValue: null,
    suggestedScoreRaw: null,
    prosZh: [],
    consZh: [],
    confidence: 0,
    needsHumanReview: true,
    reason: 'AI 建议生成失败，需要人工复核。',
    source: 'failed',
    error: input.error,
  }
}

export function buildApplyPlan(input: {
  current: {
    id: string
    scoreValue?: number | null
    prosZh?: unknown
    consZh?: unknown
    confidence?: number | null
    video?: { transcripts?: BackfillTranscriptInput[] }
  }
  suggestion: ProductBackfillSuggestion
  applyHumanReview?: boolean
}): ProductBackfillApplyPlan {
  const suggestion = normalizeSuggestion(input.suggestion)

  if (!suggestion.productId || suggestion.productId !== input.current.id) {
    return {
      productId: input.current.id,
      shouldWrite: false,
      skipReason: '建议记录的 productId 与当前产品不一致。',
      data: {},
    }
  }

  if (suggestion.needsHumanReview && !input.applyHumanReview) {
    return {
      productId: input.current.id,
      shouldWrite: false,
      skipReason: '建议标记为需要人工复核，默认跳过。',
      data: {},
    }
  }

  const data: ProductBackfillApplyPlan['data'] = {}
  if (input.current.scoreValue == null && suggestion.suggestedScoreValue != null) {
    data.scoreValue = suggestion.suggestedScoreValue
    data.scoreRaw = suggestion.suggestedScoreRaw || scoreRaw(suggestion.suggestedScoreValue)
    data.scoreScale = '10'
    data.normalizedScore = clampScore(normalizeScore(data.scoreRaw, suggestion.suggestedScoreValue, '10'))
  }

  const currentPros = toChineseStringArray(input.current.prosZh)
  const currentCons = toChineseStringArray(input.current.consZh)
  if (currentPros.length === 0 && suggestion.prosZh.length > 0) {
    data.prosZh = suggestion.prosZh
  }
  if (currentCons.length === 0 && suggestion.consZh.length > 0) {
    data.consZh = suggestion.consZh
  }

  const nextPros = data.prosZh || currentPros
  const nextCons = data.consZh || currentCons
  const nextScore = data.scoreValue ?? input.current.scoreValue ?? null
  const hasTranscript = Boolean(input.current.video?.transcripts?.length)
  data.contentStatus = computeContentStatus({
    scoreValue: nextScore,
    prosZh: nextPros,
    consZh: nextCons,
    hasTranscript,
  })
  data.confidence = Math.max(input.current.confidence ?? 0, suggestion.confidence)

  const meaningfulKeys = Object.keys(data).filter((key) => key !== 'contentStatus' && key !== 'confidence')
  if (meaningfulKeys.length === 0) {
    return {
      productId: input.current.id,
      shouldWrite: false,
      skipReason: '没有可写入的新字段。',
      data,
    }
  }

  return {
    productId: input.current.id,
    shouldWrite: true,
    skipReason: null,
    data,
  }
}
