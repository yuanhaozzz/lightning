import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { airportConfig, type AirportView } from '../../config/airport'
import { airportTaskConfig } from '../../config/airportTask'
import { createAirportSimulation, type TaskSnapshot } from './simulation'
import { bindAirportVehicles } from './vehicleAdapter'
import { createTaskDebugGeometry } from './debugGeometry'
export type { AirportView } from '../../config/airport'

interface SceneOptions {
  onProgress: (step: string) => void
  onReady: () => void
  onError: (message: string) => void
  onPresetChange: (preset: AirportView | 'custom') => void
  onTaskChange?: (snapshot: TaskSnapshot) => void
  calibration?: boolean
}

function disposeTree(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>()
  const materials = new Set<THREE.Material>()
  const textures = new Set<THREE.Texture>()
  root.traverse((object) => {
    if (!(
      object instanceof THREE.Mesh ||
      object instanceof THREE.Line ||
      object instanceof THREE.Points
    ))
      return
    geometries.add(object.geometry)
    const list = Array.isArray(object.material) ? object.material : [object.material]
    list.forEach((material) => {
      materials.add(material)
      Object.values(material).forEach((value) => {
        if (value instanceof THREE.Texture) textures.add(value)
      })
    })
  })
  geometries.forEach((value) => value.dispose())
  materials.forEach((value) => value.dispose())
  textures.forEach((value) => {
    const image: unknown = value.image
    if (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap) image.close()
    value.dispose()
  })
}

export function createAirportScene(container: HTMLElement, options: SceneOptions) {
  let renderer: THREE.WebGLRenderer
  try {
    renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    })
  } catch {
    options.onError('当前浏览器无法启动 WebGL 2 三维渲染，请启用硬件加速后重试。')
    return {
      setView: (_view: AirportView) => {},
      reset() {},
      dispose() {},
      taskStart() {},
      taskPause() {},
      taskResume() {},
      taskReset() {},
      retry: () => location.reload(),
    }
  }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 0.92
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  container.appendChild(renderer.domElement)
  renderer.domElement.setAttribute(
    'aria-label',
    'A21 近机位三维场景，可拖动旋转、滚轮缩放、右键平移',
  )
  renderer.domElement.style.cssText =
    'display:block;width:100%;height:100%;touch-action:none;outline:none'
  const scene = new THREE.Scene()
  scene.background = new THREE.Color('#b9d1df')
  scene.fog = new THREE.Fog('#c9d7de', 125, 420)
  const root = new THREE.Group()
  root.name = 'AEROTWIN_A21_v02'
  scene.add(root)
  const camera = new THREE.PerspectiveCamera(
    airportConfig.camera.fov,
    1,
    airportConfig.camera.near,
    airportConfig.camera.far,
  )
  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.09
  controls.minDistance = options.calibration ? 2 : airportConfig.camera.minDistance
  controls.maxDistance = airportConfig.camera.maxDistance
  controls.minPolarAngle = airportConfig.camera.minPolarAngle
  controls.maxPolarAngle = airportConfig.camera.maxPolarAngle
  controls.screenSpacePanning = false
  controls.panSpeed = 0.65
  controls.zoomSpeed = 0.75
  controls.rotateSpeed = 0.65
  scene.add(new THREE.HemisphereLight('#d1e5ff', '#8a8171', 0.8))
  const sun = new THREE.DirectionalLight('#fff4de', airportConfig.sunlight.intensity)
  sun.position.fromArray(airportConfig.sunlight.position)
  if (options.calibration) sun.position.set(-3, 6, 4)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  const extent = options.calibration ? 6 : airportConfig.sunlight.shadowExtent
  Object.assign(sun.shadow.camera, {
    left: -extent,
    right: extent,
    top: extent,
    bottom: -extent,
    near: 1,
    far: 180,
  })
  sun.shadow.bias = -0.00035
  sun.shadow.normalBias = 0.12
  sun.shadow.radius = 2
  scene.add(sun)
  // Procedural sky only. All aircraft, terminal and bridge surfaces are GLB geometry.
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(900, 48, 32),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      // Three r186 blends fog after tone mapping. Match its unlit horizon color.
      toneMapped: false,
      uniforms: {
        horizonColor: { value: new THREE.Color('#c9d7de') },
        zenithColor: { value: new THREE.Color('#649dc3') },
        groundColor: { value: new THREE.Color('#93958c') },
      },
      vertexShader:
        'varying vec3 vPos; void main(){vPos=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader: `varying vec3 vPos;
      uniform vec3 horizonColor; uniform vec3 zenithColor; uniform vec3 groundColor;
      float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+1.),f.x),f.y);}
      void main(){vec3 d=normalize(vPos);float h=max(d.y,0.);vec3 c=mix(horizonColor,zenithColor,pow(h,.65));
      // Keep the visible lower hemisphere equal to the distant ground fog.
      // Ground bounce is provided separately by the hemisphere light.
      vec2 p=d.xz/max(.02,d.y)*3.;float n=noise(p)*.6+noise(p*2.)*.25+noise(p*4.)*.15;
      float cloud=smoothstep(.58,.79,n)*smoothstep(.10,.25,h)*.22;c=mix(c,vec3(.85),cloud);gl_FragColor=vec4(c,1.);
      #include <colorspace_fragment>
      }`,
    }),
  )
  scene.add(sky)
  // Outdoor illumination and reflections use the same procedural daylight sky.
  const pmrem = new THREE.PMREMGenerator(renderer)
  const skyEnvironment = new THREE.Scene()
  skyEnvironment.add(sky.clone())
  const environment = pmrem.fromScene(skyEnvironment, 0.04)
  scene.environment = environment.texture
  scene.environmentIntensity = 0.65
  pmrem.dispose()
  if (!options.calibration) {
    const horizon = new THREE.Mesh(
      new THREE.PlaneGeometry(2000, 2000),
      new THREE.MeshStandardMaterial({ color: '#91918b', roughness: 1 }),
    )
    horizon.name = 'Distant_apron_horizon'
    horizon.rotation.x = -Math.PI / 2
    horizon.position.y = -0.28
    horizon.receiveShadow = true
    scene.add(horizon)
  }
  let disposed = false,
    frame = 0,
    loadGeneration = 0,
    loading = false,
    contextLost = false
  let transition:
    | {
        start: number
        from: THREE.Vector3
        fromTarget: THREE.Vector3
        to: THREE.Vector3
        toTarget: THREE.Vector3
      }
    | undefined
  const measurements: number[] = []
  let previousTime = performance.now()
  const assetBounds: Record<string, unknown> = {}
  let simulation: ReturnType<typeof createAirportSimulation> | undefined
  let vehicleAdapter: ReturnType<typeof bindAirportVehicles> | undefined
  let simulationPreviousTime: number | undefined
  let lastTaskNotification = -Infinity
  let lastTaskPhase = ''
  const taskDebug =
    !options.calibration && new URLSearchParams(location.search).get('debug') === '1'
      ? createTaskDebugGeometry()
      : undefined
  if (taskDebug) scene.add(taskDebug.group)
  function notifyTask(force = false) {
    if (!simulation) return
    const state = simulation.getSnapshot()
    const signature = `${state.phase}/${state.runState}/${state.events.length}`
    // UI is a projection of the single clock; this throttles delivery, not simulation time.
    if (force || signature !== lastTaskPhase || performance.now() - lastTaskNotification >= 100) {
      options.onTaskChange?.(state)
      lastTaskPhase = signature
      lastTaskNotification = performance.now()
    }
  }
  function taskCommand(command: 'start' | 'pause' | 'resume' | 'reset') {
    if (!simulation || disposed) return
    simulation[command]()
    simulationPreviousTime = undefined
    vehicleAdapter?.apply(simulation.getSnapshot())
    taskDebug?.update(simulation.getSnapshot())
    renderer.shadowMap.needsUpdate = true
    notifyTask(true)
  }
  const onVisibilityChange = () => {
    simulationPreviousTime = undefined
    if (document.hidden && simulation?.getSnapshot().runState === 'running') {
      simulation.pause('页面离开前台，已自动暂停')
      notifyTask(true)
    }
  }
  document.addEventListener('visibilitychange', onVisibilityChange)
  const resize = new ResizeObserver(() => {
    const { width, height } = container.getBoundingClientRect()
    if (!width || !height) return
    renderer.setSize(width, height, false)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
  })
  resize.observe(container)

  function setView(view: AirportView, instant = false) {
    const preset = airportConfig.presets[view]
    const to = new THREE.Vector3().fromArray(preset.position)
    const toTarget = new THREE.Vector3().fromArray(preset.target)
    // Flush residual damping so preset transitions start without a second camera owner.
    const damping = controls.enableDamping
    controls.enableDamping = false
    controls.update()
    controls.enableDamping = damping
    if (instant) {
      camera.position.copy(to)
      controls.target.copy(toTarget)
      controls.update()
    } else
      transition = {
        start: performance.now(),
        from: camera.position.clone(),
        fromTarget: controls.target.clone(),
        to,
        toTarget,
      }
    options.onPresetChange(view)
  }
  const interrupt = () => {
    transition = undefined
    options.onPresetChange('custom')
  }
  controls.addEventListener('start', interrupt)
  const onContextLost = (event: Event) => {
    event.preventDefault()
    contextLost = true
    simulationPreviousTime = undefined
    if (simulation?.getSnapshot().runState === 'running') {
      simulation.pause('三维渲染中断，已自动暂停')
      notifyTask(true)
    }
    options.onError('三维渲染上下文已中断，请点击重试恢复场景。')
  }
  const onContextRestored = () => location.reload()
  renderer.domElement.addEventListener('webglcontextlost', onContextLost)
  renderer.domElement.addEventListener('webglcontextrestored', onContextRestored, { once: true })
  if (options.calibration) {
    camera.position.set(3, 2.5, 4)
    controls.target.set(0, 0.4, 0)
    controls.update()
  } else setView('overview', true)

  async function load() {
    if (loading || disposed) return
    loading = true
    const generation = ++loadGeneration
    simulation = undefined
    vehicleAdapter = undefined
    simulationPreviousTime = undefined
    root.children.slice().forEach((child) => {
      root.remove(child)
      disposeTree(child)
    })
    const list = options.calibration
      ? [{ id: 'calibration', label: '1 米坐标测试物体', position: [0, 0, 0], rotationY: 0 }]
      : airportConfig.assets
    const loader = new GLTFLoader()
    try {
      for (const [index, asset] of list.entries()) {
        options.onProgress(`正在加载${asset.label} · 步骤 ${index + 1} / ${list.length}`)
        const gltf = await loader.loadAsync(
          `${import.meta.env.BASE_URL}models/airport/${asset.id}.glb`,
        )
        if (disposed || generation !== loadGeneration) {
          disposeTree(gltf.scene)
          return
        }
        gltf.scene.position.fromArray(asset.position)
        gltf.scene.rotation.y = asset.rotationY
        gltf.scene.traverse((object) => {
          if (object instanceof THREE.Mesh) {
            object.castShadow = !/glass|window|Glazing/i.test(object.name)
            object.receiveShadow = true
          }
        })
        root.add(gltf.scene)
        const bounds = new THREE.Box3().setFromObject(gltf.scene)
        assetBounds[asset.id] = {
          min: bounds.min.toArray(),
          max: bounds.max.toArray(),
          size: bounds.getSize(new THREE.Vector3()).toArray(),
        }
      }
      renderer.shadowMap.autoUpdate = false
      renderer.shadowMap.needsUpdate = true
      if (!options.calibration) {
        options.onProgress('校验车辆节点与停车锚点，准备作业路线')
        vehicleAdapter = bindAirportVehicles(root)
        simulation = createAirportSimulation(airportTaskConfig, vehicleAdapter.errors)
        vehicleAdapter.apply(simulation.getSnapshot())
        taskDebug?.update(simulation.getSnapshot())
        notifyTask(true)
      }
      if (!contextLost) options.onReady()
    } catch (error) {
      if (!disposed)
        options.onError(
          `场景资源加载失败。请检查本地模型文件与网络后重试。${error instanceof Error ? `（${error.message}）` : ''}`,
        )
    } finally {
      loading = false
    }
  }
  const debug = {
    getTaskSnapshot: () => simulation?.getSnapshot(),
    getVehicleInspection: () => vehicleAdapter?.inspect(),
    getRouteValidation: () => simulation?.getValidationReport(),
    getSnapshot: () => {
      const times = measurements.slice(-180)
      const gl = renderer.getContext()
      const ext = gl.getExtension('WEBGL_debug_renderer_info')
      const cube = root.getObjectByName('Calibration_1m_Cube')
      return {
        ready: root.children.length === (options.calibration ? 1 : airportConfig.assets.length),
        viewport: [container.clientWidth, container.clientHeight],
        pixelRatio: renderer.getPixelRatio(),
        camera: camera.position.toArray(),
        target: controls.target.toArray(),
        transitioning: !!transition,
        triangles: renderer.info.render.triangles,
        drawCalls: renderer.info.render.calls,
        geometries: renderer.info.memory.geometries,
        textures: renderer.info.memory.textures,
        fps: times.length ? 1000 / (times.reduce((a, b) => a + b, 0) / times.length) : null,
        sampleFrames: times.length,
        gpu: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'Unavailable',
        assetBounds,
        calibrationCube: cube
          ? new THREE.Box3().setFromObject(cube).getSize(new THREE.Vector3()).toArray()
          : null,
        shadowEnabled: renderer.shadowMap.enabled,
        up: camera.up.toArray(),
        task: simulation?.getSnapshot(),
        debugVisible: !!taskDebug,
      }
    },
  }
  const debugWindow = window as typeof window & { __aerotwin?: typeof debug }
  debugWindow.__aerotwin = debug
  function render(time: number) {
    if (disposed) return
    frame = requestAnimationFrame(render)
    const dt = time - previousTime
    previousTime = time
    if (simulation) {
      const elapsed =
        simulationPreviousTime === undefined ? 0 : (time - simulationPreviousTime) / 1000
      simulationPreviousTime = time
      const moving = simulation.getSnapshot().runState === 'running'
      if (moving && !document.hidden && !contextLost && elapsed > 0) {
        simulation.update(elapsed)
        vehicleAdapter?.apply(simulation.getSnapshot())
        taskDebug?.update(simulation.getSnapshot())
        renderer.shadowMap.needsUpdate = true
      }
      notifyTask()
    }
    if (dt > 0 && dt < 1000) {
      measurements.push(dt)
      if (measurements.length > 240) measurements.shift()
    }
    if (transition) {
      const progress = Math.min((time - transition.start) / 1050, 1)
      const eased = progress * progress * (3 - 2 * progress)
      camera.position.lerpVectors(transition.from, transition.to, eased)
      controls.target.lerpVectors(transition.fromTarget, transition.toTarget, eased)
      if (progress === 1) transition = undefined
    }
    controls.update()
    if (!options.calibration) {
      const before = controls.target.clone()
      controls.target.clamp(
        new THREE.Vector3(...airportConfig.camera.targetBounds.min),
        new THREE.Vector3(...airportConfig.camera.targetBounds.max),
      )
      camera.position.add(controls.target.clone().sub(before))
      camera.position.y = Math.max(camera.position.y, 1.2)
      // Coarse fuselage envelope; orbit limits are not a full collision system.
      if (
        Math.abs(camera.position.x) < 3 &&
        Math.abs(camera.position.z) < 20 &&
        camera.position.y < 7
      )
        camera.position.y = 7
      camera.lookAt(controls.target)
    }
    renderer.render(scene, camera)
  }
  frame = requestAnimationFrame(render)
  void load()
  return {
    setView,
    reset: () => setView('overview'),
    taskStart: () => taskCommand('start'),
    taskPause: () => taskCommand('pause'),
    taskResume: () => taskCommand('resume'),
    taskReset: () => taskCommand('reset'),
    retry: () => {
      if (renderer.getContext().isContextLost()) location.reload()
      else void load()
    },
    dispose() {
      if (disposed) return
      disposed = true
      ++loadGeneration
      cancelAnimationFrame(frame)
      resize.disconnect()
      document.removeEventListener('visibilitychange', onVisibilityChange)
      simulation = undefined
      vehicleAdapter = undefined
      controls.removeEventListener('start', interrupt)
      controls.dispose()
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost)
      renderer.domElement.removeEventListener('webglcontextrestored', onContextRestored)
      disposeTree(scene)
      environment.dispose()
      sun.shadow.dispose()
      renderer.dispose()
      renderer.forceContextLoss()
      renderer.domElement.remove()
      if (debugWindow.__aerotwin === debug) delete debugWindow.__aerotwin
    },
  }
}
