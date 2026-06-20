import { findBilibiliVideoMatch } from './bilibili'
import { buildOpenAiHeaders, buildOpenAiUrl } from './openai-client'
import { normalizePublicList, normalizePublicText, normalizeToSimplifiedChinese } from './text-normalization'
import { isUsableOpenAiKey } from './transcript'

const FEATURE_HINT_RE = /(降噪|音质|续航|佩戴|连接|做工|手感|重量|体积|屏幕|亮度|色彩|反光|散热|噪音|延迟|稳定|收纳|清洁|模式|风量|风感|功率|材质|充电|按键|触控|兼容|价格|性价比|画质|对焦|防抖|防水|容量|保温|速度|尺寸|性能|吸力|坐感|腰靠|承托|清晰|发热|漏音|夹头|误触|制冷|过滤|背负|舒适|静音|便携|刀头|镜片|按摩|键程|回弹|跟手|滚轮)/i
const STRONG_NEGATIVE_RE = /(偏重|太重|太大|太吵|反光明显|续航一般|价格偏贵|不够|不舒服|不稳定|有噪音|会发热|会误触|漏音明显|不好清洁|不耐用|连接不稳|背负系统差|充电慢|延迟高)/i
const STRONG_POSITIVE_RE = /(很稳|够用|够亮|很方便|很轻|很安静|很清晰|很舒服|不夹头|不漏音|不会误触|很好清理|很好收纳|做工扎实|音质不错|降噪很强|续航不错|连接稳定|质感不错|过滤稳定|制冷明显|吸力够强)/i
const LEAD_FILLER_RE = /^(优点是|缺点是|最大的优点是|最大的缺点是|我觉得|我感觉|其实|整体来看|总的来说|简单来说|说实话|不可否认|当然|另外|还有|还有就是|问题是|但|但是|不过|只是|可惜|然后|所以|那|这|而且)+/
const TAIL_FILLER_RE = /(这只是我们的想象|对我来说|对很多人来说|说白了|你知道吗|你懂的|这种感觉|这件事情|这个事啊|这个东西|这个问题|这个部分|就这么简单|也就这样|差不多就是这样)+$/
const CLAUSE_SPLIT_RE = /[，；：,;:。！？!?]/
const MAX_LOCAL_LINE_LENGTH = 28
const MAX_OPINION_COUNT = 3
const SPOKEN_FILLER_RE = /^(那|咱们|我们|你说|不是吧|怎么说呢|说实话|这个|这台|这款|这部|它的|它|啊|呢|哈|哎呀|好吧)+/
const SPOKEN_TAIL_RE = /(啊|呢|吧|哈|哦|啦|嘛|好吧|对吧|有没有)$/

export interface OpinionSummaryResult {
  pros: string[]
  cons: string[]
  source: 'ai' | 'local'
}

export interface ProductVideoLinks {
  youtube: string
  bilibili?: string
}

interface RewritePayload {
  pros: string[]
  cons: string[]
}

function cleanText(value: string): string {
  return normalizeToSimplifiedChinese(value)
    .replace(/\s+/g, ' ')
    .replace(/\s+([，。！？；：,.!?;:])/g, '$1')
    .trim()
}

function trimPunctuation(value: string): string {
  return cleanText(value).replace(/^[，。！？；：、\s]+|[，。！？；：、\s]+$/g, '')
}

function stripLeadFiller(value: string): string {
  return trimPunctuation(value)
    .replace(LEAD_FILLER_RE, '')
    .trim()
}

function stripTailFiller(value: string): string {
  return trimPunctuation(value)
    .replace(TAIL_FILLER_RE, '')
    .replace(/(这对于.+来说|对于.+来说)$/, '')
    .trim()
}

function normalizeOpinionText(value: string): string {
  return stripTailFiller(stripLeadFiller(value))
    .replace(SPOKEN_FILLER_RE, '')
    .replace(SPOKEN_TAIL_RE, '')
    .trim()
}

function splitClauses(value: string): string[] {
  return normalizeOpinionText(value)
    .split(CLAUSE_SPLIT_RE)
    .map((part) => trimPunctuation(part))
    .filter(Boolean)
}

function cropToSingleSentence(value: string): string {
  let text = trimPunctuation(value)
  if (!text) return ''

  text = text
    .replace(/^(比如说|就是说|相当于|等于说|你会发现|你可以理解为|某种程度上|某种意义上)/, '')
    .replace(/(在我看来|对我来说|对于我来说|对于大部分人来说)$/, '')
    .replace(SPOKEN_FILLER_RE, '')
    .replace(SPOKEN_TAIL_RE, '')
    .trim()

  if (text.length <= MAX_LOCAL_LINE_LENGTH) {
    return text
  }

  const pieces = splitClauses(text)
  if (pieces.length === 0) return text.slice(0, MAX_LOCAL_LINE_LENGTH)

  const best = pieces
    .map((piece) => ({
      piece,
      score:
        (FEATURE_HINT_RE.test(piece) ? 6 : 0) +
        (STRONG_NEGATIVE_RE.test(piece) || STRONG_POSITIVE_RE.test(piece) ? 4 : 0) +
        Math.min(piece.length, MAX_LOCAL_LINE_LENGTH),
    }))
    .sort((left, right) => right.score - left.score)[0]?.piece || pieces[0]

  return best.length > MAX_LOCAL_LINE_LENGTH ? best.slice(0, MAX_LOCAL_LINE_LENGTH) : best
}

export function simplifyOpinionLine(value: string): string {
  const normalized = normalizePublicText(normalizeOpinionText(value), {
    allowEmpty: true,
    maxLength: 64,
  })
  if (!normalized) return ''

  const clauses = splitClauses(normalized)
  const candidates = clauses.length > 0 ? clauses : [normalized]

  const ranked = candidates
    .map((candidate, index) => {
      const compressed = cropToSingleSentence(candidate)
      const score =
        (FEATURE_HINT_RE.test(compressed) ? 8 : 0) +
        (STRONG_NEGATIVE_RE.test(compressed) || STRONG_POSITIVE_RE.test(compressed) ? 5 : 0) +
        (compressed.length >= 6 && compressed.length <= MAX_LOCAL_LINE_LENGTH ? 3 : 0) -
        Math.max(compressed.length - MAX_LOCAL_LINE_LENGTH, 0) -
        (index > 0 ? 0.5 : 0)

      return { compressed, score }
    })
    .filter((item) => item.compressed.length > 0)
    .sort((left, right) => right.score - left.score)

  return normalizePublicText(ranked[0]?.compressed || cropToSingleSentence(normalized), {
    allowEmpty: true,
    maxLength: MAX_LOCAL_LINE_LENGTH,
  })
}

function dedupeOpinionList(values: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []

  for (const value of values) {
    const normalized = simplifyOpinionLine(value)
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    result.push(normalized)
  }

  return result
}

export function simplifyOpinionList(values: string[]): string[] {
  return normalizePublicList(dedupeOpinionList(values), {
    maxItems: MAX_OPINION_COUNT,
    maxLength: MAX_LOCAL_LINE_LENGTH,
  })
}

function safeParseJson(content: string): RewritePayload | null {
  const normalized = content.trim()

  const candidates = [
    normalized,
    normalized.match(/```json\s*([\s\S]*?)```/i)?.[1] || '',
    normalized.match(/```([\s\S]*?)```/i)?.[1] || '',
  ].filter(Boolean)

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as Partial<RewritePayload>
      return {
        pros: normalizePublicList(Array.isArray(parsed.pros) ? parsed.pros : [], { maxLength: MAX_LOCAL_LINE_LENGTH }),
        cons: normalizePublicList(Array.isArray(parsed.cons) ? parsed.cons : [], { maxLength: MAX_LOCAL_LINE_LENGTH }),
      }
    } catch {
      // ignore
    }
  }

  return null
}

function normalizeRewriteList(rewritten: string[], fallback: string[], expectedLength: number): string[] {
  const normalized = simplifyOpinionList(rewritten).slice(0, expectedLength)

  if (normalized.length >= expectedLength) {
    return normalized
  }

  for (const item of fallback) {
    if (normalized.length >= expectedLength) break
    if (!normalized.includes(item)) {
      normalized.push(item)
    }
  }

  return normalized.slice(0, expectedLength)
}

export async function refineOpinionSummary(options: {
  productName: string
  videoTitle: string
  pros: string[]
  cons: string[]
  apiKey?: string
  baseUrl?: string
  model?: string
}): Promise<OpinionSummaryResult> {
  const fallback: OpinionSummaryResult = {
    pros: simplifyOpinionList(options.pros),
    cons: simplifyOpinionList(options.cons),
    source: 'local',
  }

  const apiKey = (options.apiKey || process.env.OPENAI_API_KEY || '').trim()
  if (!isUsableOpenAiKey(apiKey)) {
    return fallback
  }

  if (fallback.pros.length === 0 && fallback.cons.length === 0) {
    return fallback
  }

  const model = (options.model || process.env.OPENAI_MODEL || 'gpt-4o-mini').trim()

  try {
    const response = await fetch(buildOpenAiUrl('/v1/chat/completions', options.baseUrl), {
      method: 'POST',
      headers: {
        ...buildOpenAiHeaders(apiKey),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: '你负责把产品评测里的优缺点候选改写成更短的中文结论。不要新增事实，不要删除观点，不要改变正反面分组。每条只保留一句结论，尽量控制在 22 到 28 个中文字符内。返回严格 JSON：{"pros":[""],"cons":[""]}。',
          },
          {
            role: 'user',
            content: JSON.stringify({
              productName: options.productName,
              videoTitle: options.videoTitle,
              rewriteRules: [
                '每条尽量一句话说清楚。',
                '删除口头禅、转场、背景说明和价格铺垫。',
                '不要扩写，不要新增新观点。',
                '每侧最多保留原有条目数，顺序尽量保持一致。',
              ],
              pros: fallback.pros,
              cons: fallback.cons,
            }),
          },
        ],
      }),
    })

    if (!response.ok) {
      throw new Error(`AI rewrite failed: ${response.status}`)
    }

    const payload = await response.json() as {
      choices?: Array<{
        message?: {
          content?: string
        }
      }>
    }

    const content = payload.choices?.[0]?.message?.content || ''
    const parsed = safeParseJson(content)

    if (!parsed) {
      return fallback
    }

    return {
      pros: normalizeRewriteList(parsed.pros, fallback.pros, fallback.pros.length),
      cons: normalizeRewriteList(parsed.cons, fallback.cons, fallback.cons.length),
      source: 'ai',
    }
  } catch {
    return fallback
  }
}

function parsePreferredMid(value: string | undefined): number | undefined {
  if (!value) return undefined
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : undefined
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`timeout after ${timeoutMs}ms`))
    }, timeoutMs)

    promise
      .then((value) => {
        clearTimeout(timer)
        resolve(value)
      })
      .catch((error) => {
        clearTimeout(timer)
        reject(error)
      })
  })
}

export async function resolveProductVideoLinks(
  options: {
    youtube: string
    title: string
    preferredMid?: number
    timeoutMs?: number
    matcher?: typeof findBilibiliVideoMatch
  },
): Promise<ProductVideoLinks> {
  const matcher = options.matcher || findBilibiliVideoMatch
  const title = cleanText(options.title)

  if (!title) {
    return { youtube: options.youtube }
  }

  try {
    const match = await withTimeout(
      matcher({
        title,
        preferredMid: options.preferredMid ?? parsePreferredMid(process.env.BILIBILI_PREFERRED_MID),
      }),
      options.timeoutMs ?? 3_500,
    )

    return match?.url
      ? {
          youtube: options.youtube,
          bilibili: match.url,
        }
      : {
          youtube: options.youtube,
        }
  } catch {
    return { youtube: options.youtube }
  }
}
