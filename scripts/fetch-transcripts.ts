import 'dotenv/config'
import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { cleanTranscript, getTranscriptForVideo } from '../lib/transcript'
import { parsePositiveInt } from '../lib/review-types'

function isEnabled(value: string | undefined): boolean {
  return value === '1' || value?.toLowerCase() === 'true'
}

async function fetchTranscripts() {
  console.log('Fetching transcripts for videos without transcripts...')

  const maxAttempts = parsePositiveInt(process.env.TRANSCRIPT_MAX_ATTEMPTS, 3)
  const batchSize = parsePositiveInt(process.env.TRANSCRIPT_BATCH_SIZE, 20)
  const continuousMode = isEnabled(process.env.CONTINUOUS_MODE)

  let totalSuccess = 0
  let totalFailed = 0
  let iteration = 0

  do {
    iteration++
    console.log(`\n--- Iteration ${iteration} ---`)

    const videos = await prisma.video.findMany({
      where: {
        syncStatus: {
          in: ['pending', 'failed'],
        },
        transcriptAttempts: {
          lt: maxAttempts,
        },
        transcripts: {
          none: {},
        },
        isAvailable: true, // Only process available videos
      },
      orderBy: {
        publishedAt: 'desc',
      },
      take: batchSize,
    })

    console.log(`Found ${videos.length} videos to process`)

    if (videos.length === 0) {
      console.log('No more videos to process.')
      break
    }

    let successCount = 0
    let failedCount = 0

    for (const video of videos) {
      console.log(`Processing: ${video.title} (${video.youtubeId})`)

      try {
        await prisma.video.update({
          where: { id: video.id },
          data: {
            transcriptAttempts: { increment: 1 },
            lastError: null,
          },
        })

        const transcriptData = await getTranscriptForVideo(video.youtubeId, {
          preferYtDlpSubtitles: isEnabled(process.env.PREFER_YTDLP_SUBTITLES),
          audioFallbackEnabled: isEnabled(process.env.ENABLE_AUDIO_TRANSCRIPTION),
          openAiApiKey: process.env.OPENAI_API_KEY,
          transcriptionModel: process.env.OPENAI_TRANSCRIPTION_MODEL || 'whisper-1',
          ytDlpBin: process.env.YTDLP_BIN,
          ytDlpCookiesFile: process.env.YTDLP_COOKIES_FILE,
          ytDlpCookiesFromBrowser: process.env.YTDLP_COOKIES_FROM_BROWSER,
          ytDlpJsRuntimes: process.env.YTDLP_JS_RUNTIMES,
          ytDlpRemoteComponents: process.env.YTDLP_REMOTE_COMPONENTS,
          keepAudioFiles: isEnabled(process.env.KEEP_AUDIO_FILES),
        })

        if (!transcriptData) {
          const message = 'No public transcript available and audio fallback is disabled or unavailable'
          console.log(`  ${message}`)

          await prisma.video.update({
            where: { id: video.id },
            data: {
              syncStatus: 'failed',
              lastError: message,
            },
          })

          failedCount++
          continue
        }

        const cleanedContent = cleanTranscript(transcriptData.content)

        await prisma.transcript.create({
          data: {
            videoId: video.id,
            content: cleanedContent,
            source: transcriptData.source,
            language: transcriptData.language,
            segments: transcriptData.segments as unknown as Prisma.InputJsonValue,
          },
        })

        await prisma.video.update({
          where: { id: video.id },
          data: {
            syncStatus: 'transcript_synced',
            lastTranscriptAt: new Date(),
            lastError: null,
          },
        })

        console.log(`  Transcript fetched via ${transcriptData.source}`)
        successCount++
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.error(`  Error: ${message}`)

        await prisma.video.update({
          where: { id: video.id },
          data: {
            syncStatus: 'failed',
            lastError: message,
          },
        })

        failedCount++
      }

      await new Promise((resolve) => setTimeout(resolve, 1000))
    }

    totalSuccess += successCount
    totalFailed += failedCount

    console.log(`Iteration ${iteration} complete: ${successCount} success, ${failedCount} failed`)

    // In continuous mode, keep going until no more videos found
    if (!continuousMode) {
      break
    }
  } while (true)

  console.log(`\n=== Final Summary ===`)
  console.log(`Total success: ${totalSuccess}`)
  console.log(`Total failed: ${totalFailed}`)
}

fetchTranscripts()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
