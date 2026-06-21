import path from 'node:path'
import { buildOpenAiHeaders, buildOpenAiUrl } from './openai-client'

export interface OpenAiRuntimeConfig {
  apiKey: string
  baseUrl?: string
  model: string
  source: 'env' | 'codex-manager'
  label: string
}

interface CodexManagerCandidate {
  id: string
  supplierName: string
  url: string
  secretValue: string
  models: string[]
  lastTestStatus: string | null
  sort: number | null
}

type SQLiteDatabase = {
  prepare(sql: string): {
    all(...params: unknown[]): unknown[]
  }
  close(): void
}

function isUsableOpenAiKey(value: string | undefined): boolean {
  if (!value) return false
  const trimmed = value.trim()
  return trimmed.length > 0 && !/your_|placeholder|here/i.test(trimmed)
}

function normalizeBaseUrl(value: string | null | undefined): string | undefined {
  const trimmed = (value || '').trim()
  return trimmed || undefined
}

function resolveModel(value: string | null | undefined): string {
  return (value || process.env.AI_BACKFILL_MODEL || process.env.OPENAI_MODEL || 'gpt-5.4-mini').trim()
}

function candidateModelList(candidateModels: string[]): string[] {
  const configured = [
    process.env.AI_BACKFILL_MODEL,
    process.env.OPENAI_MODEL,
  ].flatMap((value) => (value || '').split(','))
    .map((value) => value.trim())
    .filter(Boolean)

  const preferred = [
    'gpt-5.4-mini',
    'gpt-5.2',
    'gpt-5.4',
    'gpt-5.5',
    'gpt-5.3-codex',
    'gpt-4o-mini',
    'gpt-4o',
  ]

  return [...new Set([
    ...configured,
    ...preferred,
    ...candidateModels,
  ])]
}

async function loadNodeSqlite(): Promise<{
  DatabaseSync: new (filename: string, options?: { readOnly?: boolean }) => SQLiteDatabase
} | null> {
  try {
    const dynamicImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<{
      DatabaseSync: new (filename: string, options?: { readOnly?: boolean }) => SQLiteDatabase
    }>
    return await dynamicImport('node:sqlite')
  } catch {
    return null
  }
}

async function readCodexManagerCandidates(limit: number): Promise<CodexManagerCandidate[]> {
  const sqlite = await loadNodeSqlite()
  if (!sqlite) return []

  const appData = process.env.APPDATA
  if (!appData) return []

  const dbPath = path.join(appData, 'com.codexmanager.desktop', 'codexmanager.db')
  let db: SQLiteDatabase | null = null

  try {
    db = new sqlite.DatabaseSync(dbPath, { readOnly: true })
    const rows = db.prepare(`
      select
        a.id,
        a.supplier_name as supplierName,
        a.url,
        a.last_test_status as lastTestStatus,
        a.sort,
        s.secret_value as secretValue
      from aggregate_apis a
      join aggregate_api_secrets s on s.aggregate_api_id = a.id
      where a.status = 'active'
        and s.secret_value is not null
        and length(s.secret_value) > 0
      order by
        case when a.last_test_status = 'success' then 0 else 1 end,
        a.sort asc,
        a.updated_at desc
      limit ?
    `).all(limit)

    return rows.flatMap((row) => {
      const record = row as Partial<CodexManagerCandidate>
      if (!record.id || !record.supplierName || !record.url || !record.secretValue) return []
      const modelRows = db!.prepare(`
        select upstream_model as model
        from aggregate_api_supplier_models
        where supplier_key = ?
          and status = 'active'
        order by updated_at desc
        limit 20
      `).all(record.id) as Array<{ model?: string }>
      return [{
        id: record.id,
        supplierName: record.supplierName,
        url: record.url,
        secretValue: record.secretValue,
        models: modelRows.map((modelRow) => modelRow.model || '').filter(Boolean),
        lastTestStatus: record.lastTestStatus ?? null,
        sort: record.sort ?? null,
      }]
    })
  } catch {
    return []
  } finally {
    db?.close()
  }
}

async function testConfig(config: OpenAiRuntimeConfig): Promise<boolean> {
  if (process.env.AI_BACKFILL_TEST_CONFIG === 'false') return true
  const timeoutMs = Number.parseInt(process.env.AI_BACKFILL_CONFIG_TEST_TIMEOUT_MS || '8000', 10)

  try {
    const response = await fetch(buildOpenAiUrl('/v1/chat/completions', config.baseUrl), {
      method: 'POST',
      headers: {
        ...buildOpenAiHeaders(config.apiKey),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0,
        max_tokens: 8,
        messages: [
          { role: 'user', content: '只回复“好”。' },
        ],
      }),
      signal: AbortSignal.timeout(Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 8000),
    })

    return response.ok
  } catch {
    return false
  }
}

export async function resolveOpenAiRuntimeConfig(options: {
  testConnection?: boolean
  codexManagerCandidateLimit?: number
} = {}): Promise<OpenAiRuntimeConfig | null> {
  const configs = await resolveOpenAiRuntimeConfigs(options)
  return configs[0] ?? null
}

export async function resolveOpenAiRuntimeConfigs(options: {
  testConnection?: boolean
  codexManagerCandidateLimit?: number
} = {}): Promise<OpenAiRuntimeConfig[]> {
  const configs: OpenAiRuntimeConfig[] = []
  const envApiKey = (process.env.OPENAI_API_KEY || '').trim()
  const envConfig: OpenAiRuntimeConfig | null = isUsableOpenAiKey(envApiKey)
    ? {
        apiKey: envApiKey,
        baseUrl: normalizeBaseUrl(process.env.OPENAI_BASE_URL || process.env.OPENAI_API_BASE_URL),
        model: resolveModel(process.env.OPENAI_MODEL),
        source: 'env',
        label: 'env OPENAI_API_KEY',
      }
    : null

  if (envConfig && (!options.testConnection || await testConfig(envConfig))) {
    configs.push(envConfig)
  }

  if (process.env.USE_CODEX_MANAGER_OPENAI !== 'true') {
    return configs
  }

  const candidates = await readCodexManagerCandidates(options.codexManagerCandidateLimit ?? 10)
  for (const candidate of candidates) {
    for (const model of candidateModelList(candidate.models)) {
      const config: OpenAiRuntimeConfig = {
        apiKey: candidate.secretValue,
        baseUrl: normalizeBaseUrl(candidate.url),
        model: resolveModel(model),
        source: 'codex-manager',
        label: `Codex Manager: ${candidate.supplierName}`,
      }

      if (!options.testConnection || await testConfig(config)) {
        configs.push(config)
        break
      }
    }
  }

  const seen = new Set<string>()
  return configs.filter((config) => {
    const key = `${config.baseUrl || ''}|${config.apiKey.slice(0, 12)}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).sort((left, right) => {
    if (left.source !== right.source) {
      return left.source === 'env' ? -1 : 1
    }

    return left.label.localeCompare(right.label, 'zh-Hans-CN')
  })
}
