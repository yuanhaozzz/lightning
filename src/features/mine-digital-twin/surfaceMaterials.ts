import * as THREE from 'three'

/** Small deterministic embedded textures; no network assets or shader effects. */
export function surfaceTexture(kind: 'concrete' | 'asphalt') {
  const side = 128
  const pixels = new Uint8Array(side * side * 4)
  let seed = kind === 'concrete' ? 23 : 41
  for (let y = 0; y < side; y++)
    for (let x = 0; x < side; x++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      const noise = seed / 4294967296
      const joint = kind === 'concrete' && (x === 0 || y === 0)
      const value = joint ? 183 : Math.round(225 + (noise - .5) * (kind === 'concrete' ? 13 : 27))
      const offset = (y * side + x) * 4
      pixels.set([value, value, value, 255], offset)
    }
  const texture = new THREE.DataTexture(pixels, side, side, THREE.RGBAFormat)
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.magFilter = THREE.LinearFilter
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.generateMipmaps = true
  texture.colorSpace = THREE.SRGBColorSpace
  texture.needsUpdate = true
  return texture
}

export function applyGroundUV(mesh: THREE.Mesh<THREE.BufferGeometry>, tileMeters = 4) {
  mesh.updateMatrixWorld(true)
  const positions = mesh.geometry.getAttribute('position')
  const values = new Float32Array(positions.count * 2)
  const point = new THREE.Vector3()
  for (let i = 0; i < positions.count; i++) {
    point.fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld)
    values[i * 2] = point.x / tileMeters
    values[i * 2 + 1] = point.z / tileMeters
  }
  mesh.geometry.setAttribute('uv', new THREE.BufferAttribute(values, 2))
}
