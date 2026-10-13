/** Verify the exported binary resources and preservation of phase-2 layout. */
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import ts from 'typescript'

const root = new URL('../../', import.meta.url)
const read = (path) => readFileSync(new URL(path, root))
const baseline = JSON.parse(read('scripts/blender/core_production.layout-baseline.json'))
const config = JSON.parse(read('scripts/blender/core_production.parameters.json'))
const report = JSON.parse(read('public/models/mine-core-production.report.json'))
const source = read('src/features/mine-digital-twin/layout.ts').toString()
const js = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText
const current = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`)

for (const key of ['ZONES', 'ROADS', 'CONVEYORS', 'GROUNDING_RESERVES', 'SITE'])
  assert.deepEqual(current[key], baseline[key], `${key} changed outside phase-3 scope`)
for (const previous of baseline.ASSETS) {
  const next = structuredClone(current.ASSETS.find((a) => a.id === previous.id))
  assert.ok(next, `Missing asset ${previous.id}`)
  if (['shaft-house-01', 'hoist-house-01'].includes(previous.id)) {
    assert.equal(next.modelScale, 1)
    assert.equal(next.preserveModelOrigin, true)
    assert.ok(next.modelPath)
    next.modelPath = null
    delete next.modelScale
    delete next.preserveModelOrigin
  }
  assert.deepEqual(next, previous, `Asset layout changed: ${previous.id}`)
}
assert.equal(current.ASSETS.length, baseline.ASSETS.length)
for (const [id, name] of [['shaft-house-01', 'shaftHouse'], ['hoist-house-01', 'hoistHouse']]) {
  const asset = current.ASSETS.find((a) => a.id === id)
  assert.deepEqual(asset.position, config[name].position)
  assert.deepEqual(asset.size, config[name].size)
}
for (const [path, hash] of [
  ['scripts/blender/generate_mine_headframe.py', '989de6bff8b797cf75f95107a0a6526ccfeae246a91c095e9c406ce4cd2699b1'],
  ['public/models/mine-headframe.glb', '6d03cc94051c3d759a2b9e247ba08703dce507d994772d99091ae83c7729031b'],
]) assert.equal(createHash('sha256').update(read(path)).digest('hex'), hash, `Protected file changed: ${path}`)
assert.ok(report.headframeUnchanged)
assert.ok(report.alignment.tangentResiduals.every((value) => Math.abs(value) < 1e-5))
assert.ok(report.alignment.ropeDirectionJoinDotProducts.every((value) => value > .999))
assert.deepEqual(report.clearance.retainedFrameRopeCollisions, [])
assert.ok(report.clearance.ropeStationaryMinimumClearance > .25)
for (const key of ['hoistHouseRopeClearance', 'linksRopeClearance']) {
  assert.deepEqual(report[key].collisions, [])
  assert.ok(report[key].minimumClearance > .025)
}

const models = []
for (const exported of report.outputs) {
  const bytes = read(`public/models/${exported.file}`)
  assert.equal(bytes.readUInt32LE(0), 0x46546c67)
  assert.equal(bytes.readUInt32LE(4), 2)
  assert.equal(bytes.readUInt32LE(8), bytes.length)
  const jsonLength = bytes.readUInt32LE(12)
  assert.equal(bytes.readUInt32LE(16), 0x4e4f534a)
  const gltf = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString())
  const binOffset = 28 + jsonLength
  assert.equal(bytes.readUInt32LE(24 + jsonLength), 0x004e4942)
  assert.ok(gltf.buffers.every((buffer) => !buffer.uri))
  assert.ok((gltf.images ?? []).every((image) => image.bufferView !== undefined && !image.uri))
  let triangles = 0, vertices = 0
  const widths = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }
  for (const mesh of gltf.meshes) {
    for (const primitive of mesh.primitives) {
      assert.equal(primitive.mode ?? 4, 4)
      triangles += gltf.accessors[primitive.indices].count / 3
      vertices += gltf.accessors[primitive.attributes.POSITION].count
      for (const semantic of ['POSITION', 'NORMAL', 'TEXCOORD_0']) {
        const accessor = gltf.accessors[primitive.attributes[semantic]]
        assert.ok(accessor, `Missing ${semantic}`)
        assert.equal(accessor.componentType, 5126)
        const view = gltf.bufferViews[accessor.bufferView]
        const count = widths[accessor.type]
        const stride = view.byteStride ?? count * 4
        for (let i = 0; i < accessor.count; i++) {
          let norm = 0
          for (let j = 0; j < count; j++) {
            const offset = binOffset + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0) + i * stride + j * 4
            const value = bytes.readFloatLE(offset)
            assert.ok(Number.isFinite(value), `Nonfinite ${semantic} in ${exported.file}`)
            norm += value * value
          }
          if (semantic === 'NORMAL') assert.ok(Math.abs(norm - 1) < .03, 'Invalid normal')
        }
      }
    }
  }
  for (const material of gltf.materials) {
    const pbr = material.pbrMetallicRoughness
    assert.ok(pbr)
    for (const n of [pbr.metallicFactor ?? 1, pbr.roughnessFactor ?? 1]) assert.ok(n >= 0 && n <= 1)
  }
  assert.equal(triangles, exported.triangles)
  assert.equal(bytes.length, exported.bytes)
  assert.equal(gltf.meshes.length, exported.meshes)
  assert.ok(triangles < 60000 && gltf.materials.length <= 11)
  models.push({ ...exported, vertices, materials: gltf.materials.length, embeddedImages: gltf.images?.length ?? 0 })
}
const result = {
  result: 'PASS', layoutUnchanged: true, headframeUnchanged: true,
  tangentContinuity: true, ropeCollisionChecks: 'PASS; intentional groove/drum contact excluded',
  models, newTriangles: models.reduce((sum, m) => sum + m.triangles, 0),
  newBytes: models.reduce((sum, m) => sum + m.bytes, 0),
}
writeFileSync(new URL('public/models/mine-core-production.verification.json', root), JSON.stringify(result, null, 2))
console.log(JSON.stringify(result, null, 2))
