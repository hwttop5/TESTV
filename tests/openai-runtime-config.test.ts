import { afterEach, describe, expect, it, vi } from 'vitest'

const originalEnv = { ...process.env }

afterEach(() => {
  vi.restoreAllMocks()
  vi.resetModules()
  vi.unstubAllGlobals()
  process.env = { ...originalEnv }
})

describe('openai runtime config privacy defaults', () => {
  it('uses only explicit environment keys by default', async () => {
    process.env.OPENAI_API_KEY = 'test-openai-key'
    process.env.OPENAI_MODEL = 'gpt-4o-mini'
    delete process.env.USE_CODEX_MANAGER_OPENAI

    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)

    const { resolveOpenAiRuntimeConfigs } = await import('../lib/openai-runtime-config')
    const configs = await resolveOpenAiRuntimeConfigs({ testConnection: true })

    expect(configs).toHaveLength(1)
    expect(configs[0]).toMatchObject({
      apiKey: 'test-openai-key',
      model: 'gpt-4o-mini',
      source: 'env',
      label: 'env OPENAI_API_KEY',
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not probe local Codex Manager secrets unless explicitly enabled', async () => {
    delete process.env.OPENAI_API_KEY
    delete process.env.USE_CODEX_MANAGER_OPENAI

    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)

    const { resolveOpenAiRuntimeConfigs } = await import('../lib/openai-runtime-config')
    const configs = await resolveOpenAiRuntimeConfigs({ testConnection: true })

    expect(configs).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })
})