import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import ts from 'typescript'
import * as THREE from 'three'

const root = new URL('../', import.meta.url)
const read = path => readFileSync(new URL(path, root), 'utf8').replace(/^\uFEFF/, '')
const json = path => JSON.parse(read(path))
const transpile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText
const writeModule = (name, source) => { const url = new URL(`tmp/${name}.mjs`, root); writeFileSync(url, source); return url }
const layoutURL = writeModule('visual-spatial-layout', transpile(read('src/features/mine-digital-twin/layout.ts')))
const { ASSETS, ZONES } = await import(layoutURL.href)
const styleURL = writeModule('visual-spatial-style', transpile(read('src/features/mine-digital-twin/sceneVisualStyle.ts')).replace("from './layout'", "from './visual-spatial-layout.mjs'"))
const { applySceneVisualStyle } = await import(styleURL.href)

// Exercise newly added named park surfaces and facade clones, omitted by the
// legacy GLB-only preservation runner. No baseline or scene source is modified.
const scene = new THREE.Group(), buildings = new THREE.Group()
buildings.name = 'mine-layer-buildings'; scene.add(buildings)
const geometry = new THREE.BoxGeometry(1, 1, 1), originalMaterials = [], originalMeshes = []
function addMesh(name, parent = scene) {
  const material = new THREE.MeshStandardMaterial({ color: '#abc8b2', roughness: .62, metalness: .14, opacity: .84, transparent: true })
  material.name = 'test_concrete'
  const mesh = new THREE.Mesh(geometry, material); mesh.name = name; parent.add(mesh)
  originalMaterials.push(material); originalMeshes.push(mesh)
  return mesh
}
for (const name of ['mine-site-ground', 'connected-road-surface', 'connected-walkway-surface', ...ZONES.map(z => z.id)]) addMesh(name)
for (const asset of ASSETS) {
  const group = new THREE.Group(); group.name = asset.id; buildings.add(group)
  addMesh('placeholder-roof', group)
  if (asset.type === 'office' || asset.type === 'dispatch-center') addMesh('placeholder', group)
}
const fields = m => ({ color: m.color.getHex(), roughness: m.roughness, metalness: m.metalness, envMapIntensity: m.envMapIntensity, normalMap: m.normalMap, roughnessMap: m.roughnessMap, normalScale: m.normalScale.toArray(), opacity: m.opacity, transparent: m.transparent, emissive: m.emissive.getHex(), emissiveIntensity: m.emissiveIntensity })
const materialBefore = new Map(originalMaterials.map(material => [material, fields(material)]))
const meshBefore = new Map(originalMeshes.map(mesh => [mesh, mesh.material]))
let originalDisposed = 0
originalMaterials.forEach(material => material.addEventListener('dispose', () => originalDisposed++))
const styled = applySceneVisualStyle(scene)
assert.ok(styled.diagnostics.artDirectedSurfaces > 0)
assert.equal(styled.diagnostics.facadeFinishes, ASSETS.filter(a => a.type === 'office' || a.type === 'dispatch-center').length)
const cloneMaterials = originalMeshes.filter(mesh => mesh.material !== meshBefore.get(mesh)).map(mesh => mesh.material)
const cloneDisposals = new Map(cloneMaterials.map(material => [material, 0]))
cloneMaterials.forEach(material => material.addEventListener('dispose', () => cloneDisposals.set(material, cloneDisposals.get(material) + 1)))
const knownSurfaceChanges = originalMaterials.filter(material => material.color.getHex() !== materialBefore.get(material).color).length
assert.ok(knownSurfaceChanges > 0)
styled.dispose(); styled.dispose()
for (const [material, before] of materialBefore) assert.deepEqual(fields(material), before, 'All original surface properties restored')
for (const [mesh, material] of meshBefore) assert.strictEqual(mesh.material, material, 'Original material instance restored')
assert.equal(originalDisposed, 0)
assert.ok([...cloneDisposals.values()].every(count => count === 1))

// Real telemetry module with a minimal DOM implementation: state, listener
// lifecycle and CSS2D ownership checks; pixel appearance remains browser QA.
const created = []
class Element {
  constructor(tag) { this.tag = tag; this.style = {}; this.dataset = {}; this.attributes = {}; this.children = []; this.parentNode = null; this.ownerDocument = { defaultView: { Element } }; this.listeners = new Map(); this.queries = new Map(); this.classList = { toggle() {} }; this.offsetWidth = 170; this.offsetHeight = 88; created.push(this) }
  setAttribute(name, value) { this.attributes[name] = value }
  append(...children) { for (const child of children) { child.parentNode = this; this.children.push(child) } }
  querySelector(selector) { if (!this.queries.has(selector)) this.queries.set(selector, new Element('span')); return this.queries.get(selector) }
  addEventListener(name, handler) { if (!this.listeners.has(name)) this.listeners.set(name, new Set()); this.listeners.get(name).add(handler) }
  removeEventListener(name, handler) { this.listeners.get(name)?.delete(handler) }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(item => item !== this); this.parentNode = null }
}
globalThis.document = { createElement: tag => new Element(tag) }
const monitoring = json('scripts/blender/monitoring.parameters.json').devices
const protection = json('scripts/blender/protection.parameters.json').facilities
const monitoringURL = 'data:text/javascript,' + encodeURIComponent(`export const MONITORING_DEVICES=${JSON.stringify(monitoring)}`)
const protectionURL = 'data:text/javascript,' + encodeURIComponent(`export const PROTECTION_FACILITIES=${JSON.stringify(protection)}`)
const telemetrySource = transpile(read('src/features/mine-digital-twin/sceneTelemetryLabels.ts'))
  .replace("from './layout'", "from './visual-spatial-layout.mjs'")
  .replace("from './monitoringDevices'", `from '${monitoringURL}'`)
  .replace("from './protectionFacilities'", `from '${protectionURL}'`)
  .replace("import './telemetryLabels.css';", '')
const telemetryURL = writeModule('visual-spatial-telemetry', telemetrySource)
const { createSceneTelemetryLabels } = await import(telemetryURL.href)
const factoryURL = writeModule('visual-spatial-factory', transpile(read('src/features/mine-digital-twin/factorySimulation.ts')))
const { createFactorySimulation } = await import(factoryURL.href)
const factory = createFactorySimulation(json('public/models/mine-factory-animation.bindings.json'))
const storm = { source: '演示数据', phase: 'normal', progress: 0, devices: [...monitoring, ...protection].map(device => ({ ...device, status: 'normal', monitoringData: {} })) }
const parent = new THREE.Group(), existingChild = new THREE.Group(); parent.add(existingChild)
const located = [], labels = createSceneTelemetryLabels(parent, id => located.push(id))
const camera = new THREE.PerspectiveCamera(42, 1920 / 1080, .1, 2000)
camera.position.set(30, 95, 180); camera.lookAt(0, 12, 0); camera.updateMatrixWorld(true)
const opts = { camera, width: 1920, height: 1080, overview: true, compact: false, layers: { buildings: true, monitoring: true, protection: true, labels: true }, drillActive: false, selectedId: null }
const group = parent.getObjectByName('mine-spatial-telemetry')
const node = id => group.getObjectByName(`telemetry-${id}`)
const update = (overrides = {}) => { labels.update(factory.snapshot(), storm, { ...opts, ...overrides }); labels.layout() }
update()
assert.equal(group.children.length, 7)
assert.equal(node('headframe-01').element.dataset.state, 'stopped')
assert.equal(node('coal-silo-01').element.children[2].querySelector('.mine-telemetry-reading b').textContent, '28.0 %')
factory.startAll(); factory.update(2); update()
assert.equal(node('headframe-01').element.dataset.state, 'running')
storm.phase = 'warning'; storm.progress = .7; storm.devices.find(item => item.id === 'storm-warning-01').status = 'warning'; update()
assert.equal(node('storm-warning-01').element.dataset.state, 'warning')
assert.equal(node('air-terminal-production').element.dataset.state, 'normal', 'Storm warning does not invent protection fault')
factory.command('hoist-house-01', 'fault'); update()
assert.equal(node('headframe-01').element.dataset.state, 'fault')
assert.equal(node('substation-01').element.dataset.state, 'running', 'Independent power status preserved')
const beforeSnapshot = JSON.stringify(factory.snapshot()), beforeStorm = JSON.stringify(storm)
update(); assert.equal(JSON.stringify(factory.snapshot()), beforeSnapshot); assert.equal(JSON.stringify(storm), beforeStorm)
update({ layers: { ...opts.layers, monitoring: false } }); assert.equal(node('storm-warning-01').visible, false); assert.equal(node('headframe-01').visible, true)
update({ layers: { ...opts.layers, protection: false } }); assert.equal(node('air-terminal-production').visible, false)
update({ layers: { ...opts.layers, buildings: false } }); assert.equal(node('headframe-01').visible, false); assert.equal(node('storm-warning-01').visible, true)
update({ drillActive: true }); assert.equal(group.visible, false); assert.equal(labels.diagnostics.visible, 0)
update({ layers: { ...opts.layers, labels: false } }); assert.equal(group.visible, false); assert.equal(labels.diagnostics.visible, 0)
update()
const button = node('headframe-01').element.children[2]
for (const handler of button.listeners.get('click')) handler({ stopPropagation() {} })
assert.deepEqual(located, ['headframe-01'])
const registeredListeners = created.reduce((sum, element) => sum + [...element.listeners.values()].reduce((count, listeners) => count + listeners.size, 0), 0)
assert.equal(registeredListeners, 21)

// Execute the actual layer handler and inspect RAF placement. A descendant's
// visibility:visible overrides inherited visibility:hidden, but cannot override
// display:none on the owning renderer. This protects the browser-found regression.
const mainSource = read('src/features/mine-digital-twin/index.vue').match(/<script setup[^>]*>([\s\S]*?)<\/script>/)[1]
const mainAST = ts.createSourceFile('index.ts', mainSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
let applyLayersNode, telemetryUpdateCall
function inspect(node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'applyLayers') applyLayersNode = node
  if (ts.isCallExpression(node) && /telemetryLabels\??\.update$/.test(node.expression.getText(mainAST))) telemetryUpdateCall = node
  ts.forEachChild(node, inspect)
}
inspect(mainAST)
assert.ok(applyLayersNode && telemetryUpdateCall, 'Existing label layer integration found')
for (let ancestor = telemetryUpdateCall.parent; ancestor; ancestor = ancestor.parent) {
  if (ts.isIfStatement(ancestor)) assert.ok(!/layers\.labels/.test(ancestor.expression.getText(mainAST)), 'Telemetry updates must run even when labels are disabled')
}
const updateBlock = telemetryUpdateCall.parent.parent
assert.ok(ts.isBlock(updateBlock), 'Telemetry update belongs directly to the rendering callback block')
const labelRenderGuard = updateBlock.statements.find(node => ts.isIfStatement(node) && node.expression.getText(mainAST) === 'layers.labels')
assert.ok(labelRenderGuard && telemetryUpdateCall.getStart(mainAST) < labelRenderGuard.getStart(mainAST), 'Update state before the optional CSS2D render')
const runApplyLayers = new Function('layers', 'labelRenderer', 'interaction', 'selected', 'drilldown', 'park', 'renderer', `let needsRender=false; ${transpile(applyLayersNode.getText(mainAST))}; applyLayers(); return needsRender;`)
const owningDOM = new Element('div'), visibleChild = new Element('div')
visibleChild.style.visibility = 'visible'; owningDOM.append(visibleChild)
const mockRenderer = { domElement: owningDOM }
const drawable = element => { for (let node = element; node; node = node.parentNode) if (node.style.display === 'none') return false; return element.style.visibility !== 'hidden' }
for (const enabled of [false, true, false, true]) {
  assert.equal(runApplyLayers({ ...opts.layers, labels: enabled }, mockRenderer, undefined, { value: null }, undefined, undefined, undefined), true)
  assert.equal(owningDOM.style.display, enabled ? '' : 'none', 'Owning display suppresses all explicit-visible descendants')
  assert.equal(drawable(visibleChild), enabled)
  update({ layers: { ...opts.layers, labels: enabled } })
  if (!enabled) assert.equal(labels.diagnostics.visible, 0, 'Disabled label state clears diagnostics')
}
const visibleBeforeDispose = labels.diagnostics.visible
labels.dispose(); labels.dispose(); update()
assert.deepEqual(parent.children, [existingChild])
assert.equal(labels.diagnostics.visible, 0)
assert.deepEqual(labels.diagnostics.visibleIds, [])
assert.equal(created.reduce((sum, element) => sum + [...element.listeners.values()].reduce((count, listeners) => count + listeners.size, 0), 0), 0)
const report = {
  result: 'PASS', timestampUTC: new Date().toISOString(),
  namedSceneSurfaces: { changedSurfaces: knownSurfaceChanges, facadeClones: cloneMaterials.length, fullMaterialRestoration: true, facadeCloneDisposalExactlyOnce: true, originalResourcesDisposed: originalDisposed },
  telemetry: { cards: 7, actualSimulationSnapshots: true, stateMutation: false, independentStormAndEquipmentStates: true, layersAndDrilldown: true, eventListenersRemoved: registeredListeners, ownedGroupRemoved: true, doubleDisposeSafe: true, visibleBeforeDispose, visibleAfterDispose: labels.diagnostics.visible },
  integration: { actualApplyLayersExecuted: true, parentDisplaySuppressesExplicitVisibleChildren: true, disableEnableCycles: 2, telemetryUpdateOutsideLabelRenderGuard: true, disabledDiagnosticsZero: true },
  observations: [],
  limits: ['No browser or GPU shader compilation in this test; actual appearance and frame timing belong to browser acceptance.', 'Named surface test uses authored layout IDs with representative meshes to cover restoration paths; original GLB regression separately covers 27 actual binary assets.']
}
writeFileSync(new URL('tmp/visual-spatial-final-verification.json', root), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
