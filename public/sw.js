const CACHE_NAME = 'review-board-v2'

// Install: skip waiting so new SW activates immediately
self.addEventListener('install', () => {
  self.skipWaiting()
})

// Activate: clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME)
          .map((k) => caches.delete(k))
      )
    )
  )
})

// Fetch: Network First strategy — prefer network, fall back to cache on failure
self.addEventListener('fetch', (event) => {
  const { request } = event

  // Skip non-GET requests
  if (request.method !== 'GET') return

  const url = new URL(request.url)

  // Skip API routes (dynamic data, always fresh)
  if (url.pathname.startsWith('/api/')) return

  // Skip Next.js internal endpoints
  if (url.pathname.startsWith('/_next/')) return

  // Skip manifest / icons (handled by browser)
  if (url.pathname === '/manifest.webmanifest' || url.pathname.startsWith('/icon')) return

  event.respondWith(
    fetch(request)
      .then((response) => {
        // Cache successful responses
        if (response.ok || response.type === 'opaqueredirect') {
          const clone = response.clone()
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, clone)
          })
        }
        return response
      })
      .catch(() => {
        // Offline: try cache
        return caches.match(request).then((cached) => {
          if (cached) return cached
          // If page navigation and no cache, show minimal offline page
          if (request.mode === 'navigate') {
            return new Response(
              '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>离线</title><style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#fafaf9;color:#1c1917;text-align:center;padding:2rem}h1{font-size:1.5rem;margin-bottom:.5rem}p{color:#78716c}</style></head><body><div><h1>当前无网络连接</h1><p>请检查网络后刷新页面</p></div></body></html>',
              { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
            )
          }
          return new Response('Offline', { status: 503 })
        })
      })
  )
})
