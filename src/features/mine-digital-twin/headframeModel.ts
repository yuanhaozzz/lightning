import * as THREE from 'three'

/** Immutable assembly datum shared by every future headframe detail level.
 * Geometry extents and visibility must never change this placement. */
export const HEADFRAME_SPACE = {
  assemblyId: 'headframe-01',
  scale: 1.6,
  sourceOffset: [-1.225, .59, 0] as const,
  sourceSheaveCenter: [0, 13.4, 0] as const,
}

export function placeHeadframe(model: THREE.Object3D) {
  model.scale.setScalar(HEADFRAME_SPACE.scale)
  model.position.set(...HEADFRAME_SPACE.sourceOffset).multiplyScalar(HEADFRAME_SPACE.scale)
  model.userData.assemblyDatum = { ...HEADFRAME_SPACE }
}
