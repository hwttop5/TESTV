import 'dotenv/config'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { cleanTranscript, parseJson3Subtitle } from '../lib/transcript'
import {
  classifyTranscriptQuality,
  writeTranscriptArtifacts,
  writeTranscriptErrorArtifact,
} from '../lib/transcript-pipeline'

type ClaimMode = 'fast' | 'slow'

type ClaimableVideo = {
  id: string
  youtubeId: string
  title: string
  transcriptStage: string
  transcriptAttempts: number
  browserAttemptCount: number
  lastError: string | null
}

type IngestPayload = {
  youtubeId: string
  title?: string
  language?: string
  requestUrl?: string
  raw: string
  mode?: ClaimMode
  events?: number
}

type FailedPayload = {
  youtubeId: string
  error?: string
  mode?: ClaimMode
  trackCount?: number
  perfCount?: number
}

const HOST = process.env.BROWSER_TRANSCRIPT_BRIDGE_HOST || '127.0.0.1'
const PORT = Number.parseInt(process.env.BROWSER_TRANSCRIPT_BRIDGE_PORT || '34567', 10)
const DEFAULT_BATCH_SIZE = Number.parseInt(process.env.BROWSER_TRANSCRIPT_BRIDGE_BATCH_SIZE || '10', 10)

function sendJson(response: ServerResponse, statusCode: number, payload: unknown) {
  response.statusCode = statusCode
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Access-Control-Allow-Origin', '*')
  response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  response.end(JSON.stringify(payload))
}

function sendText(response: ServerResponse, statusCode: number, message: string) {
  response.statusCode = statusCode
  response.setHeader('Content-Type', 'text/plain; charset=utf-8')
  response.setHeader('Access-Control-Allow-Origin', '*')
  response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  response.end(message)
}

async function readJsonBody<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = []

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }

  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T
}

function normalizeBatchSize(value: string | null): number {
  const parsed = Number.parseInt(value || '', 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_BATCH_SIZE
  }

  return Math.min(parsed, 50)
}

function normalizeMode(value: string | null): ClaimMode {
  return value === 'slow' ? 'slow' : 'fast'
}

function isSlowRetryCandidate(lastError: string | null): boolean {
  if (!lastError) return false

  return (
    lastError === 'no_nonempty_timedtext trackCount=0 perfCount=0' ||
    lastError.startsWith('timedtext fetch failed status=200 length=0') ||
    lastError.includes('no_nonempty_timedtext trackCount=')
  )
}

async function claimNextVideos(limit: number, mode: ClaimMode): Promise<ClaimableVideo[]> {
  const where =
    mode === 'slow'
      ? {
          transcripts: { none: {} },
          isAvailable: true,
          transcriptStage: 'browser_failed',
        }
      : {
          transcripts: { none: {} },
          isAvailable: true,
          browserAttemptCount: 0,
        }

  const videos = await prisma.video.findMany({
    where,
    orderBy: [
      { publishedAt: 'desc' },
      { transcriptAttempts: 'asc' },
    ],
    take: limit * 3,
    select: {
      id: true,
      youtubeId: true,
      title: true,
      transcriptStage: true,
      transcriptAttempts: true,
      browserAttemptCount: true,
      lastError: true,
    },
  })

  const filtered = mode === 'slow'
    ? videos.filter((video) => isSlowRetryCandidate(video.lastError)).slice(0, limit)
    : videos.slice(0, limit)

  for (const video of filtered) {
    await prisma.video.update({
      where: { id: video.id },
      data: {
        transcriptAttempts: { increment: 1 },
        browserAttemptCount: { increment: 1 },
      },
    })
  }

  return filtered
}

async function handleIngest(payload: IngestPayload) {
  if (!payload.youtubeId || !payload.raw) {
    throw new Error('missing youtubeId or raw')
  }

  const parsed = parseJson3Subtitle(
    payload.raw,
    'browser_network_timedtext',
    payload.language || 'unknown'
  )

  if (!parsed) {
    throw new Error('empty transcript body')
  }

  const content = cleanTranscript(parsed.content)
  const quality = classifyTranscriptQuality({
    content,
    segments: parsed.segments,
  })

  const video = await prisma.video.findUnique({
    where: { youtubeId: payload.youtubeId },
    include: {
      transcripts: true,
    },
  })

  if (!video) {
    throw new Error(`video not found: ${payload.youtubeId}`)
  }

  const artifactPaths = await writeTranscriptArtifacts({
    youtubeId: payload.youtubeId,
    source: 'browser_network_timedtext',
    rawPayload: payload.raw,
    meta: {
      youtubeId: payload.youtubeId,
      title: payload.title || video.title,
      language: payload.language || 'unknown',
      source: 'browser_network_timedtext',
      sourceKind: 'browser',
      quality,
      segmentCount: parsed.segments.length,
      contentLength: content.length,
      fetchedAt: new Date().toISOString(),
      mode: payload.mode || 'fast',
      requestUrl: payload.requestUrl || null,
      events: payload.events ?? null,
    },
  })

  if (video.transcripts.length === 0) {
    await prisma.transcript.create({
      data: {
        videoId: video.id,
        content,
        source: 'browser_network_timedtext',
        language: payload.language || 'unknown',
        segments: parsed.segments as unknown as Prisma.InputJsonValue,
      },
    })
  }

  await prisma.video.update({
    where: { id: video.id },
    data: {
      syncStatus: 'transcript_synced',
      transcriptStage: 'synced',
      lastTranscriptAt: new Date(),
      lastError: null,
    },
  })

  return {
    youtubeId: payload.youtubeId,
    quality,
    segmentCount: parsed.segments.length,
    contentLength: content.length,
    alreadyExisted: video.transcripts.length > 0,
    artifactPaths,
  }
}

async function handleFailed(payload: FailedPayload) {
  if (!payload.youtubeId) {
    throw new Error('missing youtubeId')
  }

  const errorMessage = (payload.error || 'browser transcript fetch failed').slice(0, 1000)
  const video = await prisma.video.findUnique({
    where: { youtubeId: payload.youtubeId },
    select: { id: true, title: true },
  })

  if (!video) {
    throw new Error(`video not found: ${payload.youtubeId}`)
  }

  const errorPath = await writeTranscriptErrorArtifact({
    youtubeId: payload.youtubeId,
    sourceKind: 'browser',
    error: errorMessage,
    meta: {
      title: video.title,
      mode: payload.mode || 'fast',
      trackCount: payload.trackCount ?? null,
      perfCount: payload.perfCount ?? null,
    },
  })

  await prisma.video.update({
    where: { id: video.id },
    data: {
      syncStatus: 'failed',
      transcriptStage: 'browser_failed',
      lastError: errorMessage,
    },
  })

  return {
    youtubeId: payload.youtubeId,
    error: errorMessage,
    errorPath,
  }
}

async function handleStats() {
  const [
    transcriptCovered,
    noTranscript,
    transcriptTotal,
    browserRecovered,
    ytDlpRecovered,
    asrRecovered,
    unresolvedTerminal,
    pendingByStage,
  ] = await Promise.all([
    prisma.video.count({ where: { transcripts: { some: {} } } }),
    prisma.video.count({ where: { transcripts: { none: {} } } }),
    prisma.transcript.count(),
    prisma.transcript.count({ where: { source: 'browser_network_timedtext' } }),
    prisma.transcript.count({ where: { source: 'yt_dlp_subtitle' } }),
    prisma.transcript.count({ where: { source: 'openai_audio' } }),
    prisma.video.count({
      where: {
        transcripts: { none: {} },
        transcriptStage: 'terminal',
      },
    }),
    prisma.video.groupBy({
      by: ['transcriptStage'],
      _count: { _all: true },
      orderBy: { transcriptStage: 'asc' },
    }),
  ])

  return {
    transcriptCovered,
    noTranscript,
    transcriptTotal,
    browserRecovered,
    ytDlpRecovered,
    asrRecovered,
    unresolvedTerminal,
    pendingByStage: Object.fromEntries(
      pendingByStage.map((group) => [group.transcriptStage, group._count._all])
    ),
  }
}

const server = createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url || '/', `http://${HOST}:${PORT}`)

    if (request.method === 'OPTIONS') {
      sendText(response, 204, '')
      return
    }

    if (request.method === 'GET' && requestUrl.pathname === '/health') {
      sendJson(response, 200, { ok: true })
      return
    }

    if (request.method === 'GET' && requestUrl.pathname === '/stats') {
      sendJson(response, 200, await handleStats())
      return
    }

    if (request.method === 'GET' && requestUrl.pathname === '/next') {
      const limit = normalizeBatchSize(requestUrl.searchParams.get('limit'))
      const mode = normalizeMode(requestUrl.searchParams.get('mode'))
      sendJson(response, 200, await claimNextVideos(limit, mode))
      return
    }

    if (request.method === 'POST' && requestUrl.pathname === '/ingest') {
      sendJson(response, 200, await handleIngest(await readJsonBody<IngestPayload>(request)))
      return
    }

    if (request.method === 'POST' && requestUrl.pathname === '/mark-failed') {
      sendJson(response, 200, await handleFailed(await readJsonBody<FailedPayload>(request)))
      return
    }

    sendText(response, 404, 'not found')
  } catch (error) {
    sendJson(response, 500, {
      error: error instanceof Error ? error.message : String(error),
    })
  }
})

server.listen(PORT, HOST, () => {
  console.log(`browser-transcript-bridge listening on http://${HOST}:${PORT}`)
})

async function shutdown() {
  server.close(async () => {
    await prisma.$disconnect()
    process.exit(0)
  })
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
