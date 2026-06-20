/* eslint-disable @typescript-eslint/no-unused-expressions */
async (page) => {
  const bridge = 'http://127.0.0.1:34567'
  const mode = 'fast'
  const limit = 10
  const parallelism = 4
  const maxElapsedMs = 120000
  const startedAt = Date.now()

  const context = page.context()
  const claimPage = await context.newPage()
  await claimPage.goto(`${bridge}/health`, { waitUntil: 'load', timeout: 30000 })

  const getJson = async (bridgePage, url) => {
    await bridgePage.goto(url, { waitUntil: 'load', timeout: 30000 })
    return JSON.parse(await bridgePage.locator('body').innerText())
  }

  const postJson = async (bridgePage, url, payload) => {
    return await bridgePage.evaluate(async ({ target, body }) => {
      const response = await fetch(target, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      return await response.json()
    }, { target: url, body: payload })
  }

  const batch = await getJson(claimPage, `${bridge}/next?limit=${limit}&mode=${mode}`)
  await claimPage.close().catch(() => {})

  const groups = Array.from({ length: parallelism }, () => [])
  batch.forEach((video, index) => {
    groups[index % parallelism].push(video)
  })

  async function prepareWorkerPage(workerPage) {
    await workerPage.route('**/*', async (route) => {
      const request = route.request()
      const url = request.url()
      const type = request.resourceType()

      if (['image', 'font'].includes(type)) {
        await route.abort()
        return
      }

      if (/doubleclick|pagead|googlesyndication|googleads|adsystem/i.test(url)) {
        await route.abort()
        return
      }

      await route.continue()
    })
  }

  async function collectCandidates(workerPage) {
    return await workerPage.evaluate(() => {
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
        const list = [{
          source: 'baseUrl',
          lang: track.languageCode || null,
          kind: track.kind || null,
          url: track.baseUrl,
        }]
        if (!track.baseUrl.includes('fmt=')) {
          list.push({
            source: 'baseUrl+fmt',
            lang: track.languageCode || null,
            kind: track.kind || null,
            url: `${track.baseUrl}&fmt=json3`,
          })
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

  async function tryFetchCandidate(workerPage, candidates) {
    return await workerPage.evaluate(async (items) => {
      for (const item of items) {
        try {
          const response = await fetch(item.url, { credentials: 'include' })
          const text = await response.text()
          if (!response.ok) {
            return {
              ok: false,
              status: response.status,
              length: text.length,
            }
          }
          if (!text) {
            return {
              ok: false,
              status: response.status,
              length: 0,
            }
          }

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
              language: item.lang || 'unknown',
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

  async function processVideo(workerPage, bridgePage, video, workerIndex) {
    if (Date.now() - startedAt > maxElapsedMs) {
      return {
        youtubeId: video.youtubeId,
        title: video.title,
        ok: false,
        skipped: true,
        worker: workerIndex,
        error: 'stopped_before_timeout_budget',
      }
    }

    const item = {
      youtubeId: video.youtubeId,
      title: video.title,
      ok: false,
      worker: workerIndex,
    }

    try {
      await workerPage.goto(`https://www.youtube.com/watch?v=${video.youtubeId}`, {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
      })
      await workerPage.waitForTimeout(1800)

      let meta = await collectCandidates(workerPage)
      let fetched = await tryFetchCandidate(workerPage, meta.candidates)

      if (!fetched.ok) {
        await workerPage.waitForTimeout(900)
        meta = await collectCandidates(workerPage)
        fetched = await tryFetchCandidate(workerPage, meta.candidates)
      }

      if (!fetched.ok) {
        await workerPage.keyboard.press('c').catch(() => {})
        await workerPage.waitForTimeout(700)
        meta = await collectCandidates(workerPage)
        fetched = await tryFetchCandidate(workerPage, meta.candidates)
      }

      if (fetched.ok) {
        const ingest = await postJson(bridgePage, `${bridge}/ingest`, {
          youtubeId: video.youtubeId,
          title: video.title,
          language: fetched.language,
          requestUrl: fetched.requestUrl,
          raw: fetched.raw,
          mode,
          events: fetched.events,
        })

        item.ok = true
        item.events = fetched.events
        item.length = fetched.length
        item.source = fetched.source
        item.trackCount = meta.trackCount
        item.perfCount = meta.perfCount
        item.ingest = ingest
      } else {
        const emptyResponse =
          typeof fetched.status === 'number' && fetched.status === 200 && fetched.length === 0
            ? `timedtext fetch failed status=${fetched.status} length=${fetched.length}`
            : `no_nonempty_timedtext trackCount=${meta.trackCount} perfCount=${meta.perfCount}`

        await postJson(bridgePage, `${bridge}/mark-failed`, {
          youtubeId: video.youtubeId,
          error: emptyResponse,
          mode,
          trackCount: meta.trackCount,
          perfCount: meta.perfCount,
        })
        item.error = emptyResponse
        item.trackCount = meta.trackCount
        item.perfCount = meta.perfCount
      }
    } catch (error) {
      const message = String(error)
      try {
        await postJson(bridgePage, `${bridge}/mark-failed`, {
          youtubeId: video.youtubeId,
          error: message,
          mode,
        })
      } catch {}
      item.error = message
    }

    await workerPage.waitForTimeout(150)
    return item
  }

  const workerPages = []
  const bridgePages = []

  try {
    for (let i = 0; i < parallelism; i += 1) {
      const workerPage = await context.newPage()
      const bridgePage = await context.newPage()
      await prepareWorkerPage(workerPage)
      await bridgePage.goto(`${bridge}/health`, { waitUntil: 'load', timeout: 30000 })
      workerPages.push(workerPage)
      bridgePages.push(bridgePage)
    }

    const groupResults = await Promise.all(groups.map(async (videos, workerIndex) => {
      const workerPage = workerPages[workerIndex]
      const bridgePage = bridgePages[workerIndex]
      const items = []

      for (const video of videos) {
        items.push(await processVideo(workerPage, bridgePage, video, workerIndex))
      }

      return items
    }))

    const results = groupResults.flat()

    const statsPage = await context.newPage()
    await statsPage.goto(`${bridge}/stats`, { waitUntil: 'load', timeout: 30000 })
    const stats = JSON.parse(await statsPage.locator('body').innerText())
    await statsPage.close().catch(() => {})

    return {
      requested: batch.length,
      mode,
      success: results.filter((item) => item.ok).length,
      failed: results.filter((item) => !item.ok && !item.skipped).length,
      skipped: results.filter((item) => item.skipped).length,
      elapsedMs: Date.now() - startedAt,
      results,
      stats,
    }
  } finally {
    await Promise.all(workerPages.map((workerPage) => workerPage.close().catch(() => {})))
    await Promise.all(bridgePages.map((bridgePage) => bridgePage.close().catch(() => {})))
  }
}
