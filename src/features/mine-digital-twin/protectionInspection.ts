import * as THREE from 'three'
import type { ProtectionFacility } from './protectionFacilities'

export function protectionInspectionBounds(object: THREE.Object3D, facility: ProtectionFacility) {
  const bounds = new THREE.Box3().setFromObject(object, true)
  // Frame the enclosure rather than its long ground test leads.
  if (facility.type === 'ground-monitor') bounds.min.y = facility.position[1] - .25
  if (bounds.isEmpty()) throw new Error('防雷设施模型为空')
  return bounds
}

export function frameProtectionInspection(source: THREE.PerspectiveCamera, object: THREE.Object3D,
  facility: ProtectionFacility, width: number, height: number, insets?: { top: number; bottom: number }) {
  const bounds = protectionInspectionBounds(object, facility)
  const target = bounds.getCenter(new THREE.Vector3())
  const type = facility.type
  const direction = (type === 'spd' ? new THREE.Vector3(-.18, .38, -1)
    : type === 'ground-monitor' ? new THREE.Vector3(-1, .25, .3)
    : type === 'earth-section' ? new THREE.Vector3(-.45, 1.6, -.30)
    : type === 'air-belt' ? new THREE.Vector3(-.7, 1, 1)
    : type === 'down-conductor' && facility.id.includes('distribution') ? new THREE.Vector3(-1, .30, .5)
    : new THREE.Vector3(-.65, .38, 1)).normalize()
  const minDistance = type === 'spd' ? .35 : type === 'ground-monitor' ? .6 : type === 'earth-section' ? 1 : 2
  const nearPlane = ['spd', 'earth-section', 'ground-monitor'].includes(type) ? .025 : .3
  const corners = [bounds.min.x, bounds.max.x].flatMap(x => [bounds.min.y, bounds.max.y].flatMap(y =>
    [bounds.min.z, bounds.max.z].map(z => new THREE.Vector3(x, y, z))))
  const camera = source.clone()
  camera.clearViewOffset()
  const top = insets?.top ?? Math.min(height * .43, width < 500 ? 365 : 315)
  const availableWidth = Math.max(100, width - 70), availableHeight = Math.max(100, height - top - (insets?.bottom ?? 60))
  function projected(distance: number) {
    camera.position.copy(target).addScaledVector(direction, distance)
    camera.lookAt(target)
    camera.updateMatrixWorld(true)
    const points = corners.map(point => point.clone().project(camera))
    const xs = points.map(point => (point.x + 1) * width / 2), ys = points.map(point => (1 - point.y) * height / 2)
    return { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) }
  }
  let low = minDistance, high = 600
  for (let i = 0; i < 32; i++) {
    const mid = (low + high) / 2, box = projected(mid)
    if (box.right - box.left > availableWidth || box.bottom - box.top > availableHeight) low = mid
    else high = mid
  }
  const box = projected(high * 1.08)
  return { position: camera.position.clone(), target, minDistance, nearPlane,
    offsetX: (box.left + box.right) / 2 - width / 2,
    offsetY: (box.top + box.bottom) / 2 - (top + availableHeight / 2) }
}
