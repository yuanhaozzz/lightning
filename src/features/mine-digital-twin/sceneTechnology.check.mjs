import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import ts from 'typescript'
import * as THREE from 'three'

// Execute production geometry/state code in Node. Browser QA is still required
// for the actual GLSL compile, visibility, antialiasing and compositing result.
const project = new URL('../../../', import.meta.url)
const read = path => readFileSync(new URL(path, project), 'utf8')
const compile = path => ts.transpileModule(read(path), { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022,
} }).outputText
const dataModule = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64')
const layoutSource = compile('src/features/mine-digital-twin/layout.ts')
const bindings = JSON.parse(read('public/models/mine-factory-animation.bindings.json'))
const power = JSON.parse(read('scripts/blender/power_area.parameters.json'))
const { createFactorySimulation } = await import(dataModule(compile('src/features/mine-digital-twin/factorySimulation.ts')))
let source = compile('src/features/mine-digital-twin/sceneTechnology.ts')
source = source.replace(/import bindings from [^\n]+\n/, `const bindings=${JSON.stringify(bindings)};\n`)
  .replace(/import powerParameters from [^\n]+\n/, `const powerParameters=${JSON.stringify(power)};\n`)
  .replace("from './layout'", `from '${dataModule(layoutSource)}'`)
const runtimeURL = new URL('tmp/scene-technology.runtime.mjs', project)
writeFileSync(runtimeURL, source)
const { createSceneTechnology } = await import(runtimeURL.href + '?check=' + Date.now())
const parent = new THREE.Group()
const untouched = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial())
untouched.name = 'existing-selectable-asset'
untouched.position.set(12, 3, -8)
parent.add(untouched)
const original = { position: untouched.position.toArray(), quaternion: untouched.quaternion.toArray(), material: untouched.material, geometry: untouched.geometry }
const system = createSceneTechnology(parent)
const sim = createFactorySimulation(bindings)
const options = { selectedId: null, buildings: true, monitoring: true, protection: true, drillActive: false, overview: true }
const flow = system.root.getObjectByName('technology-authored-process-flows')
const boundary = system.root.getObjectByName('technology-zone-boundaries')
const corners = system.root.getObjectByName('technology-zone-registration')
const halos = system.root.getObjectByName('technology-facility-plinth-halos')
const tracks = system.root.getObjectByName('technology-facility-tracking-strokes')
const facilityPhase = () => Array.from(halos.material.uniforms.uPhase.value)
const travel = () => Array.from(flow.material.uniforms.uTravel.value)
const status = () => Array.from(flow.material.uniforms.uState.value)
assert.equal(system.update(sim.snapshot(), options), true)
assert.equal(system.update(sim.snapshot(), options), false, 'Repeated stopped snapshot must not force redraw')
assert.deepEqual(status(), [0, 0, 0, 0])
assert.equal(system.diagnostics.drawCalls, 5)
assert.equal(system.diagnostics.textures, 0)
assert.ok(system.diagnostics.triangles < 1500)
assert.deepEqual(halos.userData.facilityIds, ['headframe-01', 'coal-silo-01', 'coal-silo-02', 'substation-01', 'distribution-01'])
for (let i = 0; i < halos.geometry.getAttribute('position').count; i++)
  assert.ok(Math.abs(halos.geometry.getAttribute('position').getY(i) - .16) < 1e-6, 'Plinth halo stays on industrial ground datum')

const positions = flow.geometry.getAttribute('position')
const trace = flow.geometry.getAttribute('trace')
const channel = flow.geometry.getAttribute('channel')
for (const [index, binding] of bindings.conveyors.entries()) {
  const a = new THREE.Vector3().fromArray(binding.start)
  const axis = new THREE.Vector3().fromArray(binding.direction)
  const normal = new THREE.Vector3().fromArray(binding.normal)
  const across = new THREE.Vector3().fromArray(binding.across)
  for (let i = 0; i < positions.count; i++) {
    if (channel.getX(i) !== index) continue
    const relative = new THREE.Vector3().fromBufferAttribute(positions, i).sub(a)
    assert.ok(Math.abs(relative.dot(normal) - .54) < 1e-5, 'Conveyor overlay follows authored normal, clears cover')
    assert.ok(Math.abs(relative.dot(axis) - trace.getX(i)) < 1e-5, 'Flow distance is the same mechanical arclength')
    assert.ok(Math.abs(relative.dot(across)) >= .36 && Math.abs(relative.dot(across)) <= .92, 'Soft trace remains near each authored conveyor edge')
  }
}
const station = new THREE.Vector3().fromArray(power.substation.position)
for (let i = 0; i < positions.count; i++) if (channel.getX(i) === 3) {
  const point = new THREE.Vector3().fromBufferAttribute(positions, i).sub(station)
  assert.ok(point.x > 1.86 && point.x < 4.14 && point.z > -4.9 && point.z < 1.9 && point.y > 3.0 && point.y < 5.6,
    'Power overlay stays inside modelled three-phase switch bay; no invented cross-park wiring')
}

sim.startAll(); sim.update(1)
system.update(sim.snapshot(), options)
assert.deepEqual(status(), [1, 1, 1, 1])
for (let i = 0; i < 3; i++) assert.equal(travel()[i], Math.fround(sim.device(bindings.conveyors[i].id).travel))
assert.ok(travel()[3] > 0)
assert.ok(facilityPhase().every(phase => phase > 0), 'Facility arcs advance on simulation time only')
const running = travel()
sim.command('shaft-transfer', 'stopped'); sim.update(1); system.update(sim.snapshot(), options)
assert.equal(travel()[0], running[0], 'Stopped conveyor freezes while the rest of the factory continues')
assert.equal(status()[0], 0)
assert.ok(travel()[3] > running[3], 'Electrical direction animation follows simulation time')
sim.command('transfer-silo-1', 'fault'); system.update(sim.snapshot(), options)
assert.equal(status()[1], 2, 'Fault is isolated to corresponding flow channel')
sim.command('hoist-house-01', 'stopped'); system.update(sim.snapshot(), options)
const hoistPhase = facilityPhase()[0]
sim.update(1); system.update(sim.snapshot(), options)
assert.equal(facilityPhase()[0], hoistPhase, 'One stopped device freezes its own halo while other equipment keeps running')
sim.command('coal-silo-01', 'fault'); system.update(sim.snapshot(), options)
assert.equal(halos.material.uniforms.uState.value[1], 2)
assert.equal(halos.material.uniforms.uState.value[2], 1, 'Facility fault color remains local')
sim.stopAll(); system.update(sim.snapshot(), options)
const frozen = travel()
const frozenHalo = facilityPhase()
sim.update(2); assert.equal(system.update(sim.snapshot(), options), false)
assert.deepEqual(travel(), frozen, 'Pause/stop uses no wall clock')
assert.deepEqual(facilityPhase(), frozenHalo)
sim.reset(); system.update(sim.snapshot(), options)
assert.deepEqual(travel(), [0, 0, 0, 0]); assert.deepEqual(status(), [0, 0, 0, 0])
assert.deepEqual(facilityPhase(), [0, 0, 0, 0, 0])
assert.equal(system.update(sim.snapshot(), options), false, 'Replay reset settles without a persistent redraw')

system.update(sim.snapshot(), { ...options, selectedId: 'headframe-01' })
assert.equal(boundary.material.uniforms.uSelected.value, 0)
assert.equal(halos.material.uniforms.uSelected.value, 0)
system.update(sim.snapshot(), { ...options, buildings: false })
assert.equal(flow.visible, false)
assert.equal(halos.visible, false); assert.equal(tracks.visible, false)
assert.deepEqual(Array.from(boundary.material.uniforms.uLevels.value), [0, 0, 0, 0, 1, 1])
assert.equal(system.update(sim.snapshot(), { ...options, drillActive: true }), true, 'Hiding visible overlays requests a clearing frame')
assert.equal(system.root.visible, false)
system.update(sim.snapshot(), { ...options, overview: false })
assert.equal(system.root.visible, true); assert.equal(boundary.visible, false); assert.equal(corners.visible, false)
assert.equal(flow.visible, true)
assert.equal(halos.visible, false); assert.equal(tracks.visible, false)

const raycaster = new THREE.Raycaster(new THREE.Vector3(0, 100, 0), new THREE.Vector3(0, -1, 0))
assert.deepEqual(raycaster.intersectObjects(system.root.children, true), [], 'Decoration never steals scene picks')
let geometryDisposals = 0, materialDisposals = 0
for (const mesh of system.root.children) {
  mesh.geometry.addEventListener('dispose', () => geometryDisposals++)
  mesh.material.addEventListener('dispose', () => materialDisposals++)
}
system.dispose(); system.dispose()
assert.equal(geometryDisposals, 5); assert.equal(materialDisposals, 5)
assert.equal(parent.children.length, 1)
assert.equal(system.update(sim.snapshot(), options), false)
assert.deepEqual(untouched.position.toArray(), original.position)
assert.deepEqual(untouched.quaternion.toArray(), original.quaternion)
assert.equal(untouched.geometry, original.geometry); assert.equal(untouched.material, original.material)
const report = {
  pass: true, diagnostics: system.diagnostics,
  cases: ['authored conveyor axes and distances', 'authored power switch-bay envelope', 'running', 'independent stop', 'isolated fault', 'pause', 'replay reset', 'facility halo ground datum', 'independent halo state/time', 'selection', 'layers', 'drilldown visibility', 'raycast isolation', 'idempotent resource disposal', 'existing assets unchanged'],
  disposed: { geometries: geometryDisposals, materials: materialDisposals },
  note: 'GLSL compilation, actual screenshot appearance and GPU performance require browser acceptance.',
}
writeFileSync(new URL('tmp/scene-technology-check.json', project), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
