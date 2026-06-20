'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  clearInstallPromptDismissal,
  getSafeLocalStorage,
  isInstallPromptCoolingDown,
  rememberInstallPromptDismissal,
} from '@/lib/pwa-install'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

declare global {
  interface Navigator {
    standalone?: boolean
  }

  interface Window {
    MSStream?: unknown
  }
}

function detectIsIOS(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream
}

function detectIsStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true
}

export default function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [dismissed, setDismissed] = useState(false)

  const isIOS = useMemo(() => {
    if (typeof window === 'undefined') return false
    return detectIsIOS()
  }, [])

  const isStandalone = useMemo(() => {
    if (typeof window === 'undefined') return false
    return detectIsStandalone()
  }, [])

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js', {
        scope: '/',
        updateViaCache: 'none',
      }).catch((err) => {
        console.error('SW registration failed:', err)
      })
    }

    const handler = (event: Event) => {
      const promptEvent = event as BeforeInstallPromptEvent
      promptEvent.preventDefault()
      setDeferredPrompt(promptEvent)
    }

    window.addEventListener('beforeinstallprompt', handler)

    return () => {
      window.removeEventListener('beforeinstallprompt', handler)
    }
  }, [])

  async function handleInstall() {
    if (!deferredPrompt) return

    await deferredPrompt.prompt()
    const result = await deferredPrompt.userChoice

    if (result.outcome === 'accepted') {
      setDismissed(true)
      clearInstallPromptDismissal(getSafeLocalStorage())
    }

    setDeferredPrompt(null)
  }

  function handleDismiss() {
    setDismissed(true)
    rememberInstallPromptDismissal({ storage: getSafeLocalStorage() })
  }

  const coolingDown = isInstallPromptCoolingDown({ storage: getSafeLocalStorage() })
  const showInstall = !isStandalone && !dismissed && !coolingDown && (isIOS || deferredPrompt !== null)

  if (!showInstall) return null

  return (
    <div className="fixed bottom-4 left-0 right-0 z-50 px-4">
      <div className="animate-slide-up mx-auto flex max-w-6xl items-start justify-between gap-4 rounded-card border border-brand/30 bg-white/95 p-4 shadow-card backdrop-blur dark:border-brand/40 dark:bg-stone-900/95">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control border border-brand/30 bg-brand text-sm font-semibold tracking-[0.08em] text-white">
            TV
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">安装 TESTV</p>
            <p className="mt-1 text-xs leading-relaxed text-foreground/60 dark:text-stone-400">
              {isIOS
                ? '点击分享按钮，然后选择“添加到主屏幕”'
                : '安装到桌面，快速查看评分、分类和详情页。'}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {!isIOS && deferredPrompt && (
            <button
              onClick={handleInstall}
              className="rounded-control bg-brand px-4 py-2.5 text-sm font-medium text-white transition hover:bg-brand-strong"
            >
              安装
            </button>
          )}
          <button
            onClick={handleDismiss}
            className="rounded-control border border-foreground/15 bg-white px-3 py-2.5 text-sm font-medium text-foreground/70 transition hover:border-foreground/30 dark:border-stone-600 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  )
}
