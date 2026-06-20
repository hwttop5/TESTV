/* eslint-disable @typescript-eslint/no-unused-expressions */
async (page) => {
  const bridge = 'http://127.0.0.1:34567'
  const limit = 10
  const maxElapsedMs = 90000
  const startedAt = Date.now()

  const bridgePage = await page.context().newPage()
  await bridgePage.goto(`${bridge}/health`, { waitUntil: 'load', timeout: 30000 })

  const getJson = async (url) => {
    await bridgePage.goto(url, { waitUntil: 'load', timeout: 30000 })
    return JSON.parse(await bridgePage.locator('body').innerText())
  }

  const postJson = async (url, payload) => {
    return await bridgePage.evaluate(async ({ target, body }) => {
      const response = await fetch(target, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      return await response.json()
    }, { target: url, body: payload })
  }

  const batch = await getJson(`${bridge}/next?limit=${limit}`)

  async function collectCandidates() {
    return await page.evaluate(() => {
      const tracks = window.ytInitialPlayerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks || []
      const perf = performance
        .getEntriesByType('resource')
        .map((entry) => entry.name)
        .filter((name) => name.includes('/api/timedtext'))

      const perfCandidates = perf
        .map((url) => ({ source: 'performance', lang: null, kind: null, url }))
        .sort((a, b) => {
          const aScore = (a.url.includes('pot=') ? 2 : 0) + (a.url.includes('fmt=json3') ? 1 : 0)
          const bScore = (b.url.includes('pot=') ? 2 : 0) + (b.url.includes('fmt=json3') ? 1 : 0)
          return bScore - aScore
        })

      const trackCandidates = tracks.flatMap((track) => {
        if (!track?.baseUrl) return []
        const list = [{ source: 'baseUrl', lang: track.languageCode || null, kind: track.kind || null, url: track.baseUrl }]
        if (!track.baseUrl.includes('fmt=')) {
          list.push({ source: 'baseUrl+fmt', lang: track.languageCode || null, kind: track.kind || null, url: `${track.baseUrl}&fmt=json3` })
        }
        return list
      })

      const candidates = [...perfCandidates, ...trackCandidates]
      const unique = []
      const seen = new Set()
      for (const item of candidates) {
        if (!item.url || seen.has(item.url)) continue
        seen.add(item.url)
        unique.push(item)
      }
      return {
        title: document.title,
        trackCount: tracks.length,
        perfCount: perf.length,
        candidates: unique.slice(0, 12),
      }
    })
  }

  async function tryFetchCandidate(candidates) {
    return await page.evaluate(async (items) => {
      for (const item of items) {
        try {
          const response = await fetch(item.url, { credentials: 'include' })
          const text = await response.text()
          if (!response.ok || !text) continue
          let parsed = null
          try {
            parsed = JSON.parse(text)
          } catch {
            continue
          }
          const events = Array.isArray(parsed?.events) ? parsed.events.length : 0
          if (events > 0) {
            return {
              ok: true,
              language: item.lang || 'zh',
              requestUrl: item.url,
              source: item.source,
              raw: text,
              events,
              length: text.length,
            }
          }
        } catch {}
      }
      return { ok: false }
    }, candidates)
  }

  const results = []
  for (const video of batch) {
    if (Date.now() - startedAt > maxElapsedMs) {
      results.push({
        youtubeId: video.youtubeId,
        title: video.title,
        ok: false,
        skipped: true,
        error: 'stopped_before_timeout_budget',
      })
      continue
    }

    const item = { youtubeId: video.youtubeId, title: video.title, ok: false }
    try {
      await page.goto(`https://www.youtube.com/watch?v=${video.youtubeId}`, { waitUntil: 'domcontentloaded', timeout: 60000 })
      await page.waitForTimeout(1600)

      let meta = await collectCandidates()
      let fetched = await tryFetchCandidate(meta.candidates)

      if (!fetched.ok) {
        await page.waitForTimeout(900)
        meta = await collectCandidates()
        fetched = await tryFetchCandidate(meta.candidates)
      }

      if (!fetched.ok) {
        await page.keyboard.press('c').catch(() => {})
        await page.waitForTimeout(600)
        meta = await collectCandidates()
        fetched = await tryFetchCandidate(meta.candidates)
      }

      if (fetched.ok) {
        const ingestBody = await postJson(`${bridge}/ingest`, {
          youtubeId: video.youtubeId,
          title: video.title,
          language: fetched.language,
          requestUrl: fetched.requestUrl,
          raw: fetched.raw,
        })
        item.ok = true
        item.events = fetched.events
        item.length = fetched.length
        item.source = fetched.source
        item.trackCount = meta.trackCount
        item.perfCount = meta.perfCount
        item.ingest = ingestBody
      } else {
        const error = `no_nonempty_timedtext trackCount=${meta.trackCount} perfCount=${meta.perfCount}`
        await postJson(`${bridge}/mark-failed`, { youtubeId: video.youtubeId, error })
        item.error = error
        item.trackCount = meta.trackCount
        item.perfCount = meta.perfCount
      }
    } catch (error) {
      const message = String(error)
      try {
        await postJson(`${bridge}/mark-failed`, { youtubeId: video.youtubeId, error: message })
      } catch {}
      item.error = message
    }
    results.push(item)
    await page.waitForTimeout(250)
  }

  const stats = await getJson(`${bridge}/stats`)
  await bridgePage.close().catch(() => {})
  return {
    requested: batch.length,
    success: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    skipped: results.filter((r) => r.skipped).length,
    elapsedMs: Date.now() - startedAt,
    results,
    stats,
  }
}
