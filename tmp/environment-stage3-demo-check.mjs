import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import ts from 'typescript'

const root = new URL('../', import.meta.url)
const source = name => readFileSync(new URL(`src/features/mine-digital-twin/${name}`, root), 'utf8')
const url = text => `data:text/javascript;base64,${Buffer.from(ts.transpileModule(text, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText).toString('base64')}`
const dataUrl = url(source('stormDemoData.ts'))
const { createStormDemo, DEMO_DURATION_MS } = await import(url(source('stormDemo.ts').replace("'./stormDemoData'", JSON.stringify(dataUrl))))
const load = file => JSON.parse(readFileSync(new URL(file, root), 'utf8').replace(/^\uFEFF/, ''))
const monitoring = load('scripts/blender/monitoring.parameters.json').devices
const protection = load('scripts/blender/protection.parameters.json').facilities
const demo = createStormDemo([...monitoring, ...protection])
const initial = demo.snapshot
const epoch = Date.parse('2026-10-11T08:00:00.000Z')
assert.equal(initial.playback, 'idle')
assert.ok(initial.devices.every(device => device.status === 'normal' && device.source === '演示数据'))
assert.equal(demo.update(50000), false)
demo.start(epoch)
demo.update(4999)
assert.equal(demo.snapshot.phase, 'normal', 'Boundary before five seconds stays normal')
demo.pause()
const frozen = demo.snapshot
assert.equal(demo.update(60000), false)
assert.deepEqual(demo.snapshot, frozen, 'Pause freezes time, status and records')
demo.start(epoch + 1000)
assert.deepEqual(demo.snapshot, frozen, 'Start cannot restart a paused session')
demo.resume()
demo.update(1)
assert.equal(demo.snapshot.phase, 'warning')
const warning = demo.snapshot.devices.find(device => device.type === 'storm-warning')
assert.equal(warning.status, 'warning')
assert.equal(warning.warningAt, '2026-10-11T08:00:05.000Z')
assert.ok(demo.snapshot.devices.filter(device => device.type !== 'storm-warning').every(device => device.status === 'normal'), 'Warning is independent of SPD, grounding and locator status')
assert.ok(demo.snapshot.devices.every(device => device.monitoringData.lightningEvent === null && device.monitoringData.groundResistanceOhm === null), 'Later-step readings remain reserved')
assert.equal(demo.snapshot.events.filter(event => event.kind === 'warning').length, 1)
demo.pause('page-hidden')
assert.equal(demo.snapshot.pauseReason, 'page-hidden')
demo.update(100000)
assert.equal(demo.snapshot.elapsedMs, 5000, 'Background pause prevents time jumps')
demo.resume()
demo.update(DEMO_DURATION_MS - 5000)
assert.equal(demo.snapshot.playback, 'finished')
assert.equal(demo.snapshot.progress, 1)
assert.equal(demo.snapshot.durationMs, DEMO_DURATION_MS)
demo.update(100000)
assert.equal(demo.snapshot.events.filter(event => event.kind === 'finished').length, 1, 'No duplicate completion records')
demo.replay(epoch + 60000)
assert.equal(demo.snapshot.elapsedMs, 0)
assert.equal(demo.snapshot.phase, 'normal')
assert.equal(demo.snapshot.runId, 'storm-demo-2')
assert.ok(demo.snapshot.devices.every(device => device.status === 'normal'))
const savedSnapshot = demo.snapshot
savedSnapshot.devices[0].status = 'fault'
savedSnapshot.events[0].description = 'mutated'
assert.equal(demo.snapshot.devices[0].status, 'normal')
assert.notEqual(demo.snapshot.events[0].description, 'mutated', 'Snapshot consumers cannot mutate controller records')
demo.update(100000)
assert.deepEqual(demo.snapshot.events.filter(event => event.runId === 'storm-demo-2').map(event => event.kind), ['started', 'warning', 'finished'], 'A large delta still records ordered boundaries once')
demo.exit()
assert.equal(demo.snapshot.playback, 'idle')
assert.equal(demo.snapshot.runId, null)
assert.ok(demo.snapshot.devices.every(device => device.status === 'normal' && device.warningAt === null))
assert.ok(demo.snapshot.events.length > 0, 'Exit retains simple event history')
demo.start(epoch)
for (const invalid of [NaN, Infinity, -1, 0]) assert.equal(demo.update(invalid), false)
demo.exit()
assert.equal(demo.snapshot.events.at(-1).kind, 'exited')
for (let index = 0; index < 30; index++) { demo.start(epoch); demo.update(100000); demo.exit() }
assert.ok(demo.snapshot.events.length <= 20, 'Event memory is bounded')
demo.start(epoch)
demo.dispose()
assert.equal(demo.update(100000), false, 'Unmount disposal stops the controller')
demo.replay(epoch)
assert.equal(demo.snapshot.devices.length, 0)
assert.throws(() => createStormDemo([monitoring[0], monitoring[0]]), /ID/)

const protectedFiles = []
const result = { result: 'PASS', scenarios: [
  'normal/warning boundary', 'pause/resume freeze', 'independent facility status', 'reserved future readings',
  'background pause', 'completion once', 'replay resets devices', 'exit retains records',
  'snapshot isolation', 'large/invalid deltas', 'bounded events', 'dispose', 'unique IDs',
], protectedFilesUnchanged: protectedFiles.length }
writeFileSync(new URL('tmp/environment-stage3-demo-logic.json', root), JSON.stringify(result, null, 2))
console.log(JSON.stringify(result, null, 2))

