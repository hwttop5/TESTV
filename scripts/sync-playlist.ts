import 'dotenv/config'
import { execFile } from 'child_process'
import path from 'path'
import { promisify } from 'util'
import { prisma } from '../lib/prisma'
import { resolvePlaylistId, YouTubeClient, type YouTubeVideo } from '../lib/youtube'

const execFileAsync = promisify(execFile)

interface YtDlpPlaylist {
  entries?: YtDlpEntry[]
  playlist_count?: number
}

interface YtDlpEntry {
  id?: string
  title?: string
  url?: string
  timestamp?: number | null
  upload_date?: string | null
  thumbnails?: Array<{
    url?: string
    width?: number
    height?: number
  }>
}

interface YoutubeiPlaylist {
  playlistCount?: number
  entries?: YouTubeVideo[]
}

function isPlaceholder(value: string | undefined): boolean {
  return !value || /your_|placeholder|here/i.test(value)
}

function playlistUrlFromId(playlistId: string): string {
  return `https://www.youtube.com/playlist?list=${playlistId}`
}

function bestThumbnail(entry: YtDlpEntry): string {
  const best = (entry.thumbnails || [])
    .filter((thumbnail) => thumbnail.url)
    .sort((a, b) => ((b.width || 0) * (b.height || 0)) - ((a.width || 0) * (a.height || 0)))[0]

  return best?.url || (entry.id ? `https://i.ytimg.com/vi/${entry.id}/hqdefault.jpg` : '')
}

function readYtDlpDate(entry: YtDlpEntry, existingDate?: Date): Date {
  if (entry.timestamp) {
    return new Date(entry.timestamp * 1000)
  }

  if (entry.upload_date && /^\d{8}$/.test(entry.upload_date)) {
    const year = entry.upload_date.slice(0, 4)
    const month = entry.upload_date.slice(4, 6)
    const day = entry.upload_date.slice(6, 8)
    return new Date(`${year}-${month}-${day}T00:00:00Z`)
  }

  return existingDate || new Date(0)
}

async function getPlaylistVideosViaYtDlp(playlistUrl: string): Promise<YouTubeVideo[]> {
  const ytDlpBin = process.env.YTDLP_BIN
  const command = ytDlpBin || 'python'
  const args = ytDlpBin
    ? ['--flat-playlist', '--dump-single-json', playlistUrl]
    : ['-m', 'yt_dlp', '--flat-playlist', '--dump-single-json', playlistUrl]

  console.log('Using yt-dlp playlist fallback...')
  const { stdout } = await execFileAsync(command, args, {
    maxBuffer: 1024 * 1024 * 80,
    timeout: 10 * 60 * 1000,
  })

  const parsed = JSON.parse(stdout) as YtDlpPlaylist
  const entries = parsed.entries || []
  console.log(`yt-dlp reported playlist count: ${parsed.playlist_count ?? entries.length}`)

  return entries.flatMap((entry) => {
    if (!entry.id) return []
    const title = entry.title || 'Untitled YouTube video'
    const isAvailable = title !== 'Deleted video' && title !== 'Private video'

    return [{
      id: entry.id,
      title,
      publishedAt: readYtDlpDate(entry).toISOString(),
      thumbnailUrl: bestThumbnail(entry),
      videoUrl: entry.url || `https://www.youtube.com/watch?v=${entry.id}`,
      isAvailable,
      ...(isAvailable ? {} : { unavailableReason: title === 'Deleted video' ? 'deleted' : 'private' }),
    }]
  })
}

async function getPlaylistVideosViaYoutubei(playlistUrl: string): Promise<YouTubeVideo[]> {
  const scriptPath = path.join(process.cwd(), 'scripts', 'fetch-playlist-youtubei.py')

  console.log('Using YouTube web pagination fallback...')
  const { stdout } = await execFileAsync('python', [scriptPath, playlistUrl], {
    maxBuffer: 1024 * 1024 * 80,
    timeout: 10 * 60 * 1000,
  })

  const parsed = JSON.parse(stdout) as YoutubeiPlaylist
  const entries = parsed.entries || []
  console.log(`YouTube page reported playlist count: ${parsed.playlistCount ?? 'unknown'}`)
  console.log(`YouTube page returned available videos: ${entries.length}`)
  return entries
}

async function syncPlaylist() {
  const apiKey = process.env.YOUTUBE_API_KEY
  const playlistId = resolvePlaylistId({
    playlistId: process.env.YOUTUBE_PLAYLIST_ID,
    playlistUrl: process.env.YOUTUBE_PLAYLIST_URL,
  })

  if (!apiKey || !playlistId) {
    console.error('Missing YOUTUBE_API_KEY and playlist configuration')
    console.error('Set YOUTUBE_PLAYLIST_ID or YOUTUBE_PLAYLIST_URL')
    process.exit(1)
  }

  console.log('Starting playlist sync...')
  console.log(`Playlist ID: ${playlistId}`)

  try {
    const playlistUrl = process.env.YOUTUBE_PLAYLIST_URL || playlistUrlFromId(playlistId)
    const videos = isPlaceholder(apiKey)
      ? await getPlaylistVideosViaYoutubei(playlistUrl).catch(async (error) => {
          console.warn(`YouTube web pagination fallback failed: ${error instanceof Error ? error.message : String(error)}`)
          return getPlaylistVideosViaYtDlp(playlistUrl)
        })
      : await new YouTubeClient(apiKey).getPlaylistVideos(playlistId)

    console.log(`Found ${videos.length} videos in playlist`)

    let newCount = 0
    let updatedCount = 0
    let unavailableCount = 0

    for (const video of videos) {
      const existing = await prisma.video.findUnique({
        where: { youtubeId: video.id },
        include: {
          product: true,
        },
      })

      const publishedAt = video.publishedAt === new Date(0).toISOString() && existing?.publishedAt
        ? existing.publishedAt
        : new Date(video.publishedAt)

      const videoData = {
        title: video.title,
        publishedAt,
        thumbnailUrl: video.thumbnailUrl,
        videoUrl: video.videoUrl,
        isAvailable: video.isAvailable,
        unavailableReason: video.unavailableReason || null,
        // Mark as failed if unavailable, keep existing status if already processed
        syncStatus: !video.isAvailable ? 'failed' : (existing?.syncStatus || 'pending'),
        lastError: !video.isAvailable
          ? `Video unavailable: ${video.unavailableReason || 'unknown reason'}`
          : (existing?.lastError || null),
      }

      if (!video.isAvailable) {
        unavailableCount++
      }

      if (existing) {
        await prisma.video.update({
          where: { youtubeId: video.id },
          data: videoData,
        })
        updatedCount++
      } else {
        await prisma.video.create({
          data: {
            youtubeId: video.id,
            ...videoData,
          },
        })
        newCount++
      }
    }

    console.log(`\nSync complete:`)
    console.log(`  ${newCount} new videos`)
    console.log(`  ${updatedCount} updated videos`)
    console.log(`  ${unavailableCount} unavailable videos (marked as failed)`)
    console.log(`  Total in playlist: ${videos.length}`)
  } catch (error) {
    console.error('Playlist sync failed:', error)
    process.exit(1)
  }
}

syncPlaylist()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
