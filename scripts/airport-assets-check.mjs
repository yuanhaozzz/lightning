import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { Box3, Vector3 } from 'three'

const folder = new URL('../public/models/airport/', import.meta.url)
const manifest = JSON.parse(await readFile(new URL('manifest.json', folder), 'utf8'))
const report = { version: manifest.version, assets: [], aircraft: {}, wheelContacts: [] }
for (const asset of manifest.assets) {
  const buffer = await readFile(new URL(asset.file, folder))
  assert.equal(buffer.toString('ascii', 0, 4), 'glTF')
  assert.equal(buffer.readUInt32LE(4), 2)
  assert.equal(buffer.length, asset.bytes)
  const json = JSON.parse(buffer.toString('utf8', 20, 20 + buffer.readUInt32LE(12)))
  const triangles = json.meshes.reduce((sum, mesh) => sum + mesh.primitives.reduce((n, p) => n + json.accessors[p.indices].count / 3, 0), 0)
  report.assets.push({ id: asset.id, bytes: buffer.length, triangles, meshes: json.meshes.length, nodes: json.nodes.length, embeddedImages: json.images?.length || 0 })
  if (asset.id !== 'aircraft') continue
  const gltf = await new GLTFLoader().parseAsync(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), '')
  const bounds = new Box3().setFromObject(gltf.scene, true)
  const size = bounds.getSize(new Vector3()).toArray()
  for (const [index, expected] of [35.8, 11.76, 37.57].entries()) assert.ok(Math.abs(size[index] - expected) < .001, `Aircraft dimension ${index}: ${size[index]}`)
  const body = gltf.scene.getObjectByName('Fuselage_pressure_shell')
  assert.ok(body)
  const bodySize = new Box3().setFromObject(body, true).getSize(new Vector3()).toArray()
  assert.ok(Math.abs(bodySize[0] - 3.95) < .001)
  report.aircraft = { min: bounds.min.toArray(), max: bounds.max.toArray(), size, fuselageWidth: bodySize[0] }
  gltf.scene.traverse(object => {
    if (!object.isMesh || !object.name.endsWith('rubber_tire')) return
    const b = new Box3().setFromObject(object, true)
    assert.ok(Math.abs(b.min.y) < .001, `${object.name}: tire contact must be ground Y0, got ${b.min.y}`)
    report.wheelContacts.push({ name: object.name, min: b.min.toArray(), max: b.max.toArray() })
  })
  assert.equal(report.wheelContacts.length, 6)
}
report.totalBytes = report.assets.reduce((sum, asset) => sum + asset.bytes, 0)
report.totalTriangles = report.assets.reduce((sum, asset) => sum + asset.triangles, 0)
assert.ok(report.totalBytes < 30_000_000)
await writeFile(new URL('../docs/airport-assets-audit.json', import.meta.url), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
