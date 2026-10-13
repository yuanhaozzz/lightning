/** Validate actual exported meshes, semantic identities, occlusion and reversible inspection. */
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import ts from 'typescript'
const root = new URL('../../', import.meta.url), read = p => readFileSync(new URL(p, root))
const cfg = JSON.parse(read('scripts/blender/protection.parameters.json'))
const report = JSON.parse(read('public/models/mine-protection.report.json'))
const baseline = JSON.parse(read('scripts/blender/protection.protected-baseline.json').toString().replace(/^\uFEFF/, ''))
for (const item of baseline) assert.equal(createHash('sha256').update(read(item.path)).digest('hex').toUpperCase(), item.hash, item.path)
const compile = p => ts.transpileModule(read(p).toString(), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText
const uri = code => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
const threeUrl = new URL('node_modules/three/build/three.module.js', root).href
const constants = `const PROTECTION_FACILITIES=${JSON.stringify(cfg.facilities)}, CABINET_INSPECTION=${JSON.stringify(cfg.cabinetInspection)}, GROUND_WINDOW=${JSON.stringify(cfg.groundWindow)};`
const code = compile('src/features/mine-digital-twin/protectionScene.ts').replace("from 'three'", `from '${threeUrl}'`)
  .replace("import { PROTECTION_FACILITIES, CABINET_INSPECTION, GROUND_WINDOW } from './protectionFacilities';", constants)
  .replaceAll('import.meta.env.BASE_URL', "''")
const { createProtection } = await import(uri(code))
const { frameProtectionInspection, protectionInspectionBounds } = await import(uri(compile('src/features/mine-digital-twin/protectionInspection.ts').replace("from 'three'", `from '${threeUrl}'`)))
const { ASSETS, ROADS } = await import(uri(compile('src/features/mine-digital-twin/layout.ts')))
const loader = new GLTFLoader(), resources = new Map(), resourceChecks = []
async function load(file, check = false) {
  const bytes = read('public/models/' + file)
  assert.equal(bytes.readUInt32LE(0), 0x46546c67); assert.equal(bytes.readUInt32LE(8), bytes.length)
  const n = bytes.readUInt32LE(12), json = JSON.parse(bytes.subarray(20, 20 + n)), binOffset = 28 + n
  if (check) {
    assert.ok(json.buffers.every(b => !b.uri)); assert.ok((json.images ?? []).every(i => i.bufferView !== undefined))
    let triangles = 0
    for (const mesh of json.meshes) for (const primitive of mesh.primitives) {
      triangles += json.accessors[primitive.indices].count / 3
      for (const semantic of ['POSITION', 'NORMAL', 'TEXCOORD_0']) {
        const a = json.accessors[primitive.attributes[semantic]], view = json.bufferViews[a.bufferView], dims = { VEC2: 2, VEC3: 3 }[a.type]
        assert.equal(a.componentType, 5126)
        for (let i = 0; i < a.count; i++) {
          let norm = 0
          for (let j = 0; j < dims; j++) {
            const f = bytes.readFloatLE(binOffset + (view.byteOffset ?? 0) + (a.byteOffset ?? 0) + i * (view.byteStride ?? dims * 4) + j * 4)
            assert.ok(Number.isFinite(f)); norm += f * f
          }
          if (semantic === 'NORMAL') assert.ok(Math.abs(norm - 1) < .03)
        }
      }
    }
    const entry = report.outputs.find(o => o.file === file)
    assert.equal(triangles, entry.triangles); assert.equal(bytes.length, entry.bytes)
    assert.ok(triangles < cfg.maxTrianglesPerModel && bytes.length < cfg.maxBytesPerModel)
    assert.ok(json.materials.length <= 6)
    assert.equal(json.nodes.filter(node => node.extras?.schematic === true).length, 1)
    for (const mat of json.materials) for (const value of [mat.pbrMetallicRoughness.metallicFactor ?? 1, mat.pbrMetallicRoughness.roughnessFactor ?? 1]) assert.ok(value >= 0 && value <= 1)
    resourceChecks.push({ file, triangles, bytes: bytes.length, materials: json.materials.length, meshes: json.meshes.length })
  }
  // Geometry-only Node loading; all real image data remain in the delivered GLBs.
  delete json.images; delete json.textures; delete json.samplers
  for (const mat of json.materials ?? []) {
    delete mat.normalTexture; delete mat.occlusionTexture; delete mat.emissiveTexture
    delete mat.pbrMetallicRoughness.baseColorTexture; delete mat.pbrMetallicRoughness.metallicRoughnessTexture
  }
  const text = Buffer.from(JSON.stringify(json)), padded = Buffer.alloc(Math.ceil(text.length / 4) * 4, 0x20); text.copy(padded)
  const tail = bytes.subarray(20 + n), modified = Buffer.alloc(20 + padded.length + tail.length)
  modified.writeUInt32LE(0x46546c67); modified.writeUInt32LE(2, 4); modified.writeUInt32LE(modified.length, 8)
  modified.writeUInt32LE(padded.length, 12); modified.writeUInt32LE(0x4e4f534a, 16); padded.copy(modified, 20); tail.copy(modified, 20 + padded.length)
  return (await loader.parseAsync(modified.buffer.slice(modified.byteOffset, modified.byteOffset + modified.length), '')).scene
}
for (const output of report.outputs) resources.set('models/' + output.file, await load(output.file, true))
const scene = new THREE.Group(), room = new THREE.Group(); room.position.set(53, 0, -10); scene.add(room)
for (const file of ['mine-distribution-shell.glb', 'mine-distribution-roof.glb', 'mine-distribution-equipment.glb']) room.add(await load(file))
const terrainMat = new THREE.MeshStandardMaterial(), zoneMat = new THREE.MeshStandardMaterial()
const terrain = new THREE.Mesh(new THREE.BoxGeometry(150, .35, 120), terrainMat)
terrain.name = 'mine-site-ground'; terrain.position.y = -.175; scene.add(terrain)
const patch = new THREE.Mesh(new THREE.PlaneGeometry(25, 40), zoneMat)
patch.name = 'power'; patch.rotation.x = -Math.PI / 2; patch.position.set(53, .014, -20); scene.add(patch)
const protection = createProtection(scene), requests = []
await protection.load({ loadAsync: async path => { requests.push(path); return { scene: resources.get(path).clone(true) } } }, () => false, () => { throw new Error('Unexpected disposal') })
assert.equal(protection.count, 9); assert.equal(requests.length, 9, 'Repeated poles must share one parsed resource')
assert.equal(new Set(cfg.facilities.map(item => item.id)).size, cfg.facilities.length)
let cabinet, oldReserve, monitorReserve
room.traverse(node => {
  if (node.userData.id === 'power-cabinet-lv-01') cabinet = node
  if (node.userData.id === 'spd-distribution') oldReserve = node
  if (node.userData.id === 'grounding-monitor-reserve-01') monitorReserve = node
})
assert.ok(cabinet); assert.equal(oldReserve.visible, false); assert.equal(monitorReserve.visible, false)
const originals = []; cabinet.traverse(node => { if (node instanceof THREE.Mesh && !node.name.startsWith('inspection-insert__')) originals.push(node) })
const liner = cabinet.getObjectByName('spd-cabinet-inspection-insert')
assert.equal(liner.visible, false); assert.ok(originals.every(mesh => mesh.visible))
assert.equal(protection.object('spd-lv-01').visible, false)
assert.equal(protection.select('spd-lv-01'), null, 'Covered SPD must not be selected')
protection.setRoofVisible(false); scene.updateMatrixWorld(true)
assert.ok(originals.every(mesh => !mesh.visible)); assert.equal(liner.visible, true)
const spdBox = new THREE.Box3().setFromObject(protection.object('spd-lv-01'), true)
assert.ok(new THREE.Box3(new THREE.Vector3(50.2575, .42, -8.575), new THREE.Vector3(51.0425, 2.67, -7.425)).containsBox(spdBox), 'SPD must lie inside original cabinet volume')
const cameraChecks = []
for (const facility of cfg.facilities) {
  protection.setRoofVisible(facility.type !== 'spd')
  protection.setEarthInspection(facility.type === 'earth-section')
  scene.updateMatrixWorld(true)
  const object = protection.object(facility.id), bound = protectionInspectionBounds(object, facility)
  assert.equal(protection.select(facility.id)?.id, facility.id)
  assert.equal(scene.getObjectByName('protection-selection-outline'), undefined, 'No bounding-box highlight')
  if (facility.type === 'air-terminal') {
    const old = ASSETS.find(a => a.id === facility.id)
    assert.deepEqual([facility.position[0], facility.position[2]], [old.position[0], old.position[2]])
    let foundation; object.traverse(node => { if (node instanceof THREE.Mesh && node.name.includes('Protection_concrete')) foundation = node })
    const floor = new THREE.Box3().setFromObject(foundation, true)
    assert.ok(Math.abs(floor.min.y - .014) < .00001)
    // Both rods fit within the previous reserved footprint and remain off roads.
    for (const road of ROADS) {
      const horizontal = road.from[1] === road.to[1]
      const minX = Math.min(road.from[0], road.to[0]) - (horizontal ? 0 : road.width / 2), maxX = Math.max(road.from[0], road.to[0]) + (horizontal ? 0 : road.width / 2)
      const minZ = Math.min(road.from[1], road.to[1]) - (horizontal ? road.width / 2 : 0), maxZ = Math.max(road.from[1], road.to[1]) + (horizontal ? road.width / 2 : 0)
      assert.ok(floor.max.x < minX || floor.min.x > maxX || floor.max.z < minZ || floor.min.z > maxZ, facility.id + ' overlaps road')
    }
  }
  for (const [width, height] of [[604, 871], [1440, 900], [390, 844]]) {
    const camera = new THREE.PerspectiveCamera(40, width / height, .5, 1600)
    const frame = frameProtectionInspection(camera, object, facility, width, height)
    camera.near = frame.nearPlane; camera.position.copy(frame.position); camera.lookAt(frame.target)
    camera.setViewOffset(width, height, frame.offsetX, frame.offsetY, width, height); camera.updateMatrixWorld(true)
    for (const x of [bound.min.x, bound.max.x]) for (const y of [bound.min.y, bound.max.y]) for (const z of [bound.min.z, bound.max.z]) {
      const point = new THREE.Vector3(x, y, z).project(camera), sx = (point.x + 1) * width / 2, sy = (1 - point.y) * height / 2
      assert.ok(sx >= 25 && sx <= width - 25 && sy >= (width < 500 ? 350 : 300) && sy <= height - 45, `${facility.id} clipped by toolbar`)
    }
    cameraChecks.push({ id: facility.id, width, height, distance: frame.position.distanceTo(frame.target), nearPlane: frame.nearPlane })
  }
}
// Actual nearest-visible-mesh picking inside a cabinet and on an enclosure.
const picks = []
for (const [id, target, direction] of [
  ['spd-lv-01', [50.65, 1.42, -8], [0, 0, -1]],
  ['ground-monitor-01', [43.8, 1.35, -6.9], [-1, 0, 0]],
  ['earth-section-01', [43.13, -.4, -6.9], [-.3, 1.2, -.24]],
]) {
  protection.setRoofVisible(false); protection.setEarthInspection(id === 'earth-section-01'); scene.updateMatrixWorld(true)
  const camera = new THREE.PerspectiveCamera(40, 1, .025, 100)
  const center = new THREE.Vector3(...target)
  camera.position.copy(center).add(new THREE.Vector3(...direction)); camera.lookAt(center); camera.updateMatrixWorld(true)
  assert.equal(protection.pick(new THREE.Vector2(), camera)?.id, id, 'Actual mesh click')
  const blocker = new THREE.Mesh(new THREE.BoxGeometry(.3, .3, .03), new THREE.MeshBasicMaterial())
  blocker.position.copy(center).lerp(camera.position, .8); blocker.lookAt(camera.position); scene.add(blocker); scene.updateMatrixWorld(true)
  assert.equal(protection.pick(new THREE.Vector2(), camera), null, 'Occluded facilities must not be selectable')
  scene.remove(blocker); blocker.geometry.dispose(); blocker.material.dispose(); picks.push(id)
}
// Material tint is reversible and a reused pole's material stays untouched.
const poleA = protection.object('air-terminal-production'), poleB = protection.object('air-terminal-power')
let meshA, meshB; poleA.traverse(n => { if (n instanceof THREE.Mesh && n.name.includes('Protection_metal')) meshA = n }); poleB.traverse(n => { if (n instanceof THREE.Mesh && n.name.includes('Protection_metal')) meshB = n })
protection.clearSelection(); const matA = meshA.material, matB = meshB.material
assert.equal(matA, matB); protection.select('air-terminal-production'); assert.notEqual(meshA.material, matA); assert.equal(meshB.material, matB)
protection.clearSelection(); assert.equal(meshA.material, matA)
protection.setEarthInspection(true)
const shader = { uniforms: {}, vertexShader: '#include <project_vertex>', fragmentShader: '#include <clipping_planes_fragment>' }
terrainMat.onBeforeCompile(shader, {})
assert.equal(shader.uniforms.protectionCutaway.value, true); assert.ok(shader.fragmentShader.includes('43.350'))
protection.setEarthInspection(false); assert.equal(shader.uniforms.protectionCutaway.value, false)
protection.setRoofVisible(true); assert.ok(originals.every(mesh => mesh.visible)); assert.equal(liner.visible, false)
assert.equal(protection.object('spd-lv-01').visible, false)
for (const check of report.roofClearanceChecks) assert.ok(check.surfaceClearanceMeters > .04)
// Endpoint continuity: roof conductor -> downlead, wall interface -> local earth,
// and both monitor leads -> independent below-ground terminal blocks.
const routePoints = file => report.outputs.find(o => o.file === file).routes
for (const roof of ['hoist', 'distribution']) {
  const first = routePoints(`mine-downlead-${roof}.glb`)[0].points[0]
  assert.ok(routePoints(`mine-air-belt-${roof}.glb`)[0].points.some(p => new THREE.Vector3(...p).distanceTo(new THREE.Vector3(...first)) < .001))
}
const down = routePoints('mine-downlead-distribution.glb')[0].points.at(-1).map((v, i) => v + cfg.facilities.find(f => f.id === 'downlead-distribution-01').position[i])
const earth = routePoints('mine-earth-section.glb')[0].points[0].map((v, i) => v + cfg.facilities.find(f => f.id === 'earth-section-01').position[i])
assert.ok(new THREE.Vector3(...down).distanceTo(new THREE.Vector3(...earth)) < .001)
assert.ok(cfg.groundWindow.center[1] - cfg.groundWindow.size[1] / 2 > -8, 'Local section must stay outside the west access road')
protection.dispose(); assert.ok(originals.every(mesh => mesh.visible))
const result = { result: 'PASS', protectedFilesUnchanged: baseline.length, facilities: cfg.facilities, resources: resourceChecks,
  totalResourceBytes: resourceChecks.reduce((sum, item) => sum + item.bytes, 0), totalResourceTriangles: resourceChecks.reduce((sum, item) => sum + item.triangles, 0),
  instantiatedTriangles: resourceChecks.reduce((sum, item) => sum + item.triangles, 0) + resourceChecks.find(item => item.file === 'mine-air-terminal.glb').triangles,
  checks: { uniqueIds: true, actualMeshRaycasts: picks, occlusion: true, sharedResourceHighlightIsolation: true, reversibleRoofAndCabinet: true,
    spdInsideCabinet: true, localCutawayShader: true, roofNetClearance: report.roofClearanceChecks, connectedConductorEndpoints: true, originalModelsAndLayoutUntouched: true }, cameraChecks }
writeFileSync(new URL('public/models/mine-protection.verification.json', root), JSON.stringify(result, null, 2))
console.log(JSON.stringify({ result: result.result, protectedFilesUnchanged: baseline.length, resources: resourceChecks, bytes: result.totalResourceBytes, triangles: result.instantiatedTriangles, cameraChecks: cameraChecks.length, picks }))
