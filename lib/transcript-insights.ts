import type { TranscriptSegment } from './review-types'
import {
  normalizePublicList,
  normalizePublicText,
  normalizeToSimplifiedChinese,
} from './text-normalization'

const CHINESE_RE = /[\u3400-\u9fff]/
const PRODUCT_HINT_RE = /(耳机|音箱|音响|麦克风|手机|相机|镜头|电脑|笔记本|显示器|平板|手表|手环|眼镜|键盘|鼠标|投影仪|路由器|净水器|风扇|咖啡机|洗碗机|背包|沙发|机器人|游戏机|掌机|无人机|车载|汽车|冰箱|吸尘器|净饮机|桌椅|NAS|扩展坞|iPhone|iPad|MacBook|DJI|Switch|Sony|Nintendo|小米|米家|红米|OPPO|vivo|华为|荣耀|索尼|佳能|尼康|富士)/i
const FEATURE_HINT_RE = /(降噪|音质|续航|佩戴|连接|做工|手感|重量|体积|屏幕|亮度|色彩|反光|散热|噪音|延迟|稳定|收纳|清洁|模式|风量|风感|功率|材质|充电|按键|触控|兼容|价格|性价比|支撑|画质|对焦|防抖|防水|背负|过滤|容量|保温|速度|尺寸|线材|麦克风|通透|响应|静音|安装|自动|握持|系统|性能|键程|回弹|跟手|定位|滚轮|清晰|吸力|坐感|腰靠|承托|制冷|发热|漏音|夹头|误触|便携)/i
const POSITIVE_HINT_RE = /(优点|不错|推荐|优秀|方便|稳定|安静|划算|性价比|舒服|舒适|好用|质感|细腻|轻便|扎实|灵敏|给力|清晰|顺滑|省心|耐用|提升|很稳|很快|很静音|不会误触|不夹头|不漏音|够用|够亮|够轻|很有质感|很跟手)/i
const NEGATIVE_HINT_RE = /(缺点|问题|毛病|不足|不适合|不建议|吐槽|发热|掉线|一般|噪音|难受|可惜|误触|延迟|偏重|夹头|吃灰|反光|偏弱|偏慢|费电|漏音|麻烦|松动|溢价|不够|太重|太大|太吵|不合手|混乱|卡顿|不跟手|不顺手|不灵敏|不牢|不稳|不舒服|不耐脏|不好清洁|不耐用|不值)/i
const POSITIVE_PHRASE_RE = /(不会误触|不容易误触|没什么噪音|没有明显噪音|没问题|够用|够亮|很稳|很顺滑|很跟手|很好清理|很好拆洗|很好收纳|很有质感|很舒服|很安静|很轻|很方便|很清晰|很耐用|很扎实)/i
const NEGATIVE_PHRASE_RE = /(不太稳|不够|偏重|会发热|有噪音|会误触|不舒服|不稳定|太大|太重|太吵|反光明显|延迟高|比较慢|比较麻烦|比较笨重|容易脏|容易松动|容易掉|漏音明显|续航一般|价格偏贵)/i
const MERGE_CONNECTOR_START_RE = /^(所以|而且|然后|另外|所以说|还有就是|以及|并且|同时)/
const CONTRAST_CONNECTOR_START_RE = /^(但是|不过|只是|可惜|问题是|缺点是)/
const INTRO_LINE_RE = /(大家好|欢迎来到|今天聊|今天看|这期|本期|上一期|下期|继续给大家推荐|给大家推荐|给你们推荐|我们来聊|先来说|开箱开始|测评开始|废话不多说)/i
const PROMO_LINE_RE = /(淘宝|店铺|频道会员|超级感谢|支持我们|关注我们|订阅|点赞|转发|评论区|链接在下方|私信|抽奖|上新|橱窗|购物车|福利|赞助|商务合作)/i
const TRANSITION_LINE_RE = /(接下来|然后我们看|再来看|下一款|上一款|第二个|第三个|第四个|另外一款|另外一个|继续看|轮到|后面这个|前面那个)/i
const SCORE_LINE_RE = /(打分|评分|给它.*分|我给.*分|总分|最后.*分|值不值得买分)/
const PRICE_OR_SCORE_RE = /(美元|块钱|\d+\s*块|官方价格|主观评分|参与投票|值不值得买)/
const QUESTION_FILLER_RE = /(我不知道有没有人|为什么我要强调|咱们先不说|咱们就说|好既然你这么说|谁会想要|我承认|本来我以为)/
const SUMMARY_FILLER_RE = /(总的来说|总之|简单来说|看个人|见仁见智|就是这样)/

const PARAGRAPH_TARGET_CHARS = 120
const PARAGRAPH_MAX_CHARS = 160
const PARAGRAPH_MIN_CHARS = 8
const SEGMENT_GAP_SECONDS = 2.5
const MAX_SNIPPET_LENGTH = 72

function cleanString(value: string): string {
  return normalizeToSimplifiedChinese(value).replace(/\s+/g, ' ').trim()
}

function normalizeTranscriptText(value: string): string {
  return cleanString(value)
    .replace(/([\u3400-\u9fff])\s+(?=[\u3400-\u9fff])/g, '$1')
    .replace(/\s+([，。！？；：,.!?;:])/g, '$1')
}

function trimPunctuation(value: string): string {
  return normalizeTranscriptText(value).replace(/^[，。！？；：、\s]+|[，。！？；：、\s]+$/g, '')
}

function normalizeSegmentText(value: string): string {
  return normalizeTranscriptText(value).replace(/^[，。！？；：、\s]+|\s+$/g, '')
}

function normalizeParagraph(value: string): string {
  return normalizeTranscriptText(value).replace(/^[，。！？；：、\s]+|\s+$/g, '')
}

function cleanList(values: string[]): string[] {
  return [...new Set(values.map(trimPunctuation).filter(Boolean))]
}

function splitSentences(text: string): string[] {
  return normalizeTranscriptText(text)
    .split(/(?<=[。！？!?])/)
    .map(trimPunctuation)
    .filter(Boolean)
}

function appendText(current: string, next: string): string {
  if (!current) return next

  const tail = current.at(-1) || ''
  const head = next[0] || ''
  const needsSpace = /[A-Za-z0-9]$/.test(tail) && /^[A-Za-z0-9]/.test(head)

  return `${current}${needsSpace ? ' ' : ''}${next}`
}

function mergeTrailingShortParagraphs(paragraphs: string[]): string[] {
  if (paragraphs.length <= 1) return paragraphs

  const merged: string[] = []

  for (const paragraph of paragraphs) {
    const normalized = normalizeParagraph(paragraph)
    if (!normalized) continue

    if (merged.length > 0 && merged[merged.length - 1].length < PARAGRAPH_MIN_CHARS) {
      merged[merged.length - 1] = normalizeParagraph(appendText(merged[merged.length - 1], normalized))
      continue
    }

    merged.push(normalized)
  }

  if (merged.length > 1 && merged[merged.length - 1].length < PARAGRAPH_MIN_CHARS) {
    const tail = merged.pop()
    if (tail) {
      merged[merged.length - 1] = normalizeParagraph(appendText(merged[merged.length - 1], tail))
    }
  }

  return merged
}

function mergeSentenceFragments(sentences: string[]): string[] {
  const merged: string[] = []

  for (const sentence of sentences) {
    const normalized = trimPunctuation(sentence)
    if (!normalized) continue

    const shouldMergeIntoPrevious =
      merged.length > 0 &&
      (
        MERGE_CONNECTOR_START_RE.test(normalized)
        || (normalized.length < 6 && !hasFeatureContext(normalized) && !hasProductContext(normalized))
      )

    if (shouldMergeIntoPrevious) {
      merged[merged.length - 1] = trimPunctuation(`${merged[merged.length - 1]}。${normalized}`)
      continue
    }

    merged.push(normalized)
  }

  return merged
}

function buildSentenceCandidatesFromSegments(segments: TranscriptSegment[]): string[] {
  const candidates: string[] = []
  let current = ''

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]
    const next = segments[index + 1]
    current = appendText(current, segment.text)

    const currentLength = trimPunctuation(current).length
    const endsWithStop = /[。！？!?]$/.test(segment.text)
    const nextStartsWithMergeConnector = next ? MERGE_CONNECTOR_START_RE.test(trimPunctuation(next.text)) : false
    const nextGap = next ? next.start - segment.start : Number.POSITIVE_INFINITY
    const shouldFlush = !next
      || currentLength >= 54
      || (endsWithStop && currentLength >= 5 && !nextStartsWithMergeConnector)
      || (nextGap > SEGMENT_GAP_SECONDS && currentLength >= 8 && !nextStartsWithMergeConnector)

    if (shouldFlush) {
      candidates.push(trimPunctuation(current))
      current = ''
    }
  }

  if (current) {
    candidates.push(trimPunctuation(current))
  }

  return mergeSentenceFragments(candidates)
}

function buildSentenceCandidates(input: {
  content?: string | null
  segments?: unknown
}): string[] {
  const segments = toTranscriptSegments(input.segments)
  if (segments.length > 0) {
    return buildSentenceCandidatesFromSegments(segments)
  }

  return mergeSentenceFragments(splitSentences(input.content || ''))
}

function hasFeatureContext(sentence: string): boolean {
  return FEATURE_HINT_RE.test(sentence)
}

function hasProductContext(sentence: string): boolean {
  return hasFeatureContext(sentence) || PRODUCT_HINT_RE.test(sentence)
}

function maskPositiveNegativeOverlaps(sentence: string): string {
  return sentence
    .replace(/不会误触/g, '')
    .replace(/不容易误触/g, '')
    .replace(/不夹头/g, '')
    .replace(/不漏音/g, '')
}

function classifySentiment(sentence: string): 'pro' | 'con' | null {
  const negativeComparableText = maskPositiveNegativeOverlaps(sentence)
  const hasPositivePhrase = POSITIVE_PHRASE_RE.test(sentence)
  const hasNegativePhrase = NEGATIVE_PHRASE_RE.test(negativeComparableText)
  const hasPositiveHint = POSITIVE_HINT_RE.test(sentence)
  const hasNegativeHint = NEGATIVE_HINT_RE.test(negativeComparableText)

  if (hasPositivePhrase && !hasNegativePhrase) return 'pro'
  if (hasNegativePhrase && !hasPositivePhrase) return 'con'

  const hasPositive = hasPositiveHint || hasPositivePhrase
  const hasNegative = hasNegativeHint || hasNegativePhrase

  if (hasPositive && !hasNegative) return 'pro'
  if (hasNegative && !hasPositive) return 'con'

  if (CONTRAST_CONNECTOR_START_RE.test(sentence) && hasFeatureContext(sentence)) {
    return 'con'
  }

  return null
}

function isNoiseSentence(sentence: string): boolean {
  if (!sentence || sentence.length < 5 || sentence.length > MAX_SNIPPET_LENGTH) return true
  if (!CHINESE_RE.test(sentence)) return true
  if (PROMO_LINE_RE.test(sentence) || INTRO_LINE_RE.test(sentence) || TRANSITION_LINE_RE.test(sentence)) return true
  if (SCORE_LINE_RE.test(sentence) || PRICE_OR_SCORE_RE.test(sentence) || SUMMARY_FILLER_RE.test(sentence)) return true
  if (QUESTION_FILLER_RE.test(sentence)) return true
  if (/[?？]$/.test(sentence)) return true
  if (!hasFeatureContext(sentence) && /(最值得购买|值得购买|值得买|推荐购买|太美妙了)/.test(sentence)) return true
  if (!hasProductContext(sentence)) return true

  return false
}

function scoreSentence(sentence: string, sentiment: 'pro' | 'con'): number {
  let score = 0

  if (hasFeatureContext(sentence)) score += 3
  if (PRODUCT_HINT_RE.test(sentence)) score += 1
  if (/[，；]/.test(sentence)) score += 1
  if (sentiment === 'pro' && POSITIVE_PHRASE_RE.test(sentence)) score += 2
  if (sentiment === 'con' && NEGATIVE_PHRASE_RE.test(sentence)) score += 2
  if (MERGE_CONNECTOR_START_RE.test(sentence)) score -= 1
  if (sentence.length < 12) score -= 1
  if (sentence.length > 48) score -= 1

  return score
}

export function toTranscriptSegments(value: unknown): TranscriptSegment[] {
  if (!Array.isArray(value)) return []

  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []

    const record = item as Record<string, unknown>
    if (typeof record.text !== 'string') return []

    const text = normalizeSegmentText(record.text)
    if (!text) return []

    const start = Number(record.start)
    const duration = Number(record.duration)

    return [{
      text,
      start: Number.isFinite(start) ? start : 0,
      duration: Number.isFinite(duration) ? duration : 0,
    }]
  })
}

export function deriveProsConsFromTranscript(input: {
  content?: string | null
  segments?: unknown
}): {
  pros: string[]
  cons: string[]
} {
  const candidates = buildSentenceCandidates(input)

  if (candidates.length === 0) {
    return { pros: [], cons: [] }
  }

  const scored = candidates.flatMap((sentence, index) => {
    if (isNoiseSentence(sentence)) return []

    const sentiment = classifySentiment(sentence)
    if (!sentiment) return []

    return [{
      sentence,
      sentiment,
      index,
      score: scoreSentence(sentence, sentiment),
    }]
  })

  const selectTop = (sentiment: 'pro' | 'con'): string[] => cleanList(
    scored
      .filter((item) => item.sentiment === sentiment)
      .sort((left, right) => {
        if (right.score !== left.score) return right.score - left.score
        return left.index - right.index
      })
      .slice(0, 4)
      .sort((left, right) => left.index - right.index)
      .map((item) => item.sentence),
  )

  return {
    pros: normalizePublicList(selectTop('pro'), { maxItems: 4, maxLength: 72 }),
    cons: normalizePublicList(selectTop('con'), { maxItems: 4, maxLength: 72 }),
  }
}

export function buildTranscriptParagraphs(input: {
  content?: string | null
  segments?: unknown
}): string[] {
  const segments = toTranscriptSegments(input.segments)

  if (segments.length > 0) {
    const paragraphs: string[] = []
    let current = ''
    let previousStart: number | null = null

    for (const segment of segments) {
      const gapExceeded = previousStart !== null && segment.start - previousStart > SEGMENT_GAP_SECONDS
      if (gapExceeded && current.length >= PARAGRAPH_MIN_CHARS) {
        paragraphs.push(current)
        current = ''
      }

      current = appendText(current, segment.text)

      if (
        current.length >= PARAGRAPH_TARGET_CHARS ||
        (/[。！？!?]$/.test(segment.text) && current.length >= PARAGRAPH_MIN_CHARS)
      ) {
        paragraphs.push(current)
        current = ''
      }

      previousStart = segment.start
    }

    if (current) {
      paragraphs.push(current)
    }

    return normalizePublicList(mergeTrailingShortParagraphs(paragraphs), { maxLength: 220 })
  }

  const normalizedContent = normalizeTranscriptText(input.content || '')
  if (!normalizedContent) return []

  const sentences = splitSentences(normalizedContent)
  if (sentences.length === 0) {
    return [normalizePublicText(normalizedContent, { fallback: '暂无字幕文字版。', maxLength: 220 })]
  }

  const paragraphs: string[] = []
  let current = ''

  for (const sentence of sentences) {
    const candidate = appendText(current, sentence)

    if (current && candidate.length > PARAGRAPH_MAX_CHARS && current.length >= PARAGRAPH_MIN_CHARS) {
      paragraphs.push(current)
      current = sentence
      continue
    }

    current = candidate

    if (current.length >= PARAGRAPH_TARGET_CHARS && /[。！？!?]$/.test(sentence)) {
      paragraphs.push(current)
      current = ''
    }
  }

  if (current) {
    paragraphs.push(current)
  }

  return normalizePublicList(mergeTrailingShortParagraphs(paragraphs), { maxLength: 220 })
}
