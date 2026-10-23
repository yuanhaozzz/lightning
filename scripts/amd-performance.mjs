import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

// Lab measurements, not a Lighthouse score, hardware-device test, or GPU FPS test.
// AMD_PERF_LABEL=baseline|final; AMD_URL can select a production preview server.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const url = process.env.AMD_URL || 'http://127.0.0.1:5190/map/amd'
const label = process.env.AMD_PERF_LABEL || 'sample'
if (!/^[a-z0-9_-]+$/i.test(label)) throw new Error('AMD_PERF_LABEL must be a filename-safe label')
const output = path.resolve('tmp/amd-performance')
await mkdir(output, { recursive: true })
const browser = await chromium.launch({
  channel: process.env.AMD_BROWSER_CHANNEL || 'msedge',
  headless: true,
})
const report = {
  label,
  url,
  date: new Date().toISOString(),
  browser: await browser.version(),
  hostCpu: os.cpus()[0]?.model,
  methodology: {
    cache:
      'New browser context per profile; CDP browser cache disabled; localhost production preview.',
    metrics:
      'PerformanceObserver paint/LCP/layout-shift/longtask; CDP Network.loadingFinished encoded transfer bytes; CDP JS heap; DOM MutationObserver readiness.',
    cadence:
      'requestAnimationFrame callback intervals during visible hero and actual chapter scroll/selection. This is presentation scheduling cadence, not WebGL GPU render FPS.',
    limits:
      'Single-run local lab samples. CPU/network emulation is not real mobile hardware; no GPU utilization measurement; LCP observed before first interaction; CLS uses maximum session-window score. Browser/OS caches outside HTTP cache can be warm. Full load is sampled after scene readiness plus five seconds.',
  },
  profiles: [],
}
const profiles = [
  { name: 'desktop', viewport: { width: 1440, height: 1000 }, dpr: 1, cpuRate: 1 },
  {
    name: 'mobile-simulated',
    viewport: { width: 390, height: 844 },
    dpr: 2,
    cpuRate: 4,
    network: { latency: 150, downloadThroughput: 200000, uploadThroughput: 93750 },
  },
]
async function cadence(page, duration = 4000, scrollTarget = null) {
  return page.evaluate(
    async ({ duration, scrollTarget }) => {
      const intervals = []
      let previous
      const start = performance.now()
      const initialScroll = scrollY
      await new Promise((resolve) => {
        const frame = (timestamp) => {
          if (previous !== undefined) intervals.push(timestamp - previous)
          previous = timestamp
          const ratio = Math.min(1, (performance.now() - start) / duration)
          if (scrollTarget !== null)
            scrollTo({
              top: initialScroll + (scrollTarget - initialScroll) * ratio,
              behavior: 'instant',
            })
          if (ratio < 1) requestAnimationFrame(frame)
          else resolve()
        }
        requestAnimationFrame(frame)
      })
      const sorted = [...intervals].sort((a, b) => a - b)
      const percentile = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]
      const sum = intervals.reduce((total, value) => total + value, 0)
      return {
        samples: intervals.length,
        elapsedMs: performance.now() - start,
        meanIntervalMs: sum / intervals.length,
        medianIntervalMs: percentile(0.5),
        p95IntervalMs: percentile(0.95),
        callbacksPerSecond: (1000 * intervals.length) / sum,
        intervalsOver50ms: intervals.filter((n) => n > 50).length,
        documentVisibility: document.visibilityState,
        scrollY,
      }
    },
    { duration, scrollTarget },
  )
}
try {
  for (const profile of profiles) {
    const context = await browser.newContext({
      viewport: profile.viewport,
      deviceScaleFactor: profile.dpr,
      isMobile: profile.name.startsWith('mobile'),
      hasTouch: profile.name.startsWith('mobile'),
    })
    const page = await context.newPage()
    page.setDefaultTimeout(45000)
    const session = await context.newCDPSession(page)
    await session.send('Network.enable')
    await session.send('Network.setCacheDisabled', { cacheDisabled: true })
    await session.send('Emulation.setCPUThrottlingRate', { rate: profile.cpuRate })
    if (profile.network)
      await session.send('Network.emulateNetworkConditions', {
        offline: false,
        ...profile.network,
        connectionType: 'cellular3g',
      })
    const entry = { ...profile, errors: [], failedRequests: [], consoleWarnings: [], resources: [] }
    report.profiles.push(entry)
    const requests = new Map()
    session.on('Network.requestWillBeSent', (event) =>
      requests.set(event.requestId, { url: event.request.url, type: event.type }),
    )
    session.on('Network.loadingFinished', (event) =>
      entry.resources.push({
        ...requests.get(event.requestId),
        encodedDataLength: event.encodedDataLength,
      }),
    )
    page.on('pageerror', (error) => entry.errors.push(error.message))
    page.on('requestfailed', (request) =>
      entry.failedRequests.push({ url: request.url(), error: request.failure()?.errorText }),
    )
    page.on('console', (message) => {
      if (message.type() === 'warning') entry.consoleWarnings.push(message.text())
    })
    await page.addInitScript(() => {
      const data = (window.__amdLab = {
        paints: [],
        lcp: [],
        shifts: [],
        longTasks: [],
        marks: {},
        supported: PerformanceObserver.supportedEntryTypes,
      })
      performance.setResourceTimingBufferSize(1000)
      for (const type of ['paint', 'largest-contentful-paint', 'layout-shift', 'longtask']) {
        if (!data.supported.includes(type)) continue
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (type === 'paint') data.paints.push(entry.toJSON())
            if (type === 'largest-contentful-paint')
              data.lcp.push({
                startTime: entry.startTime,
                size: entry.size,
                element: entry.element
                  ? `${entry.element.tagName}.${entry.element.className}`
                  : null,
                url: entry.url,
              })
            if (type === 'layout-shift')
              data.shifts.push({
                startTime: entry.startTime,
                value: entry.value,
                hadRecentInput: entry.hadRecentInput,
              })
            if (type === 'longtask')
              data.longTasks.push({
                startTime: entry.startTime,
                duration: entry.duration,
                name: entry.name,
              })
          }
        }).observe({ type, buffered: true })
      }
      const inspect = () => {
        if (!data.marks.headingDomMs && document.querySelector('h1')?.textContent.trim())
          data.marks.headingDomMs = performance.now()
        if (
          !data.marks.canvasAttachedMs &&
          document.querySelector('.hero-visual .processor-canvas')
        )
          data.marks.canvasAttachedMs = performance.now()
        const status = document.querySelector('.scene-status')?.textContent || ''
        if (!data.marks.sceneReadyStatusMs && status.includes('移动指针'))
          data.marks.sceneReadyStatusMs = performance.now()
      }
      new MutationObserver(inspect).observe(document, {
        childList: true,
        subtree: true,
        characterData: true,
      })
      document.addEventListener('DOMContentLoaded', inspect)
    })
    console.log(`${label}: starting ${profile.name}`)
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
      await page.locator('h1').waitFor()
      await page.waitForFunction(() => Boolean(window.__amdLab.marks.sceneReadyStatusMs), null, {
        timeout: 60000,
      })
      // Allow any font and post-mount layout changes to settle before freezing initial-load metrics.
      await page.waitForTimeout(5000)
      entry.initial = await page.evaluate(() => {
        const data = structuredClone(window.__amdLab)
        const shifts = data.shifts.filter((shift) => !shift.hadRecentInput)
        let largest = 0,
          current = 0,
          start = 0,
          previous = 0
        for (const shift of shifts) {
          if (shift.startTime - previous > 1000 || shift.startTime - start > 5000) {
            current = 0
            start = shift.startTime
          }
          current += shift.value
          largest = Math.max(largest, current)
          previous = shift.startTime
        }
        const canvas = document.querySelector('.hero-visual .processor-canvas')
        const gl = canvas?.getContext('webgl2')
        const extension = gl?.getExtension('WEBGL_debug_renderer_info')
        return {
          observedAtMs: performance.now(),
          marks: data.marks,
          paints: data.paints,
          lcp: data.lcp.at(-1) || null,
          cls: largest,
          shifts: data.shifts,
          longTasks: data.longTasks,
          totalLongTaskDurationMs: data.longTasks.reduce((sum, task) => sum + task.duration, 0),
          estimatedBlockingAfterFcpMs: data.longTasks
            .filter(
              (task) =>
                task.startTime >=
                (data.paints.find((paint) => paint.name === 'first-contentful-paint')?.startTime ||
                  0),
            )
            .reduce((sum, task) => sum + Math.max(0, task.duration - 50), 0),
          navigation: performance.getEntriesByType('navigation')[0]?.toJSON(),
          resources: performance.getEntriesByType('resource').map((resource) => ({
            name: resource.name,
            initiatorType: resource.initiatorType,
            startTime: resource.startTime,
            duration: resource.duration,
            transferSize: resource.transferSize,
            encodedBodySize: resource.encodedBodySize,
            decodedBodySize: resource.decodedBodySize,
          })),
          renderer: extension
            ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL)
            : gl?.getParameter(gl.RENDERER),
          canvasSize: canvas ? { width: canvas.width, height: canvas.height } : null,
          heroBounds: document.querySelector('.hero-visual')?.getBoundingClientRect().toJSON(),
          title: document.title,
          heading: document.querySelector('h1')?.textContent,
        }
      })
      entry.initialNetwork = {
        completedRequests: entry.resources.length,
        encodedTransferBytes: entry.resources.reduce(
          (sum, resource) => sum + resource.encodedDataLength,
          0,
        ),
      }
      entry.initialHeap = await session.send('Runtime.getHeapUsage')
      const hero = page.locator('.hero-visual')
      await hero.scrollIntoViewIfNeeded()
      entry.heroCadence = await cadence(page)
      await page.locator('#anatomy-tab-layers').click()
      await page.waitForFunction(
        () => document.querySelector('#architecture')?.dataset.chapter === 'layers',
      )
      await page.locator('.anatomy-viewer .processor-canvas').waitFor()
      await page.waitForTimeout(1000)
      if (profile.name === 'desktop') {
        const target = await page
          .locator('#architecture')
          .evaluate(
            (el) =>
              el.getBoundingClientRect().top +
              scrollY -
              82 +
              (el.offsetHeight - el.querySelector('.anatomy-stage').offsetHeight),
          )
        entry.chapterCadence = await cadence(page, 4000, target)
      } else {
        await page.locator('.anatomy-viewer').scrollIntoViewIfNeeded()
        entry.chapterCadence = await cadence(page)
      }
      entry.endHeap = await session.send('Runtime.getHeapUsage')
      entry.complete = true
      console.log(
        JSON.stringify({
          profile: entry.name,
          fcpMs: entry.initial.paints.find((p) => p.name === 'first-contentful-paint')?.startTime,
          lcpMs: entry.initial.lcp?.startTime,
          cls: entry.initial.cls,
          marks: entry.initial.marks,
          longTasksMs: entry.initial.totalLongTaskDurationMs,
          initialTransferBytes: entry.initialNetwork.encodedTransferBytes,
          renderer: entry.initial.renderer,
          heroCadence: entry.heroCadence,
          chapterCadence: entry.chapterCadence,
        }),
      )
    } catch (error) {
      entry.complete = false
      entry.failure = error.stack
      console.error(`${profile.name}: ${error.message}`)
    } finally {
      await context.close()
      await writeFile(path.join(output, `${label}.json`), JSON.stringify(report, null, 2))
    }
  }
} finally {
  await browser.close()
  await writeFile(path.join(output, `${label}.json`), JSON.stringify(report, null, 2))
}
if (report.profiles.some((profile) => !profile.complete)) process.exitCode = 1
