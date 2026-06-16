import { execFile } from 'child_process'
import { mkdtemp, readFile, readdir, rm } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { promisify } from 'util'
import type { TranscriptSegment } from './review-types'
import { appendYtDlpOptions, getYtDlpCommand } from './yt-dlp'

const execFileAsync = promisify(execFile)

export interface AudioTranscriptionOptions {
  apiKey: string
  model?: string
  ytDlpBin?: string
  ytDlpCookiesFile?: string
  ytDlpCookiesFromBrowser?: string
  ytDlpJsRuntimes?: string
  ytDlpRemoteComponents?: string
  keepAudioFiles?: boolean
}

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

async function downloadAudio(videoId: string, options: AudioTranscriptionOptions): Promise<{
  audioPath: string
  tempDir: string
}> {
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
      `音频下载失败。请确认已安装 yt-dlp，或正确设置 YTDLP_BIN。原始错误：${error instanceof Error ? error.message : String(error)}`
    )
  }

  const files = await readdir(tempDir)
  const audioFile = files.find((file) => file.startsWith(videoId))

  if (!audioFile) {
    await rm(tempDir, { recursive: true, force: true })
    throw new Error('yt-dlp 没有生成可转写的音频文件。')
  }

  return {
    audioPath: path.join(tempDir, audioFile),
    tempDir,
  }
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

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
    },
    body: formData,
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`OpenAI 音频转写失败：${response.status} ${errorText}`)
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
    throw new Error('OpenAI 音频转写返回空文本。')
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
  const { audioPath, tempDir } = await downloadAudio(videoId, options)

  try {
    return await transcribeAudioFile(audioPath, options)
  } finally {
    if (!options.keepAudioFiles) {
      await rm(tempDir, { recursive: true, force: true })
    }
  }
}
