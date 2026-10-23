// Use an existing Playwright installation; this QA helper does not change app dependencies.
const { chromium } = await import(
  process.env.AEROTWIN_PLAYWRIGHT_MODULE ||
    'file:///C:/Users/1/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
)
import { mkdir, writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import os from 'node:os'
const mode = process.argv[2] || 'calibration'
const base = process.env.AEROTWIN_URL || 'http://127.0.0.1:5176/map/aerotwin'
const output = 'docs/screenshots/v0.1'
await mkdir(output, { recursive: true })
const browser = await chromium.launch({
  executablePath:
    process.env.AEROTWIN_BROWSER_PATH ||
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
  args: ['--no-first-run', '--disable-features=msEdgeSidebarV2'],
})
try {
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
  })
  await context.addInitScript(() => {
    const pending = new Set(),
      request = window.requestAnimationFrame.bind(window),
      cancel = window.cancelAnimationFrame.bind(window)
    window.__airportPendingFrames = pending
    window.requestAnimationFrame = (callback) => {
      let id = request((time) => {
        pending.delete(id)
        callback(time)
      })
      pending.add(id)
      return id
    }
    window.cancelAnimationFrame = (id) => {
      pending.delete(id)
      cancel(id)
    }
  })
  const page = await context.newPage()
  const errors = [],
    requests = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('response', (response) => {
    if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`)
  })
  page.on('request', (request) => requests.push(request.url()))
  const url = mode === 'calibration' ? `${base}?calibration=1` : base
  await page.goto(url, { waitUntil: 'networkidle', timeout: 120000 })
  await page.waitForFunction(() => window.__aerotwin?.getSnapshot().ready, {}, { timeout: 120000 })
  await page.waitForTimeout(2000)
  const snapshot = () => page.evaluate(() => window.__aerotwin.getSnapshot())
  const report = {
    date: new Date().toISOString(),
    url,
    browser: await browser.version(),
    device: {
      cpu: os.cpus()[0]?.model,
      logicalCores: os.cpus().length,
      totalMemoryGiB: os.totalmem() / 1024 ** 3,
      os: `${os.type()} ${os.release()} ${os.arch()}`,
    },
    screenshots: [],
    errors,
    requests: requests.filter((u) => /models|cesium|App\.vue|features/i.test(u)),
    results: {},
  }
  if (mode === 'calibration') {
    report.results.calibration = await snapshot()
    assert.deepEqual(report.results.calibration.calibrationCube, [1, 1, 1])
    assert.deepEqual(report.results.calibration.up, [0, 1, 0])
    await page.screenshot({ path: `${output}/00-calibration-1920.png` })
    report.screenshots.push({
      path: '00-calibration-1920.png',
      preset: 'calibration',
      size: [1920, 1080],
    })
  } else if (mode === 'preview') {
    report.results.overview = await snapshot()
    const size = report.results.overview.assetBounds.aircraft.size
    for (const [index, expected] of [35.8, 11.76, 37.57].entries())
      assert.ok(Math.abs(size[index] - expected) < 0.001)
    assert.equal(
      requests.some((u) => /\/src\/App\.vue|\/cesium\//i.test(u)),
      false,
      'Airport route must not initialize legacy scene',
    )
    await page.screenshot({ path: `${output}/preview.png` })
  } else {
    report.results.overview = await snapshot()
    const size = report.results.overview.assetBounds.aircraft.size
    for (const [index, expected] of [35.8, 11.76, 37.57].entries())
      assert.ok(Math.abs(size[index] - expected) < 0.001)
    assert.equal(
      requests.some((u) => /\/src\/App\.vue|\/cesium\//i.test(u)),
      false,
      'Airport route must not initialize legacy scene',
    )
    await page.screenshot({ path: `${output}/01-overview-1920.png` })
    report.screenshots.push({
      path: '01-overview-1920.png',
      preset: 'overview',
      size: [1920, 1080],
    })
    for (const [label, preset, file] of [
      ['飞机', 'aircraft', '02-aircraft-1920.png'],
      ['廊桥', 'bridge', '03-bridge-1920.png'],
    ]) {
      await page.getByRole('button', { name: label, exact: true }).click()
      await page.waitForTimeout(1600)
      report.results[preset] = await snapshot()
      await page.screenshot({ path: `${output}/${file}` })
      report.screenshots.push({ path: file, preset, size: [1920, 1080] })
    }
    await page.getByRole('button', { name: '隐藏面板', exact: true }).click()
    await page.getByText('当前航班', { exact: true }).waitFor({ state: 'hidden' })
    assert.equal(await page.getByText('当前航班', { exact: true }).isVisible(), false)
    await page.getByRole('button', { name: '显示面板', exact: true }).click()
    assert.equal(await page.getByText('当前航班', { exact: true }).isVisible(), true)
    report.results.panelRestore = true
    for (const name of ['保障作业', '运行回放'])
      assert.equal(await page.getByRole('button', { name, exact: true }).isDisabled(), true)
    await page.locator('.airport-disabled-nav').first().hover()
    assert.equal(
      await page.locator('.airport-disabled-nav').first().getByRole('tooltip').isVisible(),
      true,
    )
    report.results.futureNavigationDisabled = true
    await page.getByRole('button', { name: '复位', exact: true }).click()
    await page.waitForTimeout(1600)
    const before = await snapshot()
    await page.getByText('当前航班', { exact: true }).hover()
    await page.mouse.wheel(0, 350)
    await page.waitForTimeout(300)
    const after = await snapshot()
    assert.deepEqual(after.camera, before.camera, 'UI wheel must not zoom scene')
    report.results.uiWheelIsolated = true
    await page.getByRole('button', { name: '飞机', exact: true }).click()
    await page.waitForTimeout(180)
    await page.mouse.move(960, 600)
    await page.mouse.down()
    await page.mouse.move(1120, 620, { steps: 12 })
    await page.mouse.up()
    assert.equal((await snapshot()).transitioning, false)
    report.results.manualInterruptsTransition = true
    const orbitFrames = []
    for (let i = 0; i < 90; i++) {
      await page.mouse.move(1100 + Math.sin(i / 20) * 120, 630 + Math.cos(i / 20) * 35)
      if (i === 0) await page.mouse.down()
      await page.waitForTimeout(16)
      if (i % 30 === 0) orbitFrames.push(await snapshot())
    }
    await page.mouse.up()
    report.results.orbit = await snapshot()
    report.results.orbitSamples = orbitFrames
    await page.getByRole('button', { name: '复位', exact: true }).click()
    await page.waitForTimeout(1400)
    await page.setViewportSize({ width: 1366, height: 768 })
    await page.waitForTimeout(600)
    assert.equal(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth > innerWidth ||
          document.documentElement.scrollHeight > innerHeight,
      ),
      false,
    )
    await page.screenshot({ path: `${output}/04-overview-1366.png` })
    report.screenshots.push({ path: '04-overview-1366.png', preset: 'overview', size: [1366, 768] })
    report.results.compact = await snapshot()
    // Vue unmount must dispose the scene, canvas, controls and render loop.
    await page.evaluate(() => document.querySelector('#app').__vue_app__.unmount())
    await page.waitForTimeout(300)
    const disposed = await page.evaluate(() => ({
      canvasCount: document.querySelectorAll('.airport-scene canvas').length,
      debugGone: !window.__aerotwin,
      pendingFrames: window.__airportPendingFrames.size,
    }))
    assert.equal(disposed.canvasCount, 0)
    assert.equal(disposed.debugGone, true)
    assert.equal(disposed.pendingFrames, 0)
    report.results.dispose = disposed
    const fault = await context.newPage()
    await fault.route('**/models/airport/aircraft.glb', (route) =>
      route.fulfill({ status: 404, body: 'Acceptance test: missing aircraft' }),
    )
    await fault.goto(base, { waitUntil: 'networkidle' })
    await fault.getByRole('alert').waitFor({ timeout: 30000 })
    await fault.unroute('**/models/airport/aircraft.glb')
    await fault.getByRole('button', { name: '重新加载', exact: true }).click()
    await fault.waitForFunction(
      () => window.__aerotwin?.getSnapshot().ready,
      {},
      { timeout: 60000 },
    )
    assert.equal(await fault.getByRole('alert').count(), 0)
    report.results.missingResourceRetry = true
    await fault.close()
  }
  assert.equal(errors.length, 0, errors.join('\n'))
  await writeFile(`docs/airport-${mode}-browser.json`, JSON.stringify(report, null, 2))
  console.log(
    JSON.stringify(
      {
        mode,
        errors,
        device: report.device,
        results: Object.fromEntries(
          Object.entries(report.results).map(([k, v]) => [
            k,
            v?.fps
              ? { fps: v.fps, drawCalls: v.drawCalls, triangles: v.triangles, camera: v.camera }
              : typeof v === 'boolean'
                ? v
                : 'recorded',
          ]),
        ),
      },
      null,
      2,
    ),
  )
} finally {
  await browser.close()
}
