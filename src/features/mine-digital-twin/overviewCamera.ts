import * as THREE from 'three'

/** Fit actual projected extents, then center them in the space below the header.
 * The principal-point offset avoids aiming OrbitControls below ground simply
 * to compensate for perspective making the foreground larger than the rear.
 */
export function frameOverview(
  camera: THREE.PerspectiveCamera,
  points: THREE.Vector3[],
  width: number,
  height: number,
) {
  const portrait = width / height < 1
  const elevation = THREE.MathUtils.degToRad(portrait ? 36 : 16)
  const azimuth = THREE.MathUtils.degToRad(portrait ? 24 : 22)
  const direction = new THREE.Vector3(
    Math.sin(azimuth) * Math.cos(elevation),
    Math.sin(elevation),
    Math.cos(azimuth) * Math.cos(elevation),
  )
  const target = new THREE.Vector3(0, 7, 0)
  const sideInset = width >= 1400 ? 318 : width >= 1100 ? 276 : 32
  const margins = { left: sideInset, right: sideInset, top: width < 600 ? 155 : Math.min(370,height*.35), bottom: width < 600 ? 175 : 150 }
  const availableW = Math.max(100, width - margins.left - margins.right)
  const availableH = Math.max(100, height - margins.top - margins.bottom)
  camera.clearViewOffset()
  function projectedBounds(distance: number) {
    camera.position.copy(target).addScaledVector(direction, distance)
    camera.lookAt(target)
    camera.updateMatrixWorld(true)
    const screen = points.map((p) => p.clone().project(camera))
    const xs = screen.map((p) => ((p.x + 1) * width) / 2)
    const ys = screen.map((p) => ((1 - p.y) * height) / 2)
    return { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) }
  }
  let near = 45, far = 1200
  for (let i = 0; i < 36; i++) {
    const middle = (near + far) / 2
    const box = projectedBounds(middle)
    if (box.right - box.left > availableW || box.bottom - box.top > availableH) near = middle
    else far = middle
  }
  const distance = far * 1.025
  const box = projectedBounds(distance)
  const contentCenterX = margins.left + availableW / 2
  const contentCenterY = margins.top + availableH / 2
  const offsetX = (box.left + box.right) / 2 - contentCenterX
  const offsetY = (box.top + box.bottom) / 2 - contentCenterY
  camera.setViewOffset(width, height, offsetX, offsetY, width, height)
  return { target, elevation: portrait ? 36 : 16, azimuth: portrait ? 24 : 22, distance, offsetX, offsetY }
}
