import { Converter } from 'opencc-js'

const toSimplified = Converter({ from: 't', to: 'cn' })

const CJK_RE = /[\u3400-\u9fff]/
const TRADITIONAL_HINT_RE = /[們這個後還過開關為與風說質體屬螢觀樂錄聽幾殼溫裡邊顯對價買賣點標題圖聲頭髮電腦網頁臺]/u
const MOJIBAKE_RE = /[�]|(?:[ÄÅÃÂÆÐÑÒÓÔÕÖØÙÚÛÜÝÞßàáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿ]{2,})|(?:[锛绗鑰涓寰鏆閿鍏鏉]{2,})/u
const ENGLISH_WORD_RE = /[A-Za-z][A-Za-z'-]*/g
const CJK_CHAR_RE = /[\u3400-\u9fff]/g

const ALLOWED_LATIN_TOKEN_RE = /^(?:TESTV|YouTube|Bilibili|bilibili|BV[0-9A-Za-z]+|AV\d+|USB(?:-[A-Z0-9]+)?|HDMI|Wi-?Fi|Bluetooth|NFC|AI|OLED|LCD|LED|MiniLED|MicroLED|HDR|SDR|4K|8K|NAS|SSD|HDD|TF|SD|GPS|CPU|GPU|PC|Mac|Windows|Android|iOS|iPadOS|macOS|iPhone|iPad|MacBook|AirPods?|Apple|DJI|Redmi|Xiaomi|OPPO|vivo|HONOR|Honor|Huawei|Mate|Pura|Find|Magic|Galaxy|Pixel|Sony|SONY|Canon|Nikon|Fujifilm|Nintendo|Switch|PlayStation|Xbox|Steam|Kindle|BOOX|GoPro|Osmo|Mavic|Dyson|Bruno|Logitech|Razer|ROG|ThinkPad|OnePlus|Nothing|Beats|Bose|JBL|Anker|Ugreen|Baseus|Pro|Max|Ultra|Mini|Air|Plus|SE|Note|Pad|Tab|Book|Watch|Buds|Pods|Lite|Neo|Fold|Flip|K\d{1,3}|X\d{1,3}|S\d{1,3}|A\d{1,3}|M\d{1,3}|P\d{1,3}|G\d{1,3}|[A-Z]{1,4}\d{1,5}[A-Za-z-]*|\d+[A-Za-z]{1,4})$/i
const ENGLISH_SENTENCE_RE = /\b(?:the|this|that|with|without|review|product|feature|features|good|great|bad|problem|issue|design|screen|camera|battery|performance|price|overall|recommend|pros|cons|sound|quality|phone|tablet|laptop|speaker|headphone|keyboard|mouse)\b(?:[\s,.;:!?-]+\w+){3,}/i

const PHRASE_REPLACEMENTS: Array<[RegExp, string]> = [
  [/萤幕/g, '屏幕'],
  [/荧幕/g, '屏幕'],
  [/软体/g, '软件'],
  [/硬体/g, '硬件'],
  [/网路/g, '网络'],
  [/影片/g, '视频'],
  [/资讯/g, '信息'],
  [/画面/g, '画面'],
  [/滑鼠/g, '鼠标'],
  [/随身碟/g, 'U盘'],
  [/行动电源/g, '移动电源'],
  [/行动硬碟/g, '移动硬盘'],
  [/萤幕/g, '屏幕'],
  [/品质/g, '品质'],
  [/解析度/g, '分辨率'],
  [/记忆体/g, '内存'],
  [/储存/g, '存储'],
  [/连线/g, '连接'],
  [/讯号/g, '信号'],
  [/想像/g, '想象'],
  [/金属\s*DECO/gi, '金属镜头装饰区'],
  [/\bDECO\b/g, '镜头装饰区'],
  [/杂讯/g, '噪声'],
  [/噪声/g, '噪音'],
  [/机身/g, '机身'],
  [/镜头/g, '镜头'],
  [/画质/g, '画质'],
  [/质感/g, '质感'],
]

const PLACEHOLDER_RE = /(整理中|待补全|等待字幕|暂无优点信息|暂无缺点信息|标题待翻译|待补全产品|未命名产品|暂无中文标题|产品信息待补充|视频标题待补充)/u

function cleanWhitespace(value: string): string {
  return value
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([，。！？；：,.!?;:])/g, '$1')
    .replace(/([（【])\s+/g, '$1')
    .replace(/\s+([）】])/g, '$1')
    .trim()
}

function applyPhraseReplacements(value: string): string {
  return PHRASE_REPLACEMENTS.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), value)
}

function normalizePunctuation(value: string): string {
  return value
    .replace(/，+/g, '，')
    .replace(/。+/g, '。')
    .replace(/！+/g, '！')
    .replace(/？+/g, '？')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
}

export function normalizeToSimplifiedChinese(value: string | null | undefined): string {
  if (!value) return ''
  return cleanWhitespace(applyPhraseReplacements(normalizePunctuation(toSimplified(value))))
}

export function isLikelyTraditionalText(value: string | null | undefined): boolean {
  if (!value) return false
  return TRADITIONAL_HINT_RE.test(value)
}

export function isLikelyMojibake(value: string | null | undefined): boolean {
  if (!value) return false
  return MOJIBAKE_RE.test(value)
}

export function containsCjk(value: string | null | undefined): boolean {
  return Boolean(value && CJK_RE.test(value))
}

export function hasEnglishSentence(value: string | null | undefined): boolean {
  if (!value) return false
  const normalized = cleanWhitespace(value)
  const chineseCount = (normalized.match(CJK_CHAR_RE) || []).length
  const englishWords = normalized.match(ENGLISH_WORD_RE) || []

  if (ENGLISH_SENTENCE_RE.test(normalized)) return true
  if (chineseCount === 0 && englishWords.length >= 4) return true

  const disallowedWords = englishWords.filter((word) => !ALLOWED_LATIN_TOKEN_RE.test(word))
  return chineseCount < 6 && disallowedWords.length >= 4
}

export function hasPublicTextIssue(value: string | null | undefined): boolean {
  if (!value) return false
  return isLikelyTraditionalText(value) || isLikelyMojibake(value) || hasEnglishSentence(value) || PLACEHOLDER_RE.test(value)
}

export function normalizePublicText(
  value: string | null | undefined,
  options: {
    allowEmpty?: boolean
    maxLength?: number
    fallback?: string
  } = {},
): string {
  const normalized = normalizeToSimplifiedChinese(value)

  if (!normalized) {
    return options.allowEmpty ? '' : options.fallback || ''
  }

  if (isLikelyMojibake(normalized) || hasEnglishSentence(normalized)) {
    return options.allowEmpty ? '' : options.fallback || ''
  }

  const maxLength = options.maxLength
  if (maxLength && normalized.length > maxLength) {
    return normalized.slice(0, maxLength).replace(/[，。！？；：,.!?;:]+$/u, '')
  }

  return normalized
}

export function normalizePublicList(values: unknown, options: {
  maxItems?: number
  maxLength?: number
} = {}): string[] {
  if (!Array.isArray(values)) return []

  const seen = new Set<string>()
  const result: string[] = []

  for (const value of values) {
    if (typeof value !== 'string') continue
    const normalized = normalizePublicText(value, {
      allowEmpty: true,
      maxLength: options.maxLength,
    })
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    result.push(normalized)

    if (options.maxItems && result.length >= options.maxItems) break
  }

  return result
}

export function isPlaceholderDisplayText(value: string | null | undefined): boolean {
  return Boolean(value && PLACEHOLDER_RE.test(normalizeToSimplifiedChinese(value)))
}

export function isCleanPublicText(value: string | null | undefined): boolean {
  const normalized = normalizeToSimplifiedChinese(value)
  return Boolean(normalized && !hasPublicTextIssue(normalized))
}
