import { describe, expect, it } from 'vitest'
import {
  INSTALL_PROMPT_COOLDOWN_MS,
  INSTALL_PROMPT_DISMISSED_AT_KEY,
  clearInstallPromptDismissal,
  getSafeLocalStorage,
  isInstallPromptCoolingDown,
  rememberInstallPromptDismissal,
} from '../lib/pwa-install'

function createStorage() {
  const data = new Map<string, string>()

  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value)
    },
    removeItem: (key: string) => {
      data.delete(key)
    },
    data,
  }
}

describe('PWA install prompt cooldown', () => {
  it('shows when there is no dismissal record', () => {
    expect(isInstallPromptCoolingDown({ storage: createStorage(), now: 1000 })).toBe(false)
  })

  it('hides during the seven day cooldown', () => {
    const storage = createStorage()
    rememberInstallPromptDismissal({ storage, now: 10_000 })

    expect(isInstallPromptCoolingDown({
      storage,
      now: 10_000 + INSTALL_PROMPT_COOLDOWN_MS - 1,
    })).toBe(true)
  })

  it('shows after the cooldown expires', () => {
    const storage = createStorage()
    storage.setItem(INSTALL_PROMPT_DISMISSED_AT_KEY, '10000')

    expect(isInstallPromptCoolingDown({
      storage,
      now: 10_000 + INSTALL_PROMPT_COOLDOWN_MS + 1,
    })).toBe(false)
  })

  it('does not throw when storage is unavailable', () => {
    const storage = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
      removeItem: () => {
        throw new Error('blocked')
      },
    }

    expect(isInstallPromptCoolingDown({ storage })).toBe(false)
    expect(() => rememberInstallPromptDismissal({ storage })).not.toThrow()
    expect(() => clearInstallPromptDismissal(storage)).not.toThrow()
  })

  it('returns null when localStorage cannot be accessed', () => {
    const originalWindow = globalThis.window

    Object.defineProperty(globalThis, 'window', {
      value: {
        get localStorage() {
          throw new Error('blocked')
        },
      },
      configurable: true,
    })

    expect(getSafeLocalStorage()).toBeNull()

    Object.defineProperty(globalThis, 'window', {
      value: originalWindow,
      configurable: true,
    })
  })
})
