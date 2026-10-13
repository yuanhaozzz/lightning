import * as THREE from 'three'
import { ASSETS } from './layout'

/** Runtime art direction only: keep authored coordinates, geometry, node identity,
 * texture maps and simulation-owned emissive/opacity values. Dispose before park. */
export function applySceneVisualStyle(root: THREE.Object3D) {
  const side = 128
  const normalPixels = new Uint8Array(side * side * 4)
  const roughPixels = new Uint8Array(side * side * 4)
  const grain = (x: number, y: number) => {
    const v = Math.sin(((x + side) % side) * 127.1 + ((y + side) % side) * 311.7) * 43758.5453
    return v - Math.floor(v)
  }
  for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
    const i = (y * side + x) * 4, g = grain(x, y)
    normalPixels.set([128 + 24 * (grain(x - 1, y) - grain(x + 1, y)), 128 + 24 * (grain(x, y - 1) - grain(x, y + 1)), 255, 255], i)
    const r = Math.round(229 + g * 26)
    roughPixels.set([r, r, r, 255], i)
  }
  const makeTexture = (pixels: Uint8Array) => {
    const texture = new THREE.DataTexture(pixels, side, side, THREE.RGBAFormat)
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping
    texture.repeat.set(4, 4)
    texture.minFilter = THREE.LinearMipmapLinearFilter
    texture.magFilter = THREE.LinearFilter
    texture.generateMipmaps = true
    texture.anisotropy = 4
    texture.needsUpdate = true
    return texture
  }
  const normalTexture = makeTexture(normalPixels), roughTexture = makeTexture(roughPixels)
  const snapshots: { material: THREE.MeshStandardMaterial; roughness: number; metalness: number; envMapIntensity: number; normalMap: THREE.Texture | null; roughnessMap: THREE.Texture | null; normalScale: THREE.Vector2 }[] = []
  const seen = new Set<THREE.Material>()
  const categories = { concrete: 0, coating: 0, metal: 0, glass: 0, unchanged: 0 }
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (!(material instanceof THREE.MeshStandardMaterial) || seen.has(material)) continue
      seen.add(material)
      // Do not style status lamps, semantic highlights or custom weather shaders.
      const name = material.name.toLowerCase()
      let category: keyof typeof categories = 'unchanged'
      if (/concrete|foundation|lining|_wall/.test(name)) category = 'concrete'
      else if (/glass/.test(name)) category = 'glass'
      else if (/paint|coating|_roof|_machine$|bearing/.test(name)) category = 'coating'
      else if (/steel|machined|galvanized|copper|_metal|_trim|_rope/.test(name)) category = 'metal'
      categories[category]++
      if (category === 'unchanged') continue
      snapshots.push({ material, roughness: material.roughness, metalness: material.metalness,
        envMapIntensity: material.envMapIntensity, normalMap: material.normalMap,
        roughnessMap: material.roughnessMap, normalScale: material.normalScale.clone() })
      if (category === 'concrete') {
        material.roughness = .92; material.metalness = 0; material.envMapIntensity = .48
      } else if (category === 'coating') {
        material.roughness = /roof/.test(name) ? .51 : .47
        material.metalness = Math.min(material.metalness, .25); material.envMapIntensity = .9
      } else if (category === 'metal') {
        material.roughness = /machined|copper/.test(name) ? .29 : .39
        material.metalness = Math.max(material.metalness, .66); material.envMapIntensity = 1.15
      } else {
        material.roughness = .16; material.metalness = .08; material.envMapIntensity = 1.3
      }
      // Existing asset PBR maps take precedence over the shared fine microdetail.
      if (category !== 'glass' && object.geometry.hasAttribute('uv')) {
        if (!material.roughnessMap) material.roughnessMap = roughTexture
        if (!material.normalMap && !material.bumpMap) {
          material.normalMap = normalTexture
          material.normalScale.setScalar(category === 'concrete' ? .18 : .045)
        }
      }
      material.needsUpdate = true
    }
  })

  // Analytic near-contact grounding beneath actual building footprints. One
  // batched draw, no screen-space pass and no shadow over the open shaft.
  const vertices: number[] = [], uvs: number[] = []
  const groundedTypes = new Set(['shaft-house', 'hoist-house', 'transfer-station', 'distribution-room', 'office', 'dispatch-center'])
  for (const asset of ASSETS.filter(item => groundedTypes.has(item.type))) {
    const [x, , z] = asset.position, w = asset.size[0] * .5 + .9, d = asset.size[2] * .5 + .9
    const yaw = THREE.MathUtils.degToRad(asset.rotation[1]), c = Math.cos(yaw), s = Math.sin(yaw)
    for (const [u, v] of [[-1, -1], [-1, 1], [1, -1], [1, -1], [-1, 1], [1, 1]]) {
      vertices.push(x + u! * w * c + v! * d * s, .039, z + v! * d * c - u! * w * s)
      uvs.push(u!, v!)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  const material = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1,
    vertexShader: 'varying vec2 vContact; void main(){vContact=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader: `varying vec2 vContact; void main(){
      float edge=max(abs(vContact.x),abs(vContact.y));
      float a=(1.0-smoothstep(.73,1.0,edge))*.15;
      if(a<.001)discard;gl_FragColor=vec4(.055,.073,.085,a);
      #include <colorspace_fragment>
    }`,
  })
  const contacts = new THREE.Mesh(geometry, material)
  contacts.name = 'visual-building-contact-shadows'
  contacts.raycast = () => {}
  contacts.renderOrder = 2
  const contactParent=root.getObjectByName('mine-layer-buildings')??root
  contactParent.add(contacts)
  let disposed = false
  return {
    diagnostics: { materialCategories: categories, styledMaterials: snapshots.length,
      extraDrawCalls: 1, extraTriangles: vertices.length / 9, textures: 2,
      textureBytes: side * side * 4 * 2 * 4 / 3, geometryUnchanged: true, animationCost: 0 },
    dispose() {
      if (disposed) return
      disposed = true
      for (const original of snapshots) {
        const target = original.material
        target.roughness = original.roughness; target.metalness = original.metalness
        target.envMapIntensity = original.envMapIntensity
        target.normalMap = original.normalMap; target.roughnessMap = original.roughnessMap
        target.normalScale.copy(original.normalScale); target.needsUpdate = true
      }
      contacts.removeFromParent(); geometry.dispose(); material.dispose()
      normalTexture.dispose(); roughTexture.dispose()
    },
  }
}
