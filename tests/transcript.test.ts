import { describe, expect, it, vi } from 'vitest'
import {
  getTranscriptForVideo,
  isUsableOpenAiKey,
  parseJson3Subtitle,
  type TranscriptFetchResult,
} from '../lib/transcript'
import { classifyTranscriptQuality, getTranscriptArtifactPaths } from '../lib/transcript-pipeline'

function buildTranscript(source: string): TranscriptFetchResult {
  return {
    content: `${source} transcript`,
    language: 'zh',
    source,
    segments: [
      { text: `${source} line 1`, start: 0, duration: 1 },
      { text: `${source} line 2`, start: 1, duration: 1 },
      { text: `${source} line 3`, start: 2, duration: 1 },
      { text: `${source} line 4`, start: 3, duration: 1 },
    ],
  }
}

describe('transcript parsing', () => {
  it('parses json3 subtitles into transcript segments', () => {
    const result = parseJson3Subtitle(JSON.stringify({
      events: [
        {
          tStartMs: 0,
          dDurationMs: 1200,
          segs: [{ utf8: '你好' }],
        },
        {
          tStartMs: 1200,
          dDurationMs: 800,
          segs: [{ utf8: '世界' }],
        },
      ],
    }))

    expect(result).not.toBeNull()
    expect(result?.content).toBe('你好 世界')
    expect(result?.segments).toHaveLength(2)
  })

  it('returns null for empty json3 subtitles', () => {
    const result = parseJson3Subtitle(JSON.stringify({
      events: [{ segs: [] }],
    }))

    expect(result).toBeNull()
  })
})

describe('transcript fallback order', () => {
  it('uses public transcript before yt-dlp and ASR by default', async () => {
    const publicFetcher = vi.fn().mockResolvedValue(buildTranscript('public'))
    const ytDlpFetcher = vi.fn().mockResolvedValue(buildTranscript('yt-dlp'))
    const audioTranscriber = vi.fn().mockResolvedValue(buildTranscript('audio'))

    const result = await getTranscriptForVideo(
      'video-1',
      {
        audioFallbackEnabled: true,
        openAiApiKey: 'sk-real',
      },
      { publicFetcher, ytDlpFetcher, audioTranscriber }
    )

    expect(result?.source).toBe('public')
    expect(publicFetcher).toHaveBeenCalledTimes(1)
    expect(ytDlpFetcher).not.toHaveBeenCalled()
    expect(audioTranscriber).not.toHaveBeenCalled()
  })

  it('uses yt-dlp before public transcript when preferYtDlpSubtitles is enabled', async () => {
    const publicFetcher = vi.fn().mockResolvedValue(buildTranscript('public'))
    const ytDlpFetcher = vi.fn().mockResolvedValue(buildTranscript('yt-dlp'))

    const result = await getTranscriptForVideo(
      'video-2',
      {
        preferYtDlpSubtitles: true,
      },
      { publicFetcher, ytDlpFetcher }
    )

    expect(result?.source).toBe('yt-dlp')
    expect(ytDlpFetcher).toHaveBeenCalledTimes(1)
    expect(publicFetcher).not.toHaveBeenCalled()
  })

  it('does not call ASR when the OpenAI key is unusable', async () => {
    const publicFetcher = vi.fn().mockResolvedValue(null)
    const ytDlpFetcher = vi.fn().mockResolvedValue(null)
    const audioTranscriber = vi.fn().mockResolvedValue(buildTranscript('audio'))

    const result = await getTranscriptForVideo(
      'video-3',
      {
        audioFallbackEnabled: true,
        openAiApiKey: 'your_openai_api_key_here',
      },
      { publicFetcher, ytDlpFetcher, audioTranscriber }
    )

    expect(result).toBeNull()
    expect(audioTranscriber).not.toHaveBeenCalled()
  })

  it('passes the configured OpenAI base URL to ASR fallback', async () => {
    const publicFetcher = vi.fn().mockResolvedValue(null)
    const ytDlpFetcher = vi.fn().mockResolvedValue(null)
    const audioTranscriber = vi.fn().mockResolvedValue(buildTranscript('audio'))

    const result = await getTranscriptForVideo(
      'video-4',
      {
        audioFallbackEnabled: true,
        openAiApiKey: 'sk-real',
        openAiBaseUrl: 'https://kapibala.asia',
      },
      { publicFetcher, ytDlpFetcher, audioTranscriber }
    )

    expect(result?.source).toBe('audio')
    expect(audioTranscriber).toHaveBeenCalledWith(
      'video-4',
      expect.objectContaining({
        apiKey: 'sk-real',
        baseUrl: 'https://kapibala.asia',
      })
    )
  })
})

describe('transcript pipeline helpers', () => {
  it('marks very short transcripts as short quality', () => {
    const quality = classifyTranscriptQuality({
      content: '短字幕',
      segments: [{ text: '短字幕', start: 0, duration: 1 }],
    })

    expect(quality).toBe('short')
  })

  it('builds artifact paths from transcript source', () => {
    expect(getTranscriptArtifactPaths('abc123', 'browser_network_timedtext').responsePath)
      .toContain('data\\browser-transcripts\\abc123.response.json')
    expect(getTranscriptArtifactPaths('abc123', 'yt_dlp_subtitle').responsePath)
      .toContain('data\\ytdlp-transcripts\\abc123.response.json')
    expect(getTranscriptArtifactPaths('abc123', 'bilibili_subtitle').responsePath)
      .toContain('data\\bilibili-transcripts\\abc123.response.json')
    expect(getTranscriptArtifactPaths('abc123', 'openai_audio').responsePath)
      .toContain('data\\asr-transcripts\\abc123.response.json')
    expect(getTranscriptArtifactPaths('abc123', 'local_faster_whisper').responsePath)
      .toContain('data\\asr-transcripts\\abc123.response.json')
  })

  it('validates usable OpenAI keys', () => {
    expect(isUsableOpenAiKey('your_openai_api_key_here')).toBe(false)
    expect(isUsableOpenAiKey('sk-live')).toBe(true)
  })
})
