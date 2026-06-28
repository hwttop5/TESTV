import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('PWA service worker cache strategy', () => {
  const source = readFileSync(path.join(process.cwd(), 'public', 'sw.js'), 'utf8')

  it('uses the new cache namespace and claims existing clients', () => {
    expect(source).toContain("const CACHE_NAME = 'review-board-v3'")
    expect(source).toContain('self.clients.claim()')
  })

  it('keeps dynamic API and RSC requests out of the app shell cache', () => {
    expect(source).toContain("url.pathname.startsWith('/api/')")
    expect(source).toContain("request.headers.get('rsc') === '1'")
    expect(source).toContain("request.headers.get('next-router-prefetch') === '1'")
    expect(source).toContain("url.searchParams.has('_rsc')")
  })

  it('serves navigations from cache first and refreshes them in the background', () => {
    expect(source).toContain("url.pathname.startsWith('/_next/static/')")
    expect(source).toContain("request.mode === 'navigate'")
    expect(source).toContain('event.waitUntil(refresh)')
    expect(source).toContain('return cached')
  })
})
