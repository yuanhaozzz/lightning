import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import * as THREE from 'three'
import { loadGLB } from '../scripts/blender/verify_distribution_drilldown.mjs'

const root = new URL('../', import.meta.url)
const read = path => readFileSync(new URL(path, root), 'utf8').replace(/^\uFEFF/, '')
const baseline = JSON.parse(read('tmp/visual-command-baseline/model-hashes.json'))
for (const item of baseline) assert.equal(createHash('sha256').update(readFileSync(item.Path)).digest('hex').toUpperCase(), item.Hash, `Baseline model unchanged: ${item.Path}`)

const compilerOptions = { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 }
const layoutSource = ts.transpileModule(read('src/features/mine-digital-twin/layout.ts'), { compilerOptions }).outputText
const layoutURL = new URL('tmp/visual-command.layout.mjs', root)
writeFileSync(layoutURL, layoutSource)
const styleSource = ts.transpileModule(read('src/features/mine-digital-twin/sceneVisualStyle.ts'), { compilerOptions }).outputText.replace("from './layout'", "from './visual-command.layout.mjs'")
const styleURL = new URL('tmp/visual-command.style.mjs', root)
writeFileSync(styleURL, styleSource)
const { applySceneVisualStyle } = await import(styleURL.href + '?qa=' + Date.now())
const sceneRoot = new THREE.Group(), buildings = new THREE.Group()
buildings.name = 'mine-layer-buildings'; sceneRoot.add(buildings)
for (const item of baseline.filter(item => item.Path.endsWith('.glb'))) {
  const name = item.Path.split(/[\\/]/).at(-1)
  buildings.add(await loadGLB('public/models/' + name))
}
const originals = new Map(), materials = new Set(), sourceGeometry = new Set()
const mapKeys = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'bumpMap', 'emissiveMap', 'aoMap']
const styleFields = material => ({
  roughness: material.roughness, metalness: material.metalness, envMapIntensity: material.envMapIntensity,
  normalScale: material.normalScale?.toArray(), ...Object.fromEntries(mapKeys.map(key => [key, material[key]])),
  opacity: material.opacity, transparent: material.transparent, depthWrite: material.depthWrite,
  color: material.color?.getHex(), emissive: material.emissive?.getHex(), emissiveIntensity: material.emissiveIntensity,
})
const priorNodes = new Map()
sceneRoot.traverse(node => {
  priorNodes.set(node, { position: node.position.toArray(), quaternion: node.quaternion.toArray(), scale: node.scale.toArray(), parent: node.parent, name: node.name, userData: JSON.stringify(node.userData) })
  if (!node.isMesh) return
  sourceGeometry.add(node.geometry)
  for (const material of Array.isArray(node.material) ? node.material : [node.material]) materials.add(material)
})
// GLTFLoader geometry test omits image decoding in Node; sentinels exercise
// preservation of authored PBR maps and bump maps using actual asset materials.
const styledCandidates = [...materials].filter(m => m.isMeshStandardMaterial && /concrete|foundation|paint|steel/i.test(m.name))
assert.ok(styledCandidates.length > 3)
const sentinelNormal = new THREE.Texture(), sentinelRoughness = new THREE.Texture(), sentinelBump = new THREE.Texture()
styledCandidates[0].normalMap = sentinelNormal
styledCandidates[0].roughnessMap = sentinelRoughness
styledCandidates[1].bumpMap = sentinelBump
for (const material of materials) originals.set(material, styleFields(material))
const originalResources = new Set([...materials, ...sourceGeometry, sentinelNormal, sentinelRoughness, sentinelBump]), resourceDisposals = new Map()
originalResources.forEach(resource => { resourceDisposals.set(resource, 0); resource.addEventListener('dispose', () => resourceDisposals.set(resource, resourceDisposals.get(resource) + 1)) })
const runtime = applySceneVisualStyle(sceneRoot)
const contact = sceneRoot.getObjectByName('visual-building-contact-shadows')
assert.ok(contact?.isMesh); assert.strictEqual(contact.parent, buildings, 'Contact shadow obeys existing building layer')
assert.equal(runtime.diagnostics.extraDrawCalls, 1)
assert.equal(runtime.diagnostics.extraTriangles, contact.geometry.attributes.position.count / 3)
assert.equal(runtime.diagnostics.textures, 2)
for (const [node, before] of priorNodes) {
  assert.deepEqual({ position: node.position.toArray(), quaternion: node.quaternion.toArray(), scale: node.scale.toArray(), parent: node.parent, name: node.name, userData: JSON.stringify(node.userData) }, before, 'Original transforms, hierarchy and semantics unchanged')
}
assert.strictEqual(styledCandidates[0].normalMap, sentinelNormal); assert.strictEqual(styledCandidates[0].roughnessMap, sentinelRoughness)
assert.strictEqual(styledCandidates[1].bumpMap, sentinelBump); assert.strictEqual(styledCandidates[1].normalMap, originals.get(styledCandidates[1]).normalMap, 'Existing bump map precludes synthetic normal overlay')
const ownedTextures = new Set()
for (const material of materials) {
  const previous = originals.get(material)
  assert.equal(material.opacity, previous.opacity); assert.equal(material.transparent, previous.transparent); assert.equal(material.depthWrite, previous.depthWrite)
  assert.equal(material.emissive?.getHex(), previous.emissive); assert.equal(material.emissiveIntensity, previous.emissiveIntensity)
  assert.equal(material.color?.getHex(), previous.color, 'Base color and status/emission untouched')
  for (const key of mapKeys) if (material[key] && material[key] !== previous[key]) ownedTextures.add(material[key])
}
assert.equal(ownedTextures.size, 2, 'Only two reusable texture resources added')
const ownedResources = new Set([...ownedTextures, contact.geometry, contact.material]), ownedDisposals = new Map()
ownedResources.forEach(resource => { ownedDisposals.set(resource, 0); resource.addEventListener('dispose', () => ownedDisposals.set(resource, ownedDisposals.get(resource) + 1)) })
runtime.dispose(); runtime.dispose()
assert.ok(!sceneRoot.getObjectByName('visual-building-contact-shadows'), 'Contact mesh removed')
for (const [material, before] of originals) assert.deepEqual(styleFields(material), before, `Full material restoration: ${material.name}`)
assert.ok([...ownedDisposals.values()].every(count => count === 1), 'Added resources disposed exactly once')
assert.ok([...resourceDisposals.values()].every(count => count === 0), 'Original material, geometry, textures not disposed')

const checks = []
for (const file of [
  'src/features/mine-digital-twin/distributionDrilldown.check.mjs',
  'tmp/factory-phase2-regression.mjs',
  'src/features/mine-digital-twin/stormVisual.check.mjs',
]) {
  const result = spawnSync(process.execPath, [file], { cwd: fileURLToPath(root), encoding: 'utf8', maxBuffer: 5 * 1024 * 1024 })
  const logPath = 'tmp/visual-command-' + file.split('/').at(-1).replace(/\.mjs$/, '') + '.log'
  writeFileSync(new URL(logPath, root), result.stdout + result.stderr)
  checks.push({ file, result: result.status === 0 ? 'PASS' : 'FAIL', exitCode: result.status, logPath })
  assert.equal(result.status, 0, `${file} failed; inspect ${logPath}`)
}
const report = {
  result: 'PASS', timestampUTC: new Date().toISOString(),
  modelPreservation: { baseline: 'tmp/visual-command-baseline/model-hashes.json', resources: baseline.length, glbs: baseline.filter(item => item.Path.endsWith('.glb')).length, allHashesMatch: true },
  visualStyle: { result: 'PASS', actualGLBAssets: buildings.children.length, checkedMaterials: materials.size, originalNodes: priorNodes.size,
    diagnostics: runtime.diagnostics, authoredPBRMapPreservation: true, statusEmissionAndTransparencyPreservation: true, originalTransformsAndSemanticsPreserved: true,
    fullMaterialRestoration: true, ownedGPUResourcesDisposedExactlyOnce: ownedDisposals.size, originalResourcesNotDisposed: originalResources.size, contactShadowFollowsBuildingLayer: true },
  checks,
  limits: ['No browser run in this subtask; main task validates pixels, interaction and real GPU performance.', 'GLTFLoader preserves actual binary geometry/semantics but texture image decoding is omitted in Node. Authored-map preservation separately tested with texture objects.', 'Texture-byte and extra-draw metrics are resource estimates, not measured GPU memory or frame-rate claims.', 'Factory regression uses the existing scoped temporary runner; historical feature hash audit is skipped for authorized integration changes. Original baseline files remain unchanged.'],
}
writeFileSync(new URL('tmp/visual-command-regression.json', root), JSON.stringify(report, null, 2))
console.log(JSON.stringify({ result: report.result, modelPreservation: report.modelPreservation, checkedMaterials: report.visualStyle.checkedMaterials, ownedResourcesDisposed: ownedDisposals.size, checks }, null, 2))
