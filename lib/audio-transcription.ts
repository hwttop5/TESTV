import { execFile } from 'child_process'
import { mkdtemp, readFile, readdir, rm } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { promisify } from 'util'
import { buildOpenAiHeaders, buildOpenAiUrl } from './openai-client'
import type { TranscriptSegment } from './review-types'
import { appendYtDlpOptions, getYtDlpCommand } from './yt-dlp'

const execFileAsync = promisify(execFile)

export interface AudioTranscriptionOptions {
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

export type AudioDownloadOptions = Pick<
  AudioTranscriptionOptions,
  | 'ytDlpBin'
  | 'ytDlpCookiesFile'
  | 'ytDlpCookiesFromBrowser'
  | 'ytDlpJsRuntimes'
  | 'ytDlpRemoteComponents'
>

export interface AudioTranscriptionResult {
  content: string
  segments: TranscriptSegment[]
  source: 'openai_audio'
  language: string
}

interface OpenAITranscriptionSegment {
  text?: string
  start?: number
  end?: number
}

interface OpenAITranscriptionResponse {
  text?: string
  language?: string
  segments?: OpenAITranscriptionSegment[]
}

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()

  switch (ext) {
    case '.m4a':
      return 'audio/m4a'
    case '.mp3':
      return 'audio/mpeg'
    case '.wav':
      return 'audio/wav'
    case '.webm':
      return 'audio/webm'
    default:
      return 'application/octet-stream'
  }
}

async function downloadAudio(
  videoId: string,
  options: AudioDownloadOptions
): Promise<{ audioPath: string; tempDir: string }> {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'testv-audio-'))
  const outputTemplate = path.join(tempDir, `${videoId}.%(ext)s`)
  const { command, args } = getYtDlpCommand(options.ytDlpBin)

  args.push(
    '--no-playlist',
    '--format',
    'bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio',
    '--output',
    outputTemplate
  )

  appendYtDlpOptions(args, options)
  args.push(`https://www.youtube.com/watch?v=${videoId}`)

  try {
    await execFileAsync(command, args, {
      timeout: 10 * 60 * 1000,
      maxBuffer: 1024 * 1024 * 10,
    })
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true })
    throw new Error(
      `audio download failed for ${videoId}: ${error instanceof Error ? error.message : String(error)}`
    )
  }

  const files = await readdir(tempDir)
  const audioFile = files.find((file) => file.startsWith(videoId))

  if (!audioFile) {
    await rm(tempDir, { recursive: true, force: true })
    throw new Error(`yt-dlp did not produce an audio file for ${videoId}`)
  }

  return {
    audioPath: path.join(tempDir, audioFile),
    tempDir,
  }
}

export async function downloadYouTubeAudio(
  videoId: string,
  options: AudioDownloadOptions
): Promise<{ audioPath: string; tempDir: string }> {
  return downloadAudio(videoId, options)
}

async function transcribeAudioFile(
  audioPath: string,
  options: AudioTranscriptionOptions
): Promise<AudioTranscriptionResult> {
  const audioBuffer = await readFile(audioPath)
  const formData = new FormData()

  formData.append('model', options.model || 'whisper-1')
  formData.append('response_format', 'verbose_json')
  formData.append(
    'file',
    new Blob([new Uint8Array(audioBuffer)], {
      type: getMimeType(audioPath),
    }),
    path.basename(audioPath)
  )

  const response = await fetch(buildOpenAiUrl('/v1/audio/transcriptions', options.baseUrl), {
    method: 'POST',
    headers: buildOpenAiHeaders(options.apiKey),
    body: formData,
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`OpenAI transcription failed: ${response.status} ${errorText}`)
  }

  const data = (await response.json()) as OpenAITranscriptionResponse
  const segments = Array.isArray(data.segments)
    ? data.segments.flatMap((segment) => {
        if (!segment.text) return []

        const start = typeof segment.start === 'number' ? segment.start : 0
        const end = typeof segment.end === 'number' ? segment.end : start

        return [{
          text: segment.text,
          start,
          duration: Math.max(0, end - start),
        }]
      })
    : []

  const content = data.text || segments.map((segment) => segment.text).join(' ')
  if (!content.trim()) {
    throw new Error('OpenAI transcription returned empty text')
  }

  return {
    content,
    segments,
    source: 'openai_audio',
    language: data.language || 'unknown',
  }
}

export async function transcribeYouTubeAudio(
  videoId: string,
  options: AudioTranscriptionOptions
): Promise<AudioTranscriptionResult> {
  const { audioPath, tempDir } = await downloadYouTubeAudio(videoId, options)

  try {
    return await transcribeAudioFile(audioPath, options)
  } finally {
    if (!options.keepAudioFiles) {
      await rm(tempDir, { recursive: true, force: true })
    }
  }
}
