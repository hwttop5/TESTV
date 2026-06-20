import axios from 'axios'
import { z } from 'zod'
import { buildOpenAiHeaders, buildOpenAiUrl } from './openai-client'
import { extractPriceFromTranscript } from './price-extraction'
import { clampScore, normalizeScore, parseScore } from './scoring'
import { normalizePublicList, normalizePublicText } from './text-normalization'
import type { ProductContentStatus, TranscriptSegment } from './review-types'

const RawExtractionSchema = z.object({
  productName: z.string().default(''),
  productNameZh: z.string().default(''),
  videoTitleZh: z.string().default(''),
  scoreRaw: z.string().nullable().optional(),
  scoreValue: z.number().nullable().optional(),
  scoreScale: z.union([z.string(), z.number()]).nullable().optional(),
  normalizedScore: z.number().nullable().optional(),
  priceRaw: z.string().nullable().optional(),
  priceValue: z.number().nullable().optional(),
  priceCurrency: z.string().nullable().optional(),
  priceType: z.string().nullable().optional(),
  priceContext: z.string().nullable().optional(),
  priceConfidence: z.number().min(0).max(1).nullable().optional(),
  pros: z.array(z.string()).default([]),
  cons: z.array(z.string()).default([]),
  prosZh: z.array(z.string()).default([]),
  consZh: z.array(z.string()).default([]),
  evidenceSegments: z.array(
    z.object({
      text: z.string(),
      timestamp: z.string().nullable().optional(),
    })
  ).default([]),
  evidenceSegmentsZh: z.array(
    z.object({
      text: z.string(),
      timestamp: z.string().nullable().optional(),
    })
  ).default([]),
  confidence: z.number().min(0).max(1).default(0),
  contentStatus: z.enum(['complete', 'partial', 'placeholder']).optional(),
})

export interface ExtractionResult {
  productName: string
  productNameZh: string
  videoTitleZh: string
  scoreRaw: string | null
  scoreValue: number | null
  scoreScale: string | null
  normalizedScore: number | null
  priceRaw: string | null
  priceValue: number | null
  priceCurrency: string | null
  priceType: string | null
  priceContext: string | null
  priceConfidence: number | null
  pros: string[]
  cons: string[]
  prosZh: string[]
  consZh: string[]
  evidenceSegments: Array<{
    text: string
    timestamp?: string
  }>
  evidenceSegmentsZh: Array<{
    text: string
    timestamp?: string
  }>
  confidence: number
  contentStatus: ProductContentStatus
}

interface ExtractOptions {
  apiKey?: string
  baseUrl?: string
  model?: string
  videoTitle?: string
  transcriptSegments?: TranscriptSegment[]
}

interface CandidateScore {
  productName: string
  scoreRaw: string
  scoreValue: number
  scoreScale: string
  normalizedScore: number
  position: number
  segmentIndex?: number
  timestamp?: string
}

const CHINESE_RE = /[\u3400-\u9fff]/
const SCORE_SEGMENT_RE = /(?:TESTV|Testv)?\s*主观综合评分\s*([0-9]+(?:\.[0-9]+)?)\s*分?/
const SCORE_LINE_RE = /([^。！？\n]{1,40}?)(?:TESTV|Testv)?\s*主观综合评分\s*([0-9]+(?:\.[0-9]+)?)\s*分?/g
const PRODUCT_HINT_RE = /(耳机|风扇|净饮机|净水器|吸尘器|音箱|手机|相机|电源|显示器|平板|手表|鼠标|键盘|投影|路由器|咖啡机|洗碗机|制冰机|学习机|游戏机|掌机|MacBook|iPhone|iPad|DJI|Switch|索尼|小米|米家|红米|OPPO|vivo|华为|荣耀|西屋|Bruno|Sony|Nintendo)/i
const POSITIVE_HINT_RE = /(优点|不错|值得|推荐|适合|优秀|方便|稳定|安静|划算|性价比|舒服|好用|好看|质感|细腻|轻便|扎实|灵敏|强)/i
const NEGATIVE_HINT_RE = /(缺点|问题|毛病|不足|不适合|不建议|吐槽|发热|掉线|一般|贵|噪音|难受|可惜|误触|延迟|笨重|鸡肋|吃灰|反光|偏弱)/i
const PROMO_LINE_RE = /(淘宝|店铺|频道会员|超级感谢|支持我们|关注我们的频道|优质内容|明信片|牛肉|上新)/i

function cleanString(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function cleanList(values: string[]): string[] {
  return [...new Set(values.map(cleanString).filter(Boolean))]
}

function containsChinese(value: string): boolean {
  return CHINESE_RE.test(value)
}

function isPlaceholderKey(value: string | undefined): boolean {
  return !value || /your_|placeholder|here/i.test(value)
}

function toTimestamp(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
  }

  return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
}

function trimPunctuation(value: string): string {
  return cleanString(value).replace(/^[：:，,。.!！？\-~\s]+|[：:，,。.!！？\-~\s]+$/g, '')
}

function normalizeTitle(title: string): string {
  return trimPunctuation(
    cleanString(title)
      .replace(/【值不值得买[^】]*】/g, '')
      .replace(/《值不值得买》/g, '')
      .replace(/\[.*?\]/g, '')
      .replace(/（.*?）/g, '')
  )
}

function deriveVideoTitleZh(videoTitle?: string): string {
  return videoTitle ? normalizeTitle(videoTitle) : '暂无中文标题'
}

function normalizeProductName(name: string): string {
  return trimPunctuation(
    name
      .replace(/^(这期|本期|这个|这款|这台|今天这台|今天这款|我们这台|我们这款)/, '')
      .replace(/(主观综合评分).*$/, '')
  )
}

function isLikelyProductName(name: string): boolean {
  const normalized = normalizeProductName(name)
  if (!normalized || normalized.length < 2 || normalized.length > 48) return false
  if (PROMO_LINE_RE.test(normalized)) return false
  return PRODUCT_HINT_RE.test(normalized) || containsChinese(normalized) || /[A-Za-z]+\s*[\dA-Za-z-]+/.test(normalized)
}

function inferChineseCategory(sourceText: string): string {
  const match = sourceText.match(PRODUCT_HINT_RE)
  return match?.[1] || '产品'
}

function deriveProductNameFromTitle(videoTitle?: string): string {
  if (!videoTitle) return ''

  const normalized = normalizeTitle(videoTitle)
  const parts = normalized
    .split(/[？?！!：:·|,，]/)
    .map(normalizeProductName)
    .filter(Boolean)

  const hinted = [...parts].reverse().find((part) => PRODUCT_HINT_RE.test(part))
  if (hinted) return hinted

  return normalizeProductName(normalized)
}

function ensureChineseDisplayName(productName: string, videoTitle?: string, transcript?: string): string {
  const normalized = normalizeProductName(productName)
  if (containsChinese(normalized)) return normalized

  const sourceText = `${videoTitle || ''} ${transcript || ''}`
  const category = inferChineseCategory(sourceText)
  return normalized ? `${normalized} ${category}` : `待补全${category}`
}

function buildTenPointScore(rawValue: string): Omit<CandidateScore, 'productName' | 'position' | 'segmentIndex' | 'timestamp'> | null {
  const scoreValue = Number.parseFloat(rawValue)
  if (!Number.isFinite(scoreValue)) return null

  return {
    scoreRaw: `${scoreValue}/10`,
    scoreValue,
    scoreScale: '10',
    normalizedScore: clampScore(scoreValue * 10),
  }
}

function dedupeCandidates(candidates: CandidateScore[]): CandidateScore[] {
  const seen = new Set<string>()

  return candidates.filter((candidate) => {
    const key = `${candidate.productName}|${candidate.scoreRaw}|${candidate.position}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function findScoreCandidatesFromSegments(transcriptSegments: TranscriptSegment[]): CandidateScore[] {
  const candidates: CandidateScore[] = []

  for (let i = 0; i < transcriptSegments.length; i++) {
    const segment = transcriptSegments[i]
    const match = cleanString(segment.text).match(SCORE_SEGMENT_RE)
    if (!match) continue

    const previousWindow = transcriptSegments
      .slice(Math.max(0, i - 3), i + 1)
      .map((item) => normalizeProductName(item.text))
      .reverse()
    const productName = previousWindow.find(isLikelyProductName)
    if (!productName) continue

    const score = buildTenPointScore(cleanString(match[1] || ''))
    if (!score) continue

    candidates.push({
      productName,
      ...score,
      position: i,
      segmentIndex: i,
      timestamp: toTimestamp(segment.start),
    })
  }

  return candidates
}

function findScoreCandidatesFromText(transcript: string): CandidateScore[] {
  const candidates: CandidateScore[] = []

  for (const match of transcript.matchAll(SCORE_LINE_RE)) {
    const productName = normalizeProductName(match[1] || '')
    if (!isLikelyProductName(productName)) continue

    const score = buildTenPointScore(cleanString(match[2] || ''))
    if (!score) continue

    candidates.push({
      productName,
      ...score,
      position: match.index || 0,
    })
  }

  return candidates
}

function pickBestScoreCandidate(
  transcript: string,
  videoTitle?: string,
  transcriptSegments?: TranscriptSegment[]
): CandidateScore | null {
  const segmentCandidates = transcriptSegments && transcriptSegments.length > 0
    ? findScoreCandidatesFromSegments(transcriptSegments)
    : []
  const textCandidates = findScoreCandidatesFromText(transcript)
  const candidates = dedupeCandidates([...segmentCandidates, ...textCandidates])

  if (candidates.length === 0) return null

  const titleDerived = deriveProductNameFromTitle(videoTitle)
  const titleMatch = [...candidates].reverse().find((candidate) => titleDerived && candidate.productName.includes(titleDerived))
  if (titleMatch) return titleMatch

  return candidates[candidates.length - 1]
}

function splitSentences(text: string): string[] {
  return cleanString(text)
    .split(/(?<=[。！？!?])/)
    .map(trimPunctuation)
    .filter(Boolean)
}

function isUsefulSnippet(sentence: string): boolean {
  return sentence.length >= 6 && sentence.length <= 60 && !PROMO_LINE_RE.test(sentence)
}

function collectProsCons(sentences: string[]): { prosZh: string[]; consZh: string[] } {
  const usable = sentences.filter(isUsefulSnippet)

  const prosZh = usable.filter((sentence) => POSITIVE_HINT_RE.test(sentence)).slice(0, 4)
  const consZh = usable.filter((sentence) => NEGATIVE_HINT_RE.test(sentence)).slice(0, 4)

  if (prosZh.length > 0 || consZh.length > 0) {
    return {
      prosZh: cleanList(prosZh),
      consZh: cleanList(consZh),
    }
  }

  const neutral = usable.filter((sentence) => PRODUCT_HINT_RE.test(sentence))

  return {
    prosZh: cleanList(neutral.filter((sentence) => !sentence.includes('但是') && !sentence.includes('不过')).slice(0, 3)),
    consZh: cleanList(neutral.filter((sentence) => sentence.includes('但是') || sentence.includes('不过') || sentence.includes('可惜')).slice(0, 3)),
  }
}

function extractContextWindow(transcript: string, center: number, radius = 1200): string {
  const start = Math.max(0, center - radius)
  const end = Math.min(transcript.length, center + radius)
  return transcript.slice(start, end)
}

function buildEvidenceFromSegments(
  transcriptSegments: TranscriptSegment[] | undefined,
  scoreCandidate?: CandidateScore | null
): Array<{ text: string; timestamp?: string }> {
  if (!transcriptSegments || transcriptSegments.length === 0) {
    return scoreCandidate?.timestamp
      ? [{ text: `${scoreCandidate.productName} 主观综合评分 ${scoreCandidate.scoreRaw}`, timestamp: scoreCandidate.timestamp }]
      : []
  }

  const startIndex = scoreCandidate?.segmentIndex != null ? Math.max(0, scoreCandidate.segmentIndex - 3) : Math.max(0, transcriptSegments.length - 4)
  return transcriptSegments
    .slice(startIndex, startIndex + 6)
    .map((segment) => ({
      text: cleanString(segment.text),
      timestamp: toTimestamp(segment.start),
    }))
    .filter((segment) => segment.text)
}

function computeContentStatus(result: {
  normalizedScore: number | null
  prosZh: string[]
  consZh: string[]
  hasTranscript: boolean
}): ProductContentStatus {
  if (result.normalizedScore !== null && result.prosZh.length > 0 && result.consZh.length > 0) {
    return 'complete'
  }

  if (result.hasTranscript) {
    return 'partial'
  }

  return 'placeholder'
}

function deriveFallbackExtraction(
  transcript: string,
  videoTitle?: string,
  transcriptSegments?: TranscriptSegment[]
): ExtractionResult {
  const scoreCandidate = pickBestScoreCandidate(transcript, videoTitle, transcriptSegments)
  const titleDerivedName = deriveProductNameFromTitle(videoTitle)
  const productName = scoreCandidate?.productName || titleDerivedName || '待补全产品'
  const productNameZh = ensureChineseDisplayName(productName, videoTitle, transcript)
  const videoTitleZh = deriveVideoTitleZh(videoTitle)

  const contextText = scoreCandidate
    ? extractContextWindow(transcript, scoreCandidate.position)
    : transcript.slice(Math.max(0, transcript.length - 1600))
  const segmentText = transcriptSegments && scoreCandidate?.segmentIndex != null
    ? transcriptSegments
      .slice(Math.max(0, scoreCandidate.segmentIndex - 12), scoreCandidate.segmentIndex + 1)
      .map((segment) => cleanString(segment.text))
      .join('。')
    : ''
  const prosCons = collectProsCons(splitSentences(`${segmentText}。${contextText}`))

  const evidenceSegmentsZh = buildEvidenceFromSegments(transcriptSegments, scoreCandidate)
  const price = extractPriceFromTranscript({
    productName,
    productNameZh,
    videoTitleZh,
    videoTitle,
    transcript,
    transcriptSegments,
  })
  const contentStatus = computeContentStatus({
    normalizedScore: scoreCandidate?.normalizedScore ?? null,
    prosZh: prosCons.prosZh,
    consZh: prosCons.consZh,
    hasTranscript: transcript.trim().length > 0,
  })

  return finalizeExtraction({
    productName,
    productNameZh,
    videoTitleZh,
    scoreRaw: scoreCandidate?.scoreRaw ?? null,
    scoreValue: scoreCandidate?.scoreValue ?? null,
    scoreScale: scoreCandidate?.scoreScale ?? null,
    normalizedScore: scoreCandidate?.normalizedScore ?? null,
    priceRaw: price?.priceRaw ?? null,
    priceValue: price?.priceValue ?? null,
    priceCurrency: price?.priceCurrency ?? null,
    priceType: price?.priceType ?? null,
    priceContext: price?.priceContext ?? null,
    priceConfidence: price?.priceConfidence ?? null,
    pros: prosCons.prosZh,
    cons: prosCons.consZh,
    prosZh: prosCons.prosZh,
    consZh: prosCons.consZh,
    evidenceSegments: evidenceSegmentsZh,
    evidenceSegmentsZh,
    confidence: contentStatus === 'complete' ? 0.78 : contentStatus === 'partial' ? 0.58 : 0.35,
    contentStatus,
  })
}

export function createPlaceholderExtraction(videoTitle?: string): ExtractionResult {
  const productName = deriveProductNameFromTitle(videoTitle) || '待补全产品'
  const productNameZh = ensureChineseDisplayName(productName, videoTitle)

  return finalizeExtraction({
    productName,
    productNameZh,
    videoTitleZh: deriveVideoTitleZh(videoTitle),
    scoreRaw: null,
    scoreValue: null,
    scoreScale: null,
    normalizedScore: null,
    priceRaw: null,
    priceValue: null,
    priceCurrency: null,
    priceType: null,
    priceContext: null,
    priceConfidence: null,
    pros: [],
    cons: [],
    prosZh: [],
    consZh: [],
    evidenceSegments: [],
    evidenceSegmentsZh: [],
    confidence: 0.15,
    contentStatus: 'placeholder',
  })
}

export function finalizeExtraction(raw: unknown): ExtractionResult {
  const parsed = RawExtractionSchema.parse(raw)
  const scoreRaw = parsed.scoreRaw ? cleanString(parsed.scoreRaw) : null
  const scoreScale = parsed.scoreScale == null ? null : String(parsed.scoreScale)

  let scoreValue = parsed.scoreValue ?? null
  let normalizedScore = parsed.normalizedScore ?? null
  let finalScoreScale = scoreScale

  if (scoreRaw) {
    const localScore = parseScore(scoreRaw)

    if (localScore) {
      scoreValue = scoreValue ?? localScore.scoreValue
      finalScoreScale = finalScoreScale ?? localScore.scoreScale
      normalizedScore = normalizedScore ?? localScore.normalizedScore
    }
  }

  if (normalizedScore == null && scoreValue != null && finalScoreScale) {
    normalizedScore = normalizeScore(scoreRaw || String(scoreValue), scoreValue, finalScoreScale)
  }

  const productName = normalizePublicText(parsed.productName, { allowEmpty: true, maxLength: 80 })
    || cleanString(parsed.productName)
  const productNameZh = normalizePublicText(parsed.productNameZh, { allowEmpty: true, maxLength: 80 })
  const videoTitleZh = normalizePublicText(parsed.videoTitleZh, { allowEmpty: true, maxLength: 120 })
  const priceRaw = normalizePublicText(parsed.priceRaw, { allowEmpty: true, maxLength: 40 })
  const priceContext = normalizePublicText(parsed.priceContext, { allowEmpty: true, maxLength: 120 })
  const priceValue = typeof parsed.priceValue === 'number' && Number.isFinite(parsed.priceValue)
    ? parsed.priceValue
    : null
  const priceCurrency = priceValue == null ? null : (parsed.priceCurrency || 'CNY')
  const priceType = priceValue == null ? null : (parsed.priceType || 'mentioned')
  const priceConfidence = priceValue == null ? null : (parsed.priceConfidence ?? 0.6)
  const prosZh = normalizePublicList(parsed.prosZh, { maxItems: 3, maxLength: 42 })
  const consZh = normalizePublicList(parsed.consZh, { maxItems: 3, maxLength: 42 })
  const hasTranscript = Boolean(prosZh.length || consZh.length || normalizedScore !== null || cleanString(parsed.videoTitleZh))
  const contentStatus = parsed.contentStatus || computeContentStatus({
    normalizedScore,
    prosZh,
    consZh,
    hasTranscript,
  })

  return {
    productName,
    productNameZh,
    videoTitleZh: videoTitleZh || '暂无中文标题',
    scoreRaw,
    scoreValue,
    scoreScale: finalScoreScale,
    normalizedScore: normalizedScore == null ? null : clampScore(normalizedScore),
    priceRaw: priceRaw || null,
    priceValue,
    priceCurrency,
    priceType,
    priceContext: priceContext || null,
    priceConfidence,
    pros: cleanList(parsed.pros),
    cons: cleanList(parsed.cons),
    prosZh,
    consZh,
    evidenceSegments: parsed.evidenceSegments.flatMap((segment) => {
      const text = normalizePublicText(segment.text, { allowEmpty: true, maxLength: 160 })
      if (!text) return []

      return [{
        text,
        ...(segment.timestamp ? { timestamp: cleanString(segment.timestamp) } : {}),
      }]
    }),
    evidenceSegmentsZh: parsed.evidenceSegmentsZh.flatMap((segment) => {
      const text = normalizePublicText(segment.text, { allowEmpty: true, maxLength: 160 })
      if (!text) return []

      return [{
        text,
        ...(segment.timestamp ? { timestamp: cleanString(segment.timestamp) } : {}),
      }]
    }),
    confidence: parsed.confidence,
    contentStatus,
  }
}

async function extractWithOpenAI(
  transcript: string,
  apiKey: string,
  model = 'gpt-4o-mini',
  videoTitle?: string,
  baseUrl?: string
): Promise<ExtractionResult> {
  const prompt = `你是一个严谨的产品评测信息抽取助手。请从视频标题和字幕中提取结构化评测信息，并严格返回 JSON。
视频标题：${videoTitle || '未知'}

字幕内容：${transcript.slice(0, 12000)}${transcript.length > 12000 ? '\n\n[字幕已截断]' : ''}

请只返回 JSON，不要返回 Markdown 代码块。字段要求如下：
{
  "productName": "原始产品名",
  "productNameZh": "中文展示产品名，品牌和型号可保留英文",
  "videoTitleZh": "中文视频标题",
  "scoreRaw": "原始评分，没有则为 null",
  "scoreValue": "评分数值，没有则为 null",
  "scoreScale": "评分满分，没有则为 null",
  "normalizedScore": "归一化到 0-100 的分数，没有则为 null",
  "priceRaw": "视频中提到的价格原文，没有则为 null",
  "priceValue": "价格数值，单位人民币元，没有则为 null",
  "priceCurrency": "默认 CNY，没有价格则为 null",
  "priceType": "listed | official | launch | street | original | presale | approximate | mentioned，没有价格则为 null",
  "priceContext": "包含价格的简短字幕上下文，没有则为 null",
  "priceConfidence": "价格可信度 0 到 1，没有价格则为 null",
  "pros": ["优点原文"],
  "prosZh": ["优点中文表达"],
  "cons": ["缺点原文"],
  "consZh": ["缺点中文表达"],
  "evidenceSegments": [{"text": "原文片段", "timestamp": "可选"}],
  "evidenceSegmentsZh": [{"text": "中文片段", "timestamp": "可选"}],
  "confidence": 0 到 1,
  "contentStatus": "complete | partial | placeholder"
}

规则：
- 每个视频只抽取一个主产品，优先取视频主要评测对象或结尾最终推荐项。
- 所有公开展示字段必须使用简体中文；不要输出繁体字。
- TESTV、YouTube、Bilibili、品牌名和型号可以保留英文，例如 iPhone 16 Pro、DJI Mavic 4 Pro、Redmi K90 Max。
- 普通说明文字不要写英文整句。
- 没有明确评分时不要猜。
- priceRaw / priceValue 只提取视频字幕中明确提到的产品价格，不要抓实时电商价格。
- 不要把 10 分钟、5 个、500 块差价、优惠券、评分等识别成产品价格。
- 多价格视频优先匹配当前主产品附近的“售价/价格/官方价/到手价/定价/原价”等片段；无法判断归属时价格字段返回 null。
- 没有明确优点或缺点时允许返回空数组，但不要写“整理中”“待补全”。
- prosZh 和 consZh 每侧最多 3 条，每条尽量一句话，控制在 15 到 28 个中文字符左右。
- 中文展示字段必须是自然中文。
- 不要编造字幕里不存在的信息。`

  const response = await axios.post(
    buildOpenAiUrl('/v1/chat/completions', baseUrl),
    {
      model,
      messages: [
        {
          role: 'system',
          content: '你负责从产品评测字幕中抽取结构化数据。必须只返回严格 JSON，公开展示字段必须是自然简体中文；品牌、平台和型号英文可以保留。',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.1,
      response_format: { type: 'json_object' },
    },
    {
      headers: {
        ...buildOpenAiHeaders(apiKey),
        'Content-Type': 'application/json',
      },
      timeout: 90_000,
    }
  )

  const content = response.data.choices[0]?.message?.content
  if (!content) {
    throw new Error('No response from AI')
  }

  return finalizeExtraction(JSON.parse(content))
}

export async function extractProductInfo(
  transcript: string,
  options: ExtractOptions = {}
): Promise<ExtractionResult> {
  const { apiKey, baseUrl, model = 'gpt-4o-mini', videoTitle, transcriptSegments } = options

  if (apiKey && !isPlaceholderKey(apiKey)) {
    try {
      return await extractWithOpenAI(transcript, apiKey, model, videoTitle, baseUrl)
    } catch (error) {
      console.error('AI extraction failed, falling back to rule-based extraction:', error)
    }
  }

  return deriveFallbackExtraction(transcript, videoTitle, transcriptSegments)
}
