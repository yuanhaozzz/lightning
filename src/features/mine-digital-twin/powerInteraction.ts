import * as THREE from 'three'
import type { PowerSelection } from './powerModels'

/** Raycast semantic glTF parents. Material meshes never become device identities. */
export function createPowerInteraction(root: THREE.Object3D) {
  let roof: THREE.Object3D | undefined
  let roofVisible = true
  let selected: THREE.Object3D | undefined
  let outline: THREE.BoxHelper | undefined
  const raycaster = new THREE.Raycaster()
  const entities = new Map<string, THREE.Object3D>()
  const selectableKinds = new Set(['cabinet', 'spd-reserve', 'grounding-reserve', 'grounding-monitor-reserve', 'grounding-interface'])

  function register(object: THREE.Object3D) {
    object.traverse(node => {
      if (typeof node.userData.id === 'string' && selectableKinds.has(node.userData.kind)) {
        if (entities.has(node.userData.id)) throw new Error(`电力设备 ID 重复：${node.userData.id}`)
        entities.set(node.userData.id, node)
      }
      if (node.userData.id === 'distribution-roof') roof = node
    })
  }
  function clearSelection() {
    selected = undefined
    if (outline) {
      root.remove(outline)
      outline.geometry.dispose()
      ;(outline.material as THREE.Material).dispose()
      outline = undefined
    }
  }
  function select(object: THREE.Object3D): PowerSelection {
    clearSelection()
    selected = object
    outline = new THREE.BoxHelper(object, 0xdca53b)
    outline.name = 'power-selection-outline'
    ;(outline.material as THREE.LineBasicMaterial).toneMapped = false
    root.add(outline)
    return { id: object.userData.id, name: object.userData.name, kind: object.userData.kind,
      ...(object.userData.parentId ? { parentId: object.userData.parentId } : {}) }
  }
  return {
    register,
    clearSelection,
    setRoofVisible(visible: boolean) {
      roofVisible = visible
      if (roof) roof.visible = visible
      // Re-covering the room clears a hidden indoor device selection.
      if (visible && selected && ['cabinet', 'spd-reserve'].includes(selected.userData.kind)) clearSelection()
    },
    pick(point: THREE.Vector2, camera: THREE.Camera): PowerSelection | null {
      raycaster.setFromCamera(point, camera)
      // Raycast the scene first, so walls/roof and other buildings occlude devices.
      const hit = raycaster.intersectObject(root, true).find(item => {
        if (item.object === outline || !(item.object instanceof THREE.Mesh)) return false
        let node: THREE.Object3D | null = item.object
        while (node) { if (!node.visible) return false; node = node.parent }
        return true
      })
      if (!hit) { clearSelection(); return null }
      let node: THREE.Object3D | null = hit.object
      while (node && !entities.has(node.userData.id)) node = node.parent
      if (!node || (roofVisible && ['cabinet', 'spd-reserve'].includes(node.userData.kind))) {
        clearSelection(); return null
      }
      return select(node)
    },
    get count() { return entities.size },
    dispose() { clearSelection(); entities.clear(); roof = undefined },
  }
}
