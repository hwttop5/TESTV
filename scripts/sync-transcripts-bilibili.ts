import 'dotenv/config'
import { access } from 'node:fs/promises'
import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { getBilibiliSubtitleDetailed } from '../lib/bilibili'
import { parsePositiveInt } from '../lib/review-types'
import { cleanTranscript } from '../lib/transcript'
import {
  classifyTranscriptQuality,
  getTranscriptArtifactPaths,
  writeTranscriptArtifacts,
  writeTranscriptErrorArtifact,
} from '../lib/transcript-pipeline'
import { backfillTranscriptStageState } from '../lib/transcript-state-backfill'

function isEnabled(value: string | undefined): boolean {
  return value === '1' || value?.toLowerCase() === 'true'
}

async function hasBilibiliErrorArtifact(youtubeId: string): Promise<boolean> {
  const errorPath = getTranscriptArtifactPaths(youtubeId, 'bilibili_subtitle').errorPath
  if (!errorPath) return false

  try {
    await access(errorPath)
    return true
  } catch {
    return false
  }
}

async function main() {
  await backfillTranscriptStageState(prisma)

  const batchSize = parsePositiveInt(
    process.env.BILIBILI_BATCH_SIZE,
    parsePositiveInt(process.env.TRANSCRIPT_BATCH_SIZE, 10)
  )
  const continuousMode = isEnabled(process.env.CONTINUOUS_MODE)
  const forceRetry = isEnabled(process.env.BILIBILI_FORCE_RETRY)
  const includeAllUnresolved = isEnabled(process.env.BILIBILI_INCLUDE_ALL_UNRESOLVED)
  const preferredMid = parsePositiveInt(process.env.BILIBILI_PREFERRED_MID, 11336264)

  let totalSuccess = 0
  let totalFailed = 0
  let round = 0

  do {
    round += 1
    const candidates = await prisma.video.findMany({
      where: {
        transcripts: { none: {} },
        isAvailable: true,
        ...(forceRetry
          ? {}
          : {
              transcriptStage: {
                in: includeAllUnresolved
                  ? ['pending', 'browser_failed', 'ytdlp_failed']
                  : ['ytdlp_failed'],
              },
            }),
      },
      orderBy: [{ publishedAt: 'desc' }],
      take: Math.max(batchSize * 10, 100),
    })

    const videos = forceRetry
      ? candidates.slice(0, batchSize)
      : (
          await Promise.all(
            candidates.map(async (video) => ({
              video,
              hasErrorArtifact: await hasBilibiliErrorArtifact(video.youtubeId),
            }))
          )
        )
          .filter((item) => !item.hasErrorArtifact)
          .slice(0, batchSize)
          .map((item) => item.video)

    console.log(`[bilibili] round=${round} queue=${videos.length}`)

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
        },
      })

      try {
        const subtitle = await getBilibiliSubtitleDetailed({
          title: video.title,
          preferredMid,
          cookie: process.env.BILIBILI_COOKIE,
          cookieFile: process.env.BILIBILI_COOKIE_FILE,
        })

        if (!subtitle) {
          const error = 'bilibili subtitle unavailable or empty'
          await writeTranscriptErrorArtifact({
            youtubeId: video.youtubeId,
            sourceKind: 'bilibili',
            error,
            meta: {
              title: video.title,
              preferredMid,
            },
          })

          await prisma.video.update({
            where: { id: video.id },
            data: {
              syncStatus: 'failed',
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
          source: 'bilibili_subtitle',
          rawPayload: subtitle.raw,
          meta: {
            youtubeId: video.youtubeId,
            title: video.title,
            language: subtitle.transcript.language,
            source: 'bilibili_subtitle',
            sourceKind: 'bilibili',
            quality,
            segmentCount: subtitle.transcript.segments.length,
            contentLength: content.length,
            fetchedAt: new Date().toISOString(),
            requestUrl: `https://www.bilibili.com/video/${subtitle.match.bvid}`,
            subtitleFile: subtitle.match.subtitleUrl,
          },
        })

        await prisma.transcript.create({
          data: {
            videoId: video.id,
            content,
            source: 'bilibili_subtitle',
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
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        await writeTranscriptErrorArtifact({
          youtubeId: video.youtubeId,
          sourceKind: 'bilibili',
          error: message,
          meta: {
            title: video.title,
            preferredMid,
          },
        })

        await prisma.video.update({
          where: { id: video.id },
          data: {
            syncStatus: 'failed',
            lastError: message,
          },
        })

        roundFailed += 1
      }
    }

    totalSuccess += roundSuccess
    totalFailed += roundFailed

    console.log(`[bilibili] success=${roundSuccess} failed=${roundFailed}`)

    if (!continuousMode) {
      break
    }

    if (roundSuccess === 0 && roundFailed === 0) {
      break
    }
  } while (true)

  console.log(`[bilibili] totalSuccess=${totalSuccess} totalFailed=${totalFailed}`)
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
