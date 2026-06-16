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

export function appendYtDlpOptions(args: string[], options: YtDlpOptions): void {
  if (options.ytDlpCookiesFile) {
    args.push('--cookies', options.ytDlpCookiesFile)
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
