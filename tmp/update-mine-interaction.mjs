import { readFileSync, writeFileSync } from 'node:fs'
const path = 'src/features/mine-digital-twin/index.vue'
let source = readFileSync(path, 'utf8')
source = source.replace("onMounted, ref", "onMounted, reactive, ref")
const importsStart = source.indexOf("import type { PowerSelection }")
const importsEnd = source.indexOf('\nconst host', importsStart)
source = source.slice(0, importsStart) + `import { createSceneInteraction, DEFAULT_LAYERS, isSelectionClick, type SceneEntity } from './sceneInteraction'
import { frameSceneEntity } from './sceneCamera'
` + source.slice(importsEnd)
const stateStart = source.indexOf('const showLabels'), stateEnd = source.indexOf('const isFlying', stateStart)
source = source.slice(0, stateStart) + `const layers = reactive({ ...DEFAULT_LAYERS })
const powerRoofVisible = ref(true)
const selected = ref<SceneEntity | null>(null)
const entities = ref<SceneEntity[]>([])
const findTarget = ref('')
const showLayers = ref(false)
const showFind = ref(false)
const earthInspection = ref(false)
const inspectionView = ref<'entity' | null>(null)
const cameraPose = ref('')
let interaction: ReturnType<typeof createSceneInteraction> | undefined
` + source.slice(stateEnd)
const functionsStart = source.indexOf('function restoreOverview()'), functionsEnd = source.indexOf('function advanceInspectionFlight()', functionsStart)
source = source.slice(0, functionsStart) + `function cancelInspectionFlight() {
  flight = undefined
  isFlying.value = false
  if (controls) controls.enableDamping = true
}

function clearSelection() {
  cancelInspectionFlight()
  interaction?.clearSelection()
  park?.protection.setEarthInspection(false)
  earthInspection.value = false
  selected.value = null
  inspectionView.value = null
  findTarget.value = ''
  needsRender = true
}

function applyLayers() {
  interaction?.setLayers(layers)
  if (selected.value && !layers[selected.value.layer]) clearSelection()
  if (labelRenderer) labelRenderer.domElement.style.visibility = layers.labels ? 'visible' : 'hidden'
  if (renderer) renderer.shadowMap.needsUpdate = true
  needsRender = true
}

function restoreOverview() {
  if (!camera || !controls || !park) return
  clearSelection()
  Object.assign(layers, DEFAULT_LAYERS)
  powerRoofVisible.value = true
  park.setPowerRoofVisible(true)
  applyLayers()
  showLayers.value = showFind.value = false
  camera.near = .5
  camera.updateProjectionMatrix()
  controls.minDistance = 25
  controls.enableDamping = false
  controls.update()
  const framed = frameOverview(camera, park.overviewPoints, host.value!.clientWidth, host.value!.clientHeight)
  controls.target.copy(framed.target)
  controls.update()
  controls.enableDamping = true
  controls.saveState()
  cameraMoved = false
  needsRender = true
  if (import.meta.env.DEV) console.info('[mine-digital-twin] overview restored', JSON.stringify({camera:camera.position.toArray(),target:controls.target.toArray(),defaultLayers:true,roofVisible:true}))
}

function locateEntity(id: string) {
  if (!camera || !controls || !park || !interaction || !host.value || status.value !== 'loaded') return
  const entity = interaction.entity(id), object = interaction.object(id)
  if (!entity || !object) return
  clearSelection()
  layers[entity.layer] = true
  if (entity.kind === 'cabinet' || entity.facility?.type === 'spd') {
    layers.buildings = true
    powerRoofVisible.value = false
    park.setPowerRoofVisible(false)
  } else if (id === 'roof-belt-distribution-01') {
    powerRoofVisible.value = true
    park.setPowerRoofVisible(true)
  }
  applyLayers()
  park.protection.setEarthInspection(entity.facility?.type === 'earth-section')
  earthInspection.value = park.protection.earthInspection
  selected.value = interaction.select(id)
  if (!selected.value) return
  findTarget.value = id
  showFind.value = showLayers.value = false
  controls.enableDamping = false
  controls.update()
  const framed = frameSceneEntity(camera, object, entity, host.value.clientWidth, host.value.clientHeight)
  controls.minDistance = framed.minDistance
  camera.near = framed.nearPlane
  camera.updateProjectionMatrix()
  flight = { started: performance.now(), from: camera.position.clone(), to: framed.position,
    fromTarget: controls.target.clone(), target: framed.target,
    fromOffset: new THREE.Vector2(camera.view?.enabled ? camera.view.offsetX : 0, camera.view?.enabled ? camera.view.offsetY : 0),
    offset: new THREE.Vector2(framed.offsetX, framed.offsetY) }
  inspectionView.value = 'entity'
  isFlying.value = true
  cameraMoved = true
  needsRender = true
  if (import.meta.env.DEV) console.info('[mine-digital-twin] entity selected',JSON.stringify({id:entity.id,type:entity.type,kind:entity.kind,highlight:'soft'}))
}

function togglePowerRoof() {
  if (!park || !renderer) return
  const next = !powerRoofVisible.value
  if (selected.value && (next && (selected.value.kind === 'cabinet' || selected.value.facility?.type === 'spd') ||
    !next && selected.value.id === 'roof-belt-distribution-01')) clearSelection()
  powerRoofVisible.value = next
  park.setPowerRoofVisible(next)
  renderer.shadowMap.needsUpdate = true
  needsRender = true
}

` + source.slice(functionsEnd)
const toggleStart = source.indexOf('function toggleLabels()'), toggleEnd = source.indexOf('function arrangeLabels()', toggleStart)
source = source.slice(0, toggleStart) + source.slice(toggleEnd)
source = source.replace('const showLabels', 'const showLabels')
source = source.replaceAll('if (showLabels.value)', 'if (layers.labels)').replaceAll('labelsVisible: showLabels.value', 'labelsVisible: layers.labels')
const listenersStart = source.indexOf('    // Keep orbit gestures intact:'), listenersEnd = source.indexOf('\n    const resize =', listenersStart)
source = source.slice(0, listenersStart) + `    const canvas = renderer.domElement
    let down: { x: number; y: number; time: number; travel: number; pointerId: number } | undefined
    const pointerDown = (event: PointerEvent) => {
      down = event.button === 0 && event.isPrimary ? { x: event.clientX, y: event.clientY, time: performance.now(), travel: 0, pointerId:event.pointerId } : undefined
    }
    const pointerMove = (event: PointerEvent) => {
      if (down) down.travel = Math.max(down.travel, Math.hypot(event.clientX - down.x, event.clientY - down.y))
    }
    const pointerCancel = () => { down = undefined }
    const pointerUp = (event: PointerEvent) => {
      const start = down
      down = undefined
      if (!start || !camera || !interaction || status.value !== 'loaded' || !isSelectionClick(start,
        {x:event.clientX,y:event.clientY,time:performance.now(),pointerId:event.pointerId,button:event.button})) return
      const rect = canvas.getBoundingClientRect()
      const point = new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1)
      const entity = interaction.pick(point, camera)
      if (entity) locateEntity(entity.id)
      else clearSelection()
    }
    canvas.addEventListener('pointerdown', pointerDown)
    canvas.addEventListener('pointermove', pointerMove)
    canvas.addEventListener('pointerup', pointerUp)
    canvas.addEventListener('pointercancel', pointerCancel)
    removePowerListeners = () => {
      canvas.removeEventListener('pointerdown', pointerDown)
      canvas.removeEventListener('pointermove', pointerMove)
      canvas.removeEventListener('pointerup', pointerUp)
      canvas.removeEventListener('pointercancel', pointerCancel)
    }
` + source.slice(listenersEnd)
source = source.replace("      else if (activeInspection === 'monitoring' && selectedMonitoring.value) locateMonitoring(selectedMonitoring.value.id)\n      else if (activeInspection === 'protection' && selectedProtection.value) locateProtection(selectedProtection.value.id)\n      else if (activeInspection && activeInspection !== 'protection') locatePower(activeInspection)", "      else if (activeInspection && selected.value) locateEntity(selected.value.id)")
source = source.replace('      renderer.render(scene, camera)\n      const submitted', "      renderer.render(scene, camera)\n      if (import.meta.env.DEV) cameraPose.value = camera.position.toArray().map(v => v.toFixed(3)).join(',')\n      const submitted")
source = source.replace('    park.setPowerRoofVisible(powerRoofVisible.value)\n    renderer.shadowMap.needsUpdate', `    interaction = createSceneInteraction(park.root, hit => park!.protection.ignoresGroundHit(hit))
    interaction.initialize()
    entities.value = interaction.list
    applyLayers()
    park.setPowerRoofVisible(powerRoofVisible.value)
    renderer.shadowMap.needsUpdate`)
source = source.replace('  park?.power.dispose()', '  interaction?.dispose()\n  park?.power.dispose()')
source = source.slice(0, source.indexOf('<template>')) + `<template>
  <main class="mine-view" :data-model-status="status" :data-power-roof="powerRoofVisible ? 'visible' : 'hidden'"
    :data-selected-entity-id="selected?.id ?? ''" :data-selected-entity-type="selected?.type ?? ''"
    :data-selected-device-id="selected?.kind === 'monitoring' ? selected.id : ''"
    :data-selected-facility-id="selected?.kind === 'protection' ? selected.id : ''"
    :data-selected-power-id="selected?.kind === 'cabinet' ? selected.id : ''"
    :data-inspection-view="inspectionView ?? ''" :data-camera-flying="isFlying" :data-camera-position="cameraPose"
    :data-earth-inspection="earthInspection" :data-layers="JSON.stringify(layers)">
    <div ref="host" class="mine-canvas"></div>
    <header class="mine-heading"><span>煤矿雷电防护数字孪生</span><h1>煤矿地面工业园区</h1></header>
    <p v-if="status === 'loading'" class="mine-message" role="status">正在加载园区模型…</p>
    <p v-else-if="error" class="mine-message" role="alert">模型加载失败：{{ error }}</p>
    <aside v-if="selected" class="mine-selection glass" aria-label="选中对象信息" role="status">
      <div><strong>{{ selected.name }}</strong><span>{{ selected.typeName }}</span></div>
      <code>{{ selected.id }}</code>
      <small v-if="selected.kind === 'monitoring' || selected.kind === 'protection'">示意部署 · {{ selected.kind === 'monitoring' ? '模拟数据' : '非施工依据' }}</small>
      <button type="button" aria-label="取消选择" class="close" @click="clearSelection">×</button>
    </aside>
    <div class="mine-toolbar glass" role="toolbar" aria-label="三维场景工具栏">
      <button type="button" class="primary" :disabled="status !== 'loaded'" @click="restoreOverview">恢复鸟瞰</button>
      <button type="button" :aria-expanded="showLayers" @click="showLayers = !showLayers; showFind = false">图层</button>
      <button type="button" :disabled="status !== 'loaded'" :aria-pressed="!powerRoofVisible" @click="togglePowerRoof">
        {{ powerRoofVisible ? '查看配电室内部' : '恢复配电室屋顶' }}</button>
      <button type="button" :disabled="status !== 'loaded'" :aria-expanded="showFind" @click="showFind = !showFind; showLayers = false">查找对象</button>
      <section v-if="showLayers" class="mine-popover glass" aria-label="图层管理">
        <label><input v-model="layers.buildings" type="checkbox" @change="applyLayers">建筑与基础环境</label>
        <label><input v-model="layers.monitoring" type="checkbox" @change="applyLayers">雷电监测设备</label>
        <label><input v-model="layers.protection" type="checkbox" @change="applyLayers">防雷设施</label>
        <label><input v-model="layers.labels" type="checkbox" @change="applyLayers">设备名称标识</label>
      </section>
      <section v-if="showFind" class="mine-popover mine-find glass" aria-label="辅助查找对象">
        <label for="mine-find-target">选择对象以定位</label>
        <select id="mine-find-target" v-model="findTarget" @change="locateEntity(findTarget)">
          <option value="" disabled>建筑、设备或防雷设施</option>
          <option v-for="entity in entities" :key="entity.id" :value="entity.id">{{ entity.name }} · {{ entity.id }}</option>
        </select>
        <small>柜内设备会自动切换到内部查看。</small>
      </section>
    </div>
    <p class="mine-hint">点击对象定位 · 空白取消 · 左键旋转 · 滚轮缩放 · 右键平移</p>
  </main>
</template>

<style scoped>
.mine-view { position: fixed; inset: 0; background: #e3e7e3; color: #29444e; }
.mine-canvas { width: 100%; height: 100%; }
.mine-canvas :deep(canvas) { display: block; touch-action: none; }
.mine-canvas :deep(.mine-label-layer) { position: absolute; inset: 0; pointer-events: none; }
.mine-heading { position: absolute; top: 24px; left: 28px; pointer-events: none; }
.mine-heading span { font-size: 11px; color: #687f82; letter-spacing: .12em; }
h1 { margin: 7px 0 0; font-size: 21px; font-weight: 600; letter-spacing: .04em; }
.glass { background: #f8fbf5dd; backdrop-filter: blur(14px); border: 1px solid #ffffffc9; box-shadow: 0 5px 22px #304e5010; border-radius: 12px; }
button, select { color: #344f55; font: inherit; }
button { border: 1px solid transparent; background: transparent; border-radius: 7px; padding: 9px 12px; font-size: 12px; cursor: pointer; }
button:hover { background: #e5eeea; }
button:focus-visible, select:focus-visible, input:focus-visible { outline: 2px solid #6e9998; outline-offset: 2px; }
button:disabled { opacity: .45; cursor: wait; }
button[aria-expanded="true"], button[aria-pressed="true"] { background: #dce9e5; }
.mine-toolbar { position: absolute; bottom: 48px; left: 50%; transform: translateX(-50%); display: flex; align-items: center; gap: 4px; padding: 6px; white-space: nowrap; }
.mine-toolbar .primary { background: #496c71; color: #fff; }
.mine-toolbar .primary:hover { background: #36595d; }
.mine-popover { position: absolute; bottom: calc(100% + 10px); right: 0; width: 210px; padding: 15px; display: grid; gap: 13px; font-size: 12px; white-space: normal; }
.mine-popover label { display: flex; align-items: center; gap: 9px; cursor: pointer; }
.mine-popover input { accent-color: #507b75; }
.mine-find { width: min(370px, calc(100vw - 56px)); gap: 10px; }
.mine-find select { width: 100%; padding: 8px; border: 1px solid #c8d6d2; background: #fff9; border-radius: 6px; font-size: 12px; }
.mine-find small { font-size: 11px; color: #728783; }
.mine-selection { position: absolute; bottom: 113px; left: 50%; transform: translateX(-50%); min-width: 240px; max-width: calc(100% - 64px); padding: 12px 38px 12px 16px; display: grid; gap: 4px; pointer-events: auto; }
.mine-selection div { display: flex; align-items: center; gap: 14px; }
.mine-selection strong { font-size: 13px; font-weight: 600; }
.mine-selection span, .mine-selection small { font-size: 10px; color: #6e837d; }
.mine-selection code { font-size: 11px; color: #53716e; }
.mine-selection .close { position: absolute; right: 4px; top: 6px; font-size: 19px; padding: 4px 9px; }
.mine-message { position: absolute; top: 88px; left: 28px; font-size: 12px; }
.mine-hint { position: absolute; left: 0; right: 0; bottom: 16px; margin: 0; text-align: center; color: #72817b; font-size: 11px; pointer-events: none; }
.mine-canvas :deep(.mine-label) { padding: 5px 9px; border: 1px solid #d0dadc; border-radius: 4px; background: #ffffffeb; color: #3b525e; white-space: nowrap; font-size: 11px; line-height: 1.3; pointer-events: none; }
.mine-canvas :deep(.mine-label--zone) { font-size: 12px; font-weight: 600; color: #fff; background: #4f697bea; border-color: #4f697b; padding: 6px 10px; }
.mine-canvas :deep(.mine-label--key) { color: #294a60; border-color: #8fa8b7; font-weight: 600; }
.mine-canvas :deep(.mine-label--reserve) { color: #6c795e; font-size: 10px; }
.mine-canvas :deep(.mine-label--monitoring) { border-color: #8fa8b7; font-size: 10px; white-space: pre-line; text-align: center; }
.mine-canvas :deep(.mine-label--storm-warning) { margin-top: 32px; }
.mine-canvas :deep(.mine-label--occluded) { visibility: hidden; }
@media (max-width: 900px) {
  .mine-canvas :deep(.mine-label--building) { display: none !important; }
  .mine-heading { top: 18px; left: 18px; }
  h1 { font-size: 19px; }
}
@media (max-width: 500px) {
  .mine-toolbar { width: calc(100% - 36px); justify-content: center; flex-wrap: wrap; gap: 2px; bottom: 48px; }
  .mine-toolbar button { padding: 8px 9px; font-size: 11px; }
  .mine-selection { bottom: 150px; min-width: 210px; }
  .mine-hint { font-size: 10px; padding: 0 18px; }
}
</style>
`
if (source.includes('selectedPower') || source.includes('selectedMonitoring') || source.includes('showLabels.value')) throw new Error('Legacy selection not fully removed')
writeFileSync(path, source)
