import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import ts from 'typescript'
import * as THREE from 'three'
import { projectRoot, readProject, loadGLB, assertOriginalAssetsPreserved } from '../../../scripts/blender/verify_distribution_drilldown.mjs'

// Minimal DOM for CSS2DObject lifecycle. Geometry, transforms and materials come
// from the real exported GLBs; browser QA separately verifies pixels/picking.
const elements = []
class ElementStub {
  constructor() { this.style = {}; this.attributes = {}; this.parentNode = null; this.ownerDocument = documentStub; this.removed = false; elements.push(this) }
  setAttribute(name, value) { this.attributes[name] = value }
  remove() { this.removed = true; this.parentNode = null }
}
const documentStub = { defaultView: { Element: ElementStub }, createElement: () => new ElementStub() }
globalThis.document = documentStub
const runtimeURL = new URL('tmp/distribution-drilldown.runtime.mjs', projectRoot)
const runtimeCode = ts.transpileModule(readProject('src/features/mine-digital-twin/distributionDrilldown.ts').toString(), {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText.replaceAll('import.meta.env.BASE_URL', "''")
writeFileSync(runtimeURL, runtimeCode)
const { createDistributionDrilldown } = await import(runtimeURL.href + '?test=' + Date.now())
const ROOM = 'distribution-01', CAB = 'power-cabinet-lv-01', SPD = 'spd-lv-01'
const near = (a, b, message, epsilon = 1e-7) => assert.ok(Math.abs(a - b) < epsilon, `${message}: ${a} vs ${b}`)
const materials = mesh => Array.isArray(mesh.material) ? mesh.material : [mesh.material]
const state = node => ({ parent: node.parent, position: node.position.toArray(), quaternion: node.quaternion.toArray(), scale: node.scale.toArray(), visible: node.visible })
const pose = runtime => Object.fromEntries(['roofLift', 'wallOpacity', 'cabinetOffset', 'doorAngle', 'explode'].map(key => [key, runtime.snapshot[key]]))
function step(runtime, seconds, hz = 60, status = 'running') {
  const frames = Math.round(seconds * hz)
  for (let i = 0; i < frames; i++) runtime.update(seconds / frames, status)
}
function settle(runtime, hz = 60) {
  let frames = 0
  while (runtime.snapshot.transitioning && frames++ < hz * 20) runtime.update(1 / hz, 'running')
  assert.ok(!runtime.snapshot.transitioning, 'Finite transition completes')
}
async function fixture(options = {}) {
  const root = new THREE.Group(), room = new THREE.Group(); room.name = ROOM; room.position.set(53, 0, -10); root.add(room)
  const [shell, roof, equipment, spd, band, liner, indicators] = await Promise.all([
    'mine-distribution-shell.glb', 'mine-distribution-roof.glb', 'mine-distribution-equipment.glb', 'mine-spd.glb',
    'mine-air-belt-distribution.glb', 'mine-spd-cabinet-liner.glb', 'mine-power-indicators.glb',
  ].map(name => loadGLB('public/models/' + name)))
  shell.name = 'distribution-shell'; roof.name = 'distribution-roof'; liner.name = 'spd-cabinet-inspection-insert'; liner.position.set(-2.35, .31, 2)
  room.add(shell, roof, equipment, liner, indicators)
  spd.name = SPD; spd.userData.facilityId = SPD; spd.position.set(50.65, 1.42, -8); spd.visible = false; root.add(spd)
  band.name = 'roof-belt-distribution-01'; band.position.set(53, 0, -10); root.add(band)
  let originalCabinet; equipment.traverse(node => { if (node.userData.id === CAB) originalCabinet = node })
  assert.ok(originalCabinet, 'Actual low-voltage cabinet ID')
  const lamps = []; indicators.traverse(node => { if (node.userData.factoryEntityId === CAB && node.userData.animationRole === 'status-lamp') lamps.push(node) })
  assert.equal(lamps.length, 3, 'Actual three independent state lamps')
  root.updateMatrixWorld(true)
  const originals = new Map(), originalResources = new Set(), disposalCounts = new Map()
  root.traverse(node => {
    originals.set(node, { ...state(node), material: node.isMesh ? node.material : null })
    if (node.isMesh) { originalResources.add(node.geometry); materials(node).forEach(material => originalResources.add(material)) }
  })
  originalResources.forEach(resource => { disposalCounts.set(resource, 0); resource.addEventListener('dispose', () => disposalCounts.set(resource, disposalCounts.get(resource) + 1)) })
  const callbacks = { camera: [], cameraStart: 0, selection: [], managed: [] }
  const runtime = await createDistributionDrilldown(root, { loadAsync: async path => ({ scene: await loadGLB('public/models/' + path.split('/').at(-1)) }) }, {
    onCamera: (frame, progress) => callbacks.camera.push({ frame, progress }), onCameraStart: () => callbacks.cameraStart++, onSelection: id => callbacks.selection.push(id),
    onManaged: enabled => callbacks.managed.push(enabled), ...options,
  })
  const detail = root.getObjectByName('distribution-drilldown-detail'), roles = new Map()
  detail.traverse(node => { if (node.userData.drilldownRole) roles.set(node.userData.drilldownRole, node) })
  return { root, room, shell, roof, spd, band, lamps, runtime, callbacks, originals, originalResources, disposalCounts, roles, detail }
}

const f = await fixture(), r = f.runtime, initialPose = pose(r)
assert.equal(r.snapshot.stage, 'park'); assert.equal(r.snapshot.lampCount, 3)
assert.deepEqual(f.callbacks.managed, [true])
assert.ok(r.supports(ROOM) && r.supports(CAB) && r.supports(SPD)); assert.ok(!r.supports('power-cabinet-lv-02'))
assert.equal(r.enter('unknown'), false)
assert.strictEqual(f.spd.parent, f.roles.get('spd-mount'), 'Reused SPD attached to real mount')
for (const lamp of f.lamps) assert.strictEqual(lamp.parent, f.roles.get('door'), 'Reused lamps travel with hinged door')
const roofBase = f.roof.position.clone(), bandBase = f.band.position.clone(), cabinetBase = r.cabinetObject.position.clone()
const movingParts = [...f.roles.values()].filter(node => Array.isArray(node.userData.explodeVector)), partBases = new Map(movingParts.map(node => [node, node.position.clone()]))
const originalSPDMaterials = []; f.spd.traverse(node => { if (node.isMesh) originalSPDMaterials.push([node, node.material]) })
const originalLampMaterials = []; f.lamps.forEach(lamp => lamp.traverse(node => { if (node.isMesh) originalLampMaterials.push([node, node.material]) }))

r.enter(ROOM); step(r, .5)
assert.ok(r.snapshot.roofLift > 0 && r.snapshot.roofLift < 4.8, 'Continuous partial roof movement')
assert.ok(f.roof.visible, 'Roof remains a visible solid')
settle(r); assert.equal(r.snapshot.stage, 'building'); near(r.snapshot.roofLift, 4.8, 'Roof lifting height'); near(r.snapshot.wallOpacity, .12, 'Wall transparency')
near(f.roof.position.y - roofBase.y, 4.8, 'Actual roof transform'); near(f.band.position.y - bandBase.y, 4.8, 'Roof conductor follows roof')
const wallMeshes = []; f.roles.get('walls').traverse(node => { if (node.isMesh) wallMeshes.push(node) })
assert.ok(wallMeshes.length > 0); assert.ok(wallMeshes.every(mesh => materials(mesh).every(material => material.transparent && !material.depthWrite && material.opacity <= .12 + 1e-7)))
assert.ok(r.ignoresHit({ object: wallMeshes[0] }), 'Transparent outer shell does not block internal picks')

r.enter(CAB); settle(r); assert.equal(r.snapshot.stage, 'device')
near(r.cabinetObject.position.z - cabinetBase.z, -.30, 'Cabinet translates forward without scaling')
assert.deepEqual(r.cabinetObject.scale.toArray(), [1, 1, 1], 'No fake whole-model scale')
const door = f.roles.get('door'), hingeWorld = door.getWorldPosition(new THREE.Vector3())
assert.ok(r.snapshot.doorAngle > 1.7, 'Real hinge opened')
assert.ok(door.quaternion.angleTo(new THREE.Quaternion()) > 1.7, 'Actual door quaternion rotated')
assert.strictEqual(f.spd.parent, f.roles.get('spd-mount')); assert.ok(f.spd.visible)
for (const [mesh, material] of [...originalSPDMaterials, ...originalLampMaterials]) assert.strictEqual(mesh.material, material, 'Original operational SPD/lamp material identity retained')
const flow = f.root.getObjectByName('lv01-main-circuit-flow'); assert.ok(flow.visible, 'Flow active only for running cabinet')
assert.ok([...flow.geometry.attributes.position.array].every(Number.isFinite), 'Finite main-circuit flow geometry')
r.update(.02, 'fault'); assert.ok(!flow.visible, 'Fault stops flow'); r.update(.02, 'stopped'); assert.ok(!flow.visible, 'Stopped has no electrical flow'); r.update(.02, 'running'); assert.ok(flow.visible)
const circuitBefore = Array.from(flow.geometry.attributes.position.array); step(r, .3); assert.notDeepEqual(Array.from(flow.geometry.attributes.position.array), circuitBefore, 'Particles move along authored paths')

const breaker = r.components.find(component => component.id.endsWith('/breaker')); assert.ok(breaker)
r.enter(breaker.id); settle(r); assert.equal(r.snapshot.stage, 'component'); near(r.snapshot.explode, 1, 'Full component decomposition')
assert.ok(!flow.visible, 'No misleading current flow across exploded/disconnected components')
for (const node of movingParts) {
  const expected = partBases.get(node).clone().add(new THREE.Vector3(...node.userData.explodeVector))
  assert.ok(node.position.distanceTo(expected) < 1e-7, `${node.name}: authored independent component offset`)
}
assert.ok(door.getWorldPosition(new THREE.Vector3()).distanceTo(hingeWorld) < 1e-7, 'Exploding internals does not move hinge')
r.back(); settle(r); assert.equal(r.snapshot.stage, 'device'); near(r.snapshot.explode, 0, 'Back reassembles internals first'); assert.ok(r.snapshot.doorAngle > 1.7)
r.back(); settle(r); assert.equal(r.snapshot.stage, 'building'); near(r.snapshot.doorAngle, 0, 'Back closes hinged door'); near(r.snapshot.cabinetOffset, 0, 'Cabinet returns to datum')
r.back(); settle(r); assert.equal(r.snapshot.stage, 'park'); assert.deepEqual(pose(r), initialPose, 'Exact reversible numerical pose')
assert.ok(f.roof.position.equals(roofBase) && f.band.position.equals(bandBase), 'Building roof and conductor return exactly')

// User orbit interruption only cancels automatic camera tracking, never the
// architectural motion. Immediate restore must also work mid-transition.
r.enter(ROOM); step(r, .3); const cameraSamples = f.callbacks.camera.length, liftBefore = r.snapshot.roofLift
r.cancelCamera(); step(r, .5)
assert.equal(f.callbacks.camera.length, cameraSamples, 'Orbit cancellation stops auto camera callbacks'); assert.ok(r.snapshot.roofLift > liftBefore, 'Object animation continues after camera cancellation')
r.restore(false); assert.deepEqual(pose(r), initialPose); assert.equal(r.snapshot.stage, 'park')
r.enter(SPD); step(r, .3)
const queuedCameraSamples = f.callbacks.camera.length, queuedCameraStarts = f.callbacks.cameraStart
r.cancelCamera(); settle(r)
assert.equal(f.callbacks.camera.length, queuedCameraSamples, 'Orbit cancellation persists across queued building/device/component transitions')
assert.equal(f.callbacks.cameraStart, queuedCameraStarts, 'Queued stage does not recapture camera after manual orbit')
assert.equal(r.snapshot.stage, 'component'); assert.equal(r.snapshot.currentId, SPD, 'Direct component selection sequences building and device stages')
const explicitCameraSamples = f.callbacks.camera.length
r.enter(CAB); settle(r); assert.ok(f.callbacks.camera.length > explicitCameraSamples, 'Fresh explicit navigation restores automatic camera tracking')
r.enter(SPD); settle(r)
let restored = 0; r.restore(true, () => restored++)
let observedBuilding = false
while (r.snapshot.transitioning) {
  r.update(1 / 60, 'running')
  if (r.snapshot.targetStage === 'building') { observedBuilding = true; near(r.snapshot.explode, 0, 'Internals assembled before door closure') }
  if (r.snapshot.targetStage === 'park') near(r.snapshot.doorAngle, 0, 'Door closed before roof lowers')
}
assert.ok(observedBuilding); assert.equal(restored, 1); assert.deepEqual(pose(r), initialPose)
// A second selection while opening retargets from the current pose continuously.
r.enter(CAB); step(r, .4); const interrupted = pose(r); r.enter(ROOM); assert.deepEqual(pose(r), interrupted, 'Retargeting has no instantaneous model jump'); settle(r); assert.equal(r.snapshot.stage, 'building')
r.restore(false)
// Initial legacy hidden-roof mode is restored, including associated roof band.
f.roof.visible = false; f.band.visible = false; r.enter(ROOM); settle(r); assert.ok(f.roof.visible); r.restore(); settle(r); assert.ok(!f.roof.visible && !f.band.visible)

const ownedGeometry = new Set(), ownedMaterials = new Set(), ownedDisposals = new Map()
f.detail.traverse(node => { if (node.geometry && !f.originalResources.has(node.geometry)) ownedGeometry.add(node.geometry); if (node.material) materials(node).forEach(material => { if (!f.originalResources.has(material)) ownedMaterials.add(material) }) })
for (const resource of [...ownedGeometry, ...ownedMaterials]) { ownedDisposals.set(resource, 0); resource.addEventListener('dispose', () => ownedDisposals.set(resource, ownedDisposals.get(resource) + 1)) }
r.dispose(); r.dispose()
assert.deepEqual(f.callbacks.managed, [true, false], 'Disposal relinquishes inspection ownership exactly once')
assert.ok(!f.root.getObjectByName('distribution-drilldown-detail')); assert.ok(!f.root.getObjectByName('distribution-drilldown-guides'))
for (const [node, original] of f.originals) {
  assert.deepEqual(state(node), { parent: original.parent, position: original.position, quaternion: original.quaternion, scale: original.scale, visible: original.visible }, `Original node restored: ${node.name}`)
  if (node.isMesh) assert.strictEqual(node.material, original.material, `Original material restored: ${node.name}`)
}
assert.ok([...f.disposalCounts.values()].every(count => count === 0), 'No reused SPD, lamps, building, or cabinet resource disposed')
assert.ok([...ownedDisposals.values()].every(count => count === 1), 'Each owned GPU resource disposed exactly once')
assert.ok(elements.every(element => element.removed && element.onclick === null && element.onkeydown === null), 'Spatial labels and handlers released')
assert.equal(r.enter(CAB), false); assert.equal(r.update(.1), false, 'Disposed controller is inert')

const refreshCases = []
for (const hz of [30, 60, 144]) {
  const fixtureAtRate = await fixture(), controller = fixtureAtRate.runtime
  controller.enter(ROOM); step(controller, .5, hz); const partialBuilding = pose(controller); settle(controller, hz)
  controller.enter(CAB); step(controller, .5, hz); const partialDevice = pose(controller); settle(controller, hz)
  controller.enter(SPD); step(controller, .5, hz); const partialComponent = pose(controller); settle(controller, hz)
  controller.restore(); settle(controller, hz)
  refreshCases.push({ hz, partialBuilding, partialDevice, partialComponent, restored: pose(controller) })
  controller.dispose()
}
for (const c of refreshCases) for (const phase of ['partialBuilding', 'partialDevice', 'partialComponent', 'restored']) {
  for (const key of Object.keys(c[phase])) near(c[phase][key], refreshCases[0][phase][key], `${phase}/${key} independent of ${c.hz}Hz`, 1e-9)
}
const originalModelResourcesPreserved = assertOriginalAssetsPreserved()
const baselineModelNames = Object.keys(JSON.parse(readProject('tmp/distribution-drilldown-baseline/model-hashes.json').toString().replace(/^\uFEFF/, '')))
const report = { result: 'PASS', originalModelResourcesPreserved, originalGLBsPreserved: baselineModelNames.filter(name => name.endsWith('.glb')).length, components: r.components.map(c => ({ id: c.id, name: c.name })),
  lampsReused: f.lamps.length, ownedResourcesDisposed: ownedDisposals.size, reusedResourcesPreserved: f.originalResources.size, refreshCases,
  checks: ['actual GLTFLoader geometry and runtime module', 'park-building-device-component and staged inverse restore', 'independent real door hinge and component offsets', 'interrupted retarget has no model jump', 'manual orbit stops only camera animation and stays cancelled across queued stages', 'fresh explicit navigation resumes camera tracking', 'hidden-roof state restoration', 'SPD/lamp identity and operational materials retained', 'simulated current visible only in connected running cabinet', 'transparent shell does not intercept interior picks', 'idempotent resource disposal without touching original assets', '30/60/144Hz transform consistency'],
  limits: ['Node omits image decoding; browser handles texture/visual/picking acceptance', 'GPU/frame-rate figures require actual browser measurement'] }
writeFileSync(new URL('tmp/distribution-drilldown-runtime-verification.json', projectRoot), JSON.stringify(report, null, 2))
console.log(JSON.stringify({ result: report.result, originalGLBsPreserved: report.originalGLBsPreserved, components: report.components.length, lampsReused: report.lampsReused, refreshRates: refreshCases.map(c => c.hz), checks: report.checks }, null, 2))
