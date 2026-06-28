const CACHE_NAME = 'review-board-v3'

const OFFLINE_HTML = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>离线</title><style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#fafaf9;color:#1c1917;text-align:center;padding:2rem}h1{font-size:1.5rem;margin-bottom:.5rem}p{color:#78716c}</style></head><body><div><h1>当前无网络连接</h1><p>请检查网络后刷新页面</p></div></body></html>'

// Install: skip waiting so new SW activates immediately.
self.addEventListener('install', () => {
  self.skipWaiting()
})

// Activate: clean up old caches and take control of existing PWA windows.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      caches.keys().then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      ),
      self.clients.claim(),
    ]),
  )
})

function isSameOrigin(url) {
  return url.origin === self.location.origin
}

function isRscRequest(request, url) {
  return (
    request.headers.get('rsc') === '1' ||
    request.headers.get('next-router-prefetch') === '1' ||
    request.headers.get('accept')?.includes('text/x-component') ||
    url.searchParams.has('_rsc')
  )
}

function shouldSkipRequest(request, url) {
  if (request.method !== 'GET') return true
  if (!isSameOrigin(url)) return true
  if (url.pathname.startsWith('/api/')) return true
  return isRscRequest(request, url)
}

function isStaticAsset(url) {
  return (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname === '/manifest.webmanifest' ||
    url.pathname === '/favicon.ico' ||
    url.pathname === '/apple-icon' ||
    url.pathname.startsWith('/icon')
  )
}

function canCacheResponse(response) {
  return response && (response.ok || response.type === 'opaqueredirect')
}

async function fetchAndCache(request) {
  const response = await fetch(request)

  if (canCacheResponse(response)) {
    const cache = await caches.open(CACHE_NAME)
    await cache.put(request, response.clone())
  }

  return response
}

async function cacheFirst(request) {
  const cached = await caches.match(request)
  if (cached) return cached
  return fetchAndCache(request)
}

async function navigationResponse(event) {
  const { request } = event
  const cached = await caches.match(request)
  const refresh = fetchAndCache(request).catch(() => null)

  if (cached) {
    event.waitUntil(refresh)
    return cached
  }

  const response = await refresh
  if (response) return response

  return new Response(OFFLINE_HTML, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)

  if (shouldSkipRequest(request, url)) return

  if (request.mode === 'navigate') {
    event.respondWith(navigationResponse(event))
    return
  }

  if (isStaticAsset(url)) {
    event.respondWith(cacheFirst(request))
  }
})
