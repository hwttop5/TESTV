import { describe, expect, it } from 'vitest'
import {
  isBrowserTranscriptFailure,
  isRecoverableLocalAsrError,
  isTerminalLocalAsrError,
  isYtDlpSubtitleFailure,
  resolveLocalAsrFailureStage,
  shouldRetryLocalAsrError,
} from '../lib/transcript-errors'

describe('transcript error helpers', () => {
  it('detects browser timedtext failures', () => {
    expect(isBrowserTranscriptFailure('no_nonempty_timedtext trackCount=0 perfCount=0')).toBe(true)
    expect(isBrowserTranscriptFailure('timedtext fetch failed status=200 length=0')).toBe(true)
    expect(isBrowserTranscriptFailure('bilibili subtitle unavailable or empty')).toBe(false)
  })

  it('detects yt-dlp subtitle failures without swallowing ASR errors', () => {
    expect(isYtDlpSubtitleFailure('yt-dlp subtitle unavailable or empty')).toBe(true)
    expect(isYtDlpSubtitleFailure('audio download failed for abc123')).toBe(false)
  })

  it('keeps only a narrow set of local ASR failures recoverable', () => {
    expect(isRecoverableLocalAsrError("Unexpected token '�'")).toBe(true)
    expect(isRecoverableLocalAsrError('No supported JavaScript runtime could be found')).toBe(true)
    expect(isRecoverableLocalAsrError('Sign in to confirm you are not a bot')).toBe(true)
    expect(isRecoverableLocalAsrError('audio download failed: SSL: UNEXPECTED_EOF_WHILE_READING')).toBe(false)
    expect(isRecoverableLocalAsrError('local faster-whisper returned empty text')).toBe(false)
  })

  it('recognizes terminal local ASR failures', () => {
    expect(isTerminalLocalAsrError('audio download failed: SSL: UNEXPECTED_EOF_WHILE_READING')).toBe(true)
    expect(isTerminalLocalAsrError('local faster-whisper returned empty text')).toBe(true)
    expect(isTerminalLocalAsrError('Unexpected token')).toBe(false)
  })

  it('retries recoverable local ASR failures only up to the configured limit', () => {
    expect(shouldRetryLocalAsrError('Unexpected token', 1, 3)).toBe(true)
    expect(shouldRetryLocalAsrError('Unexpected token', 3, 3)).toBe(false)
    expect(shouldRetryLocalAsrError('audio download failed: SSL: UNEXPECTED_EOF_WHILE_READING', 1, 3)).toBe(false)
  })

  it('marks hard local ASR failures terminal', () => {
    expect(
      resolveLocalAsrFailureStage({
        lastError: 'audio download failed: SSL: UNEXPECTED_EOF_WHILE_READING',
        attemptCount: 1,
        maxRecoverableAttempts: 3,
        markTerminal: true,
      })
    ).toBe('terminal')

    expect(
      resolveLocalAsrFailureStage({
        lastError: 'Unexpected token',
        attemptCount: 1,
        maxRecoverableAttempts: 3,
        markTerminal: true,
      })
    ).toBe('asr_failed')

    expect(
      resolveLocalAsrFailureStage({
        lastError: 'Unexpected token',
        attemptCount: 3,
        maxRecoverableAttempts: 3,
        markTerminal: true,
      })
    ).toBe('terminal')
  })
})
