import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const source = readFileSync(new URL('./layout.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText
const { ASSETS, ZONES, ROADS, CONVEYORS, SITE, isBuilding } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`
)
const buildings = ASSETS.filter(isBuilding)
const ids = [...ASSETS, ...ROADS, ...CONVEYORS].map((item) => item.id)
assert.equal(new Set(ids).size, ids.length, 'IDs must be unique')
for (const asset of ASSETS) {
  assert.ok(asset.id && asset.name && asset.type)
  assert.ok(asset.size.every((n) => Number.isFinite(n) && n > 0))
  assert.ok(asset.position.every(Number.isFinite) && asset.rotation.every(Number.isFinite))
  assert.ok(ZONES.some((zone) => zone.id === asset.zone))
  assert.ok(asset.modelPath === null || typeof asset.modelPath === 'string')
}

function assetBox(asset) {
  const yaw = (asset.rotation[1] * Math.PI) / 180
  const halfX =
    (Math.abs(Math.cos(yaw)) * asset.size[0] + Math.abs(Math.sin(yaw)) * asset.size[2]) / 2
  const halfZ =
    (Math.abs(Math.sin(yaw)) * asset.size[0] + Math.abs(Math.cos(yaw)) * asset.size[2]) / 2
  return {
    xmin: asset.position[0] - halfX,
    xmax: asset.position[0] + halfX,
    zmin: asset.position[2] - halfZ,
    zmax: asset.position[2] + halfZ,
  }
}
function roadBox(road) {
  assert.ok(road.from[0] === road.to[0] || road.from[1] === road.to[1], 'Roads are orthogonal')
  const horizontal = road.from[1] === road.to[1]
  return {
    xmin: Math.min(road.from[0], road.to[0]) - (horizontal ? 0 : road.width / 2),
    xmax: Math.max(road.from[0], road.to[0]) + (horizontal ? 0 : road.width / 2),
    zmin: Math.min(road.from[1], road.to[1]) - (horizontal ? road.width / 2 : 0),
    zmax: Math.max(road.from[1], road.to[1]) + (horizontal ? road.width / 2 : 0),
  }
}
function overlap(a, b) {
  return (
    Math.min(a.xmax, b.xmax) - Math.max(a.xmin, b.xmin) > 0.01 &&
    Math.min(a.zmax, b.zmax) - Math.max(a.zmin, b.zmin) > 0.01
  )
}
function distance(a, b) {
  return Math.hypot(
    Math.max(0, a.xmin - b.xmax, b.xmin - a.xmax),
    Math.max(0, a.zmin - b.zmax, b.zmin - a.zmax),
  )
}

for (let i = 0; i < buildings.length; i++) {
  const building = buildings[i],
    box = assetBox(building)
  assert.ok(
    box.xmin >= -SITE.width / 2 &&
      box.xmax <= SITE.width / 2 &&
      box.zmin >= -SITE.depth / 2 &&
      box.zmax <= SITE.depth / 2,
    `${building.id} outside site`,
  )
  for (const other of buildings.slice(i + 1))
    assert.ok(!overlap(box, assetBox(other)), `Building overlap: ${building.id}/${other.id}`)
  for (const road of ROADS)
    assert.ok(!overlap(box, roadBox(road)), `Road intersects building: ${road.id}/${building.id}`)
  assert.ok(
    ROADS.some((road) => distance(box, roadBox(road)) < 0.1),
    `No access to ${building.id}`,
  )
}

// Intersection-based graph handles T junctions, including mid-segment entries.
const graph = ROADS.map((road) =>
  ROADS.flatMap((other, i) => (distance(roadBox(road), roadBox(other)) < 0.01 ? [i] : [])),
)
const visited = new Set([ROADS.findIndex((road) => road.id === 'main-entry-link')])
const queue = [...visited]
while (queue.length)
  for (const index of graph[queue.shift()])
    if (!visited.has(index)) {
      visited.add(index)
      queue.push(index)
    }
assert.equal(visited.size, ROADS.length, 'Every road/footpath must connect to main entrance')

function crossing(a, b, c, d) {
  const rx = b[0] - a[0],
    rz = b[1] - a[1],
    sx = d[0] - c[0],
    sz = d[1] - c[1]
  const det = rx * sz - rz * sx
  if (Math.abs(det) < 1e-9) return null
  const t = ((c[0] - a[0]) * sz - (c[1] - a[1]) * sx) / det
  const u = ((c[0] - a[0]) * rz - (c[1] - a[1]) * rx) / det
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : null
}
let elevatedRoadCrossings = 0
for (const conveyor of CONVEYORS) {
  assert.ok(
    ASSETS.some((asset) => asset.id === conveyor.fromAsset) &&
      ASSETS.some((asset) => asset.id === conveyor.toAsset),
  )
  for (const road of ROADS.filter((road) => road.kind !== 'walkway')) {
    const t = crossing(
      [conveyor.from[0], conveyor.from[2]],
      [conveyor.to[0], conveyor.to[2]],
      road.from,
      road.to,
    )
    if (t !== null) {
      const underside = conveyor.from[1] + (conveyor.to[1] - conveyor.from[1]) * t - 0.4
      assert.ok(underside > 5.5, `Conveyor clearance: ${conveyor.id}/${road.id}`)
      elevatedRoadCrossings++
    }
    for (const t of conveyor.supports) {
      const x = conveyor.from[0] + (conveyor.to[0] - conveyor.from[0]) * t
      const z = conveyor.from[2] + (conveyor.to[2] - conveyor.from[2]) * t
      assert.ok(
        !overlap({ xmin: x - 0.2, xmax: x + 0.2, zmin: z - 0.2, zmax: z + 0.2 }, roadBox(road)),
        `Conveyor support blocks ${road.id}`,
      )
    }
  }
}
assert.equal(
  ASSETS.filter((asset) => asset.modelPath).length,
  3,
  'Only headframe, shaft house and hoist house use detailed building models',
)
console.log(
  JSON.stringify(
    {
      result: 'PASS',
      assets: ASSETS.length,
      buildings: buildings.length,
      zones: ZONES.length,
      connectedRoads: visited.size,
      conveyors: CONVEYORS.length,
      elevatedRoadCrossings,
      buildingOverlaps: 0,
      buildingRoadOverlaps: 0,
    },
    null,
    2,
  ),
)
