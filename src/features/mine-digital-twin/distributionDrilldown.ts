import * as THREE from 'three'
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js'
import type { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import type { FactoryStatus } from './factorySimulation'

export type DistributionStage = 'park' | 'building' | 'device' | 'component'
export interface DistributionCameraFrame {
  position: THREE.Vector3; target: THREE.Vector3; nearPlane: number; minDistance: number; fov?: number
}
export interface DistributionDrilldownOptions {
  onCameraStart?: () => void
  onCamera?: (frame: DistributionCameraFrame, progress: number) => void
  onManaged?: (enabled: boolean) => void
  onSelection?: (id: string) => void
}
type Pose = { building: number; device: number; explode: number }
type SavedNode = { parent: THREE.Object3D | null; index: number; position: THREE.Vector3; quaternion: THREE.Quaternion; scale: THREE.Vector3; visible: boolean }
type MaterialEntry = { mesh: THREE.Mesh; original: THREE.Material | THREE.Material[]; materials: THREE.Material[]; opacity: number[]; transparent: boolean[]; depthWrite: boolean[] }
const ROOM_ID = 'distribution-01', CABINET_ID = 'power-cabinet-lv-01', SPD_ID = 'spd-lv-01'
const STAGES: DistributionStage[] = ['park', 'building', 'device', 'component']
const smooth = (t: number) => { const v = THREE.MathUtils.clamp(t, 0, 1); return v * v * (3 - 2 * v) }

/** One reversible timeline; no independent RAF, timers or alterations to plant operation. */
export async function createDistributionDrilldown(root: THREE.Group, loader: GLTFLoader, options: DistributionDrilldownOptions = {}) {
  const find = (id: string) => {
    let found: THREE.Object3D | undefined
    root.traverse(node => { if (node.name === id || node.userData.id === id || node.userData.facilityId === id) found ??= node })
    return found
  }
  const roomNode = find(ROOM_ID), originalCabinet = find(CABINET_ID), shell = find('distribution-shell'), roofNode = find('distribution-roof')
  const spd = find(SPD_ID), band = find('roof-belt-distribution-01'), liner = find('spd-cabinet-inspection-insert')
  if (!roomNode || !originalCabinet || !shell || !roofNode || !spd) throw new Error('配电室下钻缺少原有建筑、屋顶、柜体或 SPD 节点')
  const room: THREE.Object3D = roomNode, roof: THREE.Object3D = roofNode
  const asset = (await loader.loadAsync(`${import.meta.env.BASE_URL}models/mine-distribution-drilldown.glb`)).scene
  // Record only owned resources before attaching the reused SPD and lamps.
  const assetMaterials = new Set<THREE.Material>(), geometries = new Set<THREE.BufferGeometry>(), ownedMaterials = new Set<THREE.Material>(), assetTextures = new Set<THREE.Texture>()
  asset.traverse(node => { if (node instanceof THREE.Mesh) { geometries.add(node.geometry); (Array.isArray(node.material) ? node.material : [node.material]).forEach(material => assetMaterials.add(material)); node.castShadow = true; node.receiveShadow = true } })
  assetMaterials.forEach(material => Object.values(material).forEach(value => { if (value instanceof THREE.Texture) assetTextures.add(value) }))
  asset.name = 'distribution-drilldown-detail'
  room.add(asset)
  root.updateMatrixWorld(true)
  const byRole = new Map<string, THREE.Object3D>()
  asset.traverse(node => { if (typeof node.userData.drilldownRole === 'string') byRole.set(node.userData.drilldownRole, node) })
  const required = (role: string, fallbackName: string) => {
    const result = byRole.get(role) ?? asset.getObjectByName(fallbackName)
    if (!result) throw new Error(`配电室样板缺少独立语义节点：${role}`)
    return result
  }
  const cabinet = required('cabinet', 'power-cabinet-lv-01-detail')
  const door = required('door', 'cabinet-door')
  const walls = required('walls', 'distribution-shell-walls')
  const frame = required('frame', 'cabinet-frame')
  const spdMount = required('spd-mount', 'cabinet-spd-mount')
  cabinet.userData.factoryEntityId = CABINET_ID
  const saved = new Map<THREE.Object3D, SavedNode>()
  function remember(node: THREE.Object3D) {
    if (!saved.has(node)) saved.set(node, { parent: node.parent, index: node.parent?.children.indexOf(node) ?? -1,
      position: node.position.clone(), quaternion: node.quaternion.clone(), scale: node.scale.clone(), visible: node.visible })
  }
  function restoreNode(node: THREE.Object3D) {
    const value = saved.get(node)!
    if (value.parent && node.parent !== value.parent) {
      value.parent.add(node)
      const children = value.parent.children, current = children.indexOf(node)
      children.splice(current, 1); children.splice(Math.min(value.index, children.length), 0, node)
    }
    node.position.copy(value.position); node.quaternion.copy(value.quaternion); node.scale.copy(value.scale); node.visible = value.visible
  }
  remember(shell); remember(roof); remember(cabinet); remember(door); remember(spd); if (band) remember(band); if (liner) remember(liner)
  const originalMeshes: THREE.Mesh[] = []
  originalCabinet.traverse(node => { if (node instanceof THREE.Mesh) { remember(node); originalMeshes.push(node) } })
  shell.visible = false; originalMeshes.forEach(mesh => { mesh.visible = false }); if (liner) liner.visible = false
  spdMount.attach(spd); spd.visible = true
  const lampGroups: THREE.Object3D[] = []
  root.traverse(node => {
    if (node.userData.factoryEntityId === CABINET_ID && node.userData.animationRole === 'status-lamp') lampGroups.push(node)
  })
  // GLB semantics are authored on the group, while factory updates retain mesh references.
  if (!lampGroups.length) root.traverse(node => {
    if (node instanceof THREE.Mesh && node.userData.factoryEntityId === CABINET_ID && Number.isInteger(node.userData.lampIndex) && !asset.getObjectById(node.id)) lampGroups.push(node)
  })
  lampGroups.forEach(node => { remember(node); door.attach(node) })
  options.onManaged?.(true)
  const wallMaterials: MaterialEntry[] = [], otherMaterials: MaterialEntry[] = []
  function cloneMaterials(object: THREE.Object3D, entries: MaterialEntry[]) {
    object.traverse(node => {
      if (!(node instanceof THREE.Mesh) || node.userData.drilldownDecoration) return
      const original = node.material, source = Array.isArray(original) ? original : [original]
      const materials = source.map(material => { const clone = material.clone(); clone.onBeforeCompile = material.onBeforeCompile; clone.customProgramCacheKey = material.customProgramCacheKey; ownedMaterials.add(clone); return clone })
      entries.push({ mesh: node, original, materials, opacity: source.map(m => m.opacity), transparent: source.map(m => m.transparent), depthWrite: source.map(m => m.depthWrite) })
      node.material = Array.isArray(original) ? materials : materials[0]!
    })
  }
  cloneMaterials(walls, wallMaterials)
  root.traverse(node => { if (node.userData.kind === 'cabinet' && node !== originalCabinet) cloneMaterials(node, otherMaterials) })
  function fade(entries: MaterialEntry[], amount: number) {
    entries.forEach(entry => entry.materials.forEach((material, i) => {
      const transparent = amount < .999 || entry.transparent[i]!
      if (material.transparent !== transparent) { material.transparent = transparent; material.needsUpdate = true }
      material.opacity = entry.opacity[i]! * amount
      material.depthWrite = amount > .995 && entry.depthWrite[i]!
    }))
  }
  const effects = new THREE.Group(); effects.name = 'distribution-drilldown-guides'; effects.userData.drilldownDecoration = true; room.add(effects)
  const inspectionLight = new THREE.PointLight('#eef3ee', 30, 18, 2)
  inspectionLight.position.set(-2.35, 3.6, -.2); effects.add(inspectionLight)
  const edgeMaterial = new THREE.LineBasicMaterial({ color: '#73c4ca', transparent: true, opacity: 0, depthWrite: false, toneMapped: false })
  const cabinetEdgeMaterial = edgeMaterial.clone(), componentEdgeMaterial = edgeMaterial.clone()
  ownedMaterials.add(edgeMaterial); ownedMaterials.add(cabinetEdgeMaterial); ownedMaterials.add(componentEdgeMaterial)
  const decorations: THREE.Object3D[] = []
  function edge(object: THREE.Object3D, material: THREE.LineBasicMaterial) {
    const meshes: THREE.Mesh[] = []; object.traverse(node => { if (node instanceof THREE.Mesh) meshes.push(node) })
    meshes.forEach(mesh => {
      const geometry = new THREE.EdgesGeometry(mesh.geometry, 36); geometries.add(geometry)
      const lines = new THREE.LineSegments(geometry, material); lines.name = 'drilldown-contour'; lines.userData.drilldownDecoration = true; lines.raycast = () => {}; mesh.add(lines); decorations.push(lines)
    })
  }
  edge(walls, edgeMaterial); edge(frame, cabinetEdgeMaterial)
  const componentNames: Record<string, string> = { backplate: '安装背板', busbars: '三相母排', breaker: '主断路器', 'terminal-rail': '出线端子排', cables: '柜内连接导体', 'spd-mount': 'SPD 浪涌保护器' }
  const components: { id: string; name: string; object: THREE.Object3D }[] = []
  for (const [role, name] of Object.entries(componentNames)) {
    const object = byRole.get(role) ?? asset.getObjectByName('cabinet-' + role)
    if (!object) continue
    remember(object)
    const id = role === 'spd-mount' ? SPD_ID : String(object.userData.drilldownId ?? `${CABINET_ID}/${role}`)
    if (role !== 'spd-mount') object.userData.factoryEntityId = CABINET_ID
    components.push({ id, name, object: role === 'spd-mount' ? spd : object })
    edge(object, componentEdgeMaterial)
  }
  const labels: { label: CSS2DObject; role: 'building' | 'device' | 'component'; id?: string }[] = []
  function label(text: string, parent: THREE.Object3D, position: THREE.Vector3, role: 'building' | 'device' | 'component', id?: string) {
    const element = document.createElement('div'); element.className = 'distribution-spatial-label'
    element.textContent = text
    Object.assign(element.style, { padding: '4px 7px', border: '1px solid rgba(87,145,153,.45)', borderRadius: '5px', background: 'rgba(243,249,249,.88)', color: '#25454b', font: '11px/1.4 system-ui,sans-serif', boxShadow: '0 2px 8px #365c6112', whiteSpace: 'nowrap', pointerEvents: id ? 'auto' : 'none', cursor: id ? 'pointer' : 'default' })
    const object = new CSS2DObject(element); object.name = `drilldown-label-${id ?? role}`; object.position.copy(position); object.userData.drilldownDecoration = true; parent.add(object); decorations.push(object); labels.push({ label: object, role, id })
    if (id) { element.setAttribute('role', 'button'); element.setAttribute('aria-label', `查看${text}`); element.tabIndex = 0; element.onclick = event => { event.stopPropagation(); enter(id) }; element.onkeydown = event => { if (event.key === 'Enter') enter(id) } }
    return element
  }
  label('屋顶层 · 抬升检视', roof, new THREE.Vector3(-7, 4.7, 0), 'building')
  label('设备层 · 原位保留', effects, new THREE.Vector3(5, .45, 0), 'building')
  const statusLabel = label('低压柜 01 · 演示数据 · 停止', cabinet, new THREE.Vector3(.15, 2.65, -.2), 'device', CABINET_ID)
  const guideMaterial = new THREE.LineBasicMaterial({ color: '#6ba5ac', transparent: true, opacity: .42, depthWrite: false }); ownedMaterials.add(guideMaterial)
  const guideGeometry = new THREE.BufferGeometry(); geometries.add(guideGeometry)
  const guideVertices = new Float32Array(4 * 2 * 3); guideGeometry.setAttribute('position', new THREE.BufferAttribute(guideVertices, 3).setUsage(THREE.DynamicDrawUsage))
  const guides = new THREE.LineSegments(guideGeometry, guideMaterial); guides.raycast = () => {}; effects.add(guides)
  const componentGuides: { geometry: THREE.BufferGeometry; line: THREE.Line; parent: THREE.Object3D; offset: THREE.Vector3 }[] = []
  components.forEach((component, i) => {
    if (component.id.endsWith('/cables') || component.id.endsWith('/backplate')) return
    const object = component.object, bounds = new THREE.Box3().setFromObject(object), center = object.worldToLocal(bounds.getCenter(new THREE.Vector3()))
    const offset = new THREE.Vector3(i % 2 ? .7 : -.65, .12, -.15)
    const point = center.clone().add(offset)
    label(component.name, object, point, 'component', component.id)
    const geometry = new THREE.BufferGeometry().setFromPoints([center, point]); geometries.add(geometry)
    const line = new THREE.Line(geometry, guideMaterial); line.userData.drilldownDecoration = true; line.raycast = () => {}; object.add(line); decorations.push(line); componentGuides.push({ geometry, line, parent: object, offset })
  })
  // Small points travel only on the authored main circuit; an SPD is a parallel protective branch.
  const flowGeometry = new THREE.BufferGeometry(), flowData = new Float32Array(18 * 3)
  flowGeometry.setAttribute('position', new THREE.BufferAttribute(flowData, 3).setUsage(THREE.DynamicDrawUsage)); geometries.add(flowGeometry)
  const flowMaterial = new THREE.PointsMaterial({ color: '#86c2ae', size: .025, transparent: true, opacity: .65, depthWrite: false, toneMapped: false }); ownedMaterials.add(flowMaterial)
  const flow = new THREE.Points(flowGeometry, flowMaterial); flow.name = 'lv01-main-circuit-flow'; flow.raycast = () => {}; cabinet.add(flow); decorations.push(flow)
  const flowPaths: { node: THREE.Object3D; points: THREE.Vector3[] }[] = []
  for (const node of byRole.values()) if (Array.isArray(node.userData.flowPathCabinet)) flowPaths.push({ node, points: node.userData.flowPathCabinet.map((point: number[]) => new THREE.Vector3().fromArray(point)) })
  let stage: DistributionStage = 'park', targetStage: DistributionStage = 'park', currentId = ROOM_ID, transitionElapsed = 0, duration = 1, activeTransition = false, cameraFollow = true, disposed = false
  let pose: Pose = { building: 0, device: 0, explode: 0 }, from: Pose = { ...pose }, to: Pose = { ...pose }, time = 0, status: FactoryStatus = 'stopped'
  let queue: { stage: DistributionStage; id: string }[] = [], finish: (() => void) | undefined
  let roofBefore = roof.visible, bandBefore = band?.visible ?? true
  const baseRoof = roof.position.clone(), baseBand = band?.position.clone(), baseCabinet = cabinet.position.clone(), baseDoor = door.quaternion.clone()
  const openAngle = Number(door.userData.openAngleRadians ?? 1.92), axis = new THREE.Vector3(...(door.userData.rotationAxis ?? [0, 1, 0]) as [number, number, number]).normalize()
  const componentTransforms = [...byRole.values()].filter(node => Array.isArray(node.userData.explodeVector)).map(node => ({ node, position: node.position.clone(), vector: new THREE.Vector3(...node.userData.explodeVector as [number, number, number]) }))
  function cameraFrame(next: DistributionStage): DistributionCameraFrame {
    const origin = room.getWorldPosition(new THREE.Vector3()), device = cabinet.parent!.localToWorld(baseCabinet.clone())
    if (next === 'building') return { position: origin.clone().add(new THREE.Vector3(-14, 19, -23)), target: origin.clone().add(new THREE.Vector3(0, 3.4, 0)), nearPlane: .1, minDistance: 2 }
    if (next === 'park') return { position: origin.clone().add(new THREE.Vector3(-14, 19, -23)), target: origin.clone().add(new THREE.Vector3(0, 3.4, 0)), nearPlane: .1, minDistance: 2 }
    // Stay inside the real aisle: a longer lens offset crosses the opposing MV
    // row and the overhead cable tray. Widen only this close inspection lens.
    return { position: device.clone().add(new THREE.Vector3(.15, 1.65, next === 'component' ? -3.15 : -3.05)), target: device.clone().add(new THREE.Vector3(0, 1.25, next === 'component' ? -.8 : -.5)), nearPlane: .02, minDistance: .3, fov:56 }
  }
  let destination = cameraFrame('building')
  function start(next: DistributionStage, id: string) {
    targetStage = next; currentId = id; from = { ...pose }; to = { building: next === 'park' ? 0 : 1, device: next === 'device' || next === 'component' ? 1 : 0, explode: next === 'component' ? 1 : 0 }
    transitionElapsed = 0; duration = next === 'building' || next === 'park' ? 1.65 : next === 'device' ? 1.8 : 1.2; activeTransition = true; destination = cameraFrame(next)
    // Queued stages preserve a user-orbit cancellation for this whole command.
    // Only a fresh explicit enter/restore command may resume camera tracking.
    if (cameraFollow) options.onCameraStart?.(); options.onSelection?.(id)
  }
  function enter(id: string) {
    if (disposed || !supports(id)) return false
    const next: DistributionStage = id === ROOM_ID ? 'building' : id === CABINET_ID ? 'device' : 'component'
    if (pose.building < .001) { roofBefore = roof.visible; bandBefore = band?.visible ?? true }
    roof.visible = true; if (band) band.visible = true
    queue = []; finish = undefined; cameraFollow = true
    const currentLevel = STAGES.indexOf(activeTransition ? targetStage : stage), nextLevel = STAGES.indexOf(next)
    if (nextLevel > currentLevel + 1) for (let level = Math.max(1, currentLevel + 1); level < nextLevel; level++) queue.push({ stage: STAGES[level]!, id: level === 1 ? ROOM_ID : CABINET_ID })
    if (nextLevel < currentLevel - 1) for (let level = currentLevel - 1; level > nextLevel; level--) queue.push({ stage: STAGES[level]!, id: level === 1 ? ROOM_ID : CABINET_ID })
    queue.push({ stage: next, id })
    const first = queue.shift()!; start(first.stage, first.id); return true
  }
  function supports(id: string) { return id === ROOM_ID || id === CABINET_ID || components.some(component => component.id === id) }
  function restore(animated = true, onComplete?: () => void) {
    queue = []; finish = onComplete; cameraFollow = animated
    if (!animated) { pose = { building: 0, device: 0, explode: 0 }; stage = targetStage = 'park'; currentId = ROOM_ID; activeTransition = false; apply(); roof.visible = roofBefore; if (band) band.visible = bandBefore; const callback = finish; finish = undefined; callback?.(); return }
    // Reassemble internals before closing the door, then lower the solid roof.
    if (pose.explode > .001) queue.push({ stage: 'device', id: CABINET_ID })
    if (pose.device > .001) queue.push({ stage: 'building', id: ROOM_ID })
    queue.push({ stage: 'park', id: ROOM_ID })
    const first = queue.shift()!; start(first.stage, first.id)
  }
  function back() { if (targetStage === 'component' || stage === 'component') enter(CABINET_ID); else if (targetStage === 'device' || stage === 'device') enter(ROOM_ID); else restore() }
  function apply() {
    roof.position.copy(baseRoof).addScaledVector(new THREE.Vector3(0, 1, 0), pose.building * 4.8)
    if (band && baseBand) band.position.copy(baseBand).addScaledVector(new THREE.Vector3(0, 1, 0), pose.building * 4.8)
    cabinet.position.copy(baseCabinet).addScaledVector(new THREE.Vector3(0, 0, -1), pose.device * .30)
    door.quaternion.copy(baseDoor).multiply(new THREE.Quaternion().setFromAxisAngle(axis, openAngle * smooth((pose.device - .18) / .82)))
    componentTransforms.forEach(({ node, position, vector }) => node.position.copy(position).addScaledVector(vector, pose.explode))
    fade(wallMaterials, 1 - pose.building * .88); fade(otherMaterials, 1 - pose.device * .62)
    edgeMaterial.opacity = pose.building * (.08 + (activeTransition && targetStage === 'building' ? .34 * Math.sin(Math.PI * Math.min(1, transitionElapsed / duration)) : 0))
    cabinetEdgeMaterial.opacity = pose.device * (status === 'fault' ? .65 : .45); cabinetEdgeMaterial.color.set(status === 'fault' ? '#ca795f' : '#73c4ca')
    componentEdgeMaterial.opacity = pose.explode * .28
    effects.visible = pose.building > .001
    const corners = [[-8.8, -4.3], [8.8, -4.3], [-8.8, 4.3], [8.8, 4.3]]
    corners.forEach(([x, z], i) => { const start = i * 6; guideVertices.set([x!, 4.05, z!, x!, 4.05 + 4.8 * pose.building, z!], start) }); guideGeometry.attributes.position!.needsUpdate = true
    labels.forEach(item => { item.label.visible = item.role === 'building' ? pose.building > .4 && pose.device < .3 : item.role === 'device' ? pose.building > .9 : pose.device > .7 })
    inspectionLight.intensity = 30 * pose.device
    componentGuides.forEach(item => { item.line.visible = pose.device > .7 })
    flow.visible = pose.device > .55 && pose.explode < .01 && status === 'running' && flowPaths.length > 0
  }
  apply()
  return {
    supports, enter, back, restore,
    cabinetObject: cabinet, components,
    cancelCamera() { cameraFollow = false },
    get snapshot() { return { stage, targetStage, currentId, active: pose.building > .001 || activeTransition, transitioning: activeTransition, progress: activeTransition ? Math.min(1, transitionElapsed / duration) : 1, roofLift: pose.building * 4.8, wallOpacity: 1 - pose.building * .88, cabinetOffset: pose.device * .30, doorAngle: openAngle * smooth((pose.device - .18) / .82), explode: pose.explode, lampCount: lampGroups.length, status, cameraFollow } },
    ignoresHit(hit: THREE.Intersection) {
      if (hit.object.userData.drilldownDecoration) return true
      if (pose.building < .7) return false
      for (let node: THREE.Object3D | null = hit.object; node; node = node.parent) if (node === walls || node === roof || node === band) return true
      return false
    },
    update(deltaTime: number, nextStatus: FactoryStatus = 'stopped') {
      if (disposed || !Number.isFinite(deltaTime) || deltaTime < 0) return false
      status = nextStatus; time += Math.min(deltaTime, .1)
      statusLabel.textContent = `低压柜 01 · power-cabinet-lv-01 · ${{ running: '运行', stopped: '停止', fault: '模拟故障' }[status]}（演示数据）`
      statusLabel.setAttribute('aria-label', `查看${statusLabel.textContent}`)
      const wasTransition = activeTransition
      if (activeTransition) {
        transitionElapsed = Math.min(duration, transitionElapsed + deltaTime)
        const progress = smooth(transitionElapsed / duration)
        pose = { building: THREE.MathUtils.lerp(from.building, to.building, progress), device: THREE.MathUtils.lerp(from.device, to.device, progress), explode: THREE.MathUtils.lerp(from.explode, to.explode, progress) }
        apply(); if (cameraFollow && targetStage !== 'park') options.onCamera?.(destination, progress)
        if (transitionElapsed >= duration) {
          stage = targetStage; activeTransition = false
          if (stage === 'park') { roof.visible = roofBefore; if (band) band.visible = bandBefore }
          const queued = queue.shift(); if (queued) start(queued.stage, queued.id)
          else { const callback = finish; finish = undefined; callback?.() }
        }
      } else apply()
      if (flow.visible) {
        root.updateMatrixWorld(true)
        for (let i = 0; i < 18; i++) {
          const path = flowPaths[i % flowPaths.length]!, t = (time * .23 + Math.floor(i / flowPaths.length) / 6) % 1, p = t * (path.points.length - 1), a = Math.floor(p), point = path.points[a]!.clone().lerp(path.points[Math.min(a + 1, path.points.length - 1)]!, p - a)
          // Authored coordinates are cabinet-local, with their component displacement applied.
          point.addScaledVector(new THREE.Vector3(...(path.node.userData.explodeVector ?? [0, 0, 0]) as [number, number, number]), pose.explode)
          flowData.set(point.toArray(), i * 3)
        }
        flowGeometry.attributes.position!.needsUpdate = true
      }
      return wasTransition || status === 'running' && pose.device > .55
    },
    dispose() {
      if (disposed) return; disposed = true; queue = []; finish = undefined
      labels.forEach(item => { item.label.element.onclick = null; item.label.element.onkeydown = null; item.label.element.remove() })
      decorations.forEach(node => node.removeFromParent()); effects.removeFromParent()
      wallMaterials.concat(otherMaterials).forEach(entry => { entry.mesh.material = entry.original })
      // Existing objects, especially SPD and animated lamps, leave the disposable asset first.
      for (const node of [spd, ...lampGroups]) restoreNode(node)
      for (const [node] of saved) if (node !== spd && !lampGroups.includes(node)) restoreNode(node)
      asset.removeFromParent(); geometries.forEach(geometry => geometry.dispose()); ownedMaterials.forEach(material => material.dispose()); assetMaterials.forEach(material => material.dispose()); assetTextures.forEach(texture => texture.dispose())
      options.onManaged?.(false)
    },
  }
}
