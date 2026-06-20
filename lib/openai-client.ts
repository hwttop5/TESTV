export interface OpenAiClientOptions {
  apiKey: string
  baseUrl?: string
}

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '')
}

export function resolveOpenAiBaseUrl(baseUrl?: string): string {
  const configured = (baseUrl || process.env.OPENAI_BASE_URL || process.env.OPENAI_API_BASE_URL || '').trim()
  if (!configured) {
    return 'https://api.openai.com'
  }

  return trimTrailingSlashes(configured)
}

export function buildOpenAiUrl(pathname: string, baseUrl?: string): string {
  const normalizedBaseUrl = resolveOpenAiBaseUrl(baseUrl)
  const normalizedPath = pathname.startsWith('/') ? pathname : `/${pathname}`

  if (normalizedBaseUrl.endsWith('/v1') && normalizedPath.startsWith('/v1/')) {
    return `${normalizedBaseUrl}${normalizedPath.slice(3)}`
  }

  return `${normalizedBaseUrl}${normalizedPath}`
}

export function buildOpenAiHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    'x-api-key': apiKey,
    'api-key': apiKey,
  }
}
