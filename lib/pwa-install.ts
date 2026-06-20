export const INSTALL_PROMPT_DISMISSED_AT_KEY = 'testv.installPrompt.dismissedAt'
export const INSTALL_PROMPT_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000

interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

function readTimestamp(value: string | null): number | null {
  if (!value) return null

  const timestamp = Number.parseInt(value, 10)
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : null
}

export function isInstallPromptCoolingDown(options: {
  storage?: StorageLike | null
  now?: number
  cooldownMs?: number
} = {}): boolean {
  const storage = options.storage
  if (!storage) return false

  try {
    const dismissedAt = readTimestamp(storage.getItem(INSTALL_PROMPT_DISMISSED_AT_KEY))
    if (!dismissedAt) return false

    const now = options.now ?? Date.now()
    const cooldownMs = options.cooldownMs ?? INSTALL_PROMPT_COOLDOWN_MS

    return now - dismissedAt < cooldownMs
  } catch {
    return false
  }
}

export function rememberInstallPromptDismissal(options: {
  storage?: StorageLike | null
  now?: number
} = {}): void {
  const storage = options.storage
  if (!storage) return

  try {
    storage.setItem(INSTALL_PROMPT_DISMISSED_AT_KEY, String(options.now ?? Date.now()))
  } catch {
    // Storage can be unavailable in private mode or strict browser settings.
  }
}

export function clearInstallPromptDismissal(storage?: StorageLike | null): void {
  if (!storage) return

  try {
    storage.removeItem(INSTALL_PROMPT_DISMISSED_AT_KEY)
  } catch {
    // Ignore unavailable storage.
  }
}

export function getSafeLocalStorage(): StorageLike | null {
  if (typeof window === 'undefined') return null

  try {
    return window.localStorage
  } catch {
    return null
  }
}
