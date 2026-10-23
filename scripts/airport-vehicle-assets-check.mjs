/** Validate actual exported GLBs, including in-memory articulation. No model writes. */
import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const reportPath = path.join(root, 'docs/airport-v02-vehicle-assets.json')
const tolerance = 1e-4
const report = {
  version: '0.2.0',
  executedAtUtc: new Date().toISOString(),
  execution: { node: process.version, platform: process.platform, threeRevision: THREE.REVISION },
  method: 'Three.js GLTFLoader parses actual exported binary files; CPU world vertices and in-memory joint poses',
  tolerance_m: tolerance,
  assets: {},
  checks: [],
  failures: [],
}
const check = (condition, name, details = {}) => {
  const item = { name, passed: !!condition, ...details }
  report.checks.push(item)
  if (!condition) report.failures.push(item)
}
const delta = (a, b) => Math.max(...a.map((value, i) => Math.abs(value - b[i])))
const vec = (value) => new THREE.Vector3().fromArray(value)
const get = (scene, name) => {
  const matches = []
  scene.traverse((object) => { if (object.name === name) matches.push(object) })
  if (matches.length !== 1) throw new Error(`Expected exactly one node ${name}; found ${matches.length}`)
  return matches[0]
}
const meshes = (object) => {
  const result = []
  object.traverse((child) => { if (child.isMesh) result.push(child) })
  return result
}
const worldVertices = (object) => {
  const points = []
  for (const mesh of meshes(object)) {
    const positions = mesh.geometry.getAttribute('position')
    for (let i = 0; i < positions.count; i++) {
      points.push(new THREE.Vector3().fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld))
    }
  }
  return points
}
const bounds = (object) => new THREE.Box3().setFromPoints(worldVertices(object))
const shape = (box) => ({ min_m: box.min.toArray(), max_m: box.max.toArray(), size_m: box.getSize(new THREE.Vector3()).toArray() })
const tyre = (roll) => {
  const found = meshes(roll).filter((mesh) => mesh.name.endsWith('_tyre'))
  if (found.length !== 1) throw new Error(`Expected one tyre under ${roll.name}; found ${found.length}`)
  return found[0]
}
const wheelCentre = (roll) => bounds(tyre(roll)).getCenter(new THREE.Vector3())
const triangles = (mesh) => {
  const position = mesh.geometry.getAttribute('position')
  const index = mesh.geometry.getIndex()
  const count = index ? index.count : position.count
  const result = []
  for (let i = 0; i < count; i += 3) {
    const points = [0, 1, 2].map((offset) => new THREE.Vector3()
      .fromBufferAttribute(position, index ? index.getX(i + offset) : i + offset)
      .applyMatrix4(mesh.matrixWorld))
    result.push(new THREE.Triangle(...points))
  }
  return result
}

try {
  const exportLog = await fs.readFile(path.join(root, 'tmp/airport-v02-export.log'), 'utf8')
  if (!exportLog.includes('AEROTWIN_EXPORT_COMPLETE')) throw new Error('Unified V0.2 export has not completed')
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'public/models/airport/manifest.json'), 'utf8'))
  if (manifest.version !== '0.2.0') throw new Error(`Unexpected manifest version ${manifest.version}`)
  const contractBytes = await fs.readFile(path.join(root, 'assets/blender/vehicle-interface.json'))
  const contract = JSON.parse(contractBytes)
  report.sourceInterface = { path: 'assets/blender/vehicle-interface.json', sha256: crypto.createHash('sha256').update(contractBytes).digest('hex') }
  report.blenderVerification = contract.verification
  const loader = new GLTFLoader()
  const loaded = {}
  for (const id of ['vehicles', 'aircraft']) {
    const expected = manifest.assets.find((asset) => asset.id === id)
    const bytes = await fs.readFile(path.join(root, 'public/models/airport', expected.file))
    const stat = await fs.stat(path.join(root, 'public/models/airport', expected.file))
    check(bytes.length === expected.bytes, `${id}: byte size matches completed export`, { actual: bytes.length, expected: expected.bytes })
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    loaded[id] = (await loader.parseAsync(buffer, '')).scene
    loaded[id].updateMatrixWorld(true)
    report.assets[id] = { file: expected.file, bytes: bytes.length, modifiedAtUtc: stat.mtime.toISOString(), sha256: crypto.createHash('sha256').update(bytes).digest('hex') }
  }
  const { vehicles, aircraft } = loaded

  for (const [name, expected] of Object.entries(contract.nodes)) {
    const object = get(vehicles, name)
    const positionError = delta(object.position.toArray(), expected.localPosition_m)
    const rotationError = object.quaternion.angleTo(new THREE.Quaternion().fromArray(expected.localRotationQuaternion_xyzw))
    const scaleError = delta(object.scale.toArray(), expected.scale)
    check(positionError < tolerance && rotationError < 1e-6 && scaleError < 1e-6 && object.parent.name === expected.parent,
      `semantic node: ${name}`, { parent: object.parent.name, localPosition_m: object.position.toArray(), positionError_m: positionError, rotationError_rad: rotationError, scaleError })
  }
  report.semanticNodeCount = Object.keys(contract.nodes).length
  const tractor = get(vehicles, contract.tractor.root)
  const cart = get(vehicles, contract.cart.root)
  const parkedCart = get(vehicles, contract.parkedCart.root)
  for (const [object, expected] of [[tractor, contract.tractor], [cart, contract.cart], [parkedCart, contract.parkedCart]]) {
    const actual = shape(bounds(object))
    check(delta(object.getWorldPosition(new THREE.Vector3()).toArray(), expected.initialWorldPose.position_m) < tolerance,
      `initial world pose: ${object.name}`, { actual: object.position.toArray(), expected: expected.initialWorldPose.position_m })
    check(delta(actual.min_m, expected.boundsWorld.min_m) < tolerance && delta(actual.max_m, expected.boundsWorld.max_m) < tolerance,
      `actual vertex bounds: ${object.name}`, { actual, expected: expected.boundsWorld })
  }
  const tractorHitch = get(vehicles, contract.tractor.rearHitch.node)
  const cartHitch = get(vehicles, contract.cart.frontHitch.node)
  const hitchError = () => tractorHitch.getWorldPosition(new THREE.Vector3()).distanceTo(cartHitch.getWorldPosition(new THREE.Vector3()))
  check(hitchError() < tolerance, 'initial world hitch coincidence', { error_m: hitchError(), position_m: tractorHitch.getWorldPosition(new THREE.Vector3()).toArray() })

  const animatedRolls = [...Object.values(contract.tractor.rollNodes), ...Object.values(contract.cart.rollNodes)].map((name) => get(vehicles, name))
  report.animatedWheels = animatedRolls.map((roll) => {
    const expected = roll.name.startsWith('BaggageTractor_') ? contract.tractor : contract.cart
    const box = bounds(tyre(roll)), measured = box.getSize(new THREE.Vector3())
    const centreError = box.getCenter(new THREE.Vector3()).distanceTo(roll.getWorldPosition(new THREE.Vector3()))
    const passed = Math.abs(box.min.y) < tolerance && Math.abs(measured.y / 2 - expected.wheelRadius_m) < tolerance && Math.abs(measured.x - expected.wheelWidth_m) < tolerance && centreError < tolerance
    check(passed, `actual tyre and pivot: ${roll.name}`, { groundY_m: box.min.y, measuredRadius_m: measured.y / 2, measuredWidth_m: measured.x, centreError_m: centreError })
    return { roll: roll.name, tyre: tyre(roll).name, centre_m: roll.getWorldPosition(new THREE.Vector3()).toArray(), bounds: shape(box) }
  })
  check(animatedRolls.length === 8, 'exactly eight animated wheel groups', { count: animatedRolls.length })

  report.aircraftAnchors = []
  for (const reference of Object.values(contract.aircraftReferences)) {
    const anchor = get(aircraft, reference.node), position = anchor.getWorldPosition(new THREE.Vector3())
    const error = position.distanceTo(vec(reference.position_m))
    check(error < tolerance && anchor.parent.name === 'Aircraft_A320neo_root', `aircraft reference: ${reference.node}`, { position_m: position.toArray(), error_m: error, parent: anchor.parent.name })
    report.aircraftAnchors.push({ node: reference.node, position_m: position.toArray() })
  }

  const wheelNames = ['Nose_wheel_-1', 'Nose_wheel_1', 'Port_main_wheel_1', 'Port_main_wheel_2', 'Starboard_main_wheel_1', 'Starboard_main_wheel_2']
  const closest = new THREE.Vector3()
  report.aircraftChocks = contract.aircraftChocks.map((spec, i) => {
    const group = get(vehicles, spec.group), points = worldVertices(group)
    const box = new THREE.Box3().setFromPoints(points)
    const centre = vec(spec.wheelCenter_m)
    const fore = points.filter((p) => p.z > centre.z), aft = points.filter((p) => p.z < centre.z)
    const halves = [aft, fore].map((half) => new THREE.Box3().setFromPoints(half))
    const wheelMesh = get(aircraft, `${wheelNames[i]}_rubber_tire`)
    const tireTriangles = triangles(wheelMesh)
    const tireBottom = bounds(wheelMesh).min.y
    // Check each actual wedge peak midpoint against the actual exported tyre.
    const peaks = halves.map((half) => new THREE.Vector3(centre.x, half.max.y, (half.min.z + half.max.z) / 2))
    const gaps = peaks.map((point) => Math.min(...tireTriangles.map((triangle) => triangle.closestPointToPoint(point, closest).distanceTo(point))))
    const passed = aft.length > 0 && fore.length > 0 && Math.abs(box.min.y) < tolerance && Math.abs(tireBottom) < tolerance && gaps.every((gap) => gap > .005 && gap < .06)
    check(passed, `two grounded aircraft chocks: ${spec.group}`, { count: 2, groundY_m: box.min.y, tyreGroundY_m: tireBottom, peakTreadGaps_m: gaps })
    return { group: spec.group, wheel: wheelNames[i], count: 2, bounds: shape(box), peakTreadGaps_m: gaps }
  })
  check(report.aircraftChocks.length === 6 && report.aircraftChocks.reduce((n, value) => n + value.count, 0) === 12,
    'six aircraft wheels have twelve chocks', { wheels: report.aircraftChocks.length, chocks: 12 })

  const steerNodes = contract.tractor.steeringNodes.map((name) => get(vehicles, name))
  const bogie = get(vehicles, contract.cart.frontBogie.node)
  const rotating = [...steerNodes, ...animatedRolls, bogie]
  const savedRotations = new Map(rotating.map((object) => [object, object.quaternion.clone()]))
  const movingMeshes = new Set(rotating.flatMap((object) => meshes(object)))
  const staticBodies = [...meshes(tractor), ...meshes(cart), ...meshes(parkedCart)].filter((mesh) => !movingMeshes.has(mesh))
  const savedMatrices = new Map(staticBodies.map((mesh) => [mesh, mesh.matrixWorld.clone()]))
  const initialCentres = new Map(animatedRolls.map((roll) => [roll, wheelCentre(roll)]))
  steerNodes.forEach((object, i) => { object.rotation.y = i === 0 ? .30 : .34 })
  vehicles.updateMatrixWorld(true)
  for (const roll of animatedRolls) check(wheelCentre(roll).distanceTo(initialCentres.get(roll)) < tolerance,
    `steering does not orbit tyre: ${roll.name}`, { centreShift_m: wheelCentre(roll).distanceTo(initialCentres.get(roll)) })
  const centresBeforeRoll = new Map(animatedRolls.map((roll) => [roll, wheelCentre(roll)]))
  animatedRolls.forEach((roll, i) => { roll.rotation.x = .87 + i * .11 })
  vehicles.updateMatrixWorld(true)
  for (const roll of animatedRolls) check(wheelCentre(roll).distanceTo(centresBeforeRoll.get(roll)) < tolerance,
    `wheel roll stays on its axle: ${roll.name}`, { centreShift_m: wheelCentre(roll).distanceTo(centresBeforeRoll.get(roll)) })
  bogie.rotation.y = .30
  vehicles.updateMatrixWorld(true)
  const bogieYaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), .30)
  for (const side of ['PosX', 'NegX']) {
    const roll = get(vehicles, contract.cart.rollNodes[`Front_${side}`])
    const expected = new THREE.Vector3(side === 'PosX' ? .91 : -.91, .31, 0).applyQuaternion(bogieYaw)
      .add(vec(contract.cart.frontBogie.local_m))
    cart.localToWorld(expected)
    check(wheelCentre(roll).distanceTo(expected) < tolerance, `cart front bogie carries wheel: ${side}`, { error_m: wheelCentre(roll).distanceTo(expected), expectedCentre_m: expected.toArray() })
  }
  const expectedHitch = vec(contract.cart.frontHitch.local_m).applyQuaternion(bogieYaw).add(vec(contract.cart.frontBogie.local_m))
  cart.localToWorld(expectedHitch)
  check(cartHitch.getWorldPosition(new THREE.Vector3()).distanceTo(expectedHitch) < tolerance,
    'drawbar hitch follows front bogie', { error_m: cartHitch.getWorldPosition(new THREE.Vector3()).distanceTo(expectedHitch) })
  const bodyError = Math.max(...staticBodies.map((mesh) => delta(mesh.matrixWorld.elements, savedMatrices.get(mesh).elements)))
  check(bodyError < tolerance, 'steer/roll/bogie leave rigid bodies and parked cart unchanged', { maxMatrixError: bodyError, checkedMeshes: staticBodies.length })
  for (const [object, quaternion] of savedRotations) object.quaternion.copy(quaternion)
  vehicles.updateMatrixWorld(true)
  check(hitchError() < tolerance, 'restoring in-memory poses restores hitch coincidence', { error_m: hitchError() })
  report.poseTest = { tractorSteering_rad: [.30, .34], wheelRollRange_rad: [.87, 1.64], cartFrontBogieYaw_rad: .30, writesToModelFiles: false,
    note: 'Independent joint basis tests; the cart hitch is not constrained to a stationary tractor during the temporary bogie test. All poses restored.' }
} catch (error) {
  report.failures.push({ name: 'fatal asset verification error', message: error.stack || String(error) })
}
report.passed = report.failures.length === 0
report.summary = { checked: report.checks.length, passed: report.checks.filter((item) => item.passed).length, failures: report.failures.length }
await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify({ ok: report.passed, ...report.summary, report: path.relative(root, reportPath) }))
if (!report.passed) {
  console.error(JSON.stringify(report.failures, null, 2))
  process.exitCode = 1
}
