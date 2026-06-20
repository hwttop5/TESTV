const BROWSER_FAILURE_PATTERNS = [
  'no_nonempty_timedtext',
  'timedtext fetch failed status=200 length=0',
  'No data found for resource with given identifier',
  'no usable timedtext url',
]

const YTDLP_FAILURE_PATTERNS = [
  'yt-dlp subtitle unavailable or empty',
  '娌℃湁鎷垮埌鍏紑瀛楀箷',
  '鏆傛棤瀛楀箷',
]

const RECOVERABLE_LOCAL_ASR_PATTERNS = [
  'Unexpected token',
  'No supported JavaScript runtime',
  'Sign in to confirm',
  'not a bot',
  'youtube-cookies.txt',
  'cookies are no longer valid',
  'Use --cookies-from-browser',
]

const TERMINAL_LOCAL_ASR_PATTERNS = [
  'SSL: UNEXPECTED_EOF_WHILE_READING',
  'local faster-whisper returned empty text',
  'yt-dlp did not produce an audio file',
]

export function isBrowserTranscriptFailure(lastError: string | null | undefined): boolean {
  if (!lastError) return false
  return BROWSER_FAILURE_PATTERNS.some((pattern) => lastError.includes(pattern))
}

export function isYtDlpSubtitleFailure(lastError: string | null | undefined): boolean {
  if (!lastError) return false
  return YTDLP_FAILURE_PATTERNS.some((pattern) => lastError.includes(pattern))
}

export function isRecoverableLocalAsrError(lastError: string | null | undefined): boolean {
  if (!lastError) return false
  return RECOVERABLE_LOCAL_ASR_PATTERNS.some((pattern) => lastError.includes(pattern))
}

export function isTerminalLocalAsrError(lastError: string | null | undefined): boolean {
  if (!lastError) return false
  return TERMINAL_LOCAL_ASR_PATTERNS.some((pattern) => lastError.includes(pattern))
}

export function shouldRetryLocalAsrError(
  lastError: string | null | undefined,
  attemptCount: number,
  maxRecoverableAttempts: number
): boolean {
  if (!isRecoverableLocalAsrError(lastError)) {
    return false
  }

  return attemptCount < Math.max(1, maxRecoverableAttempts)
}

export function resolveLocalAsrFailureStage(options: {
  lastError: string | null | undefined
  attemptCount: number
  maxRecoverableAttempts: number
  markTerminal: boolean
}): 'asr_failed' | 'terminal' {
  const { lastError, attemptCount, maxRecoverableAttempts, markTerminal } = options

  if (!markTerminal) {
    return 'asr_failed'
  }

  if (shouldRetryLocalAsrError(lastError, attemptCount, maxRecoverableAttempts)) {
    return 'asr_failed'
  }

  return 'terminal'
}
