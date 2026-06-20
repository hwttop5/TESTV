import 'dotenv/config'
import { access, rm } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'
import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { downloadYouTubeAudio } from '../lib/audio-transcription'
import { parsePositiveInt } from '../lib/review-types'
import { cleanTranscript } from '../lib/transcript'
import {
  classifyTranscriptQuality,
  getTranscriptArtifactPaths,
  writeTranscriptArtifacts,
  writeTranscriptErrorArtifact,
} from '../lib/transcript-pipeline'
import {
  resolveLocalAsrFailureStage,
  shouldRetryLocalAsrError,
} from '../lib/transcript-errors'
import { backfillTranscriptStageState } from '../lib/transcript-state-backfill'
import { resolveYtDlpCookiesFile } from '../lib/yt-dlp'

const execFileAsync = promisify(execFile)

function isEnabled(value: string | undefined): boolean {
  return value === '1' || value?.toLowerCase() === 'true'
}

function isEnabledByDefault(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) return defaultValue
  return isEnabled(value)
}

async function hasAsrErrorArtifact(youtubeId: string): Promise<boolean> {
  const errorPath = getTranscriptArtifactPaths(youtubeId, 'local_faster_whisper').errorPath
  if (!errorPath) return false

  try {
    await access(errorPath)
    return true
  } catch {
    return false
  }
}

async function reconcileExistingLocalAsrFailures(options: {
  maxRecoverableAttempts: number
  markTerminal: boolean
}) {
  const { maxRecoverableAttempts, markTerminal } = options

  const candidates = await prisma.video.findMany({
    where: {
      transcripts: { none: {} },
      isAvailable: true,
      asrAttemptCount: { gt: 0 },
      transcriptStage: { not: 'synced' },
    },
    select: {
      id: true,
      youtubeId: true,
      lastError: true,
      asrAttemptCount: true,
      transcriptStage: true,
      syncStatus: true,
    },
  })

  for (const video of candidates) {
    const hasErrorArtifact = await hasAsrErrorArtifact(video.youtubeId)
    if (!hasErrorArtifact) {
      continue
    }

    const nextStage = resolveLocalAsrFailureStage({
      lastError: video.lastError,
      attemptCount: video.asrAttemptCount,
      maxRecoverableAttempts,
      markTerminal,
    })

    if (video.transcriptStage !== nextStage || video.syncStatus !== 'failed') {
      await prisma.video.update({
        where: { id: video.id },
        data: {
          syncStatus: 'failed',
          transcriptStage: nextStage,
        },
      })
    }
  }
}

async function runLocalAsrBatch(
  audioInputs: Array<{ youtubeId: string; audioPath: string }>
): Promise<Map<string, {
  ok: boolean
  text?: string
  language?: string
  segments?: Array<{ text: string; start: number; duration: number }>
  error?: string
}>> {
  const scriptPath = path.join(process.cwd(), 'scripts', 'faster-whisper-transcribe-batch.py')
  const model = process.env.FASTER_WHISPER_MODEL || 'small'
  const computeType = process.env.FASTER_WHISPER_COMPUTE_TYPE || 'int8'

  const { stdout, stderr } = await execFileAsync(
    'python',
    [scriptPath, model, computeType, ...audioInputs.map((item) => item.audioPath)],
    {
      timeout: 60 * 60 * 1000,
      maxBuffer: 1024 * 1024 * 50,
      env: {
        ...process.env,
        PYTHONIOENCODING: 'utf-8',
      },
      encoding: 'utf8',
    }
  )

  if (stderr?.trim()) {
    process.stderr.write(stderr)
  }

  const payload = JSON.parse(stdout) as {
    results?: Array<{
      audio_path?: string
      ok?: boolean
      text?: string
      language?: string
      error?: string
      segments?: Array<{ text?: string; start?: number; end?: number }>
    }>
  }

  const pathToYoutubeId = new Map(audioInputs.map((item) => [item.audioPath, item.youtubeId]))
  const resultMap = new Map<string, {
    ok: boolean
    text?: string
    language?: string
    segments?: Array<{ text: string; start: number; duration: number }>
    error?: string
  }>()

  for (const item of payload.results || []) {
    if (!item.audio_path) continue
    const youtubeId = pathToYoutubeId.get(item.audio_path)
    if (!youtubeId) continue

    if (!item.ok) {
      resultMap.set(youtubeId, {
        ok: false,
        error: item.error || 'local faster-whisper batch failed',
      })
      continue
    }

    const segments = (item.segments || []).flatMap((segment) => {
      if (!segment.text) return []

      const start = typeof segment.start === 'number' ? segment.start : 0
      const end = typeof segment.end === 'number' ? segment.end : start

      return [{
        text: segment.text,
        start,
        duration: Math.max(0, end - start),
      }]
    })

    const text = (item.text || '').trim()
    if (!text) {
      resultMap.set(youtubeId, {
        ok: false,
        error: 'local faster-whisper returned empty text',
      })
      continue
    }

    resultMap.set(youtubeId, {
      ok: true,
      text,
      language: item.language || 'unknown',
      segments,
    })
  }

  return resultMap
}

async function main() {
  await backfillTranscriptStageState(prisma)

  const batchSize = parsePositiveInt(
    process.env.LOCAL_ASR_BATCH_SIZE,
    parsePositiveInt(process.env.ASR_BATCH_SIZE, 2)
  )
  const continuousMode = isEnabled(process.env.CONTINUOUS_MODE)
  const forceRetry = isEnabled(process.env.LOCAL_ASR_FORCE_RETRY)
  const maxRecoverableAttempts = parsePositiveInt(process.env.LOCAL_ASR_MAX_RECOVERABLE_ATTEMPTS, 3)
  const markTerminal = isEnabledByDefault(process.env.LOCAL_ASR_MARK_TERMINAL, true)
  const cookiesFromBrowser = process.env.YTDLP_COOKIES_FROM_BROWSER?.trim() || undefined
  const cookiesFile = cookiesFromBrowser
    ? (process.env.YTDLP_COOKIES_FILE?.trim()
        ? resolveYtDlpCookiesFile(process.env.YTDLP_COOKIES_FILE)
        : undefined)
    : resolveYtDlpCookiesFile(process.env.YTDLP_COOKIES_FILE)

  await reconcileExistingLocalAsrFailures({
    maxRecoverableAttempts,
    markTerminal,
  })

  let totalSuccess = 0
  let totalFailed = 0
  let round = 0

  do {
    round += 1
    const candidates = await prisma.video.findMany({
      where: {
        transcripts: { none: {} },
        isAvailable: true,
        transcriptStage: { not: 'terminal' },
      },
      orderBy: [{ asrAttemptCount: 'asc' }, { publishedAt: 'desc' }],
      take: Math.max(batchSize * 10, 100),
    })

    const videos = forceRetry
      ? candidates.slice(0, batchSize)
      : (
          await Promise.all(
            candidates.map(async (video) => ({
              video,
              hasErrorArtifact: await hasAsrErrorArtifact(video.youtubeId),
            }))
          )
        )
          .filter(
            (item) =>
              !item.hasErrorArtifact ||
              shouldRetryLocalAsrError(
                item.video.lastError,
                item.video.asrAttemptCount,
                maxRecoverableAttempts
              )
          )
          .slice(0, batchSize)
          .map((item) => item.video)

    console.log(`[local-asr] round=${round} queue=${videos.length}`)

    if (videos.length === 0) {
      break
    }

    let roundSuccess = 0
    let roundFailed = 0

    const downloads: Array<{
      video: typeof videos[number]
      audioPath: string
      tempDir: string
    }> = []

    for (const video of videos) {
      await prisma.video.update({
        where: { id: video.id },
        data: {
          transcriptAttempts: { increment: 1 },
          asrAttemptCount: { increment: 1 },
        },
      })

      try {
        const downloaded = await downloadYouTubeAudio(video.youtubeId, {
          ytDlpBin: process.env.YTDLP_BIN,
          ytDlpCookiesFile: cookiesFile,
          ytDlpCookiesFromBrowser: cookiesFromBrowser,
          ytDlpJsRuntimes: process.env.YTDLP_JS_RUNTIMES,
          ytDlpRemoteComponents: process.env.YTDLP_REMOTE_COMPONENTS,
        })

        downloads.push({
          video,
          audioPath: downloaded.audioPath,
          tempDir: downloaded.tempDir,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)

        await writeTranscriptErrorArtifact({
          youtubeId: video.youtubeId,
          sourceKind: 'asr',
          error: message,
          meta: {
            title: video.title,
            model: process.env.FASTER_WHISPER_MODEL || 'small',
            computeType: process.env.FASTER_WHISPER_COMPUTE_TYPE || 'int8',
          },
        })

        await prisma.video.update({
          where: { id: video.id },
          data: {
            syncStatus: 'failed',
            transcriptStage: resolveLocalAsrFailureStage({
              lastError: message,
              attemptCount: video.asrAttemptCount + 1,
              maxRecoverableAttempts,
              markTerminal,
            }),
            lastError: message,
          },
        })

        roundFailed += 1
      }
    }

    const batchResults = downloads.length > 0
      ? await runLocalAsrBatch(
          downloads.map((item) => ({
            youtubeId: item.video.youtubeId,
            audioPath: item.audioPath,
          }))
        )
      : new Map()

    for (const item of downloads) {
      try {
        const result = batchResults.get(item.video.youtubeId)
        if (!result?.ok || !result.text || !result.segments) {
          throw new Error(result?.error || 'local faster-whisper batch result missing')
        }

        const content = cleanTranscript(result.text)
        const quality = classifyTranscriptQuality({
          content,
          segments: result.segments,
        })

        await writeTranscriptArtifacts({
          youtubeId: item.video.youtubeId,
          source: 'local_faster_whisper',
          rawPayload: {
            content,
            language: result.language,
            segments: result.segments,
            model: process.env.FASTER_WHISPER_MODEL || 'small',
            computeType: process.env.FASTER_WHISPER_COMPUTE_TYPE || 'int8',
          },
          meta: {
            youtubeId: item.video.youtubeId,
            title: item.video.title,
            language: result.language,
            source: 'local_faster_whisper',
            sourceKind: 'asr',
            quality,
            segmentCount: result.segments.length,
            contentLength: content.length,
            fetchedAt: new Date().toISOString(),
          },
        })

        await prisma.transcript.create({
          data: {
            videoId: item.video.id,
            content,
            source: 'local_faster_whisper',
            language: result.language || 'unknown',
            segments: result.segments as unknown as Prisma.InputJsonValue,
          },
        })

        await prisma.video.update({
          where: { id: item.video.id },
          data: {
            syncStatus: 'transcript_synced',
            transcriptStage: 'synced',
            lastTranscriptAt: new Date(),
            lastError: null,
          },
        })

        roundSuccess += 1
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)

        await writeTranscriptErrorArtifact({
          youtubeId: item.video.youtubeId,
          sourceKind: 'asr',
          error: message,
          meta: {
            title: item.video.title,
            model: process.env.FASTER_WHISPER_MODEL || 'small',
            computeType: process.env.FASTER_WHISPER_COMPUTE_TYPE || 'int8',
          },
        })

        await prisma.video.update({
          where: { id: item.video.id },
          data: {
            syncStatus: 'failed',
            transcriptStage: resolveLocalAsrFailureStage({
              lastError: message,
              attemptCount: item.video.asrAttemptCount + 1,
              maxRecoverableAttempts,
              markTerminal,
            }),
            lastError: message,
          },
        })

        roundFailed += 1
      } finally {
        if (!isEnabled(process.env.KEEP_AUDIO_FILES)) {
          await rm(item.tempDir, { recursive: true, force: true })
        }
      }
    }

    totalSuccess += roundSuccess
    totalFailed += roundFailed

    console.log(`[local-asr] success=${roundSuccess} failed=${roundFailed}`)

    if (!continuousMode) {
      break
    }
  } while (true)

  console.log(`[local-asr] totalSuccess=${totalSuccess} totalFailed=${totalFailed}`)
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
