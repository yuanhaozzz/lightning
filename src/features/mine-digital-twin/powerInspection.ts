import * as THREE from 'three'

export type PowerInspectionView = 'substation' | 'distribution' | 'monitoring'

/** Temporary acceptance views, fitted from the unchanged GLB world bounds. */
export function framePowerInspection(
  sourceCamera: THREE.PerspectiveCamera,
  object: THREE.Object3D,
  view: PowerInspectionView,
  width: number,
  height: number,
  insets?: { top: number; bottom: number },
) {
  const bounds = new THREE.Box3().setFromObject(object, true)
  if (bounds.isEmpty()) throw new Error('电力区模型为空，无法定位')
  const target = bounds.getCenter(new THREE.Vector3())
  const direction = (view === 'substation'
    ? new THREE.Vector3(-.57, .57, .59)
    : view === 'distribution' ? new THREE.Vector3(-.41, .85, -.34)
    : new THREE.Vector3(-.75, .36, 1)).normalize()
  const corners = [-1, 1].flatMap(x => [-1, 1].flatMap(y => [-1, 1].map(z => new THREE.Vector3(
    x < 0 ? bounds.min.x : bounds.max.x,
    y < 0 ? bounds.min.y : bounds.max.y,
    z < 0 ? bounds.min.z : bounds.max.z,
  ))))
  const camera = sourceCamera.clone()
  camera.clearViewOffset()
  const top = insets?.top ?? (view === 'monitoring' ? (width < 500 ? 355 : 285) : (width < 500 ? 220 : 165))
  const availableWidth = Math.max(100, width - 48)
  const availableHeight = Math.max(100, height - top - (insets?.bottom ?? 44))
  function projected(distance: number) {
    camera.position.copy(target).addScaledVector(direction, distance)
    camera.lookAt(target)
    camera.updateMatrixWorld(true)
    const points = corners.map(point => point.clone().project(camera))
    const xs = points.map(point => (point.x + 1) * width / 2)
    const ys = points.map(point => (1 - point.y) * height / 2)
    return {left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys)}
  }
  let near = view === 'monitoring' ? 2 : 25, far = 600
  for (let i = 0; i < 30; i++) {
    const mid = (near + far) / 2
    const box = projected(mid)
    if (box.right - box.left > availableWidth || box.bottom - box.top > availableHeight) near = mid
    else far = mid
  }
  const box = projected(far * 1.06)
  return {
    position: camera.position.clone(), target,
    offsetX: (box.left + box.right) / 2 - width / 2,
    offsetY: (box.top + box.bottom) / 2 - (top + availableHeight / 2),
  }
}
