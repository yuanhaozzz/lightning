import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

export const projectRoot = new URL('../../', import.meta.url)
export const readProject = path => readFileSync(new URL(path, projectRoot))
export function parseGLB(path) {
  const bytes = readProject(path)
  assert.equal(bytes.readUInt32LE(0), 0x46546c67, `${path}: GLB magic`)
  assert.equal(bytes.readUInt32LE(4), 2, `${path}: GLB version`)
  assert.equal(bytes.readUInt32LE(8), bytes.length, `${path}: declared byte length`)
  const length = bytes.readUInt32LE(12)
  assert.equal(bytes.readUInt32LE(16), 0x4e4f534a)
  const json = JSON.parse(bytes.subarray(20, 20 + length))
  const binary = bytes.subarray(28 + length)
  return { bytes, json, binary }
}

/** Real GLTFLoader geometry/metadata; texture images omitted only in Node memory. */
export async function loadGLB(path) {
  const { json: jsonSource, binary } = parseGLB(path)
  const json = structuredClone(jsonSource)
  json.images = []; json.textures = []
  for (const material of json.materials ?? []) {
    delete material.normalTexture; delete material.occlusionTexture; delete material.emissiveTexture
    if (material.pbrMetallicRoughness) {
      delete material.pbrMetallicRoughness.baseColorTexture
      delete material.pbrMetallicRoughness.metallicRoughnessTexture
    }
  }
  const encoded = Buffer.from(JSON.stringify(json)), padding = (4 - encoded.length % 4) % 4
  const binaryPadding = (4 - binary.length % 4) % 4
  const bytes = Buffer.alloc(28 + encoded.length + padding + binary.length + binaryPadding)
  bytes.writeUInt32LE(0x46546c67, 0); bytes.writeUInt32LE(2, 4); bytes.writeUInt32LE(bytes.length, 8)
  bytes.writeUInt32LE(encoded.length + padding, 12); bytes.writeUInt32LE(0x4e4f534a, 16)
  encoded.copy(bytes, 20); bytes.fill(32, 20 + encoded.length, 20 + encoded.length + padding)
  bytes.writeUInt32LE(binary.length + binaryPadding, 20 + encoded.length + padding)
  bytes.writeUInt32LE(0x004e4942, 24 + encoded.length + padding)
  binary.copy(bytes, 28 + encoded.length + padding)
  return (await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '')).scene
}
export function findMetadata(root, key, value) {
  let found
  root.traverse(node => { if (node.userData[key] === value) { assert.ok(!found, `Duplicate ${key}=${value}`); found = node } })
  assert.ok(found, `Missing ${key}=${value}`)
  return found
}
export function shapeStats(root) {
  const materials = new Set(), geometries = new Set()
  let triangles = 0, meshes = 0
  root.updateMatrixWorld(true)
  root.traverse(node => {
    assert.ok(node.matrixWorld.elements.every(Number.isFinite), `Finite transform: ${node.name}`)
    if (!node.isMesh) return
    meshes++; geometries.add(node.geometry)
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) materials.add(material)
    triangles += (node.geometry.index?.count ?? node.geometry.attributes.position.count) / 3
    const p = node.geometry.attributes.position
    for (let i = 0; i < p.count; i++) assert.ok(Number.isFinite(p.getX(i)) && Number.isFinite(p.getY(i)) && Number.isFinite(p.getZ(i)), `Finite vertex: ${node.name}`)
  })
  const bounds = new THREE.Box3().setFromObject(root, true)
  return { triangles, meshes, geometries: geometries.size, materials: materials.size, bounds: { min: bounds.min.toArray(), max: bounds.max.toArray() } }
}

export function assertOriginalAssetsPreserved() {
  const baselinePath = new URL('tmp/distribution-drilldown-baseline/model-hashes.json', projectRoot)
  assert.ok(existsSync(baselinePath), 'Phase 2 pre-change snapshot exists')
  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8').replace(/^\uFEFF/, ''))
  let count = 0
  for (const [name, expected] of Object.entries(baseline)) {
    const actual = createHash('sha256').update(readProject(`public/models/${name}`)).digest('hex').toUpperCase()
    assert.equal(actual, expected, `Original resource changed: ${name}`)
    count++
  }
  return count
}

export async function verifyDistributionAsset(path = 'public/models/mine-distribution-drilldown.glb') {
  const root = await loadGLB(path), originalShell = await loadGLB('public/models/mine-distribution-shell.glb')
  const stats = shapeStats(root), shell = new THREE.Group()
  for (const name of ['distribution-shell-floor', 'distribution-shell-walls', 'distribution-shell-structure']) {
    const node = root.getObjectByName(name)
    assert.ok(node, `Independent building node ${name}`)
    shell.add(node.clone(true))
  }
  const before = new THREE.Box3().setFromObject(originalShell, true), after = new THREE.Box3().setFromObject(shell, true)
  const boundsError = Math.max(before.min.distanceTo(after.min), before.max.distanceTo(after.max))
  assert.ok(boundsError < .0002, `Building outline/location preserved, error ${boundsError}m`)
  const cabinet = root.getObjectByName('power-cabinet-lv-01-detail')
  assert.ok(cabinet, 'Independent detailed sample cabinet')
  assert.ok(cabinet.position.distanceTo(new THREE.Vector3(-2.35, .31, 2)) < 1e-6, 'Original cabinet datum')
  const roles = ['frame', 'door', 'backplate', 'busbars', 'breaker', 'terminal-rail', 'cables', 'spd-mount']
  const parts = {}
  for (const role of roles) {
    const object = findMetadata(root, 'drilldownId', `power-cabinet-lv-01/${role}`)
    parts[role] = object
    if (role !== 'spd-mount') assert.ok(shapeStats(object).triangles > 12, `Populated ${role} rather than empty group`)
  }
  const door = parts.door, axis = new THREE.Vector3(...door.userData.hingeAxis ?? door.userData.animationAxis ?? [0, 1, 0])
  assert.ok(axis.distanceTo(new THREE.Vector3(0, 1, 0)) < 1e-6, 'Vertical hinge axis')
  assert.ok(door.position.distanceTo(new THREE.Vector3(-.387, .11, -.590)) < 1e-6, 'Hinge on cabinet left front edge')
  root.updateMatrixWorld(true)
  const pivot = door.getWorldPosition(new THREE.Vector3()), originalQuaternion = door.quaternion.clone()
  const fixed = parts.frame.matrixWorld.clone()
  for (const angle of [0, .32, .8, 1.3, 1.92]) {
    door.quaternion.copy(originalQuaternion).multiply(new THREE.Quaternion().setFromAxisAngle(axis, angle))
    root.updateMatrixWorld(true)
    assert.ok(door.getWorldPosition(new THREE.Vector3()).distanceTo(pivot) < 1e-7, 'Door hinge stays fixed')
    assert.deepEqual(parts.frame.matrixWorld.elements, fixed.elements, 'Cabinet frame is stationary while door opens')
  }
  door.quaternion.copy(originalQuaternion)
  assert.ok(stats.triangles < 60000, 'Sample geometry bounded')
  assert.ok(stats.materials <= 24, 'Sample materials bounded')
  const bytes = parseGLB(path).bytes.length
  assert.ok(bytes < 6000000, 'Sample resource below 6 MB')
  const originalEquipment = parseGLB('public/models/mine-distribution-equipment.glb').json
  assert.equal(originalEquipment.nodes.filter(node => node.extras?.kind === 'cabinet').length, 12, 'All existing cabinet IDs retained')
  assert.ok(originalEquipment.nodes.some(node => node.extras?.id === 'spd-distribution'), 'SPD reservation ID retained')
  const report = { result: 'PASS', path, bytes, ...stats, shellBoundsErrorMeters: boundsError, originalResourcesPreserved: assertOriginalAssetsPreserved(), checks: ['independent room layers', 'unchanged building bounds', 'original cabinet datum', 'populated independently movable internals', 'vertical hinge and stable pivot', 'fixed frame while door rotates', 'original GLB resources unchanged'] }
  writeFileSync(new URL('tmp/distribution-drilldown-asset-verification.json', projectRoot), JSON.stringify(report, null, 2))
  return report
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(await verifyDistributionAsset(process.argv[2]), null, 2))
}
