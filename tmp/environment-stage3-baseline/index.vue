<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js'
import { buildPark } from './parkScene'
import { frameOverview } from './overviewCamera'
import { ASSETS, CONVEYORS, ROADS, ZONES } from './layout'
import { createSceneInteraction, DEFAULT_LAYERS, isSelectionClick, type SceneEntity } from './sceneInteraction'
import { frameSceneEntity } from './sceneCamera'
import { MONITORING_DEVICES } from './monitoringDevices'
import { PROTECTION_FACILITIES } from './protectionFacilities'
import { createStormDemo } from './stormDemo'
import { DEMO_STATUS_NAMES } from './stormDemoData'
import StormDemoControls from './StormDemoControls.vue'
import { createStormCloud } from './stormCloud'
import { createMineEnvironment } from './mineEnvironment'
import { frameStormView, type StormView } from './stormView'
import { createStormWarningPulse } from './stormWarningPulse'

const host = ref<HTMLDivElement>()
const status = ref('loading')
const error = ref('')
const layers = reactive({ ...DEFAULT_LAYERS })
const powerRoofVisible = ref(true)
const selected = ref<SceneEntity | null>(null)
const entities = ref<SceneEntity[]>([])
const hiddenHeadframeParts = ref<string[]>([])
const loadPerformance = ref('')
const findTarget = ref('')
const showLayers = ref(false)
const showFind = ref(false)
const showDemo = ref(false)
const showViews = ref(false)
const sceneView = ref<StormView | 'overview' | 'manual'>('overview')
const demo = createStormDemo([...MONITORING_DEVICES, ...PROTECTION_FACILITIES])
const demoState = ref(demo.snapshot)
const selectedReading = computed(() => demoState.value.devices.find(device => device.id === selected.value?.id))
let previousDemoFrame = 0
let removeDemoListeners: (() => void) | undefined
const earthInspection = ref(false)
const inspectionView = ref<'entity' | null>(null)
const cameraPose = ref('')
let interaction: ReturnType<typeof createSceneInteraction> | undefined
const isFlying = ref(false)
let flight: { started: number; from: THREE.Vector3; to: THREE.Vector3;
  fromTarget: THREE.Vector3; target: THREE.Vector3; fromOffset: THREE.Vector2; offset: THREE.Vector2; fromFov: number; fov: number } | undefined
let removePowerListeners: (() => void) | undefined
let renderer: THREE.WebGLRenderer | undefined
let controls: OrbitControls | undefined
let observer: ResizeObserver | undefined
let scene: THREE.Scene | undefined
let environment: THREE.WebGLRenderTarget | undefined
let labelRenderer: CSS2DRenderer | undefined
let camera: THREE.PerspectiveCamera | undefined
let park: ReturnType<typeof buildPark> | undefined
let stormCloud: ReturnType<typeof createStormCloud> | undefined
let surroundings: ReturnType<typeof createMineEnvironment> | undefined
let warningPulse:ReturnType<typeof createStormWarningPulse> | undefined
let cloudFraming: THREE.Vector3[] = []
const cloudDebug = ref('')
const cloudPerformance = ref('')
const cloudSamples: { interval: number; cpu: number }[] = []
let cloudPerformanceReported = false
let previousCloudDebug = 0
let disposed = false
let needsRender = true
let cameraMoved = false
// Development-only submission timing: CPU cost, not a claim about GPU FPS.
const renderSamples: number[] = []
const drawSamples: number[] = []
const labelSamples: number[] = []
let performanceReported = false
let performanceBatches = 0

function syncDemo() {
  demoState.value = demo.snapshot
  // Status is a separate simulation overlay; model/config identity and materials stay intact.
  for (const device of demoState.value.devices) {
    const label = park?.labels.find(item => item.element.dataset.deviceId === device.id)?.element
    if (!label || label.dataset.demoStatus === device.status) continue
    label.dataset.demoStatus = device.status
    label.textContent = `${device.name}（示意）\n${device.id} · ${DEMO_STATUS_NAMES[device.status]}（演示数据）`
    needsRender = true
  }
}

function controlDemo(command: 'start' | 'pause' | 'resume' | 'replay' | 'exit') {
  if (status.value !== 'loaded') return
  // Discard elapsed wall time from paused/background frames.
  previousDemoFrame = 0
  if (command === 'start') demo.start()
  else if (command === 'pause') demo.pause()
  else if (command === 'resume') demo.resume()
  else if (command === 'replay') demo.replay()
  else demo.exit()
  if (command === 'start' || command === 'replay') switchStormView('demo')
  else if (command === 'exit') restoreOverview()
  syncDemo()
}

function disposeModel(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>()
  const materials = new Set<THREE.Material>()
  const textures = new Set<THREE.Texture>()
  root.traverse((object) => {
    if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
      geometries.add(object.geometry)
      const list = Array.isArray(object.material) ? object.material : [object.material]
      list.forEach((material: THREE.MeshStandardMaterial) => {
        materials.add(material)
        for (const texture of [
          material.map,
          material.normalMap,
          material.roughnessMap,
          material.metalnessMap,
          material.bumpMap,
        ]) {
          if (texture) textures.add(texture)
        }
      })
      if (object instanceof THREE.InstancedMesh) object.dispose()
    }
  })
  geometries.forEach((geometry) => geometry.dispose())
  materials.forEach((material) => material.dispose())
  textures.forEach((texture) => texture.dispose())
}

function cancelInspectionFlight() {
  flight = undefined
  isFlying.value = false
  if (controls) {
    controls.enableDamping = true
    // Allow looking upward from the ground view; retain the original above-ground
    // orbit limit for the bird's-eye and ordinary inspection views.
    controls.maxPolarAngle=camera&&camera.position.y<controls.target.y?Math.PI*.8:Math.PI*.48
  }
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

function flyTo(framed: {position: THREE.Vector3; target: THREE.Vector3; offsetX:number; offsetY:number; fov:number}, animated=true) {
  if (!camera || !controls || !host.value) return
  controls.enableDamping=false;controls.update()
  if (animated) {
    flight={started:performance.now(),from:camera.position.clone(),to:framed.position,
      fromTarget:controls.target.clone(),target:framed.target,
      fromOffset:new THREE.Vector2(camera.view?.enabled?camera.view.offsetX:0,camera.view?.enabled?camera.view.offsetY:0),
      offset:new THREE.Vector2(framed.offsetX,framed.offsetY),fromFov:camera.fov,fov:framed.fov}
    isFlying.value=true
  } else {
    camera.position.copy(framed.position);controls.target.copy(framed.target);camera.fov=framed.fov
    camera.setViewOffset(host.value.clientWidth,host.value.clientHeight,framed.offsetX,framed.offsetY,host.value.clientWidth,host.value.clientHeight)
    controls.update();controls.enableDamping=true
  }
  needsRender=true
}

function switchStormView(mode:StormView, animated=true) {
  if (!camera || !controls || !park || !host.value) return
  clearSelection();sceneView.value=mode;showViews.value=false
  controls.minDistance=mode==='ground'?2:25;controls.maxPolarAngle=Math.PI*.8
  camera.near=.3;camera.updateProjectionMatrix()
  flyTo(frameStormView(camera,park.overviewPoints,cloudFraming,host.value.clientWidth,host.value.clientHeight,mode),animated)
  cameraMoved=true
}

function restoreOverview(resetScene = true, animated=true) {
  if (!camera || !controls || !park) return
  if (resetScene) {
    interaction?.restoreEntityVisibility()
    hiddenHeadframeParts.value = []
    clearSelection()
    Object.assign(layers, DEFAULT_LAYERS)
    powerRoofVisible.value = true
    park.setPowerRoofVisible(true)
    applyLayers()
    showLayers.value = showFind.value = false
  }
  sceneView.value='overview';showViews.value=false
  camera.near = .5
  camera.updateProjectionMatrix()
  controls.minDistance = 25
  controls.maxPolarAngle=Math.PI*.8
  const fitted=camera.clone();fitted.fov=40;fitted.clearViewOffset();fitted.updateProjectionMatrix()
  const framed = frameOverview(fitted, park.overviewPoints, host.value!.clientWidth, host.value!.clientHeight)
  flyTo({...framed,position:fitted.position,fov:40},animated)
  cameraMoved = false
  needsRender = true
  if (import.meta.env.DEV) console.info('[mine-digital-twin] overview restored', JSON.stringify({camera:camera.position.toArray(),target:controls.target.toArray(),defaultSceneReset:resetScene,roofVisible:powerRoofVisible.value}))
}

function locateEntity(id: string) {
  if (!camera || !controls || !park || !interaction || !host.value || status.value !== 'loaded') return
  const entity = interaction.entity(id), object = interaction.object(id)
  if (!entity || !object) return
  if (entity.kind === 'component') {
    interaction.setEntityVisible(id, true)
    hiddenHeadframeParts.value = hiddenHeadframeParts.value.filter(hidden => hidden !== id)
    renderer!.shadowMap.needsUpdate = true
  }
  clearSelection()
  sceneView.value='manual'
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
    offset: new THREE.Vector2(framed.offsetX, framed.offsetY), fromFov:camera.fov, fov:camera.fov }
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

function hideSelectedPart() {
  if (!interaction || selected.value?.kind !== 'component') return
  const id = selected.value.id
  cancelInspectionFlight()
  if (interaction.setEntityVisible(id, false)) {
    hiddenHeadframeParts.value = [...hiddenHeadframeParts.value, id]
    selected.value = null
    renderer!.shadowMap.needsUpdate = true
    needsRender = true
  }
}

function advanceInspectionFlight() {
  if (!flight || !camera || !controls || !host.value) return
  const t = Math.min(1, (performance.now() - flight.started) / 1250)
  const eased = t * t * (3 - 2 * t)
  camera.position.lerpVectors(flight.from, flight.to, eased)
  controls.target.lerpVectors(flight.fromTarget, flight.target, eased)
  camera.fov=THREE.MathUtils.lerp(flight.fromFov,flight.fov,eased)
  const offset = flight.fromOffset.clone().lerp(flight.offset, eased)
  camera.setViewOffset(host.value.clientWidth, host.value.clientHeight, offset.x, offset.y,
    host.value.clientWidth, host.value.clientHeight)
  needsRender = true
  if (t === 1) {
    cancelInspectionFlight()
    if (import.meta.env.DEV) console.info('[mine-digital-twin] power inspection located',
      JSON.stringify({view:inspectionView.value,camera:camera.position.toArray(),target:controls.target.toArray()}))
  }
}

function arrangeLabels() {
  if (!park || !host.value) return
  const kept: DOMRect[] = []
  const viewport = host.value.getBoundingClientRect()
  // Read all rectangles before changing visibility. Hidden labels still have
  // bounds, so repeated class removal and synchronous style recalculation are
  // unnecessary during camera movement.
  const boxes = park.labels.map((item) => item.element.getBoundingClientRect())
  const hidden: boolean[] = []
  for (const box of boxes) {
    if (!box.width) {
      hidden.push(false)
      continue
    }
    const offscreen =
      box.left < viewport.left + 8 ||
      box.right > viewport.right - 8 ||
      box.top < viewport.top + 85 ||
      box.bottom > viewport.bottom - 44
    const overlap = kept.some(
      (other) =>
        box.left < other.right + 7 &&
        box.right > other.left - 7 &&
        box.top < other.bottom + 5 &&
        box.bottom > other.top - 5,
    )
    hidden.push(offscreen || overlap)
    if (!offscreen && !overlap) kept.push(box)
  }
  park.labels.forEach((item, i) => item.element.classList.toggle('mine-label--occluded', hidden[i]))
}

onMounted(async () => {
  const setupStarted = performance.now()
  const container = host.value
  if (!container) return
  try {
    scene = new THREE.Scene()
    scene.background = new THREE.Color('#e3e7e3')
    camera = new THREE.PerspectiveCamera(40, 1, 0.5, 5000)
    renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = .9
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFShadowMap
    renderer.shadowMap.autoUpdate = false
    const room = new RoomEnvironment()
    const pmrem = new THREE.PMREMGenerator(renderer)
    environment = pmrem.fromScene(room, 0.04)
    scene.environment = environment.texture
    scene.environmentIntensity = 0.35
    room.dispose()
    pmrem.dispose()
    renderer.domElement.setAttribute('aria-label', '煤矿地面工业园区三维布局')
    renderer.domElement.tabIndex = 0
    container.appendChild(renderer.domElement)
    labelRenderer = new CSS2DRenderer()
    labelRenderer.domElement.className = 'mine-label-layer'
    container.appendChild(labelRenderer.domElement)
    controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.enablePan = true
    controls.enableZoom = true
    controls.minDistance = 25
    controls.maxDistance = 1800
    controls.maxPolarAngle = Math.PI * 0.48
    controls.listenToKeyEvents(window)
    controls.addEventListener('start', () => {
      cancelInspectionFlight()
      sceneView.value='manual'
      inspectionView.value = null
      cameraMoved = true
    })
    controls.addEventListener('change', () => {
      needsRender = true
      cameraMoved = true
    })
    const ambient = new THREE.HemisphereLight(0xeff2ee, 0x70776a, .65)
    scene.add(ambient)
    const sun = new THREE.DirectionalLight(0xfff3e1, 2.4)
    sun.position.set(-40, 80, 55)
    sun.target.position.set(0, 0, 0)
    sun.castShadow = true
    sun.shadow.mapSize.set(3072, 3072)
    sun.shadow.camera.left = -100
    sun.shadow.camera.right = 100
    sun.shadow.camera.top = 85
    sun.shadow.camera.bottom = -85
    sun.shadow.camera.near = 1
    sun.shadow.camera.far = 200
    sun.shadow.bias = -0.00004
    sun.shadow.normalBias = 0.015
    scene.add(sun, sun.target)
    const fill = new THREE.DirectionalLight(0xe4eae7, 0.25)
    fill.position.set(70, 55, -70)
    scene.add(fill)
    stormCloud = createStormCloud(scene, { sun, ambient })
    cloudFraming=stormCloud.framingPoints()
    surroundings=createMineEnvironment(scene)
    park = buildPark(scene)
    warningPulse=createStormWarningPulse(scene,MONITORING_DEVICES)
    const canvas = renderer.domElement
    let down: { x: number; y: number; time: number; travel: number; pointerId: number } | undefined
    const pointerDown = (event: PointerEvent) => {
      down = event.button === 0 && event.isPrimary ? { x: event.clientX, y: event.clientY, time: performance.now(), travel: 0, pointerId:event.pointerId } : undefined
    }
    const pointerMove = (event: PointerEvent) => {
      if (down) down.travel = Math.max(down.travel, Math.hypot(event.clientX - down.x, event.clientY - down.y))
    }
    const pointerCancel = () => { down = undefined }
    const keyboardStart = (event: KeyboardEvent) => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
      cancelInspectionFlight()
      sceneView.value='manual'
      inspectionView.value = null
      cameraMoved = true
    }
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
    canvas.addEventListener('keydown', keyboardStart)
    removePowerListeners = () => {
      canvas.removeEventListener('pointerdown', pointerDown)
      canvas.removeEventListener('pointermove', pointerMove)
      canvas.removeEventListener('pointerup', pointerUp)
      canvas.removeEventListener('pointercancel', pointerCancel)
      canvas.removeEventListener('keydown', keyboardStart)
    }

    const resize = () => {
      if (!camera || !renderer || !labelRenderer) return
      const width = container.clientWidth,
        height = container.clientHeight
      if (!width || !height) return
      const activeInspection = inspectionView.value
      const activeView=sceneView.value
      cancelInspectionFlight()
      camera.aspect = width / height
      camera.clearViewOffset()
      camera.updateProjectionMatrix()
      renderer.setSize(width, height)
      labelRenderer.setSize(width, height)
      if (activeView==='overview') restoreOverview(false,false)
      else if (activeView!=='manual') switchStormView(activeView,false)
      else if (activeInspection && selected.value) locateEntity(selected.value.id)
      needsRender = true
    }
    observer = new ResizeObserver(resize)
    observer.observe(container)
    resize()
    renderer.shadowMap.needsUpdate = true
    const pageVisibility = () => {
      previousDemoFrame = 0
      if (document.hidden) { demo.pause('page-hidden'); syncDemo() }
    }
    document.addEventListener('visibilitychange', pageVisibility)
    removeDemoListeners = () => document.removeEventListener('visibilitychange', pageVisibility)
    renderer.setAnimationLoop((now) => {
      const delta = previousDemoFrame ? now - previousDemoFrame : 0
      previousDemoFrame = now
      if (demo.update(delta)) syncDemo()
      if (stormCloud?.update(demo.clock, delta)) needsRender = true
      if(stormCloud){
        const atmosphere=stormCloud.atmosphere
        surroundings?.update(stormCloud.frame.opacity,stormCloud.frame.position,earthInspection.value,atmosphere.approach)
        if(warningPulse?.update({...atmosphere,flashPosition:atmosphere.flashPosition as [number,number,number]},demoState.value.devices,layers.monitoring&&status.value==='loaded'))needsRender=true
      }
      if (import.meta.env.DEV && now - previousCloudDebug > 100) {
        previousCloudDebug = now
        cloudDebug.value = JSON.stringify({ ...stormCloud?.frame, atmosphere:stormCloud?.atmosphere, sun: sun.intensity, ambient: ambient.intensity, environment: scene?.environmentIntensity })
      }
      advanceInspectionFlight()
      const moved = controls?.update() ?? false
      if ((!needsRender && !moved) || !scene || !camera || !renderer) return
      const started = import.meta.env.DEV ? performance.now() : 0
      renderer.render(scene, camera)
      if (import.meta.env.DEV) cameraPose.value = camera.position.toArray().map(v => v.toFixed(3)).join(',')
      const submitted = import.meta.env.DEV ? performance.now() : 0
      if (layers.labels) {
        labelRenderer?.render(scene, camera)
        arrangeLabels()
      }
      if (import.meta.env.DEV && stormCloud?.frame.visible && demo.clock.playback === 'playing' && !cloudPerformanceReported) {
        cloudSamples.push({ interval: delta, cpu: performance.now() - started })
        if (cloudSamples.length === 90) {
          const intervals = cloudSamples.map(sample => sample.interval).sort((a,b) => a-b)
          const cpu = cloudSamples.map(sample => sample.cpu).sort((a,b) => a-b)
          cloudPerformance.value=JSON.stringify({ ...stormCloud.resourceInfo, surroundings:surroundings?.resourceInfo,warningPulse:warningPulse?.resourceInfo,
            frameIntervalMedianMs: intervals[45], frameIntervalP95Ms: intervals[85], cpuSubmissionAndLabelsMedianMs: cpu[45],
            samples: 90, note: 'Observed animation frame intervals; includes scene/browser cost, not an isolated GPU timer.' })
          console.info('[mine-digital-twin] cloud performance',cloudPerformance.value)
          cloudPerformanceReported = true; cloudSamples.length = 0
        }
      }
      if (import.meta.env.DEV && status.value === 'loaded' && !performanceReported) {
        const finished = performance.now()
        renderSamples.push(finished - started)
        drawSamples.push(submitted - started)
        labelSamples.push(finished - submitted)
        if (renderSamples.length === 32) {
          const sorted = [...renderSamples].sort((a, b) => a - b)
          console.info('[mine-digital-twin] production performance', JSON.stringify({
            batch: ++performanceBatches,
            labelsVisible: layers.labels,
            powerRoofVisible: powerRoofVisible.value,
            samples: sorted.length,
            cpuRenderAndLabelsMedianMs: sorted[16],
            cpuRenderAndLabelsP95Ms: sorted[30],
            cpuWebGLSubmissionMedianMs: [...drawSamples].sort((a, b) => a - b)[16],
            cpuLabelsMedianMs: [...labelSamples].sort((a, b) => a - b)[16],
            drawCalls: renderer.info.render.calls,
            triangles: renderer.info.render.triangles,
            geometries: renderer.info.memory.geometries,
            textures: renderer.info.memory.textures,
            shadows: 'static; refreshed on model load',
            idleRendering: 'on demand',
          }))
          // Three bounded batches expose first-use cost and warm interaction,
          // without logging continuously or changing production rendering.
          renderSamples.length = drawSamples.length = labelSamples.length = 0
          performanceReported = performanceBatches === 3
        }
      }
      needsRender = false
    })

    const modelsStarted = performance.now()
    const loadedModels = await park.loadModels(new GLTFLoader(), () => disposed, disposeModel)
    loadPerformance.value = JSON.stringify({ modelLoadMs: performance.now() - modelsStarted,
      sceneReadyMs: performance.now() - setupStarted, loadedModels,
      note: 'Actual route load: fetch, decode and model setup; browser/HTTP caches may be warm.' })
    if (disposed) return
    interaction = createSceneInteraction(park.root, hit => park!.protection.ignoresGroundHit(hit))
    interaction.initialize()
    entities.value = interaction.list
    syncDemo()
    applyLayers()
    park.setPowerRoofVisible(powerRoofVisible.value)
    renderer.shadowMap.needsUpdate = true
    renderer.render(scene, camera)
    labelRenderer.render(scene, camera)
    arrangeLabels()
    status.value = 'loaded'
    needsRender = true
    console.info(
      '[mine-digital-twin] park ready',
      JSON.stringify({
        assets: ASSETS.length,
        zones: ZONES.length,
        roads: ROADS.length,
        conveyors: CONVEYORS.length,
        loadedModels,
        loadPerformance: JSON.parse(loadPerformance.value),
        drawCalls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
        idleRendering: 'on demand',
      }),
    )
  } catch (cause) {
    if (disposed) return
    status.value = 'error'
    error.value = cause instanceof Error ? cause.message : String(cause)
    console.error('[mine-digital-twin]', cause)
  }
})

onBeforeUnmount(() => {
  disposed = true
  cancelInspectionFlight()
  observer?.disconnect()
  renderer?.setAnimationLoop(null)
  stormCloud?.dispose()
  warningPulse?.dispose()
  surroundings?.dispose()
  removeDemoListeners?.()
  demo.dispose()
  controls?.dispose()
  removePowerListeners?.()
  interaction?.dispose()
  park?.power.dispose()
  park?.monitoring.dispose()
  park?.protection.dispose()
  if (scene) {
    for (const light of scene.children) {
      if (light instanceof THREE.DirectionalLight) light.shadow.map?.dispose()
    }
    disposeModel(scene)
    scene.clear()
  }
  park?.labels.forEach(({ element }) => element.remove())
  labelRenderer?.domElement.remove()
  environment?.dispose()
  renderer?.dispose()
  renderer?.domElement.remove()
})
</script>

<template>
  <main class="mine-view" :data-model-status="status" :data-power-roof="powerRoofVisible ? 'visible' : 'hidden'"
    :data-selected-entity-id="selected?.id ?? ''" :data-selected-entity-type="selected?.type ?? ''"
    :data-selected-device-id="selected?.kind === 'monitoring' ? selected.id : ''"
    :data-selected-facility-id="selected?.kind === 'protection' ? selected.id : ''"
    :data-selected-power-id="selected?.kind === 'cabinet' ? selected.id : ''"
    :data-inspection-view="inspectionView ?? ''" :data-camera-flying="isFlying" :data-camera-position="cameraPose"
    :data-earth-inspection="earthInspection" :data-layers="JSON.stringify(layers)"
    :data-hidden-headframe-parts="JSON.stringify(hiddenHeadframeParts)" :data-load-performance="loadPerformance"
    :data-demo-playback="demoState.playback" :data-demo-phase="demoState.phase"
    :data-demo-elapsed-ms="demoState.elapsedMs" :data-demo-run-id="demoState.runId ?? ''"
    :data-cloud-state="cloudDebug" :data-cloud-performance="cloudPerformance" :data-scene-view="sceneView"
    :data-demo-devices="JSON.stringify(demoState.devices.map(device => ({id:device.id,status:device.status})))">
    <div ref="host" class="mine-canvas"></div>
    <header class="mine-heading"><span>煤矿雷电防护数字孪生</span><h1>煤矿地面工业园区</h1></header>
    <p v-if="status === 'loading'" class="mine-message" role="status">正在加载园区模型…</p>
    <p v-else-if="error" class="mine-message" role="alert">模型加载失败：{{ error }}</p>
    <aside v-if="selected" class="mine-selection glass" aria-label="选中对象信息" role="status">
      <div><strong>{{ selected.name }}</strong><span>{{ selected.typeName }}</span></div>
      <code>{{ selected.id }}</code>
      <button v-if="selected.kind === 'component'" type="button" class="part-action" @click="hideSelectedPart">隐藏该部件</button>
      <small v-if="selected.kind === 'monitoring' || selected.kind === 'protection'">示意部署 · {{ selected.kind === 'monitoring' ? '模拟数据' : '非施工依据' }}</small>
      <small v-if="selectedReading" class="selected-status" :data-status="selectedReading.status">{{ DEMO_STATUS_NAMES[selectedReading.status] }} · 演示数据
        <template v-if="selectedReading.warningAt"> · 模拟预警时间 {{ new Date(selectedReading.warningAt).toLocaleTimeString('zh-CN', { hour12: false }) }}</template>
      </small>
      <button type="button" aria-label="取消选择" class="close" @click="clearSelection">×</button>
    </aside>
    <div class="mine-toolbar glass" role="toolbar" aria-label="三维场景工具栏" @keydown.stop>
      <button type="button" class="primary" :disabled="status !== 'loaded'" @click="restoreOverview()">恢复鸟瞰</button>
      <button type="button" :disabled="status !== 'loaded'" :aria-expanded="showViews" @click="showViews=!showViews;showLayers=showFind=false">演示视角</button>
      <button type="button" :aria-expanded="showLayers" @click="showLayers = !showLayers; showFind = showViews = false">图层</button>
      <button type="button" :disabled="status !== 'loaded'" :aria-pressed="!powerRoofVisible" @click="togglePowerRoof">
        {{ powerRoofVisible ? '查看配电室内部' : '恢复配电室屋顶' }}</button>
      <button type="button" :disabled="status !== 'loaded'" :aria-expanded="showFind" @click="showFind = !showFind; showLayers = showViews = false">查找对象</button>
      <button type="button" :disabled="status !== 'loaded'" :aria-expanded="showDemo" @click="showDemo = !showDemo; showLayers = showFind = showViews = false">
        雷暴预警演示<span v-if="demoState.playback !== 'idle'" class="demo-stage-dot" :class="demoState.phase"></span>
      </button>
      <section v-if="showViews" class="mine-popover glass" aria-label="演示视角选择">
        <button @click="switchStormView('demo')">园区雷暴视角</button>
        <button @click="switchStormView('ground')">地面仰视云底</button>
        <button @click="switchStormView('oblique')">雷暴接近斜俯视</button>
      </section>
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
          <option v-for="entity in entities" :key="entity.id" :value="entity.id">{{ entity.name }} · {{ entity.id }}{{ hiddenHeadframeParts.includes(entity.id) ? '（已隐藏）' : '' }}</option>
        </select>
        <small>柜内设备会自动切换到内部查看。</small>
        <small v-if="hiddenHeadframeParts.length">重新定位可显示隐藏部件；恢复鸟瞰会还原全部部件。</small>
      </section>
    </div>
    <StormDemoControls v-if="showDemo" :state="demoState" :ready="status === 'loaded'" @command="controlDemo" @close="showDemo = false" />
    <p class="mine-hint">点击对象定位 · 空白取消 · 左键旋转 · 滚轮缩放 · 右键平移</p>
  </main>
</template>

<style scoped>
.mine-view { position: fixed; inset: 0; background: #e3e7e3; color: #29444e; }
.mine-canvas { position: relative; z-index: 0; width: 100%; height: 100%; }
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
.part-action { justify-self: start; padding: 4px 7px; border-color: #c8d6d2; }
.mine-selection strong { font-size: 13px; font-weight: 600; }
.mine-selection span, .mine-selection small { font-size: 10px; color: #6e837d; }
.mine-selection code { font-size: 11px; color: #53716e; }
.mine-selection .selected-status[data-status="normal"] { color: #357b5b; }
.mine-selection .selected-status[data-status="warning"] { color: #a26417; }
.mine-selection .selected-status[data-status="fault"] { color: #ac4c41; }
.demo-stage-dot { display: inline-block; width: 5px; height: 5px; margin-left: 5px; border-radius: 50%; background: #549777; }
.demo-stage-dot.warning { background: #d39a40; }
.mine-selection .close { position: absolute; right: 4px; top: 6px; font-size: 19px; padding: 4px 9px; }
.mine-message { position: absolute; top: 88px; left: 28px; font-size: 12px; }
.mine-heading, .mine-message, .mine-toolbar, .mine-selection { z-index: 2; }
.mine-hint { position: absolute; left: 0; right: 0; bottom: 16px; margin: 0; text-align: center; color: #72817b; font-size: 11px; pointer-events: none; }
.mine-canvas :deep(.mine-label) { padding: 5px 9px; border: 1px solid #d0dadc; border-radius: 4px; background: #ffffffeb; color: #3b525e; white-space: nowrap; font-size: 11px; line-height: 1.3; pointer-events: none; }
.mine-canvas :deep(.mine-label--zone) { font-size: 12px; font-weight: 600; color: #fff; background: #4f697bea; border-color: #4f697b; padding: 6px 10px; }
.mine-canvas :deep(.mine-label--key) { color: #294a60; border-color: #8fa8b7; font-weight: 600; }
.mine-canvas :deep(.mine-label--reserve) { color: #6c795e; font-size: 10px; }
.mine-canvas :deep(.mine-label--monitoring) { border-color: #8fa8b7; font-size: 10px; white-space: pre-line; text-align: center; }
.mine-canvas :deep(.mine-label--monitoring[data-demo-status="normal"]) { border-color: #8daa99; }
.mine-canvas :deep(.mine-label--monitoring[data-demo-status="warning"]) { border-color: #d8ad66; color: #976123; background: #fff6e8eb; }
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
