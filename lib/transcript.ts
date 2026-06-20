import { YoutubeTranscript } from 'youtube-transcript'
import { execFile } from 'child_process'
import { mkdtemp, readFile, readdir, rm } from 'fs/promises'
import os from 'os'
import path from 'path'
import { promisify } from 'util'
import { transcribeYouTubeAudio } from './audio-transcription'
import type { TranscriptSegment } from './review-types'
import { appendYtDlpOptions, getYtDlpCommand } from './yt-dlp'

const execFileAsync = promisify(execFile)

export const SUBTITLE_LANGS = [
  'zh-Hans',
  'zh-Hant',
  'zh-CN',
  'zh-TW',
  'zh',
  'en',
  'en-US',
  'en-GB',
].join(',')

interface YoutubeTranscriptItem {
  text: string
  offset: number
  duration: number
}

interface Json3Subtitle {
  events?: Array<{
    tStartMs?: number
    dDurationMs?: number
    segs?: Array<{
      utf8?: string
    }>
  }>
}

export interface TranscriptFetchOptions {
  preferYtDlpSubtitles?: boolean
  audioFallbackEnabled?: boolean
  openAiApiKey?: string
  openAiBaseUrl?: string
  transcriptionModel?: string
  ytDlpBin?: string
  ytDlpCookiesFile?: string
  ytDlpCookiesFromBrowser?: string
  ytDlpJsRuntimes?: string
  ytDlpRemoteComponents?: string
  keepAudioFiles?: boolean
}

export interface TranscriptFetchResult {
  content: string
  segments: TranscriptSegment[]
  source: string
  language: string
}

export interface YtDlpSubtitleFetchResult {
  transcript: TranscriptFetchResult
  raw: string
  subtitleFile: string
}

export interface TranscriptFetcherDependencies {
  publicFetcher?: (videoId: string) => Promise<TranscriptFetchResult | null>
  ytDlpFetcher?: (
    videoId: string,
    options: TranscriptFetchOptions
  ) => Promise<TranscriptFetchResult | null>
  audioTranscriber?: (
    videoId: string,
    options: {
      apiKey: string
      baseUrl?: string
      model?: string
      ytDlpBin?: string
      ytDlpCookiesFile?: string
      ytDlpCookiesFromBrowser?: string
      ytDlpJsRuntimes?: string
      ytDlpRemoteComponents?: string
      keepAudioFiles?: boolean
    }
  ) => Promise<TranscriptFetchResult>
}

function normalizeLanguageFromFileName(fileName: string): string {
  if (/\.zh-Hans\.|\.zh-CN\./i.test(fileName)) return 'zh-Hans'
  if (/\.zh-Hant\.|\.zh-TW\./i.test(fileName)) return 'zh-Hant'
  if (/\.zh\./i.test(fileName)) return 'zh'
  if (/\.en(-US|-GB)?\./i.test(fileName)) return 'en'
  return 'unknown'
}

function subtitleFilePriority(fileName: string): number {
  if (fileName.includes('.zh-Hans') || fileName.includes('.zh-CN')) return 0
  if (fileName.includes('.zh-Hant') || fileName.includes('.zh-TW')) return 1
  if (fileName.includes('.zh.')) return 2
  if (fileName.includes('.en.')) return 3
  return 4
}

export function isUsableOpenAiKey(value: string | undefined): boolean {
  if (!value) return false

  const trimmed = value.trim()
  return trimmed.length > 0 && !/your_|placeholder|here/i.test(trimmed)
}

export function parseJson3Subtitle(
  raw: string,
  source = 'yt_dlp_subtitle',
  language = 'unknown'
): TranscriptFetchResult | null {
  const parsed = JSON.parse(raw) as Json3Subtitle
  const segments: TranscriptSegment[] = (parsed.events || []).flatMap((event) => {
    const text = (event.segs || [])
      .map((segment) => segment.utf8 || '')
      .join('')
      .replace(/\s+/g, ' ')
      .trim()

    if (!text) return []

    return [{
      text,
      start: (event.tStartMs || 0) / 1000,
      duration: (event.dDurationMs || 0) / 1000,
    }]
  })

  if (segments.length === 0) {
    return null
  }

  return {
    content: segments.map((segment) => segment.text).join(' '),
    segments,
    source,
    language,
  }
}

export async function getYouTubeTranscript(videoId: string): Promise<TranscriptFetchResult | null> {
  try {
    const transcript = await YoutubeTranscript.fetchTranscript(videoId)

    if (!transcript || transcript.length === 0) {
      return null
    }

    const segments: TranscriptSegment[] = (transcript as YoutubeTranscriptItem[]).map((item) => ({
      text: item.text,
      start: item.offset / 1000,
      duration: item.duration / 1000,
    }))

    return {
      content: segments.map((segment) => segment.text).join(' '),
      segments,
      source: 'youtube_auto',
      language: 'unknown',
    }
  } catch {
    return null
  }
}

export async function getYtDlpSubtitleDetailed(
  videoId: string,
  options: TranscriptFetchOptions = {}
): Promise<YtDlpSubtitleFetchResult | null> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'testv-subtitles-'))
  const outputTemplate = path.join(tempDir, '%(id)s.%(ext)s')
  const { command, args } = getYtDlpCommand(options.ytDlpBin)

  args.push(
    '--skip-download',
    '--write-subs',
    '--write-auto-subs',
    '--sub-langs',
    SUBTITLE_LANGS,
    '--sub-format',
    'json3',
    '--output',
    outputTemplate
  )

  appendYtDlpOptions(args, options)
  args.push(`https://www.youtube.com/watch?v=${videoId}`)

  try {
    await execFileAsync(command, args, {
      maxBuffer: 1024 * 1024 * 20,
      timeout: 2 * 60 * 1000,
    })

    const files = await readdir(tempDir)
    const subtitleFile = files
      .filter((file) => file.endsWith('.json3'))
      .sort((a, b) => subtitleFilePriority(a) - subtitleFilePriority(b))[0]

    if (!subtitleFile) {
      return null
    }

    const raw = await readFile(path.join(tempDir, subtitleFile), 'utf8')
    const language = normalizeLanguageFromFileName(subtitleFile)
    const transcript = parseJson3Subtitle(raw, 'yt_dlp_subtitle', language)

    if (!transcript) {
      return null
    }

    return {
      transcript,
      raw,
      subtitleFile,
    }
  } catch {
    return null
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

export async function getYtDlpSubtitle(
  videoId: string,
  options: TranscriptFetchOptions = {}
): Promise<TranscriptFetchResult | null> {
  const result = await getYtDlpSubtitleDetailed(videoId, options)
  return result?.transcript ?? null
}

export async function getTranscriptForVideo(
  videoId: string,
  options: TranscriptFetchOptions = {},
  dependencies: TranscriptFetcherDependencies = {}
): Promise<TranscriptFetchResult | null> {
  const publicFetcher = dependencies.publicFetcher ?? getYouTubeTranscript
  const ytDlpFetcher = dependencies.ytDlpFetcher ?? getYtDlpSubtitle
  const audioTranscriber = dependencies.audioTranscriber ?? transcribeYouTubeAudio

  if (options.preferYtDlpSubtitles) {
    const ytDlpTranscript = await ytDlpFetcher(videoId, options)
    if (ytDlpTranscript) {
      return ytDlpTranscript
    }
  }

  const publicTranscript = await publicFetcher(videoId)
  if (publicTranscript) {
    return publicTranscript
  }

  if (!options.preferYtDlpSubtitles) {
    const ytDlpTranscript = await ytDlpFetcher(videoId, options)
    if (ytDlpTranscript) {
      return ytDlpTranscript
    }
  }

  if (!options.audioFallbackEnabled || !isUsableOpenAiKey(options.openAiApiKey)) {
    return null
  }

  return audioTranscriber(videoId, {
    apiKey: options.openAiApiKey!.trim(),
    baseUrl: options.openAiBaseUrl,
    model: options.transcriptionModel,
    ytDlpBin: options.ytDlpBin,
    ytDlpCookiesFile: options.ytDlpCookiesFile,
    ytDlpCookiesFromBrowser: options.ytDlpCookiesFromBrowser,
    ytDlpJsRuntimes: options.ytDlpJsRuntimes,
    ytDlpRemoteComponents: options.ytDlpRemoteComponents,
    keepAudioFiles: options.keepAudioFiles,
  })
}

export function cleanTranscript(text: string): string {
  return text
    .replace(/\[.*?\]/g, '')
    .replace(/\(.*?\)/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}
