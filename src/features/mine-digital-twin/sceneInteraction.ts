import * as THREE from 'three'
import { isBuilding, type SiteAsset } from './layout'
import type { MonitoringDevice } from './monitoringDevices'
import type { ProtectionFacility } from './protectionFacilities'

export type ModelLayer = 'buildings' | 'monitoring' | 'protection'
export interface SceneLayers { buildings: boolean; monitoring: boolean; protection: boolean; labels: boolean }
export const DEFAULT_LAYERS: SceneLayers = { buildings: true, monitoring: true, protection: true, labels: true }
export interface SceneEntity {
  id: string; name: string; type: string; typeName: string; layer: ModelLayer
  kind: 'building' | 'monitoring' | 'protection' | 'cabinet' | 'reserve' | 'component'
  parentEntityId?: string
  device?: MonitoringDevice; facility?: ProtectionFacility
}
export function isSelectionClick(start: { x: number; y: number; time: number; travel: number; pointerId: number },
  end: { x: number; y: number; time: number; pointerId: number; button: number }) {
  return end.button === 0 && start.pointerId === end.pointerId && end.time - start.time < 650 &&
    start.travel <= 5 && Math.hypot(end.x - start.x, end.y - start.y) <= 5
}

/** One semantic registry, one raycast, one reversible material highlight. */
export function createSceneInteraction(root: THREE.Group, ignoreHit: (hit: THREE.Intersection) => boolean) {
  const entities = new Map<string, { entity: SceneEntity; object: THREE.Object3D }>()
  const owners = new Map<THREE.Object3D, SceneEntity>()
  const groups = new Map<ModelLayer, THREE.Group>()
  const originals = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>()
  const raycaster = new THREE.Raycaster()
  let selected: SceneEntity | null = null
  function visible(object: THREE.Object3D) {
    for (let node: THREE.Object3D | null = object; node; node = node.parent) if (!node.visible) return false
    return true
  }
  function register(object: THREE.Object3D, entity: SceneEntity) {
    if (entities.has(entity.id)) throw new Error(`三维实体 ID 重复：${entity.id}`)
    entities.set(entity.id, { entity, object }); owners.set(object, entity)
    object.userData.sceneEntityId = entity.id
  }
  function clearSelection() {
    for (const [mesh, original] of originals) {
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      materials.forEach(material => material.dispose())
      mesh.material = original
    }
    originals.clear(); selected = null
  }
  return {
    register,
    replaceObject(id: string, object: THREE.Object3D) {
      const entry = entities.get(id)
      if (!entry) throw new Error(`三维实体不存在：${id}`)
      if (selected?.id === id) clearSelection()
      owners.delete(entry.object)
      entry.object = object
      owners.set(object, entry.entity)
      object.userData.sceneEntityId = id
    },
    registerAlias(object: THREE.Object3D, id: string) {
      const entry = entities.get(id)
      if (!entry) throw new Error(`三维实体不存在：${id}`)
      owners.set(object, entry.entity)
      object.userData.sceneEntityId = id
    },
    object: (id: string) => entities.get(id)?.object,
    entity: (id: string) => entities.get(id)?.entity,
    get list() { return [...entities.values()].map(item => item.entity) },
    get selected() { return selected },
    clearSelection,
    initialize() {
      root.traverse(node => {
        const asset = node.userData.asset as SiteAsset | undefined
        const device = node.userData.device as MonitoringDevice | undefined
        const facility = node.userData.facility as ProtectionFacility | undefined
        if (asset && isBuilding(asset)) register(node, { id: asset.id, name: asset.name, type: asset.type,
          typeName: ({'headframe':'井架','shaft-house':'井口房','hoist-house':'提升机房','transfer-station':'转载站','coal-silo':'煤仓','substation':'变电站','distribution-room':'配电室','office':'办公楼','dispatch-center':'调度中心'} as Record<string,string>)[asset.type] ?? '工业建筑', layer: 'buildings', kind: 'building' })
        else if (device) register(node, { id: device.id, name: device.name, type: device.type,
          typeName: device.type === 'lightning-locator' ? '闪电定位仪' : '雷暴预警仪', layer: 'monitoring', kind: 'monitoring', device })
        else if (facility) register(node, { id: facility.id, name: facility.name, type: facility.type,
          typeName: ({'air-terminal':'接闪杆','air-belt':'接闪带','down-conductor':'引下线','spd':'浪涌保护器','ground-monitor':'接地监测仪','earth-section':'接地装置剖视'})[facility.type],
          layer: 'protection', kind: 'protection', facility })
        else if (node.userData.kind === 'headframe-part') register(node, {
          id: node.userData.entityId, name: node.userData.entityName, type: node.userData.partType,
          typeName: '井架部件', layer: 'buildings', kind: 'component', parentEntityId: node.userData.parentEntityId,
        })
        else if (node.userData.animationRole === 'structure' && node.userData.factoryEntityId && node.userData.animationId.endsWith('/static')) register(node, {
          id:node.userData.factoryEntityId,name:node.userData.factoryEntityId==='shaft-transfer'?'井口输送机':node.userData.factoryEntityId.endsWith('1')?'煤仓 1 输送机':'煤仓 2 输送机',
          type:'conveyor',typeName:'带式输送机',layer:'buildings',kind:'component',parentEntityId:'transfer-01',
        })
        else if (node.userData.kind === 'cabinet' || node.userData.kind === 'grounding-interface') register(node, {
          id: node.userData.id, name: node.userData.name, type: node.userData.kind,
          typeName: node.userData.kind === 'cabinet' ? '配电柜' : '接地连接接口', layer: 'buildings', kind: node.userData.kind === 'cabinet' ? 'cabinet' : 'reserve' })
      })
      // Layer parents preserve nested roof/cabinet visibility. Every layer stays
      // independently pickable; hidden parents also hide their CSS2D labels.
      const children = [...root.children]
      for (const layer of ['buildings', 'monitoring', 'protection'] as ModelLayer[]) {
        const group = new THREE.Group(); group.name = `mine-layer-${layer}`; root.add(group); groups.set(layer, group)
      }
      for (const child of children) {
        const layer = child.userData.facilityId ? 'protection' : child.userData.deviceId ? 'monitoring' : 'buildings'
        groups.get(layer)!.add(child)
      }
    },
    setLayers(state: SceneLayers) {
      for (const [layer, group] of groups) group.visible = state[layer]
      if (selected && !state[selected.layer]) clearSelection()
    },
    setEntityVisible(id: string, show: boolean) {
      const entry = entities.get(id)
      if (!entry || entry.entity.kind !== 'component') return false
      clearSelection()
      entry.object.visible = show
      return true
    },
    restoreEntityVisibility() {
      for (const entry of entities.values()) if (entry.entity.kind === 'component') entry.object.visible = true
    },
    select(id: string, options: { highlight?: boolean } = {}) {
      const entry = entities.get(id)
      if (!entry || !visible(entry.object)) return null
      clearSelection(); selected = entry.entity
      if (options.highlight === false) return selected
      entry.object.traverse(node => {
        if (!(node instanceof THREE.Mesh) || !visible(node) || node.userData.displayRole === 'cutaway') return
        originals.set(node, node.material)
        const tint = (source: THREE.Material) => {
          const material = source.clone()
          material.onBeforeCompile=source.onBeforeCompile
          material.customProgramCacheKey=source.customProgramCacheKey
          if (material instanceof THREE.MeshStandardMaterial) {
            material.color.lerp(new THREE.Color('#8dafad'), entry.entity.kind === 'building' ? .07 : .18)
            material.emissive.set('#477b75'); material.emissiveIntensity = entry.entity.kind === 'building' ? .06 : .2
          }
          return material
        }
        node.material = Array.isArray(node.material) ? node.material.map(tint) : tint(node.material)
      })
      return selected
    },
    pick(point: THREE.Vector2, camera: THREE.Camera) {
      root.updateMatrixWorld(true)
      raycaster.setFromCamera(point, camera)
      const hit = raycaster.intersectObject(root, true).find(item => item.object instanceof THREE.Mesh && visible(item.object) && !ignoreHit(item))
      for (let node: THREE.Object3D | null = hit?.object ?? null; node; node = node.parent) {
        const owner = owners.get(node)
        if (owner) return owner
        if(node.userData.factoryEntityId){const owner=entities.get(node.userData.factoryEntityId)?.entity;if(owner)return owner}
      }
      return null
    },
    dispose() { clearSelection(); entities.clear(); owners.clear(); groups.clear() },
  }
}
