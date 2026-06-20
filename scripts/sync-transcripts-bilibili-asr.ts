import 'dotenv/config'
import { execFile } from 'node:child_process'
import { access, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { Prisma } from '@prisma/client'
import { findBilibiliVideoMatch, type BilibiliVideoMatchResult } from '../lib/bilibili'
import { prisma } from '../lib/prisma'
import { parsePositiveInt } from '../lib/review-types'
import { cleanTranscript } from '../lib/transcript'
import {
  classifyTranscriptQuality,
  getTranscriptArtifactPaths,
  writeTranscriptArtifacts,
  writeTranscriptErrorArtifact,
} from '../lib/transcript-pipeline'
import { backfillTranscriptStageState } from '../lib/transcript-state-backfill'
import { getYtDlpCommand } from '../lib/yt-dlp'

const execFileAsync = promisify(execFile)

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36'
const BILIBILI_ASR_ERROR_PREFIX = 'bilibili_asr:'
const MANUAL_BILIBILI_MATCH_OVERRIDES: Record<string, BilibiliVideoMatchResult> = {
  R7KBYvXBeOo: {
    query: 'manual_override',
    score: 999,
    bvid: 'BV1vs411t7ju',
    aid: 0,
    title: '《值不值得买》第九十六期：买了iPhone 7一定先做这十件事否则等于没买',
    author: 'TESTV官方频道',
    mid: 11336264,
    url: 'https://www.bilibili.com/video/BV1vs411t7ju',
    confidence: 'high',
    episodeMatched: true,
    titleOverlap: 1,
    preferredMidMatched: true,
  },
  TS26Xjed70Y: {
    query: 'manual_override',
    score: 999,
    bvid: 'BV1fs411R74j',
    aid: 0,
    title: '《值不值得买》第二十九期：一个果粉体验windows phone一Lumia 640',
    author: 'TESTV官方频道',
    mid: 11336264,
    url: 'https://www.bilibili.com/video/BV1fs411R74j',
    confidence: 'high',
    episodeMatched: true,
    titleOverlap: 1,
    preferredMidMatched: true,
  },
  zA4_rZNXeDQ: {
    query: 'manual_override',
    score: 999,
    bvid: 'BV1Zs411D7c8',
    aid: 0,
    title: '《值不值得买》第五十五期：为创造而生的铅笔——Apple Pencil',
    author: 'TESTV官方频道',
    mid: 11336264,
    url: 'https://www.bilibili.com/video/BV1Zs411D7c8',
    confidence: 'high',
    episodeMatched: true,
    titleOverlap: 1,
    preferredMidMatched: true,
  },
}

function isEnabled(value: string | undefined): boolean {
  return value === '1' || value?.toLowerCase() === 'true'
}

async function readBilibiliCookieHeader(): Promise<string | undefined> {
  if (process.env.BILIBILI_COOKIE?.trim()) {
    return process.env.BILIBILI_COOKIE.trim()
  }

  if (!process.env.BILIBILI_COOKIE_FILE?.trim()) {
    return undefined
  }

  const cookie = await readFile(process.env.BILIBILI_COOKIE_FILE.trim(), 'utf8')
  const normalized = cookie.trim()
  return normalized || undefined
}

async function createBilibiliCookieFile(cookieHeader: string): Promise<{
  cookieFilePath: string
  tempDir: string
}> {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'testv-bilibili-cookies-'))
  const cookieFilePath = path.join(tempDir, 'cookies.txt')
  const lines = ['# Netscape HTTP Cookie File']

  for (const rawPart of cookieHeader.split(';')) {
    const trimmed = rawPart.trim()
    if (!trimmed) continue

    const separatorIndex = trimmed.indexOf('=')
    if (separatorIndex <= 0) continue

    const name = trimmed.slice(0, separatorIndex).trim()
    const value = trimmed.slice(separatorIndex + 1).trim()
    if (!name) continue

    lines.push([ '.bilibili.com', 'TRUE', '/', 'TRUE', '2147483647', name, value ].join('\t'))
  }

  await writeFile(cookieFilePath, `${lines.join('\n')}\n`, 'utf8')

  return {
    cookieFilePath,
    tempDir,
  }
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

async function downloadBilibiliAudio(options: {
  bvid: string
  url: string
  cookieFilePath?: string
}): Promise<{ audioPath: string; tempDir: string }> {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'testv-bilibili-audio-'))
  const outputTemplate = path.join(tempDir, `${options.bvid}.%(ext)s`)
  const { command, args } = getYtDlpCommand(process.env.YTDLP_BIN)

  args.push(
    '--no-playlist',
    '--format',
    'bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio',
    '--output',
    outputTemplate,
    '--add-header',
    'Referer: https://www.bilibili.com/',
    '--add-header',
    `User-Agent: ${DEFAULT_USER_AGENT}`
  )

  if (options.cookieFilePath) {
    args.push('--cookies', options.cookieFilePath)
  }

  args.push(options.url)

  try {
    await execFileAsync(command, args, {
      timeout: 10 * 60 * 1000,
      maxBuffer: 1024 * 1024 * 10,
    })
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true })
    throw new Error(
      `bilibili audio download failed for ${options.bvid}: ${error instanceof Error ? error.message : String(error)}`
    )
  }

  const files = await readdir(tempDir)
  const audioFile = files.find((file) => file.startsWith(options.bvid))

  if (!audioFile) {
    await rm(tempDir, { recursive: true, force: true })
    throw new Error(`yt-dlp did not produce a bilibili audio file for ${options.bvid}`)
  }

  return {
    audioPath: path.join(tempDir, audioFile),
    tempDir,
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

  const batchSize = parsePositiveInt(process.env.BILIBILI_ASR_BATCH_SIZE, 4)
  const continuousMode = isEnabled(process.env.CONTINUOUS_MODE)
  const forceRetry = isEnabled(process.env.BILIBILI_ASR_FORCE_RETRY)
  const preferredMid = parsePositiveInt(process.env.BILIBILI_PREFERRED_MID, 11336264)
  const cookieHeader = await readBilibiliCookieHeader()
  const cookieFile = cookieHeader ? await createBilibiliCookieFile(cookieHeader) : null

  let totalSuccess = 0
  let totalFailed = 0
  let round = 0

  do {
    round += 1
    const videos = await prisma.video.findMany({
      where: {
        transcripts: { none: {} },
        isAvailable: true,
        transcriptStage: 'terminal',
        ...(forceRetry
          ? {}
          : {
              NOT: {
                lastError: {
                  startsWith: BILIBILI_ASR_ERROR_PREFIX,
                },
              },
            }),
      },
      orderBy: [{ publishedAt: 'desc' }],
      take: batchSize,
    })

    console.log(`[bilibili-asr] round=${round} queue=${videos.length}`)

    if (videos.length === 0) {
      break
    }

    let roundSuccess = 0
    let roundFailed = 0

    const downloads: Array<{
      video: typeof videos[number]
      audioPath: string
      tempDir: string
      match: Awaited<ReturnType<typeof findBilibiliVideoMatch>>
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
        const match =
          MANUAL_BILIBILI_MATCH_OVERRIDES[
            video.youtubeId as keyof typeof MANUAL_BILIBILI_MATCH_OVERRIDES
          ] ??
          await findBilibiliVideoMatch({
            title: video.title,
            preferredMid,
            cookie: process.env.BILIBILI_COOKIE,
            cookieFile: process.env.BILIBILI_COOKIE_FILE,
          })

        if (!match) {
          throw new Error('bilibili video match unavailable')
        }

        const downloaded = await downloadBilibiliAudio({
          bvid: match.bvid,
          url: match.url,
          cookieFilePath: cookieFile?.cookieFilePath,
        })

        downloads.push({
          video,
          audioPath: downloaded.audioPath,
          tempDir: downloaded.tempDir,
          match,
        })
      } catch (error) {
        const message = `${BILIBILI_ASR_ERROR_PREFIX} ${error instanceof Error ? error.message : String(error)}`

        await writeTranscriptErrorArtifact({
          youtubeId: video.youtubeId,
          sourceKind: 'asr',
          error: message,
          meta: {
            title: video.title,
            preferredMid,
            mode: 'bilibili-audio',
            hasPreviousAsrErrorArtifact: await hasAsrErrorArtifact(video.youtubeId),
          },
        })

        await prisma.video.update({
          where: { id: video.id },
          data: {
            syncStatus: 'failed',
            transcriptStage: 'terminal',
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
            mode: 'bilibili-audio',
            bvid: item.match?.bvid,
            sourceUrl: item.match?.url,
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
            mode: 'bilibili-audio',
            requestUrl: item.match?.url ?? null,
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
        const message = `${BILIBILI_ASR_ERROR_PREFIX} ${error instanceof Error ? error.message : String(error)}`

        await writeTranscriptErrorArtifact({
          youtubeId: item.video.youtubeId,
          sourceKind: 'asr',
          error: message,
          meta: {
            title: item.video.title,
            mode: 'bilibili-audio',
            bvid: item.match?.bvid,
            sourceUrl: item.match?.url,
          },
        })

        await prisma.video.update({
          where: { id: item.video.id },
          data: {
            syncStatus: 'failed',
            transcriptStage: 'terminal',
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

    console.log(`[bilibili-asr] success=${roundSuccess} failed=${roundFailed}`)

    if (!continuousMode) {
      break
    }
  } while (true)

  console.log(`[bilibili-asr] totalSuccess=${totalSuccess} totalFailed=${totalFailed}`)

  if (cookieFile) {
    await rm(cookieFile.tempDir, { recursive: true, force: true })
  }
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
