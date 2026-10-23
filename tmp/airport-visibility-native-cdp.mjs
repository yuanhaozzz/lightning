import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
const { chromium } = await import('file:///C:/Users/1/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs')
const report = { date: new Date().toISOString(), noDefaults: true, modes: [] }
async function probe(headless) {
  const directory = path.resolve('tmp', `airport-native-probe-${randomUUID()}`)
  await mkdir(directory, { recursive: true })
  const child = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', [
    `--user-data-dir=${directory}`, '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check',
    '--window-position=-30000,-30000', '--window-size=640,480', ...(headless ? ['--headless=new'] : []), 'about:blank',
  ], { windowsHide: true, stdio: 'ignore' })
  let browser
  const result = { headless, observations: [] }
  report.modes.push(result)
  try {
    let port
    for (let attempt = 0; attempt < 100; attempt++) {
      try { port = (await readFile(path.join(directory, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break } catch {}
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    if (!port) throw new Error('Dedicated browser did not expose a local debugging port')
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { noDefaults: true })
    const context = browser.contexts()[0]
    await context.addInitScript(() => {
      window.visibilityEvidence = []
      document.addEventListener('visibilitychange', event => window.visibilityEvidence.push({ state: document.visibilityState, hidden: document.hidden, trusted: event.isTrusted, time: performance.now() }))
    })
    const first = context.pages()[0] || await context.newPage()
    await first.goto('about:blank')
    let second
    const read = page => page.evaluate(() => ({ state: document.visibilityState, hidden: document.hidden, events: window.visibilityEvidence }))
    async function observe(label) {
      await new Promise(resolve => setTimeout(resolve, 700))
      const state = { label, first: await read(first), second: second ? await read(second) : null }
      result.observations.push(state)
      console.log(JSON.stringify({ headless, ...state }))
      return state
    }
    await observe('one page without Playwright focus override')
    second = await context.newPage()
    await second.goto('about:blank')
    await second.bringToFront()
    const tab = await observe('second real tab foreground')
    await first.bringToFront()
    await observe('first real tab foreground')
    const session = await context.newCDPSession(first)
    result.window = await session.send('Browser.getWindowForTarget')
    await session.send('Browser.setWindowBounds', { windowId: result.window.windowId, bounds: { windowState: 'minimized' } })
    const minimized = await observe('real window minimized')
    await session.send('Browser.setWindowBounds', { windowId: result.window.windowId, bounds: { windowState: 'normal' } })
    if (!headless) await session.send('Browser.setWindowBounds', { windowId: result.window.windowId, bounds: { left: -30000, top: -30000, width: 640, height: 480 } })
    await first.bringToFront()
    await observe('real window restored')
    result.tabWorks = tab.first.hidden && tab.first.events.some(event => event.hidden && event.trusted)
    result.minimizeWorks = minimized.first.hidden && minimized.first.events.some(event => event.hidden && event.trusted)
    await session.detach()
    return result.tabWorks || result.minimizeWorks
  } finally {
    if (browser) await browser.close()
    child.kill()
  }
}
try { const works = await probe(true); if (!works) await probe(false) }
catch (error) { report.error = { message: error.message, stack: error.stack }; process.exitCode = 1 }
await writeFile('tmp/airport-visibility-native-cdp.json', JSON.stringify(report, null, 2))
console.log(JSON.stringify({ summary: report.modes.map(({ headless, tabWorks, minimizeWorks }) => ({ headless, tabWorks, minimizeWorks })), error: report.error }))
