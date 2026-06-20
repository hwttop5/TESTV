import 'dotenv/config'
import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { transcribeYouTubeAudio } from '../lib/audio-transcription'
import { parsePositiveInt } from '../lib/review-types'
import { cleanTranscript, isUsableOpenAiKey } from '../lib/transcript'
import {
  classifyTranscriptQuality,
  writeTranscriptArtifacts,
  writeTranscriptErrorArtifact,
} from '../lib/transcript-pipeline'
import { backfillTranscriptStageState } from '../lib/transcript-state-backfill'
import { resolveYtDlpCookiesFile } from '../lib/yt-dlp'

function isEnabled(value: string | undefined): boolean {
  return value === '1' || value?.toLowerCase() === 'true'
}

async function main() {
  await backfillTranscriptStageState(prisma)

  const apiKey = process.env.OPENAI_API_KEY
  if (!isUsableOpenAiKey(apiKey)) {
    console.log('[asr] skipped because OPENAI_API_KEY is not configured')
    return
  }

  const batchSize = parsePositiveInt(process.env.ASR_LIMIT, parsePositiveInt(process.env.ASR_BATCH_SIZE, 5))
  const continuousMode = isEnabled(process.env.CONTINUOUS_MODE)
  const markTerminal = isEnabled(process.env.ASR_MARK_TERMINAL)
  const includeBrowserFailed = isEnabled(process.env.ASR_INCLUDE_BROWSER_FAILED)
  const cookiesFromBrowser = process.env.YTDLP_COOKIES_FROM_BROWSER?.trim() || undefined
  const cookiesFile = cookiesFromBrowser
    ? (process.env.YTDLP_COOKIES_FILE?.trim()
        ? resolveYtDlpCookiesFile(process.env.YTDLP_COOKIES_FILE)
        : undefined)
    : resolveYtDlpCookiesFile(process.env.YTDLP_COOKIES_FILE)
  const openAiBaseUrl = process.env.OPENAI_BASE_URL || process.env.OPENAI_API_BASE_URL

  const allowedStages = [
    'ytdlp_failed',
    ...(markTerminal ? ['asr_failed'] : []),
    ...(includeBrowserFailed ? ['browser_failed'] : []),
  ]

  let totalSuccess = 0
  let totalFailed = 0
  let round = 0

  do {
    round += 1
    const videos = await prisma.video.findMany({
      where: {
        transcripts: { none: {} },
        isAvailable: true,
        transcriptStage: {
          in: allowedStages,
        },
      },
      orderBy: [
        { publishedAt: 'desc' },
        { asrAttemptCount: 'asc' },
      ],
      take: batchSize,
    })

    console.log(
      `[asr] round=${round} queue=${videos.length} markTerminal=${markTerminal} includeBrowserFailed=${includeBrowserFailed}`
    )

    if (videos.length === 0) {
      break
    }

    let roundSuccess = 0
    let roundFailed = 0

    for (const video of videos) {
      await prisma.video.update({
        where: { id: video.id },
        data: {
          transcriptAttempts: { increment: 1 },
          asrAttemptCount: { increment: 1 },
        },
      })

      try {
        const transcript = await transcribeYouTubeAudio(video.youtubeId, {
          apiKey: apiKey!.trim(),
          baseUrl: openAiBaseUrl,
          model: process.env.OPENAI_TRANSCRIPTION_MODEL || 'whisper-1',
          ytDlpBin: process.env.YTDLP_BIN,
          ytDlpCookiesFile: cookiesFile,
          ytDlpCookiesFromBrowser: cookiesFromBrowser,
          ytDlpJsRuntimes: process.env.YTDLP_JS_RUNTIMES,
          ytDlpRemoteComponents: process.env.YTDLP_REMOTE_COMPONENTS,
          keepAudioFiles: isEnabled(process.env.KEEP_AUDIO_FILES),
        })

        const content = cleanTranscript(transcript.content)
        const quality = classifyTranscriptQuality({
          content,
          segments: transcript.segments,
        })

        await writeTranscriptArtifacts({
          youtubeId: video.youtubeId,
          source: 'openai_audio',
          rawPayload: {
            content,
            segments: transcript.segments,
            language: transcript.language,
            source: transcript.source,
          },
          meta: {
            youtubeId: video.youtubeId,
            title: video.title,
            language: transcript.language,
            source: 'openai_audio',
            sourceKind: 'asr',
            quality,
            segmentCount: transcript.segments.length,
            contentLength: content.length,
            fetchedAt: new Date().toISOString(),
          },
        })

        await prisma.transcript.create({
          data: {
            videoId: video.id,
            content,
            source: 'openai_audio',
            language: transcript.language,
            segments: transcript.segments as unknown as Prisma.InputJsonValue,
          },
        })

        await prisma.video.update({
          where: { id: video.id },
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
          youtubeId: video.youtubeId,
          sourceKind: 'asr',
          error: message,
          meta: {
            title: video.title,
            willMarkTerminal: markTerminal,
          },
        })

        await prisma.video.update({
          where: { id: video.id },
          data: {
            syncStatus: 'failed',
            transcriptStage: markTerminal ? 'terminal' : 'asr_failed',
            lastError: message,
          },
        })

        roundFailed += 1
      }
    }

    totalSuccess += roundSuccess
    totalFailed += roundFailed

    console.log(`[asr] success=${roundSuccess} failed=${roundFailed}`)

    if (!continuousMode) {
      break
    }
  } while (true)

  console.log(`[asr] totalSuccess=${totalSuccess} totalFailed=${totalFailed}`)
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
