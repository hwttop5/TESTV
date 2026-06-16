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
const SUBTITLE_LANGS = ['zh-Hans', 'zh-Hant', 'zh-CN', 'zh-TW', 'zh', 'en', 'en-US', 'en-GB'].join(',')

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

    const content = segments.map((segment) => segment.text).join(' ')

    return {
      content,
      segments,
      source: 'youtube_auto',
      language: 'unknown',
    }
  } catch (error) {
    console.error(`Failed to fetch transcript for video ${videoId}:`, error)
    return null
  }
}

function parseJson3Subtitle(raw: string): TranscriptFetchResult | null {
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

  if (segments.length === 0) return null

  return {
    content: segments.map((segment) => segment.text).join(' '),
    segments,
    source: 'yt_dlp_subtitle',
    language: 'unknown',
  }
}

async function getYtDlpSubtitle(
  videoId: string,
  options: TranscriptFetchOptions = {}
): Promise<TranscriptFetchResult | null> {
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
      .sort((a, b) => {
        const score = (file: string) => {
          if (file.includes('.zh-Hans') || file.includes('.zh-CN')) return 0
          if (file.includes('.zh')) return 1
          if (file.includes('.en')) return 2
          return 3
        }

        return score(a) - score(b)
      })[0]

    if (!subtitleFile) return null

    return parseJson3Subtitle(await readFile(path.join(tempDir, subtitleFile), 'utf8'))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`yt-dlp subtitle fetch failed for video ${videoId}: ${message}`)
    return null
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

export async function getTranscriptForVideo(
  videoId: string,
  options: TranscriptFetchOptions = {}
): Promise<TranscriptFetchResult | null> {
  if (options.preferYtDlpSubtitles) {
    const ytDlpTranscript = await getYtDlpSubtitle(videoId, options)
    if (ytDlpTranscript) {
      return ytDlpTranscript
    }
  }

  const publicTranscript = await getYouTubeTranscript(videoId)
  if (publicTranscript) {
    return publicTranscript
  }

  if (!options.preferYtDlpSubtitles) {
    const ytDlpTranscript = await getYtDlpSubtitle(videoId, options)
    if (ytDlpTranscript) {
      return ytDlpTranscript
    }
  }

  if (!options.audioFallbackEnabled) {
    return null
  }

  if (!options.openAiApiKey) {
    throw new Error('字幕不可用，且缺少 OPENAI_API_KEY，无法执行音频转写兜底。')
  }

  return transcribeYouTubeAudio(videoId, {
    apiKey: options.openAiApiKey,
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
