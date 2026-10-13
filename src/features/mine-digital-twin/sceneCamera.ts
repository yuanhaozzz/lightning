import * as THREE from 'three'
import type { SceneEntity } from './sceneInteraction'
import { framePowerInspection } from './powerInspection'
import { frameProtectionInspection } from './protectionInspection'

export function frameSceneEntity(source: THREE.PerspectiveCamera, object: THREE.Object3D, entity: SceneEntity, width: number, height: number) {
  const insets = { top: 90, bottom: width < 500 ? 280 : 230 }
  if (entity.facility) return frameProtectionInspection(source, object, entity.facility, width, height, insets)
  if (entity.device) return { ...framePowerInspection(source, object, 'monitoring', width, height, insets), nearPlane: .3, minDistance: 1.5 }
  const bounds = new THREE.Box3().setFromObject(object, true)
  if (bounds.isEmpty()) throw new Error('三维对象为空，无法定位')
  const target = bounds.getCenter(new THREE.Vector3())
  if(entity.type==='container'&&object.userData.motionEnvelopeY){const [low,high]=object.userData.motionEnvelopeY;bounds.min.y=low;bounds.max.y=high;target.y=(low+high)/2}
  const cabinet = entity.kind === 'cabinet'
  const component = entity.kind === 'component'
  const direction = (entity.id === 'distribution-01' ? new THREE.Vector3(-.41, .85, -.34)
    : entity.id === 'substation-01' ? new THREE.Vector3(-.57, .57, .59)
    : cabinet ? new THREE.Vector3(-.3, .85, entity.id.includes('-lv-') ? -1 : 1)
    : new THREE.Vector3(-.7, .65, 1)).normalize()
  const minDistance = entity.type==='container'?6:cabinet ? .6 : component ? 1.2 : entity.kind === 'reserve' ? 1 : 6,
    nearPlane = cabinet ? .025 : component ? .05 : .3
  const camera = source.clone(); camera.clearViewOffset()
  const corners = [bounds.min.x, bounds.max.x].flatMap(x => [bounds.min.y, bounds.max.y].flatMap(y => [bounds.min.z, bounds.max.z].map(z => new THREE.Vector3(x, y, z))))
  const availableW = Math.max(100, width - 64), availableH = Math.max(100, height - insets.top - insets.bottom)
  function projected(distance: number) {
    camera.position.copy(target).addScaledVector(direction, distance); camera.lookAt(target); camera.updateMatrixWorld(true)
    const points = corners.map(point => point.clone().project(camera))
    const xs = points.map(point => (point.x + 1) * width / 2), ys = points.map(point => (1 - point.y) * height / 2)
    return { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) }
  }
  let low = minDistance, high = 600
  for (let i = 0; i < 32; i++) {
    const mid = (low + high) / 2, box = projected(mid)
    if (box.right - box.left > availableW || box.bottom - box.top > availableH) low = mid
    else high = mid
  }
  const box = projected(high * 1.08)
  return { position: camera.position.clone(), target, minDistance, nearPlane,
    offsetX: (box.left + box.right) / 2 - width / 2,
    offsetY: (box.top + box.bottom) / 2 - (insets.top + availableH / 2) }
}
