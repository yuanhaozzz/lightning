// End-to-end acceptance. The application is controlled exclusively through DOM controls.
// window.__aerotwin is read-only here; no clocks, visibility values or task poses are forged.
import assert from 'node:assert/strict'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import ts from 'typescript'

process.env.PLAYWRIGHT_BROWSERS_PATH ||= 'F:/code/lightning/tmp/airport-playwright'
const { chromium } = await import(
  process.env.AEROTWIN_PLAYWRIGHT_MODULE ||
    'file:///C:/Users/1/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
)

const base = process.env.AEROTWIN_URL || 'http://127.0.0.1:5176/map/aerotwin'
const output = path.resolve('docs/screenshots/v0.2')
const rawOutput = path.resolve('tmp/airport-recordings')
const visibilityOnly = process.argv.includes('--visibility-only')
const skipNative = process.argv.includes('--skip-native')
const reportPath = path.resolve(
  visibilityOnly ? 'tmp/airport-v02-native-visibility.json' : 'docs/airport-v02-browser.json',
)
const cycleTimeoutMs = 180_000
const pollingMs = 100
const headed = process.env.AEROTWIN_HEADED === '1'
const errors = []
const report = {
  startedAt: new Date().toISOString(),
  url: base,
  browser: null,
  headless: !headed,
  device: {
    cpu: os.cpus()[0]?.model,
    logicalCores: os.cpus().length,
    totalMemoryGiB: os.totalmem() / 1024 ** 3,
    os: `${os.type()} ${os.release()} ${os.arch()}`,
  },
  screenshots: [],
  errors,
  requests: [],
  tests: {},
  cycles: [],
  recording: {},
  limitations: [],
  passed: false,
}
await mkdir(output, { recursive: true })
await mkdir(rawOutput, { recursive: true })

// The configuration modules contain authored data and type-only imports. Transpile
// them in memory so the checker uses the actual delivery's parking tolerances.
async function readConfigModule(filename) {
  const source = await readFile(filename, 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
}
const { airportTaskConfig: taskConfig } = await readConfigModule('src/config/airportTask.ts')
const { airportConfig } = await readConfigModule('src/config/airport.ts')
report.expected = {
  taskId: taskConfig.taskId,
  vehicleId: taskConfig.vehicleId,
  parking: taskConfig.parking,
  service: taskConfig.service,
  motion: taskConfig.motion,
}
report.modelResources = await Promise.all(
  airportConfig.assets.map(async ({ id }) => {
    const filename = `public/models/airport/${id}.glb`
    return { filename, bytes: (await stat(filename)).size }
  }),
)
report.firstScreenGlbBytes = report.modelResources.reduce((sum, entry) => sum + entry.bytes, 0)

let currentStage = 'Launching browser'
const log = (message) => {
  currentStage = message
  console.log(`[AEROTWIN ${new Date().toISOString()}] ${message}`)
}
const heartbeat = setInterval(() => {
  console.log(`[AEROTWIN ${new Date().toISOString()}] Still working: ${currentStage}`)
}, 25_000)
let browser
let mainContext
let mainPage
let mainVideo
let recordingStartMs
let firstCycleCutSeconds

function observePage(page, scope, expectedFault = false) {
  page.on('pageerror', (error) => errors.push({ scope, kind: 'pageerror', message: error.message }))
  page.on('console', (message) => {
    if (message.type() === 'error') {
      const entry = { scope, kind: 'console', message: message.text() }
      if (expectedFault) (report.expectedFaultConsole ||= []).push(entry)
      else errors.push(entry)
    }
  })
  page.on('response', (response) => {
    if (response.status() >= 400) {
      const entry = { scope, kind: 'http', status: response.status(), url: response.url() }
      if (expectedFault && /\/models\/airport\/aircraft\.glb(?:\?|$)/.test(response.url())) {
        ;(report.expectedFaultResponses ||= []).push(entry)
      } else errors.push(entry)
    }
  })
  page.on('request', (request) => {
    if (/models\/airport|\/cesium\/|\/src\/App\.vue|\/features\//i.test(request.url())) {
      report.requests.push({ scope, url: request.url() })
    }
  })
}

async function instrument(context) {
  await context.addInitScript(() => {
    const pending = new Set()
    const request = window.requestAnimationFrame.bind(window)
    const cancel = window.cancelAnimationFrame.bind(window)
    window.__airportQA = { pending, visibilityEvents: [] }
    window.requestAnimationFrame = (callback) => {
      const id = request((time) => {
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
    document.addEventListener('visibilitychange', (event) => {
      window.__airportQA.visibilityEvents.push({
        time: performance.now(),
        state: document.visibilityState,
        hidden: document.hidden,
        isTrusted: event.isTrusted,
      })
    })
  })
}

async function snapshot(page) {
  return page.evaluate(() => ({
    scene: window.__aerotwin?.getSnapshot(),
    task: window.__aerotwin?.getTaskSnapshot(),
    vehicles: window.__aerotwin?.getVehicleInspection(),
    validation: window.__aerotwin?.getRouteValidation(),
    pendingRAF: window.__airportQA?.pending.size,
    canvasCount: document.querySelectorAll('.airport-scene canvas').length,
    visibility: document.visibilityState,
    visibilityEvents: window.__airportQA?.visibilityEvents.slice(),
    browserTime: performance.now(),
  }))
}

async function ready(page, label) {
  log(`${label}: loading ${base}`)
  await page.goto(base, { waitUntil: 'networkidle', timeout: 120_000 })
  await page.waitForFunction(
    () => window.__aerotwin?.getSnapshot().ready && window.__aerotwin?.getTaskSnapshot(),
    null,
    { timeout: 120_000 },
  )
  await page.waitForFunction(() => !document.querySelector('.airport-loading-card'), null, {
    timeout: 30_000,
  })
  const state = await snapshot(page)
  assert.equal(state.scene.debugVisible, false, 'Normal page must leave debug geometry disabled')
  assert.equal(state.canvasCount, 1)
  assert.equal(state.pendingRAF, 1)
  assert.equal(state.task.taskId, taskConfig.taskId)
  assert.equal(state.task.vehicleId, taskConfig.vehicleId)
  assert.equal(state.vehicles.errors.length, 0, state.vehicles.errors.join('; '))
  return state
}

async function waitUntil(page, label, predicate, deadline = performance.now() + cycleTimeoutMs) {
  let lastLog = -Infinity
  while (performance.now() < deadline) {
    const state = await snapshot(page)
    if (state.task?.runState === 'error') throw new Error(`${label}: ${state.task.error}`)
    if (predicate(state)) return state
    if (performance.now() - lastLog > 12_000) {
      log(
        `${label}: phase=${state.task?.phase}, state=${state.task?.runState}, sim=${state.task?.elapsed?.toFixed(2)}s`,
      )
      lastLog = performance.now()
    }
    await page.waitForTimeout(pollingMs)
  }
  const latest = await snapshot(page)
  throw new Error(`${label}: timed out; ${JSON.stringify(latest.task)}`)
}

async function click(page, name) {
  await page.getByRole('button', { name, exact: true }).click()
}
async function view(page, name) {
  await click(page, name)
  await waitUntil(
    page,
    `camera ${name}`,
    (state) => !state.scene.transitioning,
    performance.now() + 8000,
  )
}
async function screenshot(page, filename, preset, extra = {}) {
  const target = path.join(output, filename)
  await page.screenshot({ path: target })
  report.screenshots.push({ path: target, preset, viewport: page.viewportSize(), ...extra })
}
function frozenFields(state) {
  return {
    elapsed: state.task.elapsed,
    phaseElapsed: state.task.phaseElapsed,
    phase: state.task.phase,
    distance: state.task.distance,
    progress: state.task.progress,
    tractor: state.task.tractor,
    trailer: state.task.trailer,
    steering: state.task.steering,
    wheelDistances: state.task.wheelDistances,
    wheelAngles: state.vehicles.wheelAngles,
    bogieAngle: state.vehicles.bogieAngle,
    hitchDistance: state.vehicles.hitchDistance,
  }
}
function assertFrozen(before, after, label) {
  assert.deepEqual(
    frozenFields(after),
    frozenFields(before),
    `${label}: simulation and visible wheel poses must stay exactly frozen`,
  )
}
function memoryFields(state) {
  return {
    geometries: state.scene.geometries,
    textures: state.scene.textures,
    nodeCounts: state.vehicles.nodeCounts,
    assetCount: Object.keys(state.scene.assetBounds).length,
    canvasCount: state.canvasCount,
    pendingRAF: state.pendingRAF,
  }
}
function assertPhysical(state) {
  assert.equal(state.vehicles.nodeCounts.tractor, 1)
  assert.equal(state.vehicles.nodeCounts.trailer, 1)
  assert.equal(state.pendingRAF, 1, 'Exactly one application RAF must remain scheduled')
  assert.ok(
    Number.isFinite(state.vehicles.hitchDistance) && state.vehicles.hitchDistance < 0.001,
    'World-space hitch ends must coincide within 1 mm',
  )
  for (const [group, angles] of Object.entries(state.vehicles.wheelAngles)) {
    const radius = group.startsWith('tractor')
      ? taskConfig.geometry.tractor.wheelRadius
      : taskConfig.geometry.trailer.wheelRadius
    const expected = state.task.wheelDistances[group] / radius
    assert.ok(angles.length > 0, `${group} must contain actual wheel nodes`)
    for (const angle of angles)
      assert.ok(
        Number.isFinite(angle) && Math.abs(angle - expected) < 1e-7,
        `${group}: visible rotation must equal travelled distance / radius`,
      )
  }
}
function stopEvidence(state, target, label) {
  const task = state.task
  const positionError = Math.hypot(task.tractor.x - target.x, task.tractor.z - target.z)
  const headingError = Math.abs(
    Math.atan2(
      Math.sin(task.tractor.heading - target.heading),
      Math.cos(task.tractor.heading - target.heading),
    ),
  )
  assert.ok(
    positionError <= taskConfig.motion.positionTolerance,
    `${label}: position error ${positionError}`,
  )
  assert.ok(
    headingError <= taskConfig.motion.angleTolerance,
    `${label}: heading error ${headingError}`,
  )
  assert.ok(
    Math.abs(task.speed) <= taskConfig.motion.speedTolerance,
    `${label}: speed ${task.speed}`,
  )
  assertPhysical(state)
  return {
    positionError,
    headingErrorRadians: headingError,
    speed: task.speed,
    expected: target,
    actual: task.tractor,
  }
}
async function assertNoOverflow(page) {
  const layout = await page.evaluate(() => {
    const panel = document.querySelector('.airport-panel-right')?.getBoundingClientRect()
    const toolbar = document.querySelector('.airport-toolbar')?.getBoundingClientRect()
    return {
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
      verticalOverflow: document.documentElement.scrollHeight > innerHeight,
      panel: panel
        ? {
            left: panel.left,
            top: panel.top,
            right: panel.right,
            bottom: panel.bottom,
            height: panel.height,
          }
        : null,
      toolbarTop: toolbar?.top,
      viewport: [innerWidth, innerHeight],
    }
  })
  assert.equal(layout.horizontalOverflow, false)
  assert.equal(layout.verticalOverflow, false)
  if (layout.panel)
    assert.ok(
      layout.panel.bottom < layout.toolbarTop,
      'Information panel must not overlap bottom controls',
    )
  return layout
}
async function dragCamera(page) {
  const { width, height } = page.viewportSize()
  const x = width * 0.52,
    y = height * 0.67
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + 115, y + 18, { steps: 12 })
  await page.mouse.up()
  await page.waitForTimeout(350)
}
async function pauseAndHold(page, cycle, label) {
  await click(page, '暂停')
  const before = await waitUntil(
    page,
    `${label}: paused`,
    (state) => state.task.runState === 'paused',
  )
  const wallStart = performance.now()
  await page.waitForTimeout(1250)
  const after = await snapshot(page)
  assertFrozen(before, after, label)
  cycle.pauses.push({
    label,
    wallStart,
    frozenSeconds: (performance.now() - wallStart) / 1000,
    before: frozenFields(before),
    after: frozenFields(after),
  })
  return { state: after, wallStart }
}
async function resume(page, cycle, hold) {
  await click(page, '继续')
  cycle.pauseWallSeconds += (performance.now() - hold.wallStart) / 1000
  return waitUntil(page, 'resumed', (state) => state.task.runState === 'running')
}

async function visibilityProbe(page, cycle) {
  log('First cycle: probing actual page visibility with a foreground tab switch')
  const initial = await snapshot(page)
  assert.equal(initial.task.runState, 'running')
  const other = await page.context().newPage()
  await other.goto('about:blank')
  await other.bringToFront()
  const probe = {
    status: 'unverified',
    method: 'tab bringToFront',
    initial: initial.visibility,
    observations: [],
    protocolError: null,
  }
  const hiddenDeadline = performance.now() + 2200
  let hiddenState
  while (performance.now() < hiddenDeadline) {
    const state = await snapshot(page)
    probe.observations.push({ visibility: state.visibility, runState: state.task.runState })
    if (state.visibility === 'hidden') {
      hiddenState = state
      break
    }
    await page.waitForTimeout(150)
  }
  if (!hiddenState) {
    // Some Chromium builds expose this protocol command, others explicitly reject it.
    // An accepted call counts only if document.visibilityState and trusted events change.
    const session = await page.context().newCDPSession(page)
    try {
      await session.send('Emulation.setPageVisibilityState', { visibilityState: 'hidden' })
      const state = await snapshot(page)
      if (state.visibility === 'hidden') {
        hiddenState = state
        probe.method = 'CDP Emulation.setPageVisibilityState'
      }
    } catch (error) {
      probe.protocolError = error.message
    } finally {
      await session.detach()
    }
  }
  if (hiddenState) {
    const paused = await waitUntil(
      page,
      'visibility auto-pause',
      (state) => state.task.runState === 'paused',
      performance.now() + 5000,
    )
    const wallStart = performance.now()
    await page.waitForTimeout(1250)
    const after = await snapshot(page)
    assertFrozen(paused, after, 'Hidden page')
    assert.ok(
      after.visibilityEvents.some((event) => event.hidden && event.isTrusted),
      'Require a genuine browser visibility event',
    )
    probe.hiddenSnapshot = paused
    if (probe.method.startsWith('CDP')) {
      const session = await page.context().newCDPSession(page)
      await session.send('Emulation.setPageVisibilityState', { visibilityState: 'visible' })
      await session.detach()
    }
    await page.bringToFront()
    await other.close()
    const returned = await waitUntil(
      page,
      'return to foreground',
      (state) => state.visibility === 'visible',
      performance.now() + 5000,
    )
    assert.equal(
      returned.task.runState,
      'paused',
      'Visibility restoration must not silently resume',
    )
    assertFrozen(paused, returned, 'Returning to foreground')
    probe.status = 'passed'
    probe.events = returned.visibilityEvents
    cycle.visibilityPauseCount = 1
    cycle.pauses.push({
      label: 'real visibility',
      wallStart,
      before: frozenFields(paused),
      after: frozenFields(returned),
    })
    await resume(page, cycle, { wallStart })
  } else {
    await page.bringToFront()
    await other.close()
    probe.reason =
      'This browser run did not change document.visibilityState. Automatic background pause was not verified; no synthetic visibility event was used.'
    if (report.tests.nativeVisibility?.status === 'passed') {
      probe.independentVerification =
        'tests.nativeVisibility: genuine tab visibility in a dedicated browser connected with noDefaults=true'
    } else report.limitations.push(probe.reason)
    assert.equal((await snapshot(page)).task.runState, 'running')
  }
  report.tests.visibility = probe
}

async function firstCycleInteractions(page, cycle) {
  await waitUntil(
    page,
    'First cycle: initial outbound motion',
    (state) => state.task.elapsed >= 2 && state.task.phase === 'to_service',
    cycle.deadline,
  )
  const hold = await pauseAndHold(page, cycle, 'outbound user pause')
  const beforeCamera = await snapshot(page)
  await dragCamera(page)
  const afterCamera = await snapshot(page)
  assert.notDeepEqual(
    afterCamera.scene.camera,
    beforeCamera.scene.camera,
    'Camera must remain usable while paused',
  )
  assertFrozen(hold.state, afterCamera, 'Camera drag while paused')
  await view(page, '视角复位')
  const resetCamera = await snapshot(page)
  assertFrozen(hold.state, resetCamera, 'Camera reset must not reset task')
  await page.getByText('当前航班', { exact: true }).hover()
  await page.mouse.wheel(0, 350)
  await page.waitForTimeout(200)
  const afterUIWheel = await snapshot(page)
  assert.deepEqual(
    afterUIWheel.scene.camera,
    resetCamera.scene.camera,
    'Wheel over UI must not zoom canvas',
  )
  report.tests.pausedCameraAndUIIsolation = true
  await view(page, '作业视角')
  await resume(page, cycle, hold)

  const canvas = await page.locator('.airport-scene canvas').elementHandle()
  const beforeNav = await snapshot(page)
  await click(page, '机位总览')
  await page.getByRole('heading', { name: '保障状态', exact: true }).waitFor()
  await page.waitForTimeout(500)
  const overview = await snapshot(page)
  assert.equal(overview.task.runState, 'running')
  assert.ok(overview.task.elapsed > beforeNav.task.elapsed)
  await click(page, '保障作业')
  await page.getByRole('heading', { name: '行李车辆作业', exact: true }).waitFor()
  const afterNav = await snapshot(page)
  assert.equal(afterNav.task.runState, 'running')
  assert.ok(afterNav.task.elapsed >= overview.task.elapsed)
  assert.equal(
    await canvas.evaluate((node) => node === document.querySelector('.airport-scene canvas')),
    true,
    'Navigation must retain the same renderer canvas',
  )
  assert.deepEqual(
    afterNav.task.events,
    beforeNav.task.events,
    'Navigation must create no task events',
  )
  report.tests.navigationPreservesTaskAndScene = true

  const beforeDrag = await snapshot(page)
  await dragCamera(page)
  const afterDrag = await snapshot(page)
  assert.equal(afterDrag.task.runState, 'running')
  assert.ok(afterDrag.task.elapsed > beforeDrag.task.elapsed)
  assert.notDeepEqual(afterDrag.scene.camera, beforeDrag.scene.camera)
  report.tests.manualCameraDoesNotPauseTask = true
  await view(page, '作业视角')
  await visibilityProbe(page, cycle)
}

function checkBoundaryEvents(cycle) {
  const events = cycle.completed.task.events
  const boundaries = {
    started: /开始.*前往/,
    arrived: /抵达.*停稳/,
    returning: /(?:模拟交接.*完成|停靠完成|交接完成).*返回/,
    completed: /已返回.*任务完成/,
  }
  cycle.boundaryEvents = {}
  for (const [name, pattern] of Object.entries(boundaries)) {
    const matches = events.filter((event) => pattern.test(event.message))
    assert.equal(matches.length, 1, `${name}: exactly one actual boundary event per cycle`)
    cycle.boundaryEvents[name] = matches[0]
  }
  const dwellSeconds = cycle.boundaryEvents.returning.time - cycle.boundaryEvents.arrived.time
  assert.ok(
    Math.abs(dwellSeconds - taskConfig.motion.serviceSeconds) < 0.02,
    'Dwell must use exactly the configured simulation duration, excluding pauses',
  )
  cycle.actualDwellSimulationSeconds = dwellSeconds
  const userPauses = cycle.index === 1 ? 2 : 0
  assert.equal(events.filter((event) => event.message === '用户暂停').length, userPauses)
  assert.equal(
    events.filter((event) => event.message === '任务继续').length,
    userPauses + cycle.visibilityPauseCount,
  )
  assert.equal(
    events.length,
    4 + 2 * (userPauses + cycle.visibilityPauseCount),
    'No duplicate or invented events',
  )
}

async function runCycle(page, index) {
  log(`Cycle ${index}/3: begin`)
  const cycle = {
    index,
    pauses: [],
    pauseWallSeconds: 0,
    visibilityPauseCount: 0,
    phaseSamples: [],
    deadline: performance.now() + cycleTimeoutMs,
  }
  report.cycles.push(cycle)
  const initial = await snapshot(page)
  assert.equal(initial.task.phase, 'idle')
  assert.equal(initial.task.elapsed, 0)
  assert.equal(initial.task.events.length, 0)
  await click(page, '开始作业')
  const started = await waitUntil(
    page,
    `Cycle ${index}: running`,
    (state) => state.task.runState === 'running',
    cycle.deadline,
  )
  cycle.wallStart = performance.now()
  cycle.simulationStart = started.task.elapsed
  cycle.started = started
  assert.equal(started.validation.ok, true, started.validation.errors.join('; '))
  assert.equal(started.validation.collisions.length, 0)
  assert.ok(started.validation.minClearance >= started.validation.clearanceMargin)
  assertPhysical(started)
  if (index === 1) await firstCycleInteractions(page, cycle)

  log(`Cycle ${index}/3: waiting for service stop`)
  const servicing = await waitUntil(
    page,
    `Cycle ${index}: service arrival`,
    (state) => state.task.phase === 'servicing',
    cycle.deadline,
  )
  cycle.serviceStop = stopEvidence(servicing, taskConfig.service, 'Service stop')
  cycle.phaseSamples.push(servicing)
  if (index === 1) {
    const hold = await pauseAndHold(page, cycle, 'service dwell user pause')
    assert.equal(hold.state.task.phase, 'servicing')
    assert.equal(await page.getByText('模拟计时', { exact: true }).isVisible(), true)
    cycle.layout1366 = await assertNoOverflow(page)
    await screenshot(page, '04-service-1366.png', 'service', {
      taskPhase: 'servicing',
      runState: 'paused',
    })
    await resume(page, cycle, hold)
  }
  const returning = await waitUntil(
    page,
    `Cycle ${index}: returning`,
    (state) => state.task.phase === 'returning',
    cycle.deadline,
  )
  assertPhysical(returning)
  cycle.phaseSamples.push(returning)
  const completed = await waitUntil(
    page,
    `Cycle ${index}: completed`,
    (state) => state.task.phase === 'completed',
    cycle.deadline,
  )
  cycle.wallSeconds = (performance.now() - cycle.wallStart) / 1000
  cycle.simulationSeconds = completed.task.elapsed - cycle.simulationStart
  cycle.wallMinusPausesMinusSimulation =
    cycle.wallSeconds - cycle.pauseWallSeconds - cycle.simulationSeconds
  cycle.completed = completed
  cycle.parkingStop = stopEvidence(completed, taskConfig.parking, 'Parking stop')
  assert.equal(completed.task.runState, 'stopped')
  assert.equal(completed.task.progress, null)
  assert.equal(await page.getByRole('button', { name: '已完成', exact: true }).isDisabled(), true)
  assert.ok(
    Math.abs(cycle.wallMinusPausesMinusSimulation) < 1.5,
    'Simulation seconds must track actual running wall time (1.5s allowance for browser/command sampling)',
  )
  assert.ok((await page.locator('.airport-task-events li').count()) <= 3)
  checkBoundaryEvents(cycle)
  await page.waitForTimeout(1100)
  assertFrozen(completed, await snapshot(page), 'Completed task must stay stopped')
  cycle.stableMemory = memoryFields(await snapshot(page))
  if (index > 1)
    assert.deepEqual(
      cycle.stableMemory,
      report.cycles[0].stableMemory,
      'Repeated cycles must not accumulate geometry, textures, vehicles or RAF loops',
    )
  await click(page, '重置任务')
  const reset = await waitUntil(
    page,
    `Cycle ${index}: reset`,
    (state) => state.task.phase === 'idle' && state.task.elapsed === 0,
  )
  assert.equal(reset.task.events.length, 0)
  assert.equal(reset.task.phaseElapsed, 0)
  assert.equal(reset.task.distance, 0)
  assert.equal(reset.task.progress, null)
  assert.equal(reset.task.runState, 'stopped')
  assert.deepEqual(reset.task.tractor, initial.task.tractor)
  assert.deepEqual(reset.task.trailer, initial.task.trailer)
  assert.deepEqual(reset.vehicles.wheelAngles, initial.vehicles.wheelAngles)
  assert.equal(await page.getByRole('button', { name: '开始作业', exact: true }).isEnabled(), true)
  cycle.reset = reset
  if (index === 1) {
    await page.waitForTimeout(1000)
    firstCycleCutSeconds = (performance.now() - recordingStartMs) / 1000
    report.recording.firstCycleCutSeconds = firstCycleCutSeconds
    // A clean idle tail separates the first cycle from the next one. Video is never sped up.
    await page.waitForTimeout(1500)
  }
  delete cycle.deadline
  log(
    `Cycle ${index}/3: completed and reset; simulation=${cycle.simulationSeconds.toFixed(2)}s, wall=${cycle.wallSeconds.toFixed(2)}s, pause=${cycle.pauseWallSeconds.toFixed(2)}s`,
  )
}

async function capture1920() {
  log('1920×1080: capturing overview and work-area camera')
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
  })
  await instrument(context)
  const page = await context.newPage()
  observePage(page, '1920')
  try {
    await ready(page, '1920')
    await page.waitForTimeout(1300)
    await screenshot(page, '02-overview-1920.png', 'overview', { taskPhase: 'idle' })
    report.tests.overview1920 = await snapshot(page)
    await click(page, '保障作业')
    await view(page, '作业视角')
    report.tests.layout1920 = await assertNoOverflow(page)
    await screenshot(page, '03-service-1920.png', 'service', { taskPhase: 'idle' })
    report.tests.service1920 = await snapshot(page)
  } finally {
    await context.close()
  }
}

async function verifyNativeVisibility() {
  const attempts = []
  for (let number = 1; number <= 3; number++) {
    try {
      await verifyNativeVisibilityAttempt(number)
      report.tests.nativeVisibility.startupAttempts = attempts
      return
    } catch (error) {
      const failed = report.tests.nativeVisibility
      attempts.push({
        attempt: number,
        profile: failed.profile,
        stage: failed.stage,
        error: error.message,
        browserStderr: failed.browserStderr,
      })
      failed.startupAttempts = attempts
      if (failed.stage !== 'startup' || number === 3) throw error
      log(
        `Native visibility startup attempt ${number} failed; retrying with a new dedicated profile`,
      )
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }
}

async function verifyNativeVisibilityAttempt(attempt) {
  log(
    'Native visibility: verifying real application auto-pause without Playwright forced-focus emulation',
  )
  const profile = path.resolve('tmp', `airport-visibility-${randomUUID()}`)
  await mkdir(profile, { recursive: true })
  const child = spawn(
    process.env.AEROTWIN_BROWSER_PATH ||
      'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    [
      `--user-data-dir=${profile}`,
      '--remote-debugging-port=0',
      '--no-first-run',
      '--no-default-browser-check',
      '--window-position=-30000,-30000',
      '--window-size=640,480',
      '--headless=new',
      'about:blank',
    ],
    { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] },
  )
  const evidence = {
    status: 'running',
    stage: 'startup',
    attempt,
    method: 'Actual tab switch in dedicated Edge; connectOverCDP noDefaults=true',
    profile,
    browserStderr: '',
  }
  child.stderr.on('data', (data) => {
    evidence.browserStderr = (evidence.browserStderr + data.toString()).slice(-16000)
  })
  let spawnError
  child.on('error', (error) => {
    spawnError = error
  })
  report.tests.nativeVisibility = evidence
  let nativeBrowser
  try {
    let port
    for (let attempt = 0; attempt < 100; attempt++) {
      if (spawnError) throw spawnError
      try {
        port = (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]
        break
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    assert.ok(port, 'Dedicated Edge must expose its temporary local debugging port')
    let targetReady = false
    for (let sample = 0; sample < 50; sample++) {
      try {
        const targets = await fetch(`http://127.0.0.1:${port}/json/list`, {
          signal: AbortSignal.timeout(500),
        }).then((response) => response.json())
        if (targets.some((target) => target.type === 'page' && target.url === 'about:blank')) {
          targetReady = true
          break
        }
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    assert.ok(targetReady, 'Dedicated Edge must finish creating its initial page target')
    await new Promise((resolve) => setTimeout(resolve, 700))
    // Installed Playwright documents noDefaults. It skips its normal
    // Emulation.setFocusEmulationEnabled(true), restoring native visibility.
    nativeBrowser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, {
      noDefaults: true,
      timeout: 15000,
    })
    evidence.stage = 'application'
    evidence.browser = await nativeBrowser.version()
    if (visibilityOnly) report.browser = evidence.browser
    log(`Native visibility: connected on attempt ${attempt}; loading actual application`)
    const context = nativeBrowser.contexts()[0]
    await instrument(context)
    const page = context.pages()[0] || (await context.newPage())
    observePage(page, 'native visibility')
    await page.setViewportSize({ width: 1366, height: 768 })
    await ready(page, 'native visibility')
    await click(page, '保障作业')
    await click(page, '开始作业')
    evidence.before = await waitUntil(
      page,
      'Native visibility: outbound motion',
      (state) => state.task.runState === 'running' && state.task.elapsed > 0.6,
    )
    const other = await context.newPage()
    await other.goto('about:blank')
    await other.bringToFront()
    const hidden = await waitUntil(
      page,
      'Native visibility: real hidden auto-pause',
      (state) => state.visibility === 'hidden' && state.task.runState === 'paused',
      performance.now() + 5000,
    )
    assert.ok(
      hidden.visibilityEvents.some((event) => event.hidden && event.isTrusted),
      'Require actual trusted visibilitychange from the browser',
    )
    evidence.hidden = hidden
    const holdStart = performance.now()
    await page.waitForTimeout(1400)
    evidence.afterHiddenHold = await snapshot(page)
    evidence.hiddenHoldSeconds = (performance.now() - holdStart) / 1000
    assertFrozen(hidden, evidence.afterHiddenHold, 'Real background tab')
    await page.bringToFront()
    evidence.returned = await waitUntil(
      page,
      'Native visibility: foreground stays paused',
      (state) => state.visibility === 'visible',
      performance.now() + 5000,
    )
    assert.equal(evidence.returned.task.runState, 'paused')
    assertFrozen(hidden, evidence.returned, 'Real foreground restoration')
    await page.waitForTimeout(500)
    assertFrozen(hidden, await snapshot(page), 'Foreground does not automatically resume')
    await click(page, '继续')
    evidence.resumed = await waitUntil(
      page,
      'Native visibility: explicit DOM resume',
      (state) =>
        state.task.runState === 'running' && state.task.elapsed > hidden.task.elapsed + 0.4,
      performance.now() + 5000,
    )
    assert.ok(evidence.resumed.task.distance > hidden.task.distance)
    assert.equal(
      evidence.resumed.task.events.filter((event) => /页面离开前台/.test(event.message)).length,
      1,
    )
    assert.equal(
      evidence.resumed.task.events.filter((event) => event.message === '任务继续').length,
      1,
    )
    await click(page, '重置任务')
    await waitUntil(
      page,
      'Native visibility: cleanup reset',
      (state) => state.task.phase === 'idle' && state.task.elapsed === 0,
    )
    await other.close()
    evidence.status = 'passed'
    log(
      'Native visibility passed: trusted hidden/visible events, frozen time/poses/wheels, explicit resume',
    )
  } catch (error) {
    evidence.status = 'failed'
    evidence.error = error.message
    throw error
  } finally {
    if (nativeBrowser) {
      try {
        const session = await nativeBrowser.newBrowserCDPSession()
        await session.send('Browser.close')
      } catch {}
      await nativeBrowser.close().catch(() => {})
    }
    child.kill()
    await Promise.race([
      new Promise((resolve) => child.once('exit', resolve)),
      new Promise((resolve) => setTimeout(resolve, 1000)),
    ])
  }
}

async function retryMissingAsset() {
  log('Fault handling: missing aircraft GLB, then real reload')
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } })
  await instrument(context)
  const page = await context.newPage()
  observePage(page, 'expected missing aircraft', true)
  try {
    await page.route('**/models/airport/aircraft.glb', (route) =>
      route.fulfill({
        status: 404,
        body: 'Acceptance test: aircraft asset deliberately unavailable',
      }),
    )
    await page.goto(base, { waitUntil: 'networkidle', timeout: 60_000 })
    await page.locator('.airport-loading-card[role="alert"]').waitFor({ timeout: 30_000 })
    const errorText = await page.locator('.airport-loading-card').innerText()
    assert.ok(errorText.includes('重新加载'))
    await page.unroute('**/models/airport/aircraft.glb')
    await click(page, '重新加载')
    await page.waitForFunction(
      () => window.__aerotwin?.getSnapshot().ready && window.__aerotwin?.getTaskSnapshot(),
      null,
      { timeout: 60_000 },
    )
    await page.locator('.airport-loading-card').waitFor({ state: 'hidden' })
    const recovered = await snapshot(page)
    assert.equal(recovered.canvasCount, 1)
    assert.equal(recovered.pendingRAF, 1)
    assert.equal(recovered.task.phase, 'idle')
    report.tests.missingAssetRetry = { passed: true, errorText, recovered }
  } finally {
    await context.close()
  }
}

async function trimRecording(rawPath) {
  if (!firstCycleCutSeconds) return
  let executable = process.env.AEROTWIN_FFMPEG
  if (!executable) {
    const directory = path.join(process.env.PLAYWRIGHT_BROWSERS_PATH, 'ffmpeg-1011')
    const names = await readdir(directory)
    executable = path.join(
      directory,
      names.find((name) => /ffmpeg.*\.exe$/i.test(name)) || 'ffmpeg-win64.exe',
    )
  }
  const target = path.join(output, '05-task-cycle.webm')
  const args = ['-y', '-i', rawPath, '-t', firstCycleCutSeconds.toFixed(3), '-c', 'copy', target]
  log(
    `Recording: retaining first cycle through reset (${firstCycleCutSeconds.toFixed(2)}s, original real-time speed)`,
  )
  const result = await new Promise((resolve, reject) => {
    const process = spawn(executable, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let logText = ''
    process.stdout.on('data', (chunk) => {
      logText += chunk.toString()
    })
    process.stderr.on('data', (chunk) => {
      logText += chunk.toString()
    })
    process.on('error', reject)
    process.on('close', (code) => resolve({ code, logText }))
  })
  report.recording.trim = { ...result, command: { executable, args }, output: target }
  assert.equal(result.code, 0, result.logText)
  assert.ok((await stat(target)).size > 0)
  report.recording.realTimeSpeed = true
  report.recording.trimTiming =
    'Wall duration from primary page creation to 1 second after first reset; stream copy preserves source timing. Original recording retained.'
}

try {
  if (skipNative) {
    report.tests.nativeVisibility = {
      status: 'pending-independent-verification',
      reason:
        'Explicit --skip-native requested; no background behavior is claimed as tested in this run.',
    }
    report.limitations.push(
      'Native background auto-pause awaits independent visibility-only evidence.',
    )
  } else await verifyNativeVisibility()
  if (!visibilityOnly) {
    browser = await chromium.launch({
      executablePath:
        process.env.AEROTWIN_BROWSER_PATH ||
        'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
      headless: !headed,
      args: ['--no-first-run', '--disable-features=msEdgeSidebarV2'],
    })
    report.browser = await browser.version()
    await capture1920()
    mainContext = await browser.newContext({
      viewport: { width: 1366, height: 768 },
      deviceScaleFactor: 1,
      recordVideo: { dir: rawOutput, size: { width: 1366, height: 768 } },
    })
    await instrument(mainContext)
    mainPage = await mainContext.newPage()
    recordingStartMs = performance.now()
    mainVideo = mainPage.video()
    observePage(mainPage, '1366 recorded')
    report.tests.initial1366 = await ready(mainPage, '1366 recorded')
    assert.equal(report.tests.initial1366.visibility, 'visible')
    assert.equal(
      await mainPage.getByRole('button', { name: '运行回放', exact: true }).isDisabled(),
      true,
    )
    await mainPage.locator('.airport-disabled-nav').hover()
    await mainPage.getByRole('tooltip').waitFor({ state: 'visible' })
    report.tests.replayDisabled = true
    await click(mainPage, '保障作业')
    await click(mainPage, '隐藏面板')
    await mainPage.getByText('当前航班', { exact: true }).waitFor({ state: 'hidden' })
    assert.equal(await mainPage.locator('.airport-topbar').isVisible(), true)
    assert.equal(await mainPage.locator('.airport-toolbar').isVisible(), true)
    await click(mainPage, '显示面板')
    await mainPage.getByRole('heading', { name: '行李车辆作业' }).waitFor()
    report.tests.panelRestore = true
    for (const preset of ['飞机', '廊桥', '作业视角']) await view(mainPage, preset)
    report.tests.warmedScene = await snapshot(mainPage)
    for (let index = 1; index <= 3; index++) await runCycle(mainPage, index)
    report.tests.resourceTiming = await mainPage.evaluate(() =>
      performance
        .getEntriesByType('resource')
        .filter((entry) => /models\/airport/.test(entry.name))
        .map((entry) => ({
          name: entry.name,
          duration: entry.duration,
          transferSize: entry.transferSize,
          encodedBodySize: entry.encodedBodySize,
          decodedBodySize: entry.decodedBodySize,
        })),
    )
    report.tests.performance = report.cycles.map((cycle) => ({
      cycle: cycle.index,
      samples: [...cycle.phaseSamples, cycle.completed].map((state) => ({
        phase: state.task.phase,
        viewport: state.scene.viewport,
        pixelRatio: state.scene.pixelRatio,
        fps: state.scene.fps,
        sampleFrames: state.scene.sampleFrames,
        triangles: state.scene.triangles,
        drawCalls: state.scene.drawCalls,
        gpu: state.scene.gpu,
      })),
    }))
    assert.equal(
      report.requests.some((entry) => /\/src\/App\.vue|\/cesium\//i.test(entry.url)),
      false,
      'Airport must not initialize the legacy scene',
    )
    log('Lifecycle: unmounting Vue application and checking render-loop cleanup')
    await mainPage.evaluate(() => document.querySelector('#app').__vue_app__.unmount())
    await mainPage.waitForTimeout(300)
    const disposed = await snapshot(mainPage)
    assert.equal(disposed.canvasCount, 0)
    assert.equal(disposed.scene, undefined)
    assert.equal(disposed.pendingRAF, 0)
    report.tests.dispose = disposed
    await mainContext.close()
    mainContext = undefined
    const rawPath = await mainVideo.path()
    report.recording.raw = rawPath
    await trimRecording(rawPath)
    await retryMissingAsset()
  }
  assert.equal(errors.length, 0, JSON.stringify(errors, null, 2))
  report.passed = true
  log(
    'All executed checks passed. Any unverified visibility check is explicitly listed under limitations.',
  )
} catch (error) {
  report.failure = { message: error.message, stack: error.stack }
  process.exitCode = 1
  log(`FAILED: ${error.message}`)
  if (mainPage && !mainPage.isClosed()) {
    report.failure.latest = await snapshot(mainPage).catch(() => null)
    await mainPage
      .screenshot({ path: path.join(output, 'failure-last-browser.png') })
      .catch(() => {})
  }
} finally {
  if (mainContext) await mainContext.close().catch(() => {})
  if (mainVideo) report.recording.raw = await mainVideo.path().catch(() => report.recording.raw)
  if (browser) await browser.close()
  clearInterval(heartbeat)
  report.finishedAt = new Date().toISOString()
  await writeFile(reportPath, JSON.stringify(report, null, 2))
  log(`Evidence written to ${reportPath}`)
}
