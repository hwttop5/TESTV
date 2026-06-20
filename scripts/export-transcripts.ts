import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { prisma } from '../lib/prisma'
import { classifyTranscriptQuality, findTranscriptArtifactPaths } from '../lib/transcript-pipeline'
import type { TranscriptSegment } from '../lib/review-types'
import { backfillTranscriptStageState } from '../lib/transcript-state-backfill'

const OUTPUT_DIR = path.join(process.cwd(), 'data', 'transcript-export')
const ALL_TRANSCRIPTS_PATH = path.join(OUTPUT_DIR, 'all-transcripts.jsonl')
const STATUS_PATH = path.join(OUTPUT_DIR, 'video-transcript-status.jsonl')
const SUMMARY_PATH = path.join(OUTPUT_DIR, 'summary.json')

type ExportRecord = {
  transcriptId: string
  videoId: string
  youtubeId: string
  title: string
  publishedAt: string | null
  language: string
  source: string
  content: string
  segments: unknown
  quality: 'short' | 'normal'
  artifactPaths: {
    responsePath: string | null
    metaPath: string | null
    errorPath: string | null
  }
}

type StatusRecord = {
  videoId: string
  youtubeId: string
  title: string
  publishedAt: string
  hasTranscript: boolean
  source: string | null
  transcriptStage: string
  lastError: string | null
  quality: 'short' | 'normal' | null
  artifactPaths: {
    responsePath: string | null
    metaPath: string | null
    errorPath: string | null
  }
}

function toTranscriptSegments(value: unknown): TranscriptSegment[] {
  if (!Array.isArray(value)) return []

  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const record = item as Record<string, unknown>

    if (
      typeof record.text !== 'string' ||
      typeof record.start !== 'number' ||
      typeof record.duration !== 'number'
    ) {
      return []
    }

    return [{
      text: record.text,
      start: record.start,
      duration: record.duration,
    }]
  })
}

async function main() {
  await backfillTranscriptStageState(prisma)

  const videos = await prisma.video.findMany({
    orderBy: [{ publishedAt: 'desc' }],
    include: {
      transcripts: {
        orderBy: [{ createdAt: 'asc' }],
      },
    },
  })

  await mkdir(OUTPUT_DIR, { recursive: true })

  const successfulRecords: ExportRecord[] = []
  const statusRecords: StatusRecord[] = []

  for (const video of videos) {
    const transcript = video.transcripts[0] || null
    const artifactPaths = await findTranscriptArtifactPaths(video.youtubeId, transcript?.source ?? null)

    if (transcript) {
      const segments = toTranscriptSegments(transcript.segments)

      successfulRecords.push({
        transcriptId: transcript.id,
        videoId: video.id,
        youtubeId: video.youtubeId,
        title: video.title,
        publishedAt: video.publishedAt.toISOString(),
        language: transcript.language,
        source: transcript.source,
        content: transcript.content,
        segments: transcript.segments,
        quality: classifyTranscriptQuality({
          content: transcript.content,
          segments,
        }),
        artifactPaths,
      })
    }

    const segments = transcript ? toTranscriptSegments(transcript.segments) : []
    statusRecords.push({
      videoId: video.id,
      youtubeId: video.youtubeId,
      title: video.title,
      publishedAt: video.publishedAt.toISOString(),
      hasTranscript: transcript !== null,
      source: transcript?.source ?? null,
      transcriptStage: video.transcriptStage,
      lastError: video.lastError,
      quality: transcript
        ? classifyTranscriptQuality({
            content: transcript.content,
            segments,
          })
        : null,
      artifactPaths,
    })
  }

  await writeFile(
    ALL_TRANSCRIPTS_PATH,
    successfulRecords.map((record) => JSON.stringify(record)).join('\n'),
    'utf8'
  )
  await writeFile(
    STATUS_PATH,
    statusRecords.map((record) => JSON.stringify(record)).join('\n'),
    'utf8'
  )
  await writeFile(
    SUMMARY_PATH,
    JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        transcriptCount: successfulRecords.length,
        videoCount: statusRecords.length,
        output: {
          transcripts: ALL_TRANSCRIPTS_PATH,
          status: STATUS_PATH,
        },
      },
      null,
      2
    ),
    'utf8'
  )

  console.log(JSON.stringify({
    transcriptCount: successfulRecords.length,
    videoCount: statusRecords.length,
    transcriptsPath: ALL_TRANSCRIPTS_PATH,
    statusPath: STATUS_PATH,
    summaryPath: SUMMARY_PATH,
  }, null, 2))
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
