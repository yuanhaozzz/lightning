/** Deterministic headless acceptance of the actual TypeScript simulation.
 * Run: node scripts/airport-simulation-check.mjs
 * Uses the project's existing TypeScript compiler in memory; no new package,
 * generated JS bundle, browser timer, or production source rewrite is needed.
 */
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import os from 'node:os'
import ts from 'typescript'

const options = { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }
const moduleURL = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
const configURL = moduleURL(ts.transpileModule(await readFile('src/config/airportTask.ts', 'utf8'), options).outputText)
const source = ts.transpileModule(await readFile('src/three/airport/simulation.ts', 'utf8'), options).outputText
const { airportTaskConfig: config } = await import(configURL)
const { createAirportSimulation, validateAirportTask, sampleRoute, routeLength, angleDifference,
  hitchConstraintErrors, SIMULATION_STEP } = await import(moduleURL(source.replaceAll('../../config/airportTask', configURL)))
const copy = value => JSON.parse(JSON.stringify(value))
const near = (actual, expected, tolerance = 1e-8) => assert.ok(Math.abs(actual - expected) <= tolerance,
  `${actual} differs from ${expected} by more than ${tolerance}`)
const poseDistance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z)
const report = {
  capturedAt: new Date().toISOString(), implementation: 'src/three/airport/simulation.ts',
  runtime: { node: process.version, typescript: ts.version, platform: process.platform,
    architecture: process.arch, cpu: os.cpus()[0]?.model ?? 'unavailable' },
  note: 'Headless deterministic simulation tests; frame rates below are supplied dt values, not measured browser rendering FPS.',
  passed: false, checks: [], validation: null, cycles: [], frameRateResults: [], failures: [],
}
function check(name, fn) {
  try { const detail = fn(); report.checks.push({ name, passed: true, ...(detail ? { detail } : {}) }) }
  catch (error) { report.checks.push({ name, passed: false }); report.failures.push({ name, error: error.stack ?? String(error) }) }
}

function runCycle(dt, simulation = createAirportSimulation(config)) {
  assert.equal(simulation.start().ok, true)
  const phases = ['to_service']
  let previous = simulation.getSnapshot(), serviceStart = null, serviceEnd = null
  let maxHitchError = 0, minimumMeasuredRadius = Infinity, maxHeadingStep = 0
  let frames = 0
  while (previous.phase !== 'completed' && frames < 30000) {
    simulation.update(dt)
    const current = simulation.getSnapshot()
    assert.notEqual(current.runState, 'error', current.error ?? '')
    assert.ok(current.elapsed >= previous.elapsed)
    assert.ok(current.distance >= previous.distance - 1e-10)
    const headingStep = Math.abs(angleDifference(current.tractor.heading, previous.tractor.heading))
    maxHeadingStep = Math.max(maxHeadingStep, headingStep)
    if (headingStep > 1e-7) minimumMeasuredRadius = Math.min(minimumMeasuredRadius,
      poseDistance(current.tractor, previous.tractor) / (2 * Math.sin(headingStep / 2)))
    assert.ok(headingStep < .1, 'tractor heading snapped')
    assert.ok(Math.abs(angleDifference(current.trailer.heading, previous.trailer.heading)) < .1, 'trailer heading snapped')
    assert.ok(Math.abs(angleDifference(current.trailer.bogieHeading, previous.trailer.bogieHeading)) < .1, 'bogie heading snapped')
    assert.ok(Math.abs(current.steering - previous.steering) <= config.motion.maxSteeringRate * dt + 1e-8)
    const hitch = hitchConstraintErrors(current, config)
    maxHitchError = Math.max(maxHitchError, hitch.drawbar, hitch.wheelbase)
    assert.ok(maxHitchError < 1e-8)
    for (const key of Object.keys(current.wheelDistances)) assert.ok(current.wheelDistances[key] >= previous.wheelDistances[key] - 1e-10)
    if (current.phase !== previous.phase) {
      phases.push(current.phase)
      if (current.phase === 'servicing') {
        serviceStart = current.elapsed
        assert.ok(current.speed <= config.motion.speedTolerance, 'servicing began before zero speed')
        assert.ok(poseDistance(current.tractor, config.service) <= config.motion.positionTolerance)
        assert.ok(Math.abs(angleDifference(current.tractor.heading, config.service.heading)) <= config.motion.angleTolerance)
      }
      if (current.phase === 'returning') serviceEnd = current.elapsed
    }
    if (current.phase === 'servicing') near(current.speed, 0)
    previous = current; frames++
  }
  assert.equal(previous.phase, 'completed', 'task failed to complete')
  assert.equal(previous.runState, 'stopped')
  assert.equal(previous.progress, null)
  assert.deepEqual(phases, ['to_service', 'servicing', 'returning', 'completed'])
  assert.equal(previous.events.length, 4, 'phase events duplicated')
  assert.equal(new Set(previous.events.map(e => e.message)).size, 4)
  near(serviceEnd - serviceStart, config.motion.serviceSeconds, SIMULATION_STEP + 1e-8)
  near(previous.speed, 0)
  assert.ok(poseDistance(previous.tractor, config.parking) <= config.motion.positionTolerance)
  assert.ok(Math.abs(angleDifference(previous.tractor.heading, config.parking.heading)) <= config.motion.angleTolerance)
  assert.ok(minimumMeasuredRadius >= config.motion.minTurnRadius - 1e-5)
  const frozen = simulation.getSnapshot(); simulation.update(10); assert.deepEqual(simulation.getSnapshot(), frozen)
  return { frames, elapsed: previous.elapsed, serviceSeconds: serviceEnd - serviceStart,
    distance: previous.distance, phases, maxHitchError, minimumMeasuredRadius, maxHeadingStep,
    finalTractor: previous.tractor, finalTrailer: previous.trailer,
    wheelDistances: previous.wheelDistances, events: previous.events }
}

check('complete articulated sweep and configured minimum clearance', () => {
  const before = performance.now()
  report.validation = validateAirportTask(config)
  const durationMs = performance.now() - before
  assert.equal(report.validation.ok, true, report.validation.errors.join('; '))
  assert.ok(report.validation.steps > 1000)
  assert.ok(report.validation.minObstacleClearance >= config.validation.clearanceMargin)
  assert.ok(report.validation.minTrainClearance >= config.validation.clearanceMargin)
  assert.equal(report.validation.collisions.length, 0)
  assert.ok(report.validation.minimumTurnRadius >= config.motion.minTurnRadius)
  assert.ok(report.validation.maxLateralAcceleration <= config.motion.lateralAcceleration + .001)
  return { wallTimeMs: durationMs }
})
check('three complete start/reset cycles with no accumulated pose/time/events', () => {
  const simulation = createAirportSimulation(config)
  const initial = simulation.getSnapshot()
  for (let i = 0; i < 3; i++) {
    report.cycles.push(runCycle(1 / 60, simulation))
    assert.equal(simulation.reset().ok, true)
    assert.deepEqual(simulation.getSnapshot(), initial)
  }
  assert.deepEqual(report.cycles[0], report.cycles[1])
  assert.deepEqual(report.cycles[1], report.cycles[2])
})
check('30/60/120 Hz supplied dt produce identical physical results', () => {
  for (const fps of [30, 60, 120]) report.frameRateResults.push({ suppliedFps: fps, ...runCycle(1 / fps) })
  const stable = result => ({ elapsed: result.elapsed, distance: result.distance, tractor: result.finalTractor,
    trailer: result.finalTrailer, wheels: result.wheelDistances, events: result.events })
  assert.deepEqual(stable(report.frameRateResults[0]), stable(report.frameRateResults[1]))
  assert.deepEqual(stable(report.frameRateResults[1]), stable(report.frameRateResults[2]))
})
check('pause freezes all state; resume advances only new supplied time', () => {
  const simulation = createAirportSimulation(config); assert.equal(simulation.start().ok, true)
  simulation.update(2.125); assert.equal(simulation.pause('验收暂停').ok, true)
  const paused = simulation.getSnapshot()
  for (const dt of [1 / 30, 1 / 60, 1 / 120, 25]) simulation.update(dt)
  assert.deepEqual(simulation.getSnapshot(), paused)
  assert.equal(simulation.resume().ok, true); simulation.update(.25)
  near(simulation.getSnapshot().elapsed - paused.elapsed, .25)
  assert.ok(simulation.getSnapshot().distance > paused.distance)
})
check('no frame-time truncation and snapshot mutation cannot change the model', () => {
  const a = createAirportSimulation(config), b = createAirportSimulation(config)
  a.start(); b.start(); a.update(2)
  for (let i = 0; i < 120; i++) b.update(1 / 60)
  assert.deepEqual(a.getSnapshot(), b.getSnapshot())
  const snapshot = a.getSnapshot(); snapshot.tractor.x = 12345; snapshot.events.push({ time: 0, message: 'injected' })
  snapshot.wheelDistances.tractorRear = -999
  assert.deepEqual(a.getSnapshot(), b.getSnapshot())
})
check('invalid route, invalid geometry and external asset errors block start', () => {
  const noRoute = copy(config); noRoute.route.outbound = []
  const noRod = copy(config); noRod.geometry.trailer.drawbarLength = 0
  for (const simulation of [createAirportSimulation(noRoute), createAirportSimulation(noRod),
    createAirportSimulation(config, ['缺少 BT-01 实际轮组节点'])]) {
    assert.equal(simulation.start().ok, false)
    const failed = simulation.getSnapshot()
    assert.equal(failed.runState, 'error'); assert.ok(failed.error)
    simulation.update(10); assert.deepEqual(simulation.getSnapshot(), failed)
  }
})
check('mid-arc obstacle is detected away from every route control point', () => {
  const obstructed = copy(config)
  const middle = sampleRoute(config.route.outbound, 13 + Math.PI * 9.5 / 2)
  obstructed.obstacles.push({ id: 'acceptance-mid-arc-obstacle', polygon: [
    { x: middle.x - .4, z: middle.z - .4 }, { x: middle.x + .4, z: middle.z - .4 },
    { x: middle.x + .4, z: middle.z + .4 }, { x: middle.x - .4, z: middle.z + .4 },
  ] })
  const validation = validateAirportTask(obstructed)
  assert.equal(validation.ok, false)
  assert.ok(validation.collisions.some(c => c.obstacle === 'acceptance-mid-arc-obstacle'))
  assert.equal(createAirportSimulation(obstructed).start().ok, false)
  return { firstCollision: validation.collisions.find(c => c.obstacle === 'acceptance-mid-arc-obstacle') }
})
check('tractor/cart body self-collision is rejected independently of the drawbar', () => {
  const impossible = copy(config); impossible.geometry.trailer.bodyFrontZ = 4.5
  const validation = validateAirportTask(impossible)
  assert.equal(validation.ok, false)
  assert.ok(validation.collisions.some(c => c.part === 'tractor-body' && c.obstacle === 'trailer-body'))
  assert.ok(validation.minTrainClearance < 0)
  return { minTrainClearance: validation.minTrainClearance }
})
check('route remains exact arcs/lines with C1 joints and prescribed length', () => {
  near(routeLength(config.route.outbound), 32 + 9.5 * Math.PI)
  near(routeLength(config.route.inbound), 13 + 6 * Math.PI)
  const end = sampleRoute(config.route.inbound, routeLength(config.route.inbound))
  near(end.x, config.parking.x); near(end.z, config.parking.z)
  near(angleDifference(end.heading, config.parking.heading), 0)
})

report.passed = report.failures.length === 0
await mkdir('docs', { recursive: true })
await writeFile('docs/airport-v02-simulation.json', JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify({ passed: report.passed, checks: report.checks, validation: report.validation,
  failures: report.failures, output: 'docs/airport-v02-simulation.json' }, null, 2))
if (!report.passed) process.exitCode = 1
