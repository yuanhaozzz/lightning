import { writeFile } from 'node:fs/promises'
process.env.PLAYWRIGHT_BROWSERS_PATH ||= 'F:/code/lightning/tmp/airport-playwright'
const { chromium } = await import('file:///C:/Users/1/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs')
const nativeFocus = process.argv.includes('--native-focus')
const report = { date: new Date().toISOString(), nativeFocus, modes: [] }
async function probe(headless) {
  const result = { headless, observations: [] }
  report.modes.push(result)
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    headless,
    args: ['--no-first-run', '--disable-features=msEdgeSidebarV2', ...(headless ? [] : ['--window-position=-30000,-30000', '--window-size=640,480'])],
  })
  try {
    const nativeSessions = []
    result.version = await browser.version()
    const context = await browser.newContext({ viewport: { width: 640, height: 480 } })
    await context.addInitScript(() => {
      window.visibilityEvidence = []
      document.addEventListener('visibilitychange', event => window.visibilityEvidence.push({ state: document.visibilityState, hidden: document.hidden, trusted: event.isTrusted, time: performance.now() }))
    })
    const first = await context.newPage()
    await first.goto('about:blank')
    if (nativeFocus) {
      const native = await context.newCDPSession(first)
      await native.send('Emulation.setFocusEmulationEnabled', { enabled: false })
      nativeSessions.push(native)
    }
    let second
    const read = page => page.evaluate(() => ({ state: document.visibilityState, hidden: document.hidden, events: window.visibilityEvidence }))
    async function observe(label) {
      await first.waitForTimeout(700)
      const state = { label, first: await read(first), second: second ? await read(second) : null }
      result.observations.push(state)
      console.log(JSON.stringify({ headless, ...state }))
      return state
    }
    await observe('one page')
    second = await context.newPage()
    await second.goto('about:blank')
    if (nativeFocus) {
      const native = await context.newCDPSession(second)
      await native.send('Emulation.setFocusEmulationEnabled', { enabled: false })
      nativeSessions.push(native)
    }
    await second.bringToFront()
    const tab = await observe('second bringToFront')
    await first.bringToFront()
    await observe('first bringToFront')
    const session = await context.newCDPSession(first)
    try {
      result.window = await session.send('Browser.getWindowForTarget')
      await session.send('Browser.setWindowBounds', { windowId: result.window.windowId, bounds: { windowState: 'minimized' } })
      result.minimizedBounds = await session.send('Browser.getWindowBounds', { windowId: result.window.windowId })
      const minimized = await observe('window minimized')
      await session.send('Browser.setWindowBounds', { windowId: result.window.windowId, bounds: { windowState: 'normal' } })
      // Keep any headed window off the user's screen after restoring it.
      if (!headless) await session.send('Browser.setWindowBounds', { windowId: result.window.windowId, bounds: { left: -30000, top: -30000, width: 640, height: 480 } })
      await first.bringToFront()
      await observe('window restored')
      result.minimizeWorks = minimized.first.hidden && minimized.first.events.some(event => event.hidden && event.trusted)
    } catch (error) { result.windowError = error.message }
    await session.detach()
    result.tabWorks = tab.first.hidden && tab.first.events.some(event => event.hidden && event.trusted)
    return result.tabWorks || result.minimizeWorks
  } finally { await browser.close() }
}
try {
  const works = await probe(true)
  if (!works) await probe(false)
} catch (error) { report.error = { message: error.message, stack: error.stack }; process.exitCode = 1 }
await writeFile(nativeFocus ? 'tmp/airport-visibility-probe-native.json' : 'tmp/airport-visibility-probe.json', JSON.stringify(report, null, 2))
console.log(JSON.stringify({ summary: report.modes.map(({ headless, tabWorks, minimizeWorks, windowError }) => ({ headless, tabWorks, minimizeWorks, windowError })), error: report.error }))
