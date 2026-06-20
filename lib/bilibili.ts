import crypto from 'node:crypto'
import { readFile } from 'node:fs/promises'
import type { TranscriptSegment } from './review-types'

const BILIBILI_NAV_URL = 'https://api.bilibili.com/x/web-interface/nav'
const BILIBILI_VIEW_URL = 'https://api.bilibili.com/x/web-interface/view'
const BILIBILI_PLAYER_URL = 'https://api.bilibili.com/x/player/wbi/v2'
const BILIBILI_DEFAULT_PREFERRED_MID = 11336264

const SUBTITLE_LANGUAGE_PRIORITY = [
  'zh-Hans',
  'zh-CN',
  'zh',
  'zh-Hant',
  'zh-TW',
  'ai-zh',
  'en',
]

const WBI_MIXIN_KEY_INDEX = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
  27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
  37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
  22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
] as const

const DEFAULT_HEADERS = {
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
  accept: 'application/json, text/plain, */*',
  'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
  origin: 'https://www.bilibili.com',
  referer: 'https://www.bilibili.com/',
}

interface BilibiliSearchVideo {
  aid: number
  bvid: string
  title: string
  author: string
  mid: number
  arcurl?: string
  description?: string
  tag?: string
  pubdate?: number
  duration?: string
}

interface BilibiliViewResponse {
  code: number
  message: string
  data?: {
    aid: number
    bvid: string
    cid?: number
    title: string
    owner?: {
      mid: number
      name: string
    }
    pages?: Array<{
      cid: number
      part?: string
    }>
  }
}

interface BilibiliPlayerResponse {
  code: number
  message: string
  data?: {
    need_login_subtitle?: boolean
    subtitle?: {
      subtitles?: BilibiliSubtitleTrack[]
    }
  }
}

interface BilibiliSubtitleTrack {
  id?: number
  id_str?: string
  lan?: string
  lan_doc?: string
  is_lock?: boolean
  subtitle_url?: string
}

interface BilibiliSubtitleBodyItem {
  from?: number
  to?: number
  content?: string
}

interface BilibiliSubtitleJson {
  body?: BilibiliSubtitleBodyItem[]
  lang?: string
  lan?: string
}

interface BilibiliWbiNavResponse {
  code: number
  message: string
  data?: {
    wbi_img?: {
      img_url?: string
      sub_url?: string
    }
  }
}

export interface BilibiliFetchOptions {
  title: string
  preferredMid?: number
  cookie?: string
  cookieFile?: string
}

export interface BilibiliSubtitleFetchResult {
  transcript: {
    content: string
    segments: TranscriptSegment[]
    source: 'bilibili_subtitle'
    language: string
  }
  raw: BilibiliSubtitleJson
  match: {
    query: string
    score: number
    bvid: string
    aid: number
    title: string
    author: string
    mid: number
    cid: number
    subtitleUrl: string
    subtitleLanguage: string
  }
}

export interface BilibiliVideoMatchResult {
  query: string
  score: number
  bvid: string
  aid: number
  title: string
  author: string
  mid: number
  url: string
  confidence: 'high'
  episodeMatched: boolean
  titleOverlap: number
  preferredMidMatched: boolean
}

interface BilibiliMatchCandidate {
  query: string
  score: number
  video: BilibiliSearchVideo
  confidence: 'high' | 'low'
  episodeMatched: boolean
  titleOverlap: number
  preferredMidMatched: boolean
}

let cachedWbiKeys: Promise<{ imgKey: string; subKey: string }> | null = null

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, '')
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
  }

function cleanText(value: string): string {
  return decodeHtml(stripHtml(value))
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeTitleForMatch(value: string): string {
  return cleanText(value)
    .toLowerCase()
    .replace(/【值不值得买第\d+期】/g, ' ')
    .replace(/\[is it worth buying\??\s*(ep\.?|episode)\s*\d+\]/gi, ' ')
    .replace(/[【】\[\](){}<>《》“”"':：,，.!！？?\/\\|+~`@#$%^&*_=-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokenizeForMatch(value: string): string[] {
  return normalizeTitleForMatch(value)
    .split(' ')
    .filter((token) => token.length >= 2)
}

function dedupeTokens(tokens: string[]): string[] {
  return [...new Set(tokens)]
}

export function extractEpisodeNumber(title: string): string | null {
  const patterns = [
    /值不值得买第\s*(\d+)\s*期/i,
    /(?:ep\.?|episode)\s*(\d+)/i,
  ]

  for (const pattern of patterns) {
    const match = title.match(pattern)
    if (match?.[1]) return match[1]
  }

  return null
}

function stripSeriesSuffix(title: string): string {
  return cleanText(title)
    .replace(/【值不值得买第\d+期】/g, '')
    .replace(/\[is it worth buying\??\s*(ep\.?|episode)\s*\d+\]/gi, '')
    .replace(/\s+-\s+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function buildBilibiliSearchQueries(title: string): string[] {
  const queries = new Set<string>()
  const cleanedTitle = cleanText(title)
  const mainTitle = stripSeriesSuffix(cleanedTitle)
  const episode = extractEpisodeNumber(cleanedTitle)
  const containsChinese = /[\u3400-\u9fff]/.test(cleanedTitle)

  if (containsChinese && mainTitle) {
    queries.add(mainTitle)
  }

  if (episode) {
    queries.add(`值不值得买 ${episode}`)
    queries.add(`值不值得买 第${episode}期`)
    if (mainTitle) {
      queries.add(`${mainTitle} 值不值得买 ${episode}`)
    }
  }

  if (!containsChinese && mainTitle) {
    queries.add(mainTitle)
  }

  if (!queries.size && cleanedTitle) {
    queries.add(cleanedTitle)
  }

  return [...queries].filter((query) => query.length > 0).slice(0, 5)
}

function scoreCandidate(
  sourceTitle: string,
  candidate: BilibiliSearchVideo,
  preferredMid: number
): {
  score: number
  episodeMatched: boolean
  titleOverlap: number
  preferredMidMatched: boolean
  confidence: 'high' | 'low'
} {
  const sourceTokens = dedupeTokens(tokenizeForMatch(sourceTitle))
  const targetTitle = cleanText(candidate.title)
  const targetTokens = dedupeTokens(tokenizeForMatch(targetTitle))
  const targetTokenSet = new Set(targetTokens)
  const sourceEpisode = extractEpisodeNumber(sourceTitle)
  const targetEpisode = extractEpisodeNumber(targetTitle)

  let score = 0
  const preferredMidMatched = candidate.mid === preferredMid
  const episodeMatched = Boolean(sourceEpisode && targetEpisode && sourceEpisode === targetEpisode)

  if (preferredMidMatched) {
    score += 80
  }

  if (episodeMatched) {
    score += 90
  } else if (sourceEpisode || targetEpisode) {
    score -= 35
  }

  const overlap = sourceTokens.filter((token) => targetTokenSet.has(token)).length
  const titleOverlap = sourceTokens.length > 0 ? overlap / sourceTokens.length : 0
  if (sourceTokens.length > 0) {
    score += Math.round(titleOverlap * 80)
  }

  const normalizedSource = normalizeTitleForMatch(sourceTitle)
  const normalizedTarget = normalizeTitleForMatch(targetTitle)
  if (normalizedSource && normalizedTarget) {
    if (normalizedTarget.includes(normalizedSource) || normalizedSource.includes(normalizedTarget)) {
      score += 28
    }
  }

  const confidence = (
    (episodeMatched && titleOverlap >= 0.45)
    || (preferredMidMatched && titleOverlap >= 0.72)
  ) ? 'high' : 'low'

  return {
    score,
    episodeMatched,
    titleOverlap,
    preferredMidMatched,
    confidence,
  }
}

function pickSubtitleTrack(subtitles: BilibiliSubtitleTrack[]): BilibiliSubtitleTrack | null {
  const sorted = [...subtitles].sort((left, right) => {
    const leftIndex = SUBTITLE_LANGUAGE_PRIORITY.indexOf(left.lan || '')
    const rightIndex = SUBTITLE_LANGUAGE_PRIORITY.indexOf(right.lan || '')
    const normalizedLeft = leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex
    const normalizedRight = rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex

    return normalizedLeft - normalizedRight
  })

  return sorted[0] || null
}

export function parseBilibiliSubtitle(
  raw: BilibiliSubtitleJson
): BilibiliSubtitleFetchResult['transcript'] | null {
  const segments = (raw.body || []).flatMap((item) => {
    const text = cleanText(item.content || '')
    if (!text) return []

    const start = typeof item.from === 'number' ? item.from : 0
    const end = typeof item.to === 'number' ? item.to : start

    return [{
      text,
      start,
      duration: Math.max(0, end - start),
    }]
  })

  if (segments.length === 0) {
    return null
  }

  return {
    content: segments.map((segment) => segment.text).join(' '),
    segments,
    source: 'bilibili_subtitle',
    language: raw.lan || raw.lang || 'unknown',
  }
}

async function resolveCookieHeader(
  cookie?: string,
  cookieFile?: string
): Promise<string | undefined> {
  if (cookie?.trim()) {
    return cookie.trim()
  }

  if (!cookieFile?.trim()) {
    return undefined
  }

  const raw = await readFile(cookieFile.trim(), 'utf8')
  const normalized = raw.trim()
  return normalized || undefined
}

function buildHeaders(cookie?: string, referer?: string): HeadersInit {
  return {
    ...DEFAULT_HEADERS,
    ...(referer ? { referer } : {}),
    ...(cookie ? { cookie } : {}),
  }
}

async function fetchBilibiliJson<T>(
  url: string,
  options: {
    cookie?: string
    referer?: string
  } = {}
): Promise<T> {
  const response = await fetch(url, {
    headers: buildHeaders(options.cookie, options.referer),
  })

  if (!response.ok) {
    throw new Error(`bilibili request failed: ${response.status} ${url}`)
  }

  return (await response.json()) as T
}

async function fetchBilibiliHtml(
  url: string,
  options: {
    cookie?: string
    referer?: string
  } = {}
): Promise<string> {
  const response = await fetch(url, {
    headers: {
      ...buildHeaders(options.cookie, options.referer),
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    },
  })

  if (!response.ok) {
    throw new Error(`bilibili request failed: ${response.status} ${url}`)
  }

  return response.text()
}

function getMixinKey(orig: string): string {
  return WBI_MIXIN_KEY_INDEX.map((index) => orig[index]).join('').slice(0, 32)
}

async function getWbiKeys(cookie?: string): Promise<{ imgKey: string; subKey: string }> {
  if (!cachedWbiKeys) {
    cachedWbiKeys = (async () => {
      const nav = await fetchBilibiliJson<BilibiliWbiNavResponse>(BILIBILI_NAV_URL, { cookie })
      const imgUrl = nav.data?.wbi_img?.img_url || ''
      const subUrl = nav.data?.wbi_img?.sub_url || ''
      const imgKey = imgUrl.split('/').pop()?.split('.')[0] || ''
      const subKey = subUrl.split('/').pop()?.split('.')[0] || ''

      if (!imgKey || !subKey) {
        throw new Error('bilibili wbi keys unavailable')
      }

      return { imgKey, subKey }
    })()
  }

  return cachedWbiKeys
}

function buildWbiQuery(
  params: Record<string, string | number>,
  keys: { imgKey: string; subKey: string }
): string {
  const searchParams = new URLSearchParams()
  const mixinKey = getMixinKey(`${keys.imgKey}${keys.subKey}`)
  const wts = Math.floor(Date.now() / 1000)

  for (const [key, value] of Object.entries({ ...params, wts }).sort(([left], [right]) => {
    return left.localeCompare(right)
  })) {
    searchParams.set(key, String(value).replace(/[!'()*]/g, ''))
  }

  const wRid = crypto
    .createHash('md5')
    .update(`${searchParams.toString()}${mixinKey}`)
    .digest('hex')

  searchParams.set('w_rid', wRid)
  return searchParams.toString()
}

async function searchVideos(
  query: string,
  cookie?: string
): Promise<BilibiliSearchVideo[]> {
  const url = `https://search.bilibili.com/all?keyword=${encodeURIComponent(query)}`
  const html = await fetchBilibiliHtml(url, {
    cookie,
    referer: 'https://www.bilibili.com/',
  })
  const results: BilibiliSearchVideo[] = []
  const cardPattern =
    /<a href="\/\/www\.bilibili\.com\/video\/(BV[0-9A-Za-z]{10})\/"[\s\S]*?<h3[^>]*title="([^"]+)"[\s\S]*?<a class="bili-video-card__info--owner" href="\/\/space\.bilibili\.com\/(\d+)"[\s\S]*?<span class="bili-video-card__info--author"[^>]*>([\s\S]*?)<\/span>/g

  for (const match of html.matchAll(cardPattern)) {
    const [, bvid, rawTitle, rawMid, rawAuthor] = match
    const mid = Number.parseInt(rawMid, 10)

    if (!bvid || !rawTitle || !Number.isFinite(mid) || !rawAuthor) {
      continue
    }

    results.push({
      aid: 0,
      bvid,
      title: cleanText(rawTitle),
      author: cleanText(rawAuthor),
      mid,
      arcurl: `https://www.bilibili.com/video/${bvid}`,
    })
  }

  return results
}

async function findBestMatch(
  title: string,
  preferredMid: number,
  cookie?: string
): Promise<BilibiliMatchCandidate | null> {
  const matches = new Map<string, BilibiliMatchCandidate>()

  for (const query of buildBilibiliSearchQueries(title)) {
    const results = await searchVideos(query, cookie)

    for (const video of results) {
      const scored = scoreCandidate(title, video, preferredMid)
      const current = matches.get(video.bvid)
      if (!current || scored.score > current.score) {
        matches.set(video.bvid, {
          query,
          score: scored.score,
          video,
          confidence: scored.confidence,
          episodeMatched: scored.episodeMatched,
          titleOverlap: scored.titleOverlap,
          preferredMidMatched: scored.preferredMidMatched,
        })
      }
    }
  }

  const ranked = [...matches.values()]
    .sort((left, right) => right.score - left.score)

  const preferred = ranked.filter((item) => item.video.mid === preferredMid)
  const best = (preferred[0] || ranked[0]) ?? null

  if (!best) {
    return null
  }

  if (best.confidence !== 'high') {
    return null
  }

  if (best.score < 85) {
    return null
  }

  return best
}

async function getViewInfo(
  bvid: string,
  cookie?: string
): Promise<NonNullable<BilibiliViewResponse['data']>> {
  const payload = await fetchBilibiliJson<BilibiliViewResponse>(
    `${BILIBILI_VIEW_URL}?bvid=${encodeURIComponent(bvid)}`,
    {
      cookie,
      referer: `https://www.bilibili.com/video/${bvid}`,
    }
  )

  if (payload.code !== 0 || !payload.data) {
    throw new Error(`bilibili view failed: ${payload.message}`)
  }

  return payload.data
}

async function getPlayerInfo(
  bvid: string,
  cid: number,
  cookie?: string
): Promise<NonNullable<BilibiliPlayerResponse['data']>> {
  const keys = await getWbiKeys(cookie)
  const query = buildWbiQuery({ bvid, cid }, keys)
  const payload = await fetchBilibiliJson<BilibiliPlayerResponse>(
    `${BILIBILI_PLAYER_URL}?${query}`,
    {
      cookie,
      referer: `https://www.bilibili.com/video/${bvid}`,
    }
  )

  if (payload.code !== 0 || !payload.data) {
    throw new Error(`bilibili player failed: ${payload.message}`)
  }

  return payload.data
}

async function getSubtitleJson(
  subtitleUrl: string,
  cookie?: string,
  referer?: string
): Promise<BilibiliSubtitleJson> {
  const resolvedUrl = subtitleUrl.startsWith('//') ? `https:${subtitleUrl}` : subtitleUrl
  return fetchBilibiliJson<BilibiliSubtitleJson>(resolvedUrl, {
    cookie,
    referer,
  })
}

export async function getBilibiliSubtitleDetailed(
  options: BilibiliFetchOptions
): Promise<BilibiliSubtitleFetchResult | null> {
  const cookie = await resolveCookieHeader(options.cookie, options.cookieFile)
  const preferredMid = options.preferredMid ?? BILIBILI_DEFAULT_PREFERRED_MID
  const match = await findBestMatch(options.title, preferredMid, cookie)

  if (!match) {
    return null
  }

  const view = await getViewInfo(match.video.bvid, cookie)
  const cid = view.cid || view.pages?.[0]?.cid
  if (!cid) {
    throw new Error(`bilibili cid unavailable for ${match.video.bvid}`)
  }

  const player = await getPlayerInfo(match.video.bvid, cid, cookie)
  const subtitles = player.subtitle?.subtitles || []
  const subtitleTrack = pickSubtitleTrack(subtitles)

  if (!subtitleTrack?.subtitle_url) {
    if (player.need_login_subtitle && !cookie) {
      throw new Error('bilibili subtitle requires login cookie')
    }

    return null
  }

  const raw = await getSubtitleJson(
    subtitleTrack.subtitle_url,
    cookie,
    `https://www.bilibili.com/video/${match.video.bvid}`
  )
  const transcript = parseBilibiliSubtitle(raw)

  if (!transcript) {
    return null
  }

  return {
    transcript,
    raw,
    match: {
      query: match.query,
      score: match.score,
      bvid: match.video.bvid,
      aid: match.video.aid,
      title: cleanText(match.video.title),
      author: match.video.author,
      mid: match.video.mid,
      cid,
      subtitleUrl: subtitleTrack.subtitle_url,
      subtitleLanguage: subtitleTrack.lan || subtitleTrack.lan_doc || 'unknown',
    },
  }
}

export async function getBilibiliSubtitle(
  options: BilibiliFetchOptions
): Promise<BilibiliSubtitleFetchResult['transcript'] | null> {
  const result = await getBilibiliSubtitleDetailed(options)
  return result?.transcript ?? null
}

export async function findBilibiliVideoMatch(
  options: BilibiliFetchOptions
): Promise<BilibiliVideoMatchResult | null> {
  const cookie = await resolveCookieHeader(options.cookie, options.cookieFile)
  const preferredMid = options.preferredMid ?? BILIBILI_DEFAULT_PREFERRED_MID
  const match = await findBestMatch(options.title, preferredMid, cookie)

  if (!match) {
    return null
  }

  return {
    query: match.query,
    score: match.score,
    bvid: match.video.bvid,
    aid: match.video.aid,
    title: cleanText(match.video.title),
    author: match.video.author,
    mid: match.video.mid,
    url: match.video.arcurl || `https://www.bilibili.com/video/${match.video.bvid}`,
    confidence: 'high',
    episodeMatched: match.episodeMatched,
    titleOverlap: match.titleOverlap,
    preferredMidMatched: match.preferredMidMatched,
  }
}
