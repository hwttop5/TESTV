import 'dotenv/config'
import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { parsePositiveInt } from '../lib/review-types'
import { cleanTranscript, getYtDlpSubtitleDetailed } from '../lib/transcript'
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

  const batchSize = parsePositiveInt(process.env.TRANSCRIPT_BATCH_SIZE, 20)
  const continuousMode = isEnabled(process.env.CONTINUOUS_MODE)
  const forceRetry = isEnabled(process.env.FORCE_RETRY_FAILED_TRANSCRIPTS)
  const cookiesFromBrowser = process.env.YTDLP_COOKIES_FROM_BROWSER?.trim() || undefined
  const cookiesFile = cookiesFromBrowser
    ? (process.env.YTDLP_COOKIES_FILE?.trim()
        ? resolveYtDlpCookiesFile(process.env.YTDLP_COOKIES_FILE)
        : undefined)
    : resolveYtDlpCookiesFile(process.env.YTDLP_COOKIES_FILE)

  let totalSuccess = 0
  let totalFailed = 0
  let round = 0

  do {
    round += 1
    const videos = await prisma.video.findMany({
      where: {
        transcripts: { none: {} },
        isAvailable: true,
        browserAttemptCount: { gt: 0 },
        ...(forceRetry
          ? {}
          : {
              ytdlpAttemptCount: 0,
            }),
      },
      orderBy: [
        { publishedAt: 'desc' },
        { browserAttemptCount: 'asc' },
      ],
      take: batchSize,
    })

    console.log(`[yt-dlp] round=${round} queue=${videos.length}`)

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
          ytdlpAttemptCount: { increment: 1 },
        },
      })

      const subtitle = await getYtDlpSubtitleDetailed(video.youtubeId, {
        ytDlpBin: process.env.YTDLP_BIN,
        ytDlpCookiesFile: cookiesFile,
        ytDlpCookiesFromBrowser: cookiesFromBrowser,
        ytDlpJsRuntimes: process.env.YTDLP_JS_RUNTIMES,
        ytDlpRemoteComponents: process.env.YTDLP_REMOTE_COMPONENTS,
      })

      if (!subtitle) {
        const error = 'yt-dlp subtitle unavailable or empty'
        await writeTranscriptErrorArtifact({
          youtubeId: video.youtubeId,
          sourceKind: 'ytdlp',
          error,
          meta: {
            title: video.title,
            cookiesFile: cookiesFile || null,
          },
        })

        await prisma.video.update({
          where: { id: video.id },
          data: {
            syncStatus: 'failed',
            transcriptStage: 'ytdlp_failed',
            lastError: error,
          },
        })

        roundFailed += 1
        continue
      }

      const content = cleanTranscript(subtitle.transcript.content)
      const quality = classifyTranscriptQuality({
        content,
        segments: subtitle.transcript.segments,
      })

      await writeTranscriptArtifacts({
        youtubeId: video.youtubeId,
        source: 'yt_dlp_subtitle',
        rawPayload: subtitle.raw,
        meta: {
          youtubeId: video.youtubeId,
          title: video.title,
          language: subtitle.transcript.language,
          source: 'yt_dlp_subtitle',
          sourceKind: 'ytdlp',
          quality,
          segmentCount: subtitle.transcript.segments.length,
          contentLength: content.length,
          fetchedAt: new Date().toISOString(),
          subtitleFile: subtitle.subtitleFile,
        },
      })

      await prisma.transcript.create({
        data: {
          videoId: video.id,
          content,
          source: 'yt_dlp_subtitle',
          language: subtitle.transcript.language,
          segments: subtitle.transcript.segments as unknown as Prisma.InputJsonValue,
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
    }

    totalSuccess += roundSuccess
    totalFailed += roundFailed

    console.log(`[yt-dlp] success=${roundSuccess} failed=${roundFailed}`)

    if (!continuousMode) {
      break
    }

    if (roundSuccess === 0 && roundFailed === 0) {
      break
    }
  } while (true)

  console.log(`[yt-dlp] totalSuccess=${totalSuccess} totalFailed=${totalFailed}`)
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
