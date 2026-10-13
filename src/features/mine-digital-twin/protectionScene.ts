import * as THREE from 'three'
import type { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { PROTECTION_FACILITIES, CABINET_INSPECTION, GROUND_WINDOW, type ProtectionFacility } from './protectionFacilities'

/** Reversible inspection states. Existing building resources stay byte-for-byte intact. */
export function createProtection(root: THREE.Group) {
  const instances = new Map<string, THREE.Group>()
  const originalCabinetMeshes = new Map<THREE.Mesh, boolean>()
  const highlight = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>()
  const groundMaterials = new Set<THREE.Material>()
  const restoreShader: (() => void)[] = []
  const cutaway = { value: false }
  const raycaster = new THREE.Raycaster()
  let liner: THREE.Object3D | undefined
  let roofVisible = true
  // The reversible distribution-room sample owns its cabinet/roof assembly
  // while active. The original inspection remains available on return.
  let drilldownManaged = false
  let selectedId: string | undefined
  function visible(node: THREE.Object3D) {
    for (let current: THREE.Object3D | null = node; current; current = current.parent) if (!current.visible) return false
    return true
  }
  function insideWindow(point: THREE.Vector3) {
    return Math.abs(point.x - GROUND_WINDOW.center[0]) < GROUND_WINDOW.size[0] / 2 &&
      Math.abs(point.z - GROUND_WINDOW.center[1]) < GROUND_WINDOW.size[1] / 2
  }
  function clearSelection() {
    for (const [mesh, material] of highlight) {
      const active = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      active.forEach(mat => mat.dispose())
      mesh.material = material
    }
    highlight.clear()
    selectedId = undefined
  }
  function select(id: string): ProtectionFacility | null {
    const object = instances.get(id)
    if (!object || !visible(object)) return null
    clearSelection()
    selectedId = id
    object.traverse(node => {
      if (!(node instanceof THREE.Mesh) || node.userData.displayRole === 'cutaway') return
      highlight.set(node, node.material)
      const tint = (source: THREE.Material) => {
        const mat = source.clone()
        if (mat instanceof THREE.MeshStandardMaterial) {
          mat.color.lerp(new THREE.Color('#89ada0'), .18)
          mat.emissive.set('#477d70')
          mat.emissiveIntensity = .22
        }
        return mat
      }
      node.material = Array.isArray(node.material) ? node.material.map(tint) : tint(node.material)
    })
    return object.userData.facility as ProtectionFacility
  }
  function setEarthInspection(enabled: boolean) {
    cutaway.value = enabled
    instances.get('earth-section-01')?.traverse(node => {
      if (node.userData.displayRole === 'cutaway') node.visible = enabled
    })
  }
  function setRoofVisible(enabled: boolean) {
    roofVisible = enabled
    if (drilldownManaged) return
    originalCabinetMeshes.forEach((wasVisible, mesh) => { mesh.visible = enabled && wasVisible })
    if (liner) liner.visible = !enabled
    const spd = instances.get('spd-lv-01')
    if (spd) spd.visible = !enabled
    const band = instances.get('roof-belt-distribution-01')
    if (band) band.visible = enabled
    if (enabled && selectedId === 'spd-lv-01' || !enabled && selectedId === 'roof-belt-distribution-01') clearSelection()
  }
  function installGroundWindow() {
    // Only the shared terrain/apron material and power-zone patch are affected,
    // only inside the 0.92m inspection rectangle, only during local inspection.
    const terrain = root.getObjectByName('mine-site-ground') as THREE.Mesh | undefined
    const patch = root.getObjectByName('power') as THREE.Mesh | undefined
    for (const mesh of [terrain, patch]) {
      if (!mesh) throw new Error('接地剖视缺少地面对象')
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      mats.forEach(mat => groundMaterials.add(mat))
    }
    for (const mat of groundMaterials) {
      const original = mat.onBeforeCompile, cacheKey = mat.customProgramCacheKey
      mat.onBeforeCompile = (shader, renderer) => {
        original.call(mat, shader, renderer)
        shader.uniforms.protectionCutaway = cutaway
        shader.vertexShader = 'varying vec3 protectionWorldPosition;\n' + shader.vertexShader
        shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', `
          vec4 protectionPosition = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            protectionPosition = instanceMatrix * protectionPosition;
          #endif
          protectionWorldPosition = (modelMatrix * protectionPosition).xyz;
          #include <project_vertex>`)
        shader.fragmentShader = 'varying vec3 protectionWorldPosition;\nuniform bool protectionCutaway;\n' + shader.fragmentShader
        shader.fragmentShader = shader.fragmentShader.replace('#include <clipping_planes_fragment>', `
          #include <clipping_planes_fragment>
          if (protectionCutaway && abs(protectionWorldPosition.x - ${GROUND_WINDOW.center[0].toFixed(3)}) < ${(GROUND_WINDOW.size[0] / 2).toFixed(3)}
              && abs(protectionWorldPosition.z - ${GROUND_WINDOW.center[1].toFixed(3)}) < ${(GROUND_WINDOW.size[1] / 2).toFixed(3)}) discard;`)
      }
      mat.customProgramCacheKey = () => cacheKey.call(mat) + '|protection-local-window-v1'
      mat.needsUpdate = true
      restoreShader.push(() => { mat.onBeforeCompile = original; mat.customProgramCacheKey = cacheKey; mat.needsUpdate = true })
    }
  }
  return {
    object: (id: string) => instances.get(id),
    select, clearSelection, setRoofVisible, setEarthInspection,
    setDrilldownManaged(enabled: boolean) { drilldownManaged = enabled },
    ignoresGroundHit(hit: THREE.Intersection) {
      if (!(hit.object instanceof THREE.Mesh)) return false
      const mats = Array.isArray(hit.object.material) ? hit.object.material : [hit.object.material]
      return cutaway.value && insideWindow(hit.point) && mats.some(mat => groundMaterials.has(mat))
    },
    get earthInspection() { return cutaway.value },
    get count() { return instances.size },
    register(facility: ProtectionFacility, object: THREE.Group) {
      if (instances.has(facility.id)) throw new Error(`防雷设施 ID 重复：${facility.id}`)
      object.name = facility.id
      object.userData.facilityId = facility.id
      object.userData.facility = facility
      instances.set(facility.id, object)
    },
    pick(point: THREE.Vector2, camera: THREE.Camera): ProtectionFacility | null {
      raycaster.setFromCamera(point, camera)
      const hit = raycaster.intersectObject(root, true).find(item => {
        if (!(item.object instanceof THREE.Mesh) || !visible(item.object)) return false
        const mats = Array.isArray(item.object.material) ? item.object.material : [item.object.material]
        return !(cutaway.value && insideWindow(item.point) && mats.some(mat => groundMaterials.has(mat)))
      })
      let node: THREE.Object3D | null = hit?.object ?? null
      while (node && !instances.has(node.userData.facilityId)) node = node.parent
      return node ? select(node.userData.facilityId) : null
    },
    async load(loader: GLTFLoader, disposed: () => boolean, dispose: (object: THREE.Object3D) => void) {
      const resources = new Map<string, THREE.Object3D>()
      for (const facility of PROTECTION_FACILITIES) {
        let resource = resources.get(facility.modelPath)
        if (!resource) {
          resource = (await loader.loadAsync(`${import.meta.env.BASE_URL}${facility.modelPath}`)).scene
          if (disposed()) { dispose(resource); return 0 }
          resources.set(facility.modelPath, resource)
        }
        const group = new THREE.Group()
        group.position.set(...facility.position)
        group.rotation.set(...facility.rotation.map(THREE.MathUtils.degToRad) as [number, number, number])
        group.add(resource.clone(true))
        group.traverse(node => { if (node instanceof THREE.Mesh) { node.castShadow = true; node.receiveShadow = true } })
        if (new THREE.Box3().setFromObject(group, true).isEmpty()) throw new Error(`${facility.name}模型为空`)
        root.add(group)
        this.register(facility, group)
        console.info('[mine-digital-twin] protection loaded', JSON.stringify(facility))
      }
      let cabinet: THREE.Object3D | undefined
      root.traverse(node => {
        if (node.userData.id === CABINET_INSPECTION.cabinetId) cabinet = node
        // Superseded reserve markers; genuine wall brackets/interfaces remain.
        if (['spd-distribution', 'grounding-test-point-01', 'grounding-monitor-reserve-01'].includes(node.userData.id)) node.visible = false
      })
      if (!cabinet) throw new Error('找不到 SPD 宿主配电柜')
      cabinet.traverse(node => { if (node instanceof THREE.Mesh) originalCabinetMeshes.set(node, node.visible) })
      liner = (await loader.loadAsync(`${import.meta.env.BASE_URL}${CABINET_INSPECTION.modelPath}`)).scene
      if (disposed()) { dispose(liner); return instances.size }
      liner.name = 'spd-cabinet-inspection-insert'
      liner.position.set(...CABINET_INSPECTION.localPosition as [number, number, number])
      liner.traverse(node => { if (node instanceof THREE.Mesh) { node.castShadow = true; node.receiveShadow = true } })
      cabinet.add(liner)
      // Roof/old installation-reserve labels cannot masquerade as new facilities.
      for (const id of ['spd-distribution', 'grounding-monitor-reserve-01', 'grounding-test-point-01', 'grounding-downlead-interface-01']) {
        const label = root.getObjectByName(`${id}-label`)
        if (label) { label.visible = false; label.removeFromParent() }
      }
      installGroundWindow()
      setEarthInspection(false)
      setRoofVisible(roofVisible)
      console.info('[mine-digital-twin] protection ready', JSON.stringify({facilities: instances.size, resources: resources.size + 1, cabinetId: CABINET_INSPECTION.cabinetId}))
      return instances.size + 1
    },
    dispose() {
      clearSelection()
      setEarthInspection(false)
      restoreShader.forEach(restore => restore())
      originalCabinetMeshes.forEach((wasVisible, mesh) => { mesh.visible = wasVisible })
      instances.clear()
    },
  }
}
