import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { Line2 } from 'three/addons/lines/Line2.js'
import { LineGeometry } from 'three/addons/lines/LineGeometry.js'
import { LineMaterial } from 'three/addons/lines/LineMaterial.js'
import { focusProgress, FOCUS_FLIGHT_SECONDS, type FocusKind, type FocusStage } from './focus'
import {
  LEVELS,
  MINES,
  STORMS,
  bearingTo,
  destination,
  nearestStorm,
  stormThreats,
  stormBoundary,
  scenarioTime,
  stormPosition,
  stormRadius,
  visibleStrikes,
  type LngLat,
  type MapScope,
  type Storm,
  type Strike,
  type WeatherMode,
} from './weather'

export interface WeatherScene {
  setMode(mode: WeatherMode): void
  setTime(minute: number): void
  selectMine(id: string): void
  focusMine(id: string): void
  selectStorm(id: string): void
  setScope(scope: MapScope): void
  setView(view: '3D' | '2D'): void
  setLayer(layer: 'radar' | 'lightning', visible: boolean): void
  zoom(delta: number): void
  reset(): void
  dispose(): void
}

type GeoFeature = {
  geometry:
    | { type: 'MultiPolygon'; coordinates: LngLat[][][] }
    | { type: 'MultiLineString'; coordinates: LngLat[][] }
}
type Label = {
  sprite: THREE.Sprite
  anchor: THREE.Vector3
  width: number
  height: number
  nationalOnly?: boolean
}
const TOP = 0.48
const project = (p: LngLat, height = TOP) =>
  new THREE.Vector3((p[0] - 104.4) * 0.82, height, -(p[1] - 35.2))
const ring = (center: LngLat, km: number, height = TOP + 0.05) =>
  Array.from({ length: 181 }, (_, i) => project(destination(center, i * 2, km), height))

function weatherTexture(storm: Storm): THREE.CanvasTexture {
  const size = 256,
    canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const context = canvas.getContext('2d')!,
    pixels = context.createImageData(size, size)
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const dx = (x / size) * 2 - 1,
        north = 1 - (y / size) * 2
      const angle = (Math.atan2(dx, north) * 180) / Math.PI
      const edge = stormRadius(storm, angle) / storm.radius
      const r = Math.hypot(dx, north) / edge
      if (r > 1) continue
      const noise =
        Math.sin(dx * 21 + Math.sin(north * 14 + storm.phase) * 2) * Math.cos(north * 19) * 0.035
      const core = Math.exp(-((dx + 0.18) ** 2 * 8 + (north - 0.13) ** 2 * 14))
      const lobe = Math.exp(-((dx - 0.23) ** 2 * 28 + (north + 0.25) ** 2 * 17))
      const strength = (1 - r) * 0.28 + core * 0.59 + lobe * 0.37 + noise
      const color =
        strength > 0.72
          ? [239, 118, 88]
          : strength > 0.57
            ? [230, 165, 76]
            : strength > 0.39
              ? [188, 195, 79]
              : strength > 0.23
                ? [100, 178, 137]
                : [67, 145, 153]
      const i = (y * size + x) * 4
      pixels.data[i] = color[0]!
      pixels.data[i + 1] = color[1]!
      pixels.data[i + 2] = color[2]!
      pixels.data[i + 3] = Math.round(Math.min(1, (1 - r) * 20) * (195 + strength * 58))
    }
  context.putImageData(pixels, 0, 0)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

function glowTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 64
  const ctx = canvas.getContext('2d')!,
    gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
  gradient.addColorStop(0, '#ffffff')
  gradient.addColorStop(0.15, '#ffffffb0')
  gradient.addColorStop(1, '#ffffff00')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, 64, 64)
  return new THREE.CanvasTexture(canvas)
}

export async function createWeatherScene(
  host: HTMLElement,
  options: {
    onMine: (id: string) => void
    onStorm: (id: string) => void
    onStrike: (strike: Strike) => void
    onError: (message: string) => void
    onFocusStage: (stage: FocusStage) => void
    onTargetScreen: (point: { x: number; y: number; visible: boolean }) => void
  },
): Promise<WeatherScene> {
  const response = await fetch(`${import.meta.env.BASE_URL}china.geojson`)
  if (!response.ok) throw new Error('中国边界数据加载失败')
  const geo = (await response.json()) as { features: GeoFeature[] }
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance',
  })
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.6))
  renderer.setClearColor(0x08151c, 0)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.35
  renderer.domElement.setAttribute(
    'aria-label',
    '中国雷暴监测地图；左键拖动平移，右键旋转，滚轮缩放，点击矿区启动定位与测距',
  )
  host.append(renderer.domElement)
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 240)
  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.075
  controls.enablePan = true
  controls.screenSpacePanning = false
  controls.panSpeed = .85
  controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE }
  controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE }
  controls.minDistance = 5
  controls.maxDistance = 140
  controls.minPolarAngle = 0.05
  controls.maxPolarAngle = 1.16
  controls.rotateSpeed = 0.32
  scene.add(new THREE.HemisphereLight(0xbfeeff, 0x183544, 2.6))
  const light = new THREE.DirectionalLight(0xc0eaff, 3)
  light.position.set(-18, 35, 14)
  scene.add(light)
  let mode: WeatherMode = 'live',
    scope: MapScope = 'national',
    view: '3D' | '2D' = '3D',
    minute = 30
  let mine = MINES[0]!,
    disposed = false,
    frame = 0,
    fit = 1
  let selectedStormId = nearestStorm(mine, minute).storm.id
  let threats = stormThreats(mine, minute)
  const activeThreat = () =>
    threats.find((item) => item.storm.id === selectedStormId) ?? threats[0]!
  const visibleThreats = () => threats.filter((item) => item.distance <= 350)
  const strikePulses: { ring: THREE.Mesh; glow: THREE.Sprite; phase: number }[] = []
  const cloudUniforms: { focus: { value: number }; selected: { value: number } }[] = []
  let elapsed = 0
  let focusStarted = 0, focusKind: FocusKind = 'full', focusStage: FocusStage = 'overview'
  let flight: { from: THREE.Vector3; to: THREE.Vector3; fromTarget: THREE.Vector3; toTarget: THREE.Vector3; start: number } | undefined
  const radarStrokes: { object: THREE.Line; count: number; order: number }[] = []
  let rangeMaterial: THREE.ShaderMaterial | undefined
  let rangeTip: THREE.Sprite | undefined
  let targetOutline: THREE.Line | undefined
  let targetOutlineCount = 0
  const rangeStart = new THREE.Vector3(), rangeEnd = new THREE.Vector3()
  let lastTargetScreen = { x: -1, y: -1, visible: false }
  const mapUniforms = { focus: { value: 0 }, center: { value: new THREE.Vector2() }, longitudeScale: { value: 1 } }
  let cameraGoal: THREE.Vector3 | undefined, targetGoal: THREE.Vector3 | undefined
  const layerState = { radar: true, lightning: true }
  const country = new THREE.Group(),
    clouds = new THREE.Group(),
    mines = new THREE.Group(),
    strikes = new THREE.Group()
  const radar = new THREE.Group(),
    tracks = new THREE.Group(),
    heat = new THREE.Group(),
    measurement = new THREE.Group()
  scene.add(country, clouds, mines, strikes, radar, tracks, heat, measurement)
  const labels: Label[] = [],
    hits: THREE.Object3D[] = []
  const textureSet = new Set<THREE.Texture>()
  const glow = glowTexture()
  textureSet.add(glow)

  function line(
    points: THREE.Vector3[],
    color: THREE.ColorRepresentation,
    opacity = 0.5,
    dashed = false,
    width = 1,
  ) {
    if (width > 1) {
      const material = new LineMaterial({
        color: new THREE.Color(color).getHex(),
        linewidth: width,
        transparent: true,
        opacity,
        dashed,
        dashSize: 0.12,
        gapSize: 0.1,
        depthWrite: false,
      })
      material.resolution.set(host.clientWidth, host.clientHeight)
      const object = new Line2(
        new LineGeometry().setPositions(points.flatMap((p) => p.toArray())),
        material,
      )
      object.computeLineDistances()
      object.renderOrder = 20
      return object
    }
    const material = dashed
      ? new THREE.LineDashedMaterial({
          color,
          transparent: true,
          opacity,
          dashSize: 0.12,
          gapSize: 0.1,
          depthWrite: false,
        })
      : new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false })
    const object = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), material)
    if (dashed) object.computeLineDistances()
    return object
  }
  function label(
    text: string,
    position: THREE.Vector3,
    color = '#c1d6d7',
    background = true,
    size = 11,
  ): THREE.Sprite {
    const canvas = document.createElement('canvas'),
      ctx = canvas.getContext('2d')!
    ctx.font = '500 28px "Microsoft YaHei",sans-serif'
    canvas.width = Math.ceil(ctx.measureText(text).width + 36)
    canvas.height = 58
    ctx.font = '500 28px "Microsoft YaHei",sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    if (background) {
      ctx.fillStyle = '#0a1b23e8'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.strokeStyle = `${color}40`
      ctx.lineWidth = 1
      ctx.strokeRect(0.5, 0.5, canvas.width - 1, canvas.height - 1)
    }
    ctx.fillStyle = color
    ctx.fillText(text, canvas.width / 2, 28)
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    textureSet.add(texture)
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      }),
    )
    sprite.position.copy(position)
    labels.push({
      sprite,
      anchor: position.clone(),
      width: (canvas.width / 28) * size,
      height: (58 / 28) * size,
    })
    return sprite
  }
  function clearGroup(group: THREE.Group) {
    group.traverse((object) => {
      const renderable = object as THREE.Mesh
      if (renderable.geometry) renderable.geometry.dispose()
      if (renderable.material) {
        const materials = Array.isArray(renderable.material)
          ? renderable.material
          : [renderable.material]
        for (const material of materials) {
          const map = (material as THREE.SpriteMaterial).map
          if (map && map !== glow) {
            map.dispose()
            textureSet.delete(map)
          }
          material.dispose()
        }
      }
      const index = labels.findIndex((item) => item.sprite === object)
      if (index >= 0) labels.splice(index, 1)
      const hit = hits.indexOf(object)
      if (hit >= 0) hits.splice(hit, 1)
    })
    group.clear()
  }

  // A clean extruded cartographic plate, without invented terrain, towers or inter-site links.
  const topMaterial = new THREE.MeshStandardMaterial({
    color: 0x265b72,
    emissive: 0x12445b,
    emissiveIntensity: 0.3,
    roughness: 0.48,
    metalness: 0.32,
  })
  const sideMaterial = new THREE.MeshStandardMaterial({
    color: 0x16465b,
    emissive: 0x08718c,
    emissiveIntensity: 0.24,
    roughness: 0.62,
    metalness: 0.3,
  })
  // Fine georeferenced grid remains on the map surface at every camera angle.
  topMaterial.onBeforeCompile = (shader) => {
    shader.uniforms.mapFocus = mapUniforms.focus
    shader.uniforms.focusCenter = mapUniforms.center
    shader.uniforms.longitudeScale = mapUniforms.longitudeScale
    shader.vertexShader = 'varying vec3 mapLocal;\n' + shader.vertexShader
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\nmapLocal=position;',
    )
    shader.fragmentShader = 'varying vec3 mapLocal;uniform float mapFocus;uniform vec2 focusCenter;uniform float longitudeScale;\n' + shader.fragmentShader
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      vec2 deltaKm=(mapLocal.xy-focusCenter)*vec2(longitudeScale,111.32);
      float focusMask=1.-smoothstep(170.,580.,length(deltaKm));
      diffuseColor.rgb *= mix(1., .33+focusMask*.5, mapFocus);
      diffuseColor.rgb *= .84+.16*smoothstep(-12.,16.,mapLocal.y);`)
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
      vec2 gridUv=mapLocal.xy*2.;
      vec2 gridDist=abs(fract(gridUv-.5)-.5)/max(fwidth(gridUv),vec2(.001));
      float gridLine=1.-min(min(gridDist.x,gridDist.y),1.);
      totalEmissiveRadiance*=mix(1.,.5+focusMask*.6,mapFocus);
      totalEmissiveRadiance+=vec3(.1,.42,.62)*gridLine*.018;`,
    )
  }
  const edges: number[] = [],
    boundary: number[] = []
  function addEdges(points: LngLat[], output: number[]) {
    for (let i = 1; i < points.length; i++)
      output.push(
        ...project(points[i - 1]!, TOP + 0.01).toArray(),
        ...project(points[i]!, TOP + 0.01).toArray(),
      )
  }
  for (const feature of geo.features) {
    if (feature.geometry.type === 'MultiLineString') {
      feature.geometry.coordinates.forEach((points) => addEdges(points, boundary))
      continue
    }
    const shapes = feature.geometry.coordinates.map((polygon) => {
      const points = (ring: LngLat[]) =>
        ring.map((p) => new THREE.Vector2((p[0] - 104.4) * 0.82, p[1] - 35.2))
      const shape = new THREE.Shape(points(polygon[0]!))
      polygon.slice(1).forEach((hole) => shape.holes.push(new THREE.Path(points(hole))))
      polygon.forEach((ring) => addEdges(ring, edges))
      return shape
    })
    const geometry = new THREE.ExtrudeGeometry(shapes, {
      depth: 0.64,
      bevelEnabled: false,
      steps: 1,
      curveSegments: 1,
    })
    const mesh = new THREE.Mesh(geometry, [topMaterial, sideMaterial])
    mesh.rotation.x = -Math.PI / 2
    mesh.position.y = TOP - 0.64
    country.add(mesh)
  }
  function segments(vertices: number[], color: number, opacity: number) {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
    return new THREE.LineSegments(
      geometry,
      new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false }),
    )
  }
  country.add(segments(edges, 0xb4e6fa, 0.28), segments(boundary, 0xc0f4ff, 0.9))
  const underlay = segments(edges, 0x5dcefa, 0.32)
  underlay.position.y = -0.85
  country.add(underlay)
  const floor = new THREE.GridHelper(140, 70, 0x2c637c, 0x2c637c)
  floor.position.y = -0.8
  const floorMat = floor.material as THREE.Material
  floorMat.transparent = true
  floorMat.opacity = 0.085
  scene.add(floor)

  const provinces: [string, number, number][] = [
    ['新疆', 85, 40],
    ['西藏', 88, 31.5],
    ['青海', 96, 35.5],
    ['甘肃', 101, 39],
    ['内蒙古', 113, 44],
    ['黑龙江', 127, 48],
    ['四川', 103, 30.5],
    ['云南', 101, 24],
    ['湖北', 113, 31],
    ['广东', 113, 23.5],
    ['台湾', 121.3, 23.6],
    ['海南', 109.5, 19],
  ]
  for (const [name, lon, lat] of provinces) {
    const sprite = label(name, project([lon, lat], TOP + 0.07), '#a3c9dc', false, 10)
    labels[labels.length - 1]!.nationalOnly = true
    country.add(sprite)
  }

  const mineMarkers = new Map<string, THREE.Mesh>()
  for (const item of MINES) {
    const point = project(item.center, TOP + 0.08)
    const marker = new THREE.Mesh(
      new THREE.RingGeometry(0.06, 0.09, 32),
      new THREE.MeshBasicMaterial({ color: 0xb2dfd6, side: THREE.DoubleSide, depthWrite: false }),
    )
    marker.rotation.x = -Math.PI / 2
    marker.position.copy(point)
    mines.add(marker)
    mineMarkers.set(item.id, marker)
    const center = new THREE.Mesh(
      new THREE.SphereGeometry(0.035, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xe5f7ed }),
    )
    center.position.copy(point)
    mines.add(center)
    const name = label(
      item.name,
      point.clone().add(new THREE.Vector3(0, 0.35, 0)),
      '#b6d4cf',
      true,
      11,
    )
    name.center.set(0, 1)
    name.userData = { kind: 'mine', id: item.id }
    mines.add(name)
    hits.push(name)
    const hit = new THREE.Mesh(
      new THREE.SphereGeometry(0.2, 8, 6),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
    )
    hit.position.copy(point)
    hit.userData = { kind: 'mine', id: item.id }
    mines.add(hit)
    hits.push(hit)
  }

  const cloudMeshes = new Map<string, THREE.Mesh>()
  for (const storm of STORMS) {
    const texture = weatherTexture(storm)
    textureSet.add(texture)
    const uniforms = {
      focus: { value: 0 },
      selected: { value: storm.id === selectedStormId ? 1 : 0 },
      field: { value: texture },
    }
    cloudUniforms.push(uniforms)
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.ShaderMaterial({
        uniforms,
        vertexShader:
          'varying vec2 uvp;void main(){uvp=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
        // The echo itself is stable. Acquisition is expressed by tracing its actual boundary.
        fragmentShader: `varying vec2 uvp;uniform sampler2D field;uniform float focus;uniform float selected;
          void main(){vec4 echo=texture2D(field,uvp);if(echo.a<.01)discard;
          vec3 color=echo.rgb+vec3(.005,.015,.018)*selected*focus;
          gl_FragColor=vec4(color,echo.a*mix(1.,.73+selected*.27,focus));
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          }`,
        transparent: true,
        toneMapped: false,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    )
    mesh.rotation.x = -Math.PI / 2
    clouds.add(mesh)
    cloudMeshes.set(storm.id, mesh)
  }

  const scanMaterial = new THREE.ShaderMaterial({
    uniforms: { angle: { value: 0 }, reveal: { value: 0 } },
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
    vertexShader:
      'varying vec2 uvp;void main(){uvp=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader:
      'varying vec2 uvp;uniform float angle;uniform float reveal;void main(){vec2 p=uvp*2.-1.;float r=length(p);if(r>reveal)discard;float a=atan(p.y,p.x);float diff=mod(angle-a+6.283185,6.283185);float sweep=(1.-smoothstep(0.,1.1,diff))*.19;float head=(1.-smoothstep(0.,.018,diff))*.65;float front=exp(-pow((r-reveal)*70.,2.))*(1.-step(.995,reveal))*.5;gl_FragColor=vec4(.36,.87,1.,(sweep+head+front)*smoothstep(.01,.12,r)*(1.-smoothstep(.97,1.,r)));}',
  })
  const scanner = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), scanMaterial)
  scanner.rotation.x = -Math.PI / 2
  scene.add(scanner)

  const minePulse = new THREE.Mesh(
    new THREE.RingGeometry(0.96, 1, 96),
    new THREE.MeshBasicMaterial({
      color: '#8ceaff',
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  )
  minePulse.rotation.x = -Math.PI / 2
  scene.add(minePulse)

  function setFocusStage(next: FocusStage) {
    if (next === focusStage) return
    focusStage = next
    options.onFocusStage(next)
  }

  function beginFocus(kind: FocusKind = 'full') {
    focusStarted = elapsed
    focusKind = kind
    options.onTargetScreen({ x: 0, y: 0, visible: false })
    lastTargetScreen.visible = false
    setFocusStage(kind === 'full' ? 'flying' : 'ranging')
    if (kind === 'full') {
      moveCamera()
      flight = { from: camera.position.clone(), to: cameraGoal!.clone(), fromTarget: controls.target.clone(), toTarget: targetGoal!.clone(), start: elapsed }
      cameraGoal = targetGoal = undefined
    }
  }

  function updateRadar() {
    clearGroup(radar)
    radarStrokes.length = 0
    const nearest = threats[0]!
    const position = project(mine.center, TOP + .055)
    mapUniforms.center.value.set(position.x, -position.z)
    mapUniforms.longitudeScale.value = 111.32 * Math.cos(mine.center[1] * Math.PI / 180) / .82
    scanner.position.copy(position)
    scanner.scale.set(400 / mapUniforms.longitudeScale.value, 400 / 111.32, 1)
    const levels = [...LEVELS].reverse()
    for (let i = 0; i < levels.length; i++) {
      const level = levels[i]!
      const points = ring(mine.center, level.radius)
      const circle = line(points, level.color, level.level === nearest.level.level ? .86 : .48) as THREE.Line
      radar.add(circle)
      radarStrokes.push({object:circle,count:points.length,order:i})
      const anchor = destination(mine.center, 208, level.radius)
      const text = label(level.radius + ' km', project(anchor,TOP+.11), level.color, false, 10)
      text.userData.reveal = 'radar'
      radar.add(text)
    }
    const ticks: number[] = []
    for (let bearing = 0; bearing < 360; bearing += 5) {
      const major = bearing % 30 === 0
      ticks.push(...project(destination(mine.center,bearing,major?213:219),TOP+.07).toArray(),...project(destination(mine.center,bearing,225),TOP+.07).toArray())
    }
    const bezel = segments(ticks,0xa5dce8,.55)
    bezel.userData.reveal = 'radar'
    radar.add(bezel)
    for (const [name,bearing] of [['N',0],['E',90],['S',180],['W',270]] as const) {
      const text=label(name,project(destination(mine.center,bearing,244),TOP+.1),'#9bc2d3',false,9)
      text.userData.reveal='radar'
      radar.add(text)
    }
    radar.add(line(ring(mine.center,9,TOP+.075),'#d7f7ff',.8))
    mineMarkers.forEach((marker,id) => {
      ;(marker.material as THREE.MeshBasicMaterial).color.set(id === mine.id ? '#eefaff' : '#82aaa8')
    })
    minePulse.position.copy(project(mine.center,TOP+.085))
    updateMeasurement()
  }

  function measurementRibbon(start: THREE.Vector3, end: THREE.Vector3, color: string) {
    const side = new THREE.Vector3(-(end.z-start.z),0,end.x-start.x).normalize().multiplyScalar(.028)
    const positions = [start.clone().sub(side),end.clone().sub(side),start.clone().add(side),end.clone().add(side)]
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions.flatMap((p)=>p.toArray()),3))
    geometry.setAttribute('uv',new THREE.Float32BufferAttribute([0,0,1,0,0,1,1,1],2))
    geometry.setIndex([0,1,2,2,1,3])
    const material = new THREE.ShaderMaterial({
      uniforms:{progress:{value:0},time:{value:0},tint:{value:new THREE.Color(color)}},
      transparent:true,depthWrite:false,side:THREE.DoubleSide,
      vertexShader:'varying vec2 uvp;void main(){uvp=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader:`varying vec2 uvp;uniform float progress;uniform float time;uniform vec3 tint;
        void main(){if(uvp.x>progress)discard;
        float across=abs(uvp.y-.5)*2.;
        float core=1.-smoothstep(.08,.3,across);
        float glow=pow(1.-across,2.)*.22;
        float flow=pow(1.-fract(uvp.x*2.-time*.55),14.);
        float head=exp(-pow((uvp.x-progress)*60.,2.));
        vec3 color=mix(tint,vec3(.83,.97,1.),max(flow,head)*.85);
        gl_FragColor=vec4(color,(core*.58+glow+flow*(1.-across)*.7+head*(1.-across)*.6)*smoothstep(0.,.02,progress));
      }`,
    })
    const mesh = new THREE.Mesh(geometry,material)
    mesh.renderOrder=22
    measurement.add(mesh)
    rangeMaterial=material
  }

  function updateMeasurement() {
    clearGroup(measurement)
    rangeMaterial=undefined
    rangeTip=undefined
    targetOutline=undefined
    const visible = scope === 'national' ? threats : visibleThreats()
    for (const threat of visible) {
      const selected = threat.storm.id === activeThreat().storm.id
      const color = threat.level.color
      const center = project(stormPosition(threat.storm,minute),TOP+.2)
      if(scope === 'mine') {
        const boundary=stormBoundary(threat.storm,minute)
        const first=Math.round(bearingTo(stormPosition(threat.storm,minute),mine.center)/2)%180
        const points=Array.from({length:181},(_,i)=>project(boundary[(first+i)%180]!,TOP+.13))
        const outline=line(points,selected?'#d1f3ff':color,selected?.8:.25) as THREE.Line
        outline.renderOrder=23
        measurement.add(outline)
        if(selected) {
          targetOutline=outline
          targetOutlineCount=points.length
        }
      }
      if(selected && scope === 'mine') {
        rangeStart.copy(project(mine.center,TOP+.17))
        rangeEnd.copy(project(threat.edge,TOP+.17))
        measurementRibbon(rangeStart,rangeEnd,color)
        rangeTip=new THREE.Sprite(new THREE.SpriteMaterial({map:glow,color:'#d8f8ff',transparent:true,depthWrite:false,blending:THREE.AdditiveBlending}))
        rangeTip.scale.setScalar(.14)
        rangeTip.renderOrder=24
        measurement.add(rangeTip)
        const endpoint=new THREE.Mesh(new THREE.RingGeometry(.035,.055,32),new THREE.MeshBasicMaterial({color:'#e2fbff',transparent:true,side:THREE.DoubleSide,depthWrite:false}))
        endpoint.rotation.x=-Math.PI/2
        endpoint.position.copy(rangeEnd)
        endpoint.userData.reveal='cloud'
        measurement.add(endpoint)
      }
      const text = label(threat.storm.id,center,color,true,selected?11:10)
      const azimuth=bearingTo(mine.center,stormPosition(threat.storm,minute))
      text.position.copy(project(destination(stormPosition(threat.storm,minute),azimuth,threat.storm.radius*.75),TOP+.3))
      labels[labels.length-1]!.anchor.copy(text.position)
      text.center.set(azimuth>180?1:0,azimuth>90&&azimuth<270?1:0)
      text.userData={kind:'storm',id:threat.storm.id}
      if(scope === 'mine') text.userData.reveal='cloud'
      hits.push(text)
      measurement.add(text)
    }
    measurement.visible=mode!=='heat'
  }

  function updateTracks() {
    clearGroup(tracks)
    // Trajectories belong to their own module. No arrows or moving rods over the echoes.
    if(mode!=='track') { tracks.visible=false; return }
    const storm=activeThreat().storm
    const history=Array.from({length:31},(_,i)=>project(stormPosition(storm,minute*i/30),TOP+.17))
    const future=Array.from({length:31},(_,i)=>project(stormPosition(storm,minute+i*2),TOP+.17))
    tracks.add(line(history,'#a8eaff',.65),line(future,'#c4d8dd',.6,true))
    for(const offset of [-30,0,30,60]) {
      const m=Math.max(0,minute+offset)
      const p=project(stormPosition(storm,m),TOP+.2)
      const node=new THREE.Mesh(new THREE.RingGeometry(.035,.05,24),new THREE.MeshBasicMaterial({color:'#c8eafa',side:THREE.DoubleSide}))
      node.rotation.x=-Math.PI/2; node.position.copy(p); tracks.add(node)
      const text=label(scenarioTime(m)+(offset===0?' 当前':offset>0?' 预测':''),p.clone().add(new THREE.Vector3(-.18,.23,0)),'#b5dbea',true,9)
      text.center.set(1,.5); tracks.add(text)
    }
    tracks.visible=scope==='mine'
  }

  let currentStrikes: Strike[] = []
  function updateStrikes() {
    clearGroup(strikes)
    strikePulses.length = 0
    currentStrikes = visibleStrikes(minute)
    // Recent observations pulse at their recorded positions; never invent new lightning events.
    const recent = currentStrikes.filter((strike) => minute - strike.minute <= 8).slice(-18)
    for (let i = 0; i < recent.length; i++) {
      const strike = recent[i]!
      const p = project(strike.position, TOP + 0.2)
      const pulse = new THREE.Mesh(
        new THREE.RingGeometry(0.91, 1, 32),
        new THREE.MeshBasicMaterial({
          color: '#d4faff',
          transparent: true,
          depthWrite: false,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
        }),
      )
      pulse.rotation.x = -Math.PI / 2
      pulse.position.copy(p)
      const flash = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: glow,
          color: '#e2ffff',
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      )
      flash.position.copy(p)
      strikes.add(pulse, flash)
      strikePulses.push({ ring: pulse, glow: flash, phase: i * 0.618 })
    }
    if (scope === 'national') {
      const geometry = new THREE.BufferGeometry().setFromPoints(
        currentStrikes.map((strike) => project(strike.position, TOP + 0.13)),
      )
      strikes.add(
        new THREE.Points(
          geometry,
          new THREE.PointsMaterial({
            color: '#faecc2',
            size: 2.6,
            sizeAttenuation: false,
            transparent: true,
            opacity: 0.8,
            depthWrite: false,
          }),
        ),
      )
      strikes.visible = layerState.lightning && mode !== 'heat'
      return
    }
    for (const strike of currentStrikes) {
      const p = project(strike.position, TOP + 0.2)
      const newest = minute - strike.minute <= 5
      const bolt = line(
        [
          new THREE.Vector3(0.022, 0.09, 0),
          new THREE.Vector3(-0.02, 0.005, 0),
          new THREE.Vector3(0.018, 0.005, 0),
          new THREE.Vector3(-0.028, -0.09, 0),
        ],
        newest ? '#fff0b2' : '#c4dace',
        newest ? 0.95 : 0.42,
      )
      bolt.position.copy(p)
      bolt.rotation.x = -0.7
      bolt.scale.setScalar(0.65)
      bolt.userData = { kind: 'strike', strike }
      strikes.add(bolt)
      if (scope === 'mine') {
        const hit = new THREE.Mesh(
          new THREE.SphereGeometry(0.075, 6, 4),
          new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
        )
        hit.position.copy(p)
        hit.userData = { kind: 'strike', strike }
        strikes.add(hit)
        hits.push(hit)
      }
    }
    strikes.visible = layerState.lightning && mode !== 'heat'
  }

  function updateHeat() {
    clearGroup(heat)
    const west = 73,
      east = 136,
      south = 16,
      north = 55,
      size = 768
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = 512
    const ctx = canvas.getContext('2d')!
    for (const strike of currentStrikes) {
      const x = ((strike.position[0] - west) / (east - west)) * size
      const y = ((north - strike.position[1]) / (north - south)) * 512
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, 8)
      gradient.addColorStop(0, 'rgba(255,255,255,.15)')
      gradient.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.fillStyle = gradient
      ctx.fillRect(x - 8, y - 8, 16, 16)
    }
    const pixels = ctx.getImageData(0, 0, size, 512)
    for (let i = 0; i < pixels.data.length; i += 4) {
      const strength = pixels.data[i + 3]! / 255
      if (strength < 0.015) {
        pixels.data[i + 3] = 0
        continue
      }
      const color =
        strength > 0.6
          ? [239, 115, 89]
          : strength > 0.38
            ? [224, 175, 93]
            : strength > 0.19
              ? [141, 183, 122]
              : [66, 152, 153]
      pixels.data[i] = color[0]!
      pixels.data[i + 1] = color[1]!
      pixels.data[i + 2] = color[2]!
      pixels.data[i + 3] = Math.min(225, Math.round(strength * 380))
    }
    ctx.putImageData(pixels, 0, 0)
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    textureSet.add(texture)
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry((east - west) * 0.82, north - south),
      new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    )
    mesh.rotation.x = -Math.PI / 2
    mesh.position.copy(project([(west + east) / 2, (north + south) / 2], TOP + 0.09))
    heat.add(mesh)
    heat.visible = mode === 'heat'
  }

  function updateClouds() {
    for (const storm of STORMS) {
      const mesh = cloudMeshes.get(storm.id)!,
        center = stormPosition(storm, minute)
      mesh.position.copy(project(center, TOP + 0.08))
      mesh.scale.set(
        ((storm.radius * 2) / (111.32 * Math.cos((center[1] * Math.PI) / 180))) * 0.82,
        (storm.radius * 2) / 111.32,
        1,
      )
      ;(mesh.material as THREE.ShaderMaterial).uniforms.selected!.value =
        storm.id === activeThreat().storm.id ? 1 : 0
    }
    clouds.visible = layerState.radar && mode !== 'heat'
  }
  function updateWeather() {
    threats = stormThreats(mine, minute)
    updateClouds()
    updateRadar()
    updateTracks()
    updateStrikes()
    if (mode === 'heat') updateHeat()
  }

  function moveCamera() {
    // Keep the mine at the radar centre, framing simultaneous threats on all sides.
    const region = project(mine.center)
    const local = visibleThreats()
    const extent = Math.max(260, ...local.map((item) => item.distance + item.storm.radius * 1.6))
    const regionalFit = Math.max(0.95, Math.min(1.15, extent / 510))
    targetGoal = scope === 'national' ? new THREE.Vector3(0.7, 0, 1.4) : region
    const offset =
      scope === 'national'
        ? view === '2D'
          ? new THREE.Vector3(0, 64, 0.1)
          : new THREE.Vector3(0.4, 35, 36)
        : view === '2D'
          ? new THREE.Vector3(0, 11.8 * regionalFit, 0.05)
          : new THREE.Vector3(0.1, 8.5 * regionalFit, 8 * regionalFit)
    cameraGoal = targetGoal.clone().add(offset.multiplyScalar(fit))
  }
  const resize = () => {
    const width = Math.max(1, host.clientWidth),
      height = Math.max(1, host.clientHeight)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
    renderer.setSize(width, height, false)
    tracks.traverse((object) => {
      const material = (object as Line2).material
      if (material instanceof LineMaterial) material.resolution.set(width, height)
    })
    measurement.traverse((object) => {
      const material = (object as Line2).material
      if (material instanceof LineMaterial) material.resolution.set(width, height)
    })
    const nextFit = Math.max(1, Math.min(2.8, 1.25 / camera.aspect))
    if (Math.abs(nextFit - fit) > 0.001) {
      camera.position
        .sub(controls.target)
        .multiplyScalar(nextFit / fit)
        .add(controls.target)
      if (cameraGoal && targetGoal)
        cameraGoal
          .sub(targetGoal)
          .multiplyScalar(nextFit / fit)
          .add(targetGoal)
    }
    fit = nextFit
  }
  resize()
  moveCamera()
  camera.position.copy(cameraGoal!)
  controls.target.copy(targetGoal!)
  cameraGoal = targetGoal = undefined
  const observer = new ResizeObserver(resize)
  observer.observe(host)
  const media = matchMedia('(prefers-reduced-motion: reduce)')
  let reducedMotion = media.matches
  const motionChange = () => {
    reducedMotion = media.matches
  }
  media.addEventListener('change', motionChange)
  const raycaster = new THREE.Raycaster(),
    cursor = new THREE.Vector2(),
    down = new THREE.Vector2()
  let pointerDown = false
  function pick(event: PointerEvent) {
    const rect = renderer.domElement.getBoundingClientRect()
    cursor.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      (-(event.clientY - rect.top) / rect.height) * 2 + 1,
    )
    raycaster.setFromCamera(cursor, camera)
    return raycaster.intersectObjects(
      hits.filter((object) => object.parent?.visible),
      false,
    )[0]?.object.userData
  }
  const pointerStart = (event: PointerEvent) => {
    pointerDown = true
    down.set(event.clientX, event.clientY)
    cameraGoal = targetGoal = undefined
  }
  const pointerEnd = (event: PointerEvent) => {
    if (event.button === 0 && pointerDown && down.distanceTo(new THREE.Vector2(event.clientX, event.clientY)) < 5) {
      const item = pick(event)
      if (item?.kind === 'mine') options.onMine(item.id)
      if (item?.kind === 'strike') options.onStrike(item.strike)
      if (item?.kind === 'storm') options.onStorm(item.id)
    }
    pointerDown = false
  }
  const pointerMove = (event: PointerEvent) => {
    if (pointerDown && down.distanceTo(new THREE.Vector2(event.clientX,event.clientY)) > 5) flight = undefined
    if (!pointerDown) renderer.domElement.style.cursor = pick(event) ? 'pointer' : 'grab'
  }
  const pointerCancel = () => {
    pointerDown = false
  }
  const wheel = () => {
    flight = undefined
    cameraGoal = targetGoal = undefined
  }
  const contextLost = (event: Event) => {
    event.preventDefault()
    cancelAnimationFrame(frame)
    options.onError('三维渲染已暂停，请刷新恢复。')
  }
  renderer.domElement.addEventListener('pointerdown', pointerStart)
  renderer.domElement.addEventListener('pointerup', pointerEnd)
  renderer.domElement.addEventListener('pointermove', pointerMove)
  renderer.domElement.addEventListener('pointercancel', pointerCancel)
  renderer.domElement.addEventListener('wheel', wheel, { passive: true })
  renderer.domElement.addEventListener('webglcontextlost', contextLost)

  let last = performance.now()
  const animate = (now: number) => {
    if (disposed) return
    frame = requestAnimationFrame(animate)
    const frameSeconds = Math.max(0, (now - last) / 1000)
    const delta = Math.min(0.06, frameSeconds)
    last = now
    if (document.hidden) return
    if (!reducedMotion) elapsed += frameSeconds
    const progress = focusProgress(focusStage === 'overview' ? 100 : elapsed - focusStarted,focusKind,reducedMotion)
    if (focusStage !== 'overview') setFocusStage(progress.stage)
    if (flight) {
      const p = progress.flight
      camera.position.lerpVectors(flight.from,flight.to,p)
      camera.position.y += Math.sin(p*Math.PI)*Math.min(4,flight.from.distanceTo(flight.to)*.1+.6)
      controls.target.lerpVectors(flight.fromTarget,flight.toTarget,p)
      if(p >= 1) flight=undefined
    }
    if (cameraGoal && targetGoal) {
      const factor = reducedMotion ? 1 : 1 - Math.exp(-delta * 4)
      camera.position.lerp(cameraGoal, factor)
      controls.target.lerp(targetGoal, factor)
      if (camera.position.distanceTo(cameraGoal) < 0.005) cameraGoal = targetGoal = undefined
    }
    controls.update()
    mapUniforms.focus.value = THREE.MathUtils.lerp(mapUniforms.focus.value,scope==='mine'?1:0,reducedMotion?1:1-Math.exp(-frameSeconds*2.5))
    const radarVisible=scope==='mine'&&mode!=='heat'
    radar.visible=radarVisible
    scanner.visible=radarVisible
    minePulse.visible=radarVisible
    scanMaterial.uniforms.angle!.value = (elapsed-focusStarted-FOCUS_FLIGHT_SECONDS)*((Math.PI*2)/3)
    scanMaterial.uniforms.reveal!.value=progress.radar
    for(const stroke of radarStrokes) stroke.object.geometry.setDrawRange(0,Math.floor(stroke.count*THREE.MathUtils.clamp(progress.radar*1.3-stroke.order*.1,0,1)))
    for(const group of [radar,measurement]) group.traverse((object)=>{
      const reveal=object.userData.reveal
      if(!reveal) return
      const material=(object as THREE.Mesh).material as THREE.Material
      if(object.userData.baseOpacity === undefined) object.userData.baseOpacity=material.opacity
      material.opacity=object.userData.baseOpacity*(reveal==='radar'?progress.radar:progress.cloud)
      object.visible=material.opacity>.01
    })
    if(rangeMaterial) {
      rangeMaterial.uniforms.progress!.value=progress.range
      rangeMaterial.uniforms.time!.value=reducedMotion?0:Math.max(0,elapsed-focusStarted-3.65)
    }
    if(rangeTip) {
      rangeTip.position.lerpVectors(rangeStart,rangeEnd,progress.range)
      rangeTip.material.opacity=progress.range>0 ? .55+Math.sin(elapsed*2)*.12 : 0
    }
    if(targetOutline) {
      targetOutline.geometry.setDrawRange(0,Math.floor(targetOutlineCount*progress.cloud))
      ;(targetOutline.material as THREE.LineBasicMaterial).opacity=.65+Math.sin(elapsed*1.8)*.12
    }
    for(const uniforms of cloudUniforms) uniforms.focus.value=scope==='mine'?progress.cloud:0
    const radarPhase = (elapsed / 2.6) % 1
    minePulse.scale.setScalar(0.1 + radarPhase * (scope === 'national' ? 0.48 : 0.24))
    ;(minePulse.material as THREE.MeshBasicMaterial).opacity = (1-radarPhase)*.55*progress.radar
    for (const pulse of strikePulses) {
      const phase = (elapsed / 2.4 + pulse.phase) % 1
      const scale = scope === 'national' ? 0.25 : 0.17
      pulse.ring.scale.setScalar(0.025 + phase * scale)
      ;(pulse.ring.material as THREE.MeshBasicMaterial).opacity = Math.pow(1 - phase, 3) * 0.35
      pulse.glow.scale.setScalar(scale * (1 + phase))
      pulse.glow.material.opacity = Math.pow(1 - phase, 5) * 0.45
    }
    const targetNdc=rangeEnd.clone().project(camera)
    const screenWidth=host.clientWidth, screenHeight=host.clientHeight
    const canShow=radarVisible&&progress.result>.05&&!!rangeMaterial&&targetNdc.z<1&&Math.abs(targetNdc.x)<.95&&Math.abs(targetNdc.y)<.9
    const minX=screenWidth>1000?286:screenWidth>700?220:18
    const maxX=Math.max(minX,screenWidth-(screenWidth>1000?490:screenWidth>700?420:220))
    const targetScreen={
      x:THREE.MathUtils.clamp((targetNdc.x+1)*screenWidth/2+28,minX,maxX),
      y:THREE.MathUtils.clamp((1-targetNdc.y)*screenHeight/2-90,185,Math.max(185,screenHeight-305)),
      visible:canShow,
    }
    if(targetScreen.visible!==lastTargetScreen.visible||Math.abs(targetScreen.x-lastTargetScreen.x)>.5||Math.abs(targetScreen.y-lastTargetScreen.y)>.5){
      lastTargetScreen=targetScreen
      options.onTargetScreen(targetScreen)
    }
    const occupied: { x: number; y: number; width: number; height: number }[] = []
    const rightVector = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion)
    const upVector = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion)
    for (const item of labels) {
      item.sprite.position.copy(item.anchor)
      const perPixel =
        (2 *
          Math.tan((camera.fov * Math.PI) / 360) *
          camera.position.distanceTo(item.sprite.position)) /
        Math.max(1, host.clientHeight)
      item.sprite.scale.set(item.width * perPixel, item.height * perPixel, 1)
      if (item.nationalOnly) item.sprite.visible = scope === 'national'
      if (item.sprite.userData.kind === 'mine' || item.sprite.userData.kind === 'storm') {
        const screen = item.anchor.clone().project(camera)
        const x = ((screen.x + 1) * host.clientWidth) / 2 - item.width * item.sprite.center.x
        const y =
          ((1 - screen.y) * host.clientHeight) / 2 - item.height * (1 - item.sprite.center.y)
        let dx = 0,
          dy = 0
        for (let attempt = 0; attempt < 12; attempt++) {
          const rect = { x: x + dx, y: y + dy, width: item.width + 6, height: item.height + 5 }
          if (
            !occupied.some(
              (other) =>
                rect.x < other.x + other.width &&
                rect.x + rect.width > other.x &&
                rect.y < other.y + other.height &&
                rect.y + rect.height > other.y,
            )
          ) {
            occupied.push(rect)
            break
          }
          dy = (Math.floor(attempt / 2) + 1) * (item.height + 5) * (attempt % 2 === 0 ? 1 : -1)
          dx = attempt > 7 ? item.width * 0.4 : 0
        }
        item.sprite.position
          .addScaledVector(rightVector, dx * perPixel)
          .addScaledVector(upVector, -dy * perPixel)
      }
    }
    renderer.render(scene, camera)
  }
  updateWeather()
  frame = requestAnimationFrame(animate)
  return {
    setMode(next) {
      mode = next
      heat.visible = mode === 'heat'
      updateWeather()
      if(mode==='heat') { flight=undefined; setFocusStage('overview'); options.onTargetScreen({x:0,y:0,visible:false}) }
      else if(scope==='mine') beginFocus()
    },
    setTime(next) {
      minute = Math.max(0, Math.min(90, next))
      updateWeather()
    },
    selectMine(id) {
      mine = MINES.find((item) => item.id === id) || mine
      threats = stormThreats(mine, minute)
      selectedStormId = threats[0]!.storm.id
      updateClouds()
      updateRadar()
      updateTracks()
      if (scope === 'mine') moveCamera()
    },
    focusMine(id) {
      mine=MINES.find((item)=>item.id===id)||mine
      scope='mine'
      threats=stormThreats(mine,minute)
      selectedStormId=threats[0]!.storm.id
      updateWeather()
      beginFocus()
    },
    selectStorm(id) {
      if(id===selectedStormId) return
      selectedStormId = id
      updateClouds()
      updateMeasurement()
      updateTracks()
      if(scope==='mine'&&mode!=='heat') beginFocus('retarget')
    },
    setScope(next) {
      scope = next
      updateRadar()
      updateTracks()
      updateStrikes()
      if(scope==='mine'&&mode!=='heat') beginFocus()
      else { flight=undefined; setFocusStage('overview'); moveCamera() }
    },
    setView(next) {
      view = next
      flight=undefined
      moveCamera()
    },
    setLayer(key, visible) {
      layerState[key] = visible
      updateClouds()
      strikes.visible = layerState.lightning && mode !== 'heat'
    },
    reset() {
      view = '3D'
      if(scope==='mine'&&mode!=='heat') beginFocus()
      else moveCamera()
    },
    zoom(delta) {
      flight=undefined
      const offset = camera.position.clone().sub(controls.target)
      cameraGoal = controls.target
        .clone()
        .add(
          offset.setLength(
            THREE.MathUtils.clamp(offset.length() * Math.exp(-delta * 0.18), 5, 140),
          ),
        )
      targetGoal = controls.target.clone()
    },
    dispose() {
      if (disposed) return
      disposed = true
      cancelAnimationFrame(frame)
      observer.disconnect()
      controls.dispose()
      media.removeEventListener('change', motionChange)
      renderer.domElement.removeEventListener('pointerdown', pointerStart)
      renderer.domElement.removeEventListener('pointerup', pointerEnd)
      renderer.domElement.removeEventListener('pointermove', pointerMove)
      renderer.domElement.removeEventListener('pointercancel', pointerCancel)
      renderer.domElement.removeEventListener('wheel', wheel)
      renderer.domElement.removeEventListener('webglcontextlost', contextLost)
      const geometries = new Set<THREE.BufferGeometry>(),
        materials = new Set<THREE.Material>()
      scene.traverse((object) => {
        const r = object as THREE.Mesh
        if (r.geometry) geometries.add(r.geometry)
        if (r.material)
          (Array.isArray(r.material) ? r.material : [r.material]).forEach((m) => materials.add(m))
      })
      geometries.forEach((g) => g.dispose())
      materials.forEach((m) => m.dispose())
      textureSet.forEach((t) => t.dispose())
      renderer.dispose()
      renderer.forceContextLoss()
      renderer.domElement.remove()
      scene.clear()
    },
  }
}
