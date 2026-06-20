import { normalizePublicText } from './text-normalization'

export type ProductPriceType = 'listed' | 'official' | 'launch' | 'street' | 'original' | 'presale' | 'approximate' | 'mentioned'

export interface PriceTranscriptSegment {
  text: string
  start?: number
  duration?: number
}

export interface PriceExtractionInput {
  productNameZh?: string | null
  productName?: string | null
  videoTitleZh?: string | null
  videoTitle?: string | null
  transcript?: string | null
  transcriptSegments?: unknown
}

export interface PriceExtractionResult {
  priceRaw: string
  priceValue: number
  priceCurrency: 'CNY'
  priceType: ProductPriceType
  priceContext: string
  priceConfidence: number
}

interface PriceCandidate extends PriceExtractionResult {
  index: number
  tokenMatches: number
  keywordScore: number
  rawSignalScore: number
}

const PRICE_KEYWORD_RE = /(价格|售价|官方价|官方价格|首发价|到手价|定价|原价|预售价|人民币|报价|卖到|卖|¥|￥)/
const APPROX_RE = /(接近|大约|大概|大致|差不多|将近|不到|约)/
const BAD_CONTEXT_RE = /(美元|美金|刀|USD|港币|欧元|差价|优惠券|红包|满减|立减|便宜了|贵了|省了|加价|补贴|定金|尾款|订金|给你|下手|起拍|起争取|一共|总共|合计|整套|这一套|回血|购买价|保护膜|快门线|摄影包|配件|两倍|翻了|跳水|降价|少了|差了|分钟|小时|秒钟|毫安|瓦|摄氏|公里|克|公斤|英寸|寸|毫米|GB|TB|Hz|帧率|版本|评分|打分|综合评分|主观评分|第\s*\d+\s*期)/
const FOREIGN_CURRENCY_RE = /(美元|美金|USD|US\$|港币|港元|HKD|欧元|EUR|英镑|GBP|日元|JPY)/i
const COMMON_TOKEN_RE = /^(TESTV|YouTube|Bilibili|值不值得买|产品|评测|视频|字幕|官方|价格|售价|这一期|本期|这个|一个|今天|我们|主观|综合|评分)$/i
const COLLECTION_PRODUCT_RE = /(年度|大回顾|大合集|合集|大比拼|鉴定|伙伴们|好物|废物|回血榜|榜单|清单|盘点)/
const ACCESSORY_RE = /(键盘|电池|保护膜|快门线|摄影包|数据线|会员|色带|相纸|刷头|滤芯|耗材|遥控器|太阳能板|充电器|壳子|外壳|套餐|配件)/

const NUMBER_PATTERN = '([0-9]+(?:,[0-9]{3})*(?:\\.[0-9]+)?|[0-9]+(?:\\.[0-9]+)?)'
const MONEY_WITH_KEYWORD_RE = new RegExp(`(价格|售价|官方价|官方价格|首发价|到手价|定价|原价|预售价|人民币|报价|卖到|卖)\\s*(?:就是|大概是|大约是|约为|为|在|：|:)?\\s*(?:[¥￥]\\s*)?${NUMBER_PATTERN}\\s*(万|千|百)?\\s*(元|块钱|块)?`, 'g')
const SYMBOL_MONEY_RE = new RegExp(`[¥￥]\\s*${NUMBER_PATTERN}\\s*(万|千|百)?`, 'g')
const APPROX_MONEY_RE = new RegExp(`(接近|大约|大概|大致|差不多|将近|不到|约)\\s*${NUMBER_PATTERN}\\s*(万|千|百)?\\s*(元|块钱|块)`, 'g')
const UNIT_MONEY_RE = new RegExp(`${NUMBER_PATTERN}\\s*(万|千|百)?\\s*(元|块钱|块)`, 'g')
const PRICE_TYPES: ProductPriceType[] = ['listed', 'official', 'launch', 'street', 'original', 'presale', 'approximate', 'mentioned']

function clean(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function clampConfidence(value: number): number {
  return Math.max(0.1, Math.min(0.99, Number(value.toFixed(2))))
}

function parseAmount(value: string, magnitude?: string): number | null {
  const amount = Number.parseFloat(value.replace(/,/g, ''))
  if (!Number.isFinite(amount)) return null

  const multiplier = magnitude === '万' ? 10_000 : magnitude === '千' ? 1_000 : magnitude === '百' ? 100 : 1
  const result = amount * multiplier

  if (!Number.isFinite(result) || result < 50 || result > 50_000) return null
  return Math.round(result * 100) / 100
}

function formatYuan(value: number): string {
  return `¥${new Intl.NumberFormat('zh-CN', {
    maximumFractionDigits: value % 1 === 0 ? 0 : 2,
  }).format(value)}`
}

function formatYuanDisplay(value: number): string {
  return `${new Intl.NumberFormat('zh-CN', {
    maximumFractionDigits: value % 1 === 0 ? 0 : 2,
    useGrouping: false,
  }).format(value)}元`
}

function parseDisplayAmountFromRaw(raw: string): number | null {
  const cleaned = normalizePublicText(raw, { allowEmpty: true, maxLength: 40 })
  if (!cleaned) return null

  const patterns = [
    /[¥￥]\s*([0-9]+(?:,[0-9]{3})*(?:\.[0-9]+)?|[0-9]+(?:\.[0-9]+)?)\s*(万|千|百)?/,
    /([0-9]+(?:,[0-9]{3})*(?:\.[0-9]+)?|[0-9]+(?:\.[0-9]+)?)\s*(万|千|百)?\s*(?:元|块钱|块)/,
  ]

  for (const pattern of patterns) {
    const match = pattern.exec(cleaned)
    if (!match) continue
    const value = parseAmount(match[1], match[2])
    if (value != null) return value
  }

  return null
}

function readAiString(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  return typeof value === 'string' ? value.trim() : ''
}

function readAiNumber(record: Record<string, unknown>, key: string): number | null {
  const value = record[key]
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string') return null

  const normalized = value.trim()
  if (!normalized) return null

  const parsed = parseDisplayAmountFromRaw(normalized) ?? Number.parseFloat(normalized.replace(/,/g, ''))
  return Number.isFinite(parsed) ? parsed : null
}

function normalizeAiPriceType(value: string): ProductPriceType {
  return PRICE_TYPES.includes(value as ProductPriceType) ? value as ProductPriceType : 'mentioned'
}

function normalizePriceRaw(raw: string, value: number, keyword?: string | null, approximate?: string | null): string {
  const cleaned = normalizePublicText(raw, { allowEmpty: true, maxLength: 40 })

  if (cleaned && /[元块¥￥]/.test(cleaned)) {
    return cleaned.replace(/￥/g, '¥')
  }

  if (approximate) {
    return `${approximate} ${formatYuan(value)}`
  }

  if (keyword && keyword !== '卖') {
    return `${keyword} ${formatYuan(value)}`
  }

  return formatYuan(value)
}

function inferPriceType(raw: string, keyword?: string | null, approximate?: string | null): ProductPriceType {
  const text = `${keyword || ''}${raw}`
  if (approximate || APPROX_RE.test(text)) return 'approximate'
  if (/官方/.test(text)) return 'official'
  if (/首发/.test(text)) return 'launch'
  if (/到手/.test(text)) return 'street'
  if (/原价/.test(text)) return 'original'
  if (/预售/.test(text)) return 'presale'
  if (/售价|价格|定价|报价/.test(text)) return 'listed'
  return 'mentioned'
}

function contextAround(text: string, index: number, length: number, radius = 48): string {
  return clean(text.slice(Math.max(0, index - radius), Math.min(text.length, index + length + radius)))
}

function normalizeContext(value: string): string {
  return normalizePublicText(value, { allowEmpty: true, maxLength: 120 })
}

function normalizeSegments(value: unknown): PriceTranscriptSegment[] {
  if (!Array.isArray(value)) return []

  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const record = item as { text?: unknown; start?: unknown; duration?: unknown }
    if (typeof record.text !== 'string' || !record.text.trim()) return []

    return [{
      text: record.text,
      ...(typeof record.start === 'number' ? { start: record.start } : {}),
      ...(typeof record.duration === 'number' ? { duration: record.duration } : {}),
    }]
  })
}

function extractTokens(input: PriceExtractionInput): string[] {
  const source = [
    input.productNameZh,
    input.productName,
    input.videoTitleZh,
    input.videoTitle,
  ].filter(Boolean).join(' ')

  const tokens = new Set<string>()
  const normalized = source
    .replace(/【[^】]*】/g, ' ')
    .replace(/\[[^\]]*]/g, ' ')
    .replace(/[第]\s*\d+\s*[期集]/g, ' ')
    .replace(/[^\p{Script=Han}A-Za-z0-9]+/gu, ' ')

  for (const match of normalized.matchAll(/[\p{Script=Han}]{2,}|[A-Za-z][A-Za-z0-9-]{1,}/gu)) {
    const token = match[0].trim()
    if (!token || COMMON_TOKEN_RE.test(token)) continue
    if (/^\d+$/.test(token)) continue
    tokens.add(token)
  }

  return [...tokens].slice(0, 12)
}

function productSourceText(input: PriceExtractionInput): string {
  return clean([
    input.productNameZh,
    input.productName,
    input.videoTitleZh,
    input.videoTitle,
  ].filter(Boolean).join(' '))
}

function countTokenMatches(context: string, tokens: string[]): number {
  if (tokens.length === 0) return 0
  return tokens.filter((token) => context.includes(token)).length
}

function shouldRejectContext(context: string, raw: string): boolean {
  if (BAD_CONTEXT_RE.test(context)) return true
  if (/(差价|优惠|便宜|贵|省|加)\s*[0-9]+(?:\.[0-9]+)?\s*(?:元|块|块钱)/.test(context)) return true
  if (/[0-9]+(?:\.[0-9]+)?\s*(?:元|块|块钱)\s*(差价|优惠|便宜|贵|省|加)/.test(context)) return true
  if (/[0-9]+(?:\.[0-9]+)?\s*块\s*[0-9]/.test(context)) return true
  if (/价值\s*[0-9]+(?:\.[0-9]+)?\s*(?:元|块|块钱)/.test(context) && !PRICE_KEYWORD_RE.test(raw)) return true
  if (/[0-9]+(?:\.[0-9]+)?\s*(?:元|块|块钱).{0,12}[0-9]+(?:\.[0-9]+)?\s*(?:元|块|块钱).{0,12}[0-9]+(?:\.[0-9]+)?\s*(?:元|块|块钱)/.test(context)) return true
  if (/价格\s*[0-9]+(?:\.[0-9]+)?\s*(?:毫米|mm|MM)/i.test(context)) return true
  if (/不重要|还需要|还得|算下来|这就|买了一个|买好多|换到|换来/.test(context)) return true
  if (/比[^。]{0,24}(?:还要|更)[^。]{0,24}(?:大|小|长|短|厚|薄)/.test(context)) return true
  if (/^\s*[0-9]+(?:\.[0-9]+)?\s*分\s*$/.test(raw)) return true
  return false
}

function shouldRejectForProduct(context: string, productSource: string): boolean {
  if (COLLECTION_PRODUCT_RE.test(productSource)) return true

  const accessoryMatch = context.match(ACCESSORY_RE)
  if (accessoryMatch && !productSource.includes(accessoryMatch[0])) return true

  return false
}

export function shouldSkipPriceExtraction(input: PriceExtractionInput): boolean {
  return COLLECTION_PRODUCT_RE.test(productSourceText(input))
}

function buildCandidate(input: {
  raw: string
  value: number
  index: number
  context: string
  tokens: string[]
  keyword?: string | null
  approximate?: string | null
  hasUnitOrSymbol: boolean
}): PriceCandidate | null {
  const context = normalizeContext(input.context)
  if (!context || shouldRejectContext(context, input.raw)) return null

  const keywordScore = PRICE_KEYWORD_RE.test(context) ? 1 : 0
  const rawSignalScore =
    (/(价格|售价|官方价|官方价格|首发价|到手价|定价|原价|预售价|人民币|报价|卖到|卖)/.test(input.raw) ? 2 : 0) +
    (APPROX_RE.test(input.raw) ? 1 : 0) +
    (/[¥￥]/.test(input.raw) ? 0.5 : 0)
  const approximateScore = APPROX_RE.test(context) ? 0.1 : 0
  const tokenMatches = countTokenMatches(context, input.tokens)

  if (!input.hasUnitOrSymbol && !keywordScore) return null
  if (!keywordScore && !input.approximate && tokenMatches === 0) return null

  const confidence = clampConfidence(
    0.48 +
      (input.keyword ? 0.18 : 0) +
      (input.hasUnitOrSymbol ? 0.08 : 0) +
      Math.min(tokenMatches, 2) * 0.1 +
      approximateScore,
  )

  return {
    priceRaw: normalizePriceRaw(input.raw, input.value, input.keyword, input.approximate),
    priceValue: input.value,
    priceCurrency: 'CNY',
    priceType: inferPriceType(input.raw, input.keyword, input.approximate),
    priceContext: context,
    priceConfidence: confidence,
    index: input.index,
    tokenMatches,
    keywordScore,
    rawSignalScore,
  }
}

function collectFromText(text: string, tokens: string[]): PriceCandidate[] {
  const candidates: PriceCandidate[] = []

  for (const match of text.matchAll(MONEY_WITH_KEYWORD_RE)) {
    const value = parseAmount(match[2] || '', match[3])
    if (value == null || match.index == null) continue
    const raw = match[0]
    const candidate = buildCandidate({
      raw,
      value,
      index: match.index,
      context: contextAround(text, match.index, raw.length),
      tokens,
      keyword: match[1],
      hasUnitOrSymbol: Boolean(match[4]) || /[¥￥]/.test(raw),
    })
    if (candidate) candidates.push(candidate)
  }

  for (const match of text.matchAll(SYMBOL_MONEY_RE)) {
    const value = parseAmount(match[1] || '', match[2])
    if (value == null || match.index == null) continue
    const raw = match[0]
    const candidate = buildCandidate({
      raw,
      value,
      index: match.index,
      context: contextAround(text, match.index, raw.length),
      tokens,
      keyword: '¥',
      hasUnitOrSymbol: true,
    })
    if (candidate) candidates.push(candidate)
  }

  for (const match of text.matchAll(APPROX_MONEY_RE)) {
    const value = parseAmount(match[2] || '', match[3])
    if (value == null || match.index == null) continue
    const raw = match[0]
    const candidate = buildCandidate({
      raw,
      value,
      index: match.index,
      context: contextAround(text, match.index, raw.length),
      tokens,
      approximate: match[1],
      hasUnitOrSymbol: true,
    })
    if (candidate) candidates.push(candidate)
  }

  for (const match of text.matchAll(UNIT_MONEY_RE)) {
    const value = parseAmount(match[1] || '', match[2])
    if (value == null || match.index == null) continue
    const raw = match[0]
    const context = contextAround(text, match.index, raw.length)
    if (!PRICE_KEYWORD_RE.test(context) && !APPROX_RE.test(context)) continue
    const candidate = buildCandidate({
      raw,
      value,
      index: match.index,
      context,
      tokens,
      hasUnitOrSymbol: true,
    })
    if (candidate) candidates.push(candidate)
  }

  return candidates
}

function collectFromSegments(segments: PriceTranscriptSegment[], tokens: string[]): PriceCandidate[] {
  const candidates: PriceCandidate[] = []

  for (let index = 0; index < segments.length; index += 1) {
    const window = segments
      .slice(Math.max(0, index - 2), Math.min(segments.length, index + 3))
      .map((segment) => segment.text)
      .join('。')

    for (const candidate of collectFromText(window, tokens)) {
      candidates.push({
        ...candidate,
        index: index * 10_000 + candidate.index,
      })
    }
  }

  return candidates
}

function dedupeCandidates(candidates: PriceCandidate[]): PriceCandidate[] {
  const seen = new Set<string>()

  return candidates.filter((candidate) => {
    const key = `${candidate.priceValue}|${candidate.priceRaw}|${candidate.priceContext}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function pickBestCandidate(candidates: PriceCandidate[]): PriceCandidate | null {
  if (candidates.length === 0) return null

  return [...candidates].sort((left, right) => {
    if (right.tokenMatches !== left.tokenMatches) return right.tokenMatches - left.tokenMatches
    if (right.keywordScore !== left.keywordScore) return right.keywordScore - left.keywordScore
    if (right.rawSignalScore !== left.rawSignalScore) return right.rawSignalScore - left.rawSignalScore
    if (right.priceConfidence !== left.priceConfidence) return right.priceConfidence - left.priceConfidence
    return right.index - left.index
  })[0] ?? null
}

export function extractPriceFromTranscript(input: PriceExtractionInput): PriceExtractionResult | null {
  if (shouldSkipPriceExtraction(input)) return null

  const tokens = extractTokens(input)
  const productSource = productSourceText(input)
  const transcript = clean(input.transcript || '')
  const segments = normalizeSegments(input.transcriptSegments)
  const candidates = dedupeCandidates([
    ...collectFromText(transcript, tokens),
    ...collectFromSegments(segments, tokens),
  ])
  const best = pickBestCandidate(candidates)

  if (!best) return null
  if (shouldRejectForProduct(best.priceContext, productSource)) return null

  return {
    priceRaw: best.priceRaw,
    priceValue: best.priceValue,
    priceCurrency: best.priceCurrency,
    priceType: best.priceType,
    priceContext: best.priceContext,
    priceConfidence: best.priceConfidence,
  }
}

export function formatDisplayPrice(input: {
  priceRaw?: string | null
  priceValue?: number | null
  priceCurrency?: string | null
}): string {
  if (input.priceCurrency && input.priceCurrency !== 'CNY') return ''

  if (typeof input.priceValue === 'number' && Number.isFinite(input.priceValue)) {
    return formatYuanDisplay(input.priceValue)
  }

  const rawValue = parseDisplayAmountFromRaw(input.priceRaw || '')
  if (rawValue != null) {
    return formatYuanDisplay(rawValue)
  }

  return ''
}

export function normalizeAiPriceExtractionResult(input: unknown): PriceExtractionResult | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null

  const record = input as Record<string, unknown>
  if (record.hasPrice === false) return null

  const currency = readAiString(record, 'priceCurrency')
  if (currency && currency !== 'CNY' && currency !== '人民币') return null

  const raw = normalizePublicText(readAiString(record, 'priceRaw'), {
    allowEmpty: true,
    maxLength: 40,
  })
  const valueFromNumber = readAiNumber(record, 'priceValue')
  const valueFromRaw = raw ? parseDisplayAmountFromRaw(raw) : null
  const priceValue = valueFromNumber ?? valueFromRaw

  if (priceValue == null || priceValue < 50 || priceValue > 50_000) return null

  const priceContext = normalizePublicText(readAiString(record, 'priceContext'), {
    allowEmpty: true,
    maxLength: 120,
  })
  if (FOREIGN_CURRENCY_RE.test(`${raw} ${priceContext}`)) return null

  const confidence = readAiNumber(record, 'priceConfidence')

  return {
    priceRaw: raw || formatYuanDisplay(priceValue),
    priceValue: Math.round(priceValue * 100) / 100,
    priceCurrency: 'CNY',
    priceType: normalizeAiPriceType(readAiString(record, 'priceType')),
    priceContext: priceContext || raw || formatYuanDisplay(priceValue),
    priceConfidence: clampConfidence(confidence ?? 0.75),
  }
}
