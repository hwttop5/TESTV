import { existsSync } from 'node:fs'
import path from 'node:path'

export interface YtDlpOptions {
  ytDlpBin?: string
  ytDlpCookiesFile?: string
  ytDlpCookiesFromBrowser?: string
  ytDlpJsRuntimes?: string
  ytDlpRemoteComponents?: string
}

export function getYtDlpCommand(ytDlpBin?: string): {
  command: string
  args: string[]
} {
  if (ytDlpBin) {
    return {
      command: ytDlpBin,
      args: [],
    }
  }

  return {
    command: 'python',
    args: ['-m', 'yt_dlp'],
  }
}

export function resolveYtDlpCookiesFile(
  configuredPath?: string,
  allowFallback = true
): string | undefined {
  if (configuredPath?.trim()) {
    return configuredPath.trim()
  }

  if (!allowFallback) {
    return undefined
  }

  const fallback = path.join(process.cwd(), 'youtube-cookies.txt')
  return existsSync(fallback) ? fallback : undefined
}

export function appendYtDlpOptions(args: string[], options: YtDlpOptions): void {
  const cookiesFile = resolveYtDlpCookiesFile(
    options.ytDlpCookiesFile,
    !options.ytDlpCookiesFromBrowser
  )
  if (cookiesFile) {
    args.push('--cookies', cookiesFile)
  }

  if (options.ytDlpCookiesFromBrowser) {
    args.push('--cookies-from-browser', options.ytDlpCookiesFromBrowser)
  }

  if (options.ytDlpJsRuntimes) {
    args.push('--js-runtimes', options.ytDlpJsRuntimes)
  }

  if (options.ytDlpRemoteComponents) {
    args.push('--remote-components', options.ytDlpRemoteComponents)
  }
}
