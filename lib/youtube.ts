import axios, { type AxiosResponse } from 'axios'

const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3'

export interface YouTubeVideo {
  id: string
  title: string
  publishedAt: string
  thumbnailUrl: string
  videoUrl: string
  isAvailable: boolean
  unavailableReason?: string
}

export interface YouTubeTranscript {
  text: string
  start: number
  duration: number
}

export function resolvePlaylistId(input: {
  playlistId?: string
  playlistUrl?: string
}): string | null {
  const rawUrl = input.playlistUrl?.trim()
  if (rawUrl) {
    try {
      const url = new URL(rawUrl)
      const list = url.searchParams.get('list')?.trim()
      if (list) return list
    } catch {
      const match = rawUrl.match(/[?&]list=([^&]+)/)
      if (match?.[1]) return decodeURIComponent(match[1]).trim()
    }
  }

  return input.playlistId?.trim() || null
}

interface PlaylistItemsResponse {
  items?: Array<{
    snippet?: {
      title?: string
      publishedAt?: string
      thumbnails?: {
        high?: { url?: string }
        medium?: { url?: string }
        default?: { url?: string }
      }
      videoOwnerChannelTitle?: string
    }
    contentDetails?: {
      videoId?: string
      videoPublishedAt?: string
    }
    status?: {
      privacyStatus?: string
    }
  }>
  nextPageToken?: string
}

export class YouTubeClient {
  private apiKey: string

  constructor(apiKey: string) {
    this.apiKey = apiKey
  }

  async getPlaylistVideos(playlistId: string, maxResults = 50): Promise<YouTubeVideo[]> {
    const videos: YouTubeVideo[] = []
    let pageToken: string | undefined = undefined

    do {
      const response: AxiosResponse<PlaylistItemsResponse> = await axios.get(`${YOUTUBE_API_BASE}/playlistItems`, {
        params: {
          key: this.apiKey,
          playlistId,
          part: 'snippet,contentDetails,status',
          maxResults,
          pageToken,
        },
      })

      const items = response.data.items || []
      for (const item of items) {
        const snippet = item.snippet
        const contentDetails = item.contentDetails
        const videoId = contentDetails?.videoId

        if (!videoId) continue

        // Use videoPublishedAt (actual video upload date) instead of item publishedAt (date added to playlist)
        const publishedAt = contentDetails?.videoPublishedAt || snippet?.publishedAt

        if (!publishedAt) continue

        // Check if video is available
        const title = snippet?.title || ''
        const privacyStatus = item.status?.privacyStatus

        let isAvailable = true
        let unavailableReason: string | undefined

        // Detect various unavailable states
        if (title === 'Deleted video' || title === 'Private video') {
          isAvailable = false
          unavailableReason = title === 'Deleted video' ? 'deleted' : 'private'
        } else if (privacyStatus === 'private' || privacyStatus === 'privacyStatusUnspecified') {
          isAvailable = false
          unavailableReason = 'private'
        }

        videos.push({
          id: videoId,
          title: title || 'Untitled YouTube video',
          publishedAt,
          thumbnailUrl: snippet?.thumbnails?.high?.url || snippet?.thumbnails?.medium?.url || snippet?.thumbnails?.default?.url || '',
          videoUrl: `https://www.youtube.com/watch?v=${videoId}`,
          isAvailable,
          unavailableReason,
        })
      }

      pageToken = response.data.nextPageToken
    } while (pageToken)

    return videos
  }

  async getCaptions(videoId: string): Promise<string | null> {
    try {
      // Note: This requires OAuth2 authentication and video owner permissions
      // For now, we return null and rely on public transcripts or fallback methods
      return null
    } catch (error) {
      console.error(`Failed to get captions for video ${videoId}:`, error)
      return null
    }
  }
}
