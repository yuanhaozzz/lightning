import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const moduleUrl = (source) =>
  `data:text/javascript;base64,${Buffer.from(
    ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
    }).outputText,
  ).toString('base64')}`
const weatherUrl = moduleUrl(readFileSync(new URL('./weather.ts', import.meta.url), 'utf8'))
const weather = await import(weatherUrl)
const demoUrl = moduleUrl(
  readFileSync(new URL('./commandDemo.ts', import.meta.url), 'utf8').replace(
    "'./weather'",
    JSON.stringify(weatherUrl),
  ),
)
const demo = await import(demoUrl)
const analysis = await import(
  moduleUrl(
    readFileSync(new URL('./commandAnalysis.ts', import.meta.url), 'utf8')
      .replace("'./weather'", JSON.stringify(weatherUrl))
      .replace("'./commandDemo'", JSON.stringify(demoUrl)),
  )
)

assert.deepEqual(
  demo.DEMO_STORMS.map((s) => s.id),
  ['T01', 'T03', 'T05', 'T06'],
)
assert.equal(demo.DEMO_STORMS.filter((s) => s.primary).length, 1)
assert.deepEqual(demo.demoReading(demo.PRIMARY_STORM, demo.DEMO_NOW), { distance: 78, eta: 18 })
assert.equal(demo.PRIMARY_STORM.speed, 42)
assert.equal(demo.PRIMARY_STORM.bearing, 45)
assert.equal(demo.demoClock(demo.DEMO_NOW), '14:32')
assert.equal(demo.demoClock(demo.DEMO_END), '16:32')
assert.equal(
  demo.demoPhase(2.99),
  3,
  'Targets identified within the three-second acceptance window',
)
assert.equal(demo.demoPhase(5), 6, 'Threat relationship established within five seconds')
assert.equal(demo.demoPhase(5.3), 7, 'Final readings revealed by 5.3 seconds')
for (const storm of demo.DEMO_STORMS) {
  const before = demo.demoPosition(storm, demo.DEMO_NOW)
  const after = demo.demoPosition(storm, demo.DEMO_NOW + 60)
  assert.ok(
    Math.abs(weather.distanceKm(before, after) - storm.speed) < 1e-7,
    'Geographic motion agrees with speed',
  )
  let previous = Infinity
  for (let t = 0; t <= demo.DEMO_END; t += 0.25) {
    const reading = demo.demoReading(storm, t)
    assert.ok(reading.distance >= 0 && reading.eta >= 0)
    assert.ok(reading.distance <= previous, 'Mock approaching-distance readings remain monotonic')
    previous = reading.distance
  }
}
for (const km of [50, 100, 150, 200]) {
  for (const angle of [0, 45, 180, 270]) {
    assert.ok(
      Math.abs(
        weather.distanceKm(
          demo.DEMO_MINE.center,
          weather.destination(demo.DEMO_MINE.center, angle, km),
        ) - km,
      ) < 1e-7,
    )
  }
}
assert.equal(weather.warningLevel(demo.demoReading(demo.PRIMARY_STORM, 0).distance).level, 3)
assert.equal(
  weather.warningLevel(demo.demoReading(demo.PRIMARY_STORM, demo.DEMO_NOW).distance).level,
  2,
)
assert.equal(
  weather.warningLevel(demo.demoReading(demo.PRIMARY_STORM, demo.DEMO_END).distance).level,
  1,
)
assert.equal(demo.DEMO_EVENTS.length, 560)
assert.ok(
  demo.DEMO_EVENTS.every(
    (e) => e.minute >= 0 && e.minute <= demo.DEMO_END && e.position.every(Number.isFinite),
  ),
)
// Independent equatorial case: 111.2 km center distance, 10 km footprint, 60 km/h.
const storm = { ...demo.PRIMARY_STORM, center: [0, 0], radius: 10, bearing: 90, speed: 60 }
const mine = { id: 'test', name: '测试煤矿', region: '测试', center: [1, 0] }
const relation = analysis.analyzeRelation(storm, mine, demo.DEMO_NOW)
assert.ok(Math.abs(relation.distance - 101.195) < 0.01)
assert.equal(relation.eta, 102)
assert.equal(relation.approaching, true)
assert.equal(analysis.predictedArrival({ ...storm, bearing: 270 }, mine, demo.DEMO_NOW), null)
assert.equal(analysis.predictedArrival(storm, { ...mine, center: [1, 0.5] }, demo.DEMO_NOW), null)
assert.equal(analysis.predictedArrival(storm, { ...mine, center: [5, 0] }, demo.DEMO_NOW), null)
assert.equal(analysis.predictedArrival(storm, { ...mine, center: [0, 0] }, demo.DEMO_NOW), 0)
assert.equal(
  analysis.threatenedMinesForStorm(storm, demo.DEMO_NOW, [
    { ...mine, id: 'nearest-off-track', center: [0, 0.15] },
    { ...mine, id: 'near-lateral', center: [0.5, 0.085] },
    { ...mine, id: 'far-first-hit', center: [0.54, 0] },
  ])[0].mine.id,
  'far-first-hit',
  'Choose first impact along the swept corridor, not the shortest straight-line distance',
)
assert.deepEqual(
  analysis.threatenedMinesForStorm(storm, demo.DEMO_NOW, [
    { ...mine, center: [0, 0.15] },
    { ...mine, center: [-0.5, 0] },
    { ...mine, center: [5, 0] },
  ]),
  [],
  'No forced fallback to a nearby mine when the forecast misses',
)
assert.deepEqual(analysis.threateningStormsForMine(mine, demo.DEMO_NOW, []), [])
assert.deepEqual(
  analysis.threateningStormsForMine(mine, demo.DEMO_NOW, [
    { ...storm, id: 'away', bearing: 270 },
    { ...storm, id: 'near-miss', center: [0.95, 0.1] },
  ]),
  [],
  'Reverse analysis excludes nearby clouds whose paths miss the asset',
)
assert.equal(
  analysis.threateningStormsForMine({ ...mine, center: [2.5, 0] }, demo.DEMO_NOW, [
    { ...storm, speed: 120 },
  ]).length,
  1,
  'Reverse analysis includes incoming threats initially outside 200 km',
)
assert.equal(analysis.predictedArrival({ ...storm, speed: 0 }, mine, demo.DEMO_NOW), null)
assert.equal(
  analysis.predictedArrival(
    { ...storm, radius: 0.01, speed: 600 },
    { ...mine, center: [0.004, 0] },
    demo.DEMO_NOW,
  ),
  1,
  'A brief crossing between minute samples is detected',
)
assert.equal(analysis.resolveAnalysis({ kind: 'mine', id: 'zhundong' }, demo.DEMO_NOW).storm, null)
assert.equal(analysis.resolveAnalysis({ kind: 'storm', id: 'T01' }, demo.DEMO_NOW).mine, null)
const cloud = analysis.resolveAnalysis({ kind: 'storm', id: 'T06' }, demo.DEMO_NOW)
assert.equal(cloud.mine.id, 'shendong')
assert.ok(Math.abs(cloud.relation.distance - 78) < 1e-7)
assert.ok(
  cloud.relation.eta > 100,
  'Explicit analysis uses the moving footprint, not the opening mock ETA',
)
const defense = analysis.resolveAnalysis({ kind: 'mine', id: 'shendong' }, demo.DEMO_NOW)
assert.equal(defense.storm.id, 'T06')
assert.ok(defense.threats.every((r) => r.impactMinutes !== null && r.impactMinutes <= 180))
assert.equal(weather.MINES.filter((m) => analysis.mineVisible(m, 'priority', 'shendong')).length, 3)
assert.equal(weather.MINES.filter((m) => analysis.mineVisible(m, 'all', 'shendong')).length, 6)
assert.equal(analysis.mineVisible(weather.MINES[1], 'priority', weather.MINES[1].id), true)
console.log(
  'PASS: scenario, geographic motion, defense rings, corridor first impact, no-target state, continuous ETA, reverse threat analysis and mine visibility.',
)
