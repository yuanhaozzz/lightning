import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
const source = readFileSync(
  new URL('../src/features/tianji-command/weather.ts', import.meta.url),
  'utf8',
)
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText
const weather = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`
)
for (const [distance, level] of [
  [0, 1],
  [50, 1],
  [50.001, 2],
  [100, 2],
  [100.001, 3],
  [150, 3],
  [150.001, 4],
  [200, 4],
  [200.001, 0],
]) {
  assert.equal(weather.warningLevel(distance).level, level, `Threshold at ${distance} km`)
}
for (const mine of weather.MINES)
  for (const radius of [50, 100, 150, 200])
    for (const bearing of [0, 45, 90, 180, 270]) {
      const point = weather.destination(mine.center, bearing, radius)
      assert.ok(Math.abs(weather.distanceKm(mine.center, point) - radius) < 1e-6, 'Ring radius')
    }
let previous = Infinity
for (let minute = 0; minute <= 90; minute++) {
  const near = weather.nearestStorm(weather.MINES[0], minute)
  assert.ok(Number.isFinite(near.distance) && near.distance >= 0)
  assert.ok(near.distance <= previous + 1e-6, 'Approaching scenario')
  assert.ok(
    Math.abs(weather.distanceKm(weather.MINES[0].center, near.edge) - near.distance) < 1e-6,
    'Line endpoint must agree with the displayed distance',
  )
  previous = near.distance
}
assert.ok(weather.nearestStorm(weather.MINES[0], 30).distance <= 200)
assert.equal(weather.nearestStorm(weather.MINES[0], 90).level.level, 1)
const simultaneous = weather
  .stormThreats(weather.MINES[0], 30)
  .filter((item) => item.distance <= 200)
assert.deepEqual(
  simultaneous.map((item) => item.storm.id),
  ['T06', 'T05', 'T01'],
)
assert.deepEqual(
  simultaneous.map((item) => item.level.level),
  [2, 3, 4],
)
assert.equal(new Set(simultaneous.map((item) => item.direction)).size, 3)
assert.ok(simultaneous.every((item) => item.approaching))
for (const mine of weather.MINES) {
  for (const minute of [0, 30.25, 60, 90]) {
    const threats = weather.stormThreats(mine, minute)
    assert.equal(new Set(threats.map((item) => item.storm.id)).size, weather.STORMS.length)
    assert.equal(threats[0].storm.id, weather.nearestStorm(mine, minute).storm.id)
    for (let i = 0; i < threats.length; i++) {
      const threat = threats[i]
      if (i) assert.ok(threat.distance >= threats[i - 1].distance, 'Priority must follow distance')
      assert.ok(Math.abs(weather.distanceKm(mine.center, threat.edge) - threat.distance) < 1e-6)
      const next = weather.stormDistance(mine, threat.storm, minute + 1)
      assert.equal(
        threat.approaching,
        threat.distance - next.distance > 0.02,
        'Trend follows the same cell',
      )
    }
  }
}
const coveredStorm = weather.STORMS[0]
assert.equal(
  weather.stormDistance(
    { ...weather.MINES[0], center: weather.stormPosition(coveredStorm, 30) },
    coveredStorm,
    30,
  ).distance,
  0,
)
assert.equal(weather.scenarioTime(30.75), '14:30')
for (const minute of [0, 30, 60, 90]) {
  assert.ok(
    weather
      .visibleStrikes(minute)
      .every((strike) => strike.minute <= minute && strike.minute > minute - 30),
    'Exclude future events',
  )
  const near = weather.nearestStorm(weather.MINES[0], minute)
  console.log(
    `${weather.scenarioTime(minute)}: ${near.distance.toFixed(1)} km / ${near.level.name}`,
  )
}
console.log(
  'PASS: warning thresholds, geodesic rings, simultaneous cell ranking/trends, distance agreement, coverage, fractional time, scenario progression and 30-minute event window.',
)
