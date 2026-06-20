import { access, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { TranscriptSegment } from './review-types'

export const TRANSCRIPT_STAGES = [
  'pending',
  'browser_failed',
  'ytdlp_failed',
  'asr_failed',
  'synced',
  'terminal',
] as const

export type TranscriptStage = (typeof TRANSCRIPT_STAGES)[number]
export type TranscriptQuality = 'short' | 'normal'
export type TranscriptSourceKind = 'browser' | 'ytdlp' | 'bilibili' | 'asr' | 'unknown'

export interface TranscriptArtifactMeta {
  youtubeId: string
  title?: string | null
  language?: string | null
  source: string
  sourceKind: TranscriptSourceKind
  quality: TranscriptQuality
  segmentCount: number
  contentLength: number
  fetchedAt: string
  mode?: string | null
  requestUrl?: string | null
  subtitleFile?: string | null
  events?: number | null
  lastError?: string | null
}

export interface TranscriptArtifactPaths {
  responsePath: string | null
  metaPath: string | null
  errorPath: string | null
}

const DATA_DIR_BY_KIND: Record<Exclude<TranscriptSourceKind, 'unknown'>, string> = {
  browser: path.join('data', 'browser-transcripts'),
  ytdlp: path.join('data', 'ytdlp-transcripts'),
  bilibili: path.join('data', 'bilibili-transcripts'),
  asr: path.join('data', 'asr-transcripts'),
}

function toAbsolute(relativePath: string): string {
  return path.join(process.cwd(), relativePath)
}

export function inferTranscriptSourceKind(source: string | null | undefined): TranscriptSourceKind {
  if (!source) return 'unknown'
  if (source.startsWith('browser_')) return 'browser'
  if (source === 'yt_dlp_subtitle') return 'ytdlp'
  if (source === 'bilibili_subtitle') return 'bilibili'
  if (source === 'openai_audio' || source === 'local_faster_whisper') return 'asr'
  return 'unknown'
}

export function classifyTranscriptQuality(input: {
  content: string
  segments: TranscriptSegment[]
}): TranscriptQuality {
  const contentLength = input.content.trim().length
  return contentLength < 80 || input.segments.length < 4 ? 'short' : 'normal'
}

function buildRelativePaths(
  youtubeId: string,
  directory: string
): TranscriptArtifactPaths {
  return {
    responsePath: path.join(directory, `${youtubeId}.response.json`),
    metaPath: path.join(directory, `${youtubeId}.meta.json`),
    errorPath: path.join(directory, `${youtubeId}.error.json`),
  }
}

export function getTranscriptArtifactPaths(
  youtubeId: string,
  source: string | null | undefined
): TranscriptArtifactPaths {
  const kind = inferTranscriptSourceKind(source)
  if (kind === 'unknown') {
    return {
      responsePath: null,
      metaPath: null,
      errorPath: null,
    }
  }

  return buildRelativePaths(youtubeId, DATA_DIR_BY_KIND[kind])
}

export async function findTranscriptArtifactPaths(
  youtubeId: string,
  source: string | null | undefined
): Promise<TranscriptArtifactPaths> {
  const candidates = source
    ? [getTranscriptArtifactPaths(youtubeId, source)]
    : Object.values(DATA_DIR_BY_KIND).map((directory) => buildRelativePaths(youtubeId, directory))

  for (const candidate of candidates) {
    const checks = await Promise.all([
      candidate.responsePath ? fileExists(candidate.responsePath) : Promise.resolve(false),
      candidate.metaPath ? fileExists(candidate.metaPath) : Promise.resolve(false),
      candidate.errorPath ? fileExists(candidate.errorPath) : Promise.resolve(false),
    ])

    if (checks.some(Boolean)) {
      return {
        responsePath: checks[0] ? candidate.responsePath : null,
        metaPath: checks[1] ? candidate.metaPath : null,
        errorPath: checks[2] ? candidate.errorPath : null,
      }
    }
  }

  return {
    responsePath: null,
    metaPath: null,
    errorPath: null,
  }
}

async function fileExists(relativePath: string): Promise<boolean> {
  try {
    await access(toAbsolute(relativePath))
    return true
  } catch {
    return false
  }
}

async function ensureDirForRelativePath(relativePath: string) {
  await mkdir(path.dirname(toAbsolute(relativePath)), { recursive: true })
}

export async function writeTranscriptArtifacts(input: {
  youtubeId: string
  source: string
  rawPayload: unknown
  meta: TranscriptArtifactMeta
}): Promise<TranscriptArtifactPaths> {
  const paths = getTranscriptArtifactPaths(input.youtubeId, input.source)

  if (!paths.responsePath || !paths.metaPath) {
    throw new Error(`unsupported transcript artifact source: ${input.source}`)
  }

  await ensureDirForRelativePath(paths.responsePath)
  await writeFile(
    toAbsolute(paths.responsePath),
    typeof input.rawPayload === 'string'
      ? input.rawPayload
      : JSON.stringify(input.rawPayload, null, 2),
    'utf8'
  )
  await writeFile(toAbsolute(paths.metaPath), JSON.stringify(input.meta, null, 2), 'utf8')

  return paths
}

export async function writeTranscriptErrorArtifact(input: {
  youtubeId: string
  sourceKind: Exclude<TranscriptSourceKind, 'unknown'>
  error: string
  meta: Record<string, unknown>
}): Promise<string> {
  const relativePath = buildRelativePaths(input.youtubeId, DATA_DIR_BY_KIND[input.sourceKind]).errorPath
  if (!relativePath) {
    throw new Error(`unsupported transcript error source kind: ${input.sourceKind}`)
  }

  await ensureDirForRelativePath(relativePath)
  await writeFile(
    toAbsolute(relativePath),
    JSON.stringify(
      {
        ...input.meta,
        youtubeId: input.youtubeId,
        error: input.error,
        failedAt: new Date().toISOString(),
      },
      null,
      2
    ),
    'utf8'
  )

  return relativePath
}
