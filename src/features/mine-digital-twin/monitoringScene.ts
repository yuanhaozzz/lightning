import * as THREE from 'three'
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js'
import type { GLTFLoader, GLTF } from 'three/addons/loaders/GLTFLoader.js'
import { MONITORING_DEVICES, type MonitoringDevice } from './monitoringDevices'
import type { ParkLabel } from './parkScene'

export function createMonitoring(root: THREE.Group, labels: ParkLabel[]) {
  const instances = new Map<string, THREE.Group>()
  const raycaster = new THREE.Raycaster()
  let outline: THREE.BoxHelper | undefined
  function clearSelection() {
    if (!outline) return
    root.remove(outline)
    outline.geometry.dispose()
    ;(outline.material as THREE.Material).dispose()
    outline = undefined
  }
  function register(device: MonitoringDevice, object: THREE.Group) {
    if (instances.has(device.id)) throw new Error(`监测设备 ID 重复：${device.id}`)
    object.name = device.id
    object.userData = { deviceId: device.id, kind: 'monitoring-instance', device }
    instances.set(device.id, object)
  }
  function select(id: string): MonitoringDevice | null {
    const object = instances.get(id)
    const device = object?.userData.device as MonitoringDevice | undefined
    if (!object || !device) return null
    clearSelection()
    outline = new THREE.BoxHelper(object, 0xdca53b)
    outline.name = 'monitoring-selection-outline'
    ;(outline.material as THREE.LineBasicMaterial).toneMapped = false
    root.add(outline)
    return device
  }
  return {
    object: (id: string) => instances.get(id),
    select, clearSelection, register,
    pick(point: THREE.Vector2, camera: THREE.Camera) {
      raycaster.setFromCamera(point, camera)
      const hit = raycaster.intersectObject(root, true).find(item => {
        if (!(item.object instanceof THREE.Mesh)) return false
        let node: THREE.Object3D | null = item.object
        while (node) { if (!node.visible) return false; node = node.parent }
        return true
      })
      let node: THREE.Object3D | null = hit?.object ?? null
      while (node && !instances.has(node.userData.deviceId)) node = node.parent
      if (!node) { clearSelection(); return null }
      return select(node.userData.deviceId)
    },
    async load(loader: GLTFLoader, disposed: () => boolean, dispose: (object: THREE.Object3D) => void) {
      const resources = new Map<string, GLTF>()
      for (const device of MONITORING_DEVICES) {
        let resource = resources.get(device.modelPath)
        if (!resource) {
          resource = await loader.loadAsync(`${import.meta.env.BASE_URL}${device.modelPath}`)
          if (disposed()) { dispose(resource.scene); return 0 }
          resources.set(device.modelPath, resource)
        }
        const object = new THREE.Group()
        object.position.set(...device.position)
        object.rotation.set(...device.rotation.map(THREE.MathUtils.degToRad) as [number, number, number])
        object.add(resource.scene.clone(true))
        if (new THREE.Box3().setFromObject(object, true).isEmpty()) throw new Error(`${device.name}模型为空`)
        object.traverse(node => {
          if (node instanceof THREE.Mesh) { node.castShadow = true; node.receiveShadow = true }
        })
        root.add(object)
        register(device, object)
        const element = document.createElement('div')
        element.className = `mine-label mine-label--monitoring mine-label--${device.type}`
        element.textContent = `${device.name}（示意）\n${device.id}`
        element.dataset.deviceId = device.id
        const label = new CSS2DObject(element)
        label.position.set(0, new THREE.Box3().setFromObject(object).max.y - device.position[1] + .2, 0)
        object.add(label)
        labels.push({ element, priority: 0 })
        console.info('[mine-digital-twin] monitoring loaded', JSON.stringify({id:device.id,path:device.modelPath,position:device.position,schematic:true}))
      }
      return instances.size
    },
    dispose() { clearSelection(); instances.clear() },
  }
}
