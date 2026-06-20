import type { PrismaClient } from '@prisma/client'
import { isBrowserTranscriptFailure, isYtDlpSubtitleFailure } from './transcript-errors'

export async function backfillTranscriptStageState(prisma: PrismaClient) {
  const videos = await prisma.video.findMany({
    include: {
      transcripts: {
        select: {
          id: true,
        },
      },
    },
  })

  for (const video of videos) {
    const hasTranscript = video.transcripts.length > 0

    if (hasTranscript) {
      if (video.transcriptStage !== 'synced' || video.lastError !== null) {
        await prisma.video.update({
          where: { id: video.id },
          data: {
            transcriptStage: 'synced',
            lastError: null,
          },
        })
      }
      continue
    }

    if (video.transcriptStage === 'terminal' || video.transcriptStage === 'asr_failed') {
      continue
    }

    if (isYtDlpSubtitleFailure(video.lastError)) {
      await prisma.video.update({
        where: { id: video.id },
        data: {
          transcriptStage: 'ytdlp_failed',
          browserAttemptCount:
            video.browserAttemptCount > 0 ? video.browserAttemptCount : Math.max(1, video.transcriptAttempts),
          ytdlpAttemptCount: video.ytdlpAttemptCount > 0 ? video.ytdlpAttemptCount : 1,
        },
      })
      continue
    }

    if (isBrowserTranscriptFailure(video.lastError)) {
      await prisma.video.update({
        where: { id: video.id },
        data: {
          transcriptStage: 'browser_failed',
          browserAttemptCount:
            video.browserAttemptCount > 0 ? video.browserAttemptCount : Math.max(1, video.transcriptAttempts),
        },
      })
    }
  }
}
