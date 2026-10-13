import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { bearingTo, destination, MINES, type LngLat, type WeatherMode } from './weather'
import {
  resolveAnalysis,
  mineVisible,
  FORECAST_MINUTES,
  ANALYSIS_SECONDS,
  HISTORY_SLICES,
  analysisFrame,
  stormForecast,
  type CommandAnalysis,
  type MineFilter,
} from './commandAnalysis'
import {
  DEMO_EVENTS,
  DEMO_MINE,
  DEMO_NOW,
  DEMO_STORMS,
  demoPhase,
  demoPosition,
  demoClock,
  type CommandLayer,
  type CommandScope,
} from './commandDemo'

export interface ScreenAnchor {
  id: string
  x: number
  y: number
  visible: boolean
  bounds?: { x: number; y: number; width: number; height: number }
}
export interface CommandScene {
  setMode(mode: WeatherMode): void
  setLayer(layer: CommandLayer, visible: boolean): void
  setTime(minute: number): void
  setScope(scope: CommandScope): void
  setAnalysis(analysis: CommandAnalysis, focus?: boolean, restart?: boolean): void
  setMineFilter(filter: MineFilter): void
  setView(flat: boolean): void
  zoom(direction: number): void
  reset(): void
  replay(): void
  dispose(): void
}
type GeoFeature = {
  geometry:
    | { type: 'MultiPolygon'; coordinates: LngLat[][][] }
    | { type: 'Polygon'; coordinates: LngLat[][] }
    | { type: 'MultiLineString'; coordinates: LngLat[][] }
}
const project = (p: LngLat, y = 0.12) => new THREE.Vector3((p[0] - 104.4) * 0.82, y, -(p[1] - 35.2))
const smooth = (a: number, b: number, v: number) => THREE.MathUtils.smoothstep(v, a, b)
const fract = (v: number) => v - Math.floor(v)
const rand = (i: number) => fract(Math.sin(i * 127.1 + 31.7) * 43758.5453)
const vertex =
  'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}'
const noiseGLSL = `
  float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
  float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+1.),f.x),f.y);}
  float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<4;i++){v+=a*noise(p);p=mat2(1.6,1.2,-1.2,1.6)*p;a*=.5;}return v;}
`

export async function createCommandScene(
  host: HTMLElement,
  options: {
    signal: AbortSignal
    onPhase: (phase: number) => void
    onAnchors: (anchors: ScreenAnchor[]) => void
    onAnalysisProgress: (progress: number) => void
    onError: (message: string) => void
    onPick: (kind: 'storm' | 'mine', id: string) => void
  },
): Promise<CommandScene> {
  const response = await fetch(`${import.meta.env.BASE_URL}china.geojson`, {
    signal: options.signal,
  })
  if (!response.ok) throw new Error('地图数据加载失败')
  const geo = (await response.json()) as { features: GeoFeature[] }
  options.signal.throwIfAborted()
  const renderer = new THREE.WebGLRenderer({
    alpha: true,
    antialias: true,
    powerPreference: 'high-performance',
  })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.6))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.setClearColor(0x050b12, 0)
  renderer.domElement.setAttribute(
    'aria-label',
    '雷电数字战场。拖动平移、滚轮缩放、右键旋转；雷暴与资产详情可通过地图标签查看。',
  )
  host.append(renderer.domElement)
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 220)
  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.screenSpacePanning = false
  controls.minDistance = 8
  controls.maxDistance = 100
  controls.minPolarAngle = 0.05
  controls.maxPolarAngle = 1.1
  controls.mouseButtons = {
    LEFT: THREE.MOUSE.PAN,
    MIDDLE: THREE.MOUSE.DOLLY,
    RIGHT: THREE.MOUSE.ROTATE,
  }
  controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE }
  let disposed = false,
    frame = 0,
    last = 0,
    elapsed = 0,
    started = 0,
    lastLabels = 0
  let phase = -1,
    mode: WeatherMode = 'live',
    scope: CommandScope = 'theater',
    flat = false
  let minute = DEMO_NOW,
    targetMinute = DEMO_NOW,
    selected = 'T06'
  let analysis = resolveAnalysis({ kind: 'overview' }, minute)
  let mineFilter: MineFilter = 'priority',
    relockAt = -10
  const hitTargets: THREE.Mesh[] = []
  const stormShown = (id: string) =>
    analysis.kind !== 'mine' || analysis.threats.some((r) => r.storm.id === id)
  let goal: THREE.Vector3 | undefined, target: THREE.Vector3 | undefined
  const media = matchMedia('(prefers-reduced-motion: reduce)')
  let reduced = media.matches
  const layerState: Record<CommandLayer, boolean> = {
    energy: true,
    strikes: true,
    tracks: true,
    corridor: true,
    assets: true,
    rings: true,
  }
  const blend = { energy: 0, strikes: 0, tracks: 0, corridor: 0, assets: 0, rings: 0 }
  const modeBlend = { heat: 0, track: 0, warning: 0 }
  const environment = new THREE.Group()
  const layers = Object.fromEntries(
    Object.keys(layerState).map((key) => [key, new THREE.Group()]),
  ) as Record<CommandLayer, THREE.Group>
  scene.add(environment, ...Object.values(layers))
  const animatedMaterials: THREE.ShaderMaterial[] = []
  const textures = new Set<THREE.Texture>()
  const materials = new Set<THREE.Material>()
  const geometries = new Set<THREE.BufferGeometry>()
  function remember<T extends THREE.Object3D>(object: T): T {
    const drawable = object as unknown as {
      geometry?: THREE.BufferGeometry
      material?: THREE.Material | THREE.Material[]
    }
    if (drawable.geometry) geometries.add(drawable.geometry)
    if (drawable.material)
      for (const mat of Array.isArray(drawable.material)
        ? drawable.material
        : [drawable.material]) {
        materials.add(mat)
        mat.userData.baseOpacity = mat.opacity
      }
    return object
  }
  function line(points: THREE.Vector3[], color: string, opacity: number, dashed = false) {
    const material = dashed
      ? new THREE.LineDashedMaterial({
          color,
          opacity,
          transparent: true,
          dashSize: 0.1,
          gapSize: 0.09,
          depthWrite: false,
        })
      : new THREE.LineBasicMaterial({ color, opacity, transparent: true, depthWrite: false })
    const object = remember(
      new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), material),
    )
    if (dashed) object.computeLineDistances()
    return object
  }
  function circle(center: LngLat, km: number, color: string, opacity: number, dashed = false) {
    return line(
      Array.from({ length: 161 }, (_, i) =>
        project(destination(center, (i * 360) / 160, km), 0.14),
      ),
      color,
      opacity,
      dashed,
    )
  }
  function textSprite(text: string, color: string, size = 11) {
    const canvas = document.createElement('canvas')
    canvas.width = 256
    canvas.height = 64
    const ctx = canvas.getContext('2d')!
    ctx.font = `500 ${size * 3}px "Segoe UI", "Microsoft YaHei", sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = '#ffffff'
    ctx.fillText(text, 128, 32)
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    textures.add(texture)
    const sprite = remember(
      new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: texture,
          color,
          transparent: true,
          depthWrite: false,
          depthTest: false,
        }),
      ),
    )
    sprite.scale.set(1.7, 0.425, 1)
    return sprite
  }
  function shader(fragmentShader: string, uniforms: Record<string, THREE.IUniform>) {
    const material = new THREE.ShaderMaterial({
      vertexShader: vertex,
      // Custom shaders need the same linear-to-display conversion as Three's built-in materials.
      fragmentShader: fragmentShader.replace(/\}\s*$/, '\n#include <colorspace_fragment>\n}'),
      uniforms: { time: { value: 0 }, alpha: { value: 1 }, ...uniforms },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    })
    animatedMaterials.push(material)
    return material
  }
  function setAlpha(group: THREE.Group, opacity: number) {
    group.visible = opacity > 0.002
    group.traverse((object) => {
      const mat = (object as THREE.Mesh).material
      if (!mat) return
      for (const m of Array.isArray(mat) ? mat : [mat]) {
        if (m instanceof THREE.ShaderMaterial && m.uniforms.alpha) m.uniforms.alpha.value = opacity
        else m.opacity = (m.userData.baseOpacity ?? 1) * opacity
      }
    })
  }

  // Local geodata, including polygon holes, coastlines, islands and administrative boundaries.
  const landMaterial = new THREE.ShaderMaterial({
    vertexShader:
      'varying vec2 mapUv;void main(){mapUv=position.xy;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader: `varying vec2 mapUv;uniform float alpha;uniform float time;${noiseGLSL}
      void main(){vec2 p=mapUv;float n=fbm(p*.64);vec3 c=mix(vec3(.006,.014,.021),vec3(.019,.039,.055),n);
      // Abstract shaded relief, not elevation measurements. A broad light keeps the land readable.
      vec2 q=p*.64;vec2 slope=vec2(noise(q+vec2(.12,0.))-noise(q-vec2(.12,0.)),noise(q+vec2(0.,.12))-noise(q-vec2(0.,.12)));
      float light=dot(normalize(vec3(-slope*3.5,1.)),normalize(vec3(-.55,.65,1.)));
      float center=exp(-dot(p-vec2(1.,1.),p-vec2(1.,1.))*.007);
      c*=1.42*(.78+light*.28+center*.10);
      float contour=1.-smoothstep(.0,.025,abs(fract(n*12.)-.5));c+=vec3(.018,.04,.05)*contour*.19;
      float haze=fbm(p*.17+vec2(time*.002,0.));c+=vec3(.001,.0035,.005)*haze*center;
      vec2 g=abs(fract(p*2.-.5)-.5)/max(fwidth(p*2.),vec2(.001));float grid=1.-min(min(g.x,g.y),1.);
      c+=vec3(.018,.05,.06)*grid*.18;gl_FragColor=vec4(c,alpha);
      #include <colorspace_fragment>
      }`,
    uniforms: { alpha: { value: 1 }, time: { value: 0 } },
    side: THREE.DoubleSide,
    transparent: true,
  })
  animatedMaterials.push(landMaterial)
  const landShadow = new THREE.MeshBasicMaterial({
    color: '#030b12',
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
  })
  const edges: number[] = [],
    outline: number[] = []
  const addEdge = (ring: LngLat[], output: number[]) => {
    for (let i = 1; i < ring.length; i++)
      output.push(...project(ring[i - 1]!, 0.015).toArray(), ...project(ring[i]!, 0.015).toArray())
  }
  for (const feature of geo.features) {
    const geometry = feature.geometry
    if (geometry.type === 'MultiLineString') {
      geometry.coordinates.forEach((r) => addEdge(r, outline))
      continue
    }
    const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
    const shapes = polygons
      .filter((p) => p[0]?.length)
      .map((polygon) => {
        const points = (r: LngLat[]) =>
          r.map((p) => new THREE.Vector2((p[0] - 104.4) * 0.82, p[1] - 35.2))
        const shape = new THREE.Shape(points(polygon[0]!))
        polygon.slice(1).forEach((hole) => shape.holes.push(new THREE.Path(points(hole))))
        polygon.forEach((r) => addEdge(r, edges))
        return shape
      })
    const mesh = remember(new THREE.Mesh(new THREE.ShapeGeometry(shapes), landMaterial))
    mesh.rotation.x = -Math.PI / 2
    // Transparent land must render before additive weather; otherwise province fills erase it.
    mesh.renderOrder = -10
    environment.add(mesh)
    const shadow = remember(new THREE.Mesh(mesh.geometry, landShadow))
    shadow.rotation.x = -Math.PI / 2
    shadow.position.set(0.04, -0.2, 0.06)
    shadow.renderOrder = -12
    environment.add(shadow)
  }
  for (const [vertices, color, opacity] of [
    [edges, '#81a2ac', 0.27],
    [outline, '#65b5c9', 0.88],
  ] as const) {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
    environment.add(
      remember(
        new THREE.LineSegments(
          geometry,
          new THREE.LineBasicMaterial({ color, transparent: true, opacity }),
        ),
      ),
    )
  }
  const grid = new THREE.GridHelper(160, 80, '#284755', '#284755')
  grid.position.y = -0.03
  const gridMaterial = grid.material as THREE.Material
  gridMaterial.transparent = true
  gridMaterial.opacity = 0.1
  grid.renderOrder = -11
  environment.add(remember(grid))
  for (const [name, lon, lat] of [
    ['内 蒙 古', 114, 43],
    ['陕 西', 108.6, 34.4],
    ['山 西', 112.7, 37.2],
    ['四 川', 102, 30.8],
  ] as [string, number, number][]) {
    const label = textSprite(name, '#668591', 10)
    label.position.copy(project([lon, lat], 0.04))
    environment.add(label)
  }
  const scan = remember(
    new THREE.Mesh(
      new THREE.PlaneGeometry(80, 60),
      shader(
        `varying vec2 vUv;uniform float time;uniform float alpha;uniform float scanAt;uniform float strength;
    void main(){float beam=exp(-pow((vUv.y-scanAt)*100.,2.));gl_FragColor=vec4(.05,.53,.7,beam*strength*alpha);}`,
        { scanAt: { value: -1 }, strength: { value: 0.1 } },
      ),
    ),
  )
  scan.rotation.x = -Math.PI / 2
  scan.position.y = 0.025
  environment.add(scan)

  // A sparse, bounded field of slow data particles, kept below every operational layer.
  const ambientGeometry = new THREE.BufferGeometry()
  ambientGeometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      Array.from({ length: 48 }, (_, i) => [
        (rand(i * 5) - 0.5) * 38,
        0.08 + rand(i + 8) * 0.08,
        (rand(i * 7 + 2) - 0.5) * 24,
      ]).flat(),
      3,
    ),
  )
  const ambientMaterial = shader(
    `varying float fade;uniform float alpha;void main(){float p=1.-smoothstep(.0,.5,length(gl_PointCoord-.5));gl_FragColor=vec4(.19,.47,.58,p*fade*alpha*.16);}`,
    {},
  )
  ambientMaterial.vertexShader = `uniform float time;varying float fade;void main(){vec3 p=position;p.x+=sin(time*.025+position.z)*.17;fade=.3+.7*pow(.5+.5*sin(position.x+time*.13),2.);vec4 mv=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*mv;gl_PointSize=clamp(38./-mv.z,1.,1.8);}`
  environment.add(remember(new THREE.Points(ambientGeometry, ambientMaterial)))

  function trackFlow(historical: boolean, speed: number) {
    const count = historical ? 3 : 7
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(
        Array.from({ length: count }, (_, i) => [i / count, 0, 0]).flat(),
        3,
      ),
    )
    const material = shader(
      'uniform float alpha;varying float strength;void main(){float r=length(gl_PointCoord-.5);gl_FragColor=vec4(.64,.88,.95,exp(-r*r*24.)*strength*alpha);}',
      {
        path: { value: Array.from({ length: 41 }, () => new THREE.Vector3()) },
        reveal: { value: 0 },
        historical: { value: historical ? 1 : 0 },
        rate: { value: historical ? 0.055 + speed / 1200 : 0.045 + speed / 1800 },
      },
    )
    material.vertexShader = `uniform vec3 path[41];uniform float time;uniform float rate;uniform float reveal;uniform float historical;varying float strength;
      void main(){float t=fract(position.x+time*rate);float at=t*40.;int i=min(39,int(floor(at)));
      vec3 p=mix(path[i],path[i+1],fract(at));p.y=.36;
      strength=step(t,reveal)*smoothstep(.0,.08,t)*(1.-smoothstep(.94,1.,t))*mix(1.-t*.85,.1+.9*t,historical);
      vec4 mv=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*mv;gl_PointSize=clamp(75./-mv.z,1.8,3.);}`
    const points = remember(new THREE.Points(geometry, material))
    points.frustumCulled = false
    points.renderOrder = 6
    layers.tracks.add(points)
    return { points, material }
  }
  function fadeLineAlpha(material: THREE.LineBasicMaterial) {
    // Vertex color encodes age; fade alpha as well so old segments don't darken the map.
    material.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <color_fragment>',
        '#include <color_fragment>\n#ifdef USE_COLOR\ndiffuseColor.a *= vColor.r;\n#endif',
      )
    }
  }
  const stormVisuals = DEMO_STORMS.map((storm, index) => {
    const group = new THREE.Group()
    layers.energy.add(group)
    const trailMinutes = 60
    const extent = (storm.radius / 111) * 2
    const energy = remember(
      new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        shader(
          `
      varying vec2 vUv;uniform float time;uniform float alpha;uniform float seed;uniform float danger;uniform float heat;uniform float locked;
      ${noiseGLSL}
      void main(){vec2 p=(vUv-.5)*2.;float t=time*.035;
        float n=fbm(p*4.3+vec2(seed+t,-t));float edge=length(p)+.12*(n-.5);
        float envelope=1.-smoothstep(.68,.96,edge);
        float mass=fbm(p*6.+vec2(seed,t));float lobes=exp(-dot(p+vec2(.08,-.03),p+vec2(.08,-.03))*6.5);
        float energy=mass*.47+lobes*.63;float core=smoothstep(.50,.86,energy)*envelope;
        vec3 cold=mix(vec3(.03,.20,.29),vec3(.07,.46,.53),mass);
        vec3 warm=mix(vec3(1.,.31,.045),vec3(1.,.84,.32),smoothstep(.70,.92,energy));
        warm=mix(warm,vec3(1.,.16,.045),danger*.27*(1.-smoothstep(.7,.92,energy)));
        vec3 color=mix(cold,warm,core);float filaments=pow(fbm(p*22.+seed+time*.06),4.)*4.;
        color+=vec3(.27,.52,.62)*filaments*envelope*.30;
        float rim=exp(-pow((edge-.89)*42.,2.))*(.018+locked*.12);
        float opacity=(envelope*(.13+mass*.44)+core*.78+rim)*(1.+heat*.24);
        gl_FragColor=vec4(color+vec3(.08,.2,.23)*rim,min(.88,opacity)*alpha*(.97+.03*sin(time*.75+seed)));}`,
          {
            seed: { value: storm.phase },
            danger: { value: storm.primary ? 1 : 0 },
            heat: { value: 0 },
            locked: { value: 0 },
          },
        ),
      ),
    )
    energy.rotation.x = -Math.PI / 2
    energy.position.y = 0.24
    energy.userData = { kind: 'storm', id: storm.id }
    hitTargets.push(energy)
    group.add(energy)
    const stormLock = new THREE.Group()
    {
      const radius = 0.5
      for (const x of [-1, 1])
        for (const z of [-1, 1]) {
          stormLock.add(
            line(
              [
                new THREE.Vector3(x * radius, 0.34, z * radius * 0.68),
                new THREE.Vector3(x * radius, 0.34, z * radius),
                new THREE.Vector3(x * radius * 0.68, 0.34, z * radius),
              ],
              '#ffcc8a',
              0.8,
            ),
          )
        }
      group.add(stormLock)
    }
    const scanArc = line(
      Array.from({ length: 25 }, (_, i) => {
        const a = (i / 24) * Math.PI * 0.42
        return new THREE.Vector3(Math.cos(a) * 0.43, 0.35, Math.sin(a) * 0.43)
      }),
      '#94e6ef',
      0.16,
    )
    stormLock.add(scanArc)

    const pCount = storm.primary ? 110 : 55
    const particleGeometry = new THREE.BufferGeometry()
    const positions: number[] = [],
      seeds: number[] = []
    for (let i = 0; i < pCount; i++) {
      const angle = rand(i + index * 90) * Math.PI * 2,
        radius = Math.sqrt(rand(i * 3 + 8)) * extent * 0.28
      positions.push(
        Math.cos(angle) * radius,
        0.26 + rand(i) * 0.15,
        Math.sin(angle) * radius * 0.78,
      )
      seeds.push(rand(i * 7))
    }
    particleGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    particleGeometry.setAttribute('seed', new THREE.Float32BufferAttribute(seeds, 1))
    const particlesMaterial = shader(
      `varying float brightness;uniform float alpha;void main(){float a=1.-smoothstep(.0,.5,length(gl_PointCoord-.5));gl_FragColor=vec4(1.,.72,.30,a*brightness*alpha*.65);}`,
      { flowDirection: { value: new THREE.Vector3() }, extent: { value: extent } },
    )
    particlesMaterial.vertexShader = `attribute float seed;uniform float time;uniform vec3 flowDirection;uniform float extent;varying float brightness;
      void main(){float t=fract(seed+time*.08);vec3 side=vec3(-flowDirection.z,0.,flowDirection.x);
      vec3 p=flowDirection*(t-.5)*extent*.53+side*position.x*.65;p.y=position.y;
      p+=side*sin(time*.5+seed*18.)*.025;brightness=smoothstep(0.,.18,t)*(1.-smoothstep(.8,1.,t))*(.45+.55*seed);
      vec4 mv=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*mv;gl_PointSize=clamp(65./-mv.z,1.2,3.2);}`
    group.add(remember(new THREE.Points(particleGeometry, particlesMaterial)))
    const history = line(
      Array.from({ length: 81 }, (_, i) =>
        project(demoPosition(storm, DEMO_NOW - trailMinutes + (i * trailMinutes) / 80), 0.28),
      ),
      '#78cddc',
      0.7,
    )
    const historyColors = Array.from({ length: 81 }, (_, i) => {
      const strength = 0.055 + 0.945 * Math.pow(i / 80, 1.8)
      return [strength, strength, strength]
    }).flat()
    history.geometry.setAttribute('color', new THREE.Float32BufferAttribute(historyColors, 3))
    ;(history.material as THREE.LineBasicMaterial).vertexColors = true
    fadeLineAlpha(history.material)
    const forecast = line(
      Array.from({ length: 41 }, (_, i) => project(demoPosition(storm, DEMO_NOW + i * 3), 0.18)),
      '#78c6d5',
      0.56,
      true,
    )
    forecast.geometry.setAttribute(
      'color',
      new THREE.Float32BufferAttribute(
        Array.from({ length: 41 }, (_, i) => Array(3).fill(1 - (0.8 * i) / 40)).flat(),
        3,
      ),
    )
    forecast.material.vertexColors = true
    fadeLineAlpha(forecast.material)
    layers.tracks.add(history, forecast)
    const historyDots = new THREE.Group()
    for (let i = 0; i < HISTORY_SLICES.length; i++) {
      const dot = remember(
        new THREE.Mesh(
          new THREE.CircleGeometry(0.023 + i * 0.003, 16),
          new THREE.MeshBasicMaterial({
            color: '#80d5df',
            transparent: true,
            opacity: 0.12 + i * 0.13,
            side: THREE.DoubleSide,
            depthWrite: false,
          }),
        ),
      )
      dot.rotation.x = -Math.PI / 2
      historyDots.add(dot)
    }
    layers.tracks.add(historyDots)
    const historyFlow = trackFlow(true, storm.speed)
    const forecastFlow = trackFlow(false, storm.speed)
    const vector = line(
      Array.from({ length: 5 }, () => new THREE.Vector3()),
      '#b3dbe3',
      0.68,
    )
    layers.tracks.add(vector)
    return {
      storm,
      group,
      energy,
      history,
      forecast,
      historyDots,
      extent,
      index,
      trailMinutes,
      stormLock,
      scanArc,
      particlesMaterial,
      historyFlow,
      forecastFlow,
      vector,
      width: extent,
      depth: extent,
      bounds: new THREE.Box3(),
    }
  })

  // Swept cloud footprint along the forecast; its direction never bends toward an asset.
  const corridors = DEMO_STORMS.map((storm) => {
    const group = new THREE.Group()
    const geometry = new THREE.PlaneGeometry(1, 1, 1, 80)
    const material = shader(
      `varying vec2 vUv;varying vec2 mapPoint;uniform vec2 origin;uniform vec2 halfSize;uniform float alpha;uniform float time;uniform float speed;uniform float primary;uniform float reveal;uniform float scanAt;
      void main(){float progress=vUv.y;if(progress>reveal)discard;
      if(length((mapPoint-origin)/halfSize)<1.02)discard;
      float x=abs(vUv.x-.5)*2.;
      float edge=smoothstep(.96,1.,x)*.11;float fill=pow(1.-x,.7)*mix(.024,.05,primary);
      float dash=pow(.5+.5*sin(progress*50.-time*speed),16.);
      float stream=exp(-pow(x*15.,2.))*dash*.07;
      float sides=exp(-pow((x-.56)*35.,2.))*dash*.02;
      float spine=exp(-pow(x*36.,2.))*.05;
      float scan=exp(-pow((progress-scanAt)*45.,2.))*.22;
      vec3 color=mix(vec3(.17,.74,.82),mix(vec3(1.,.27,.035),vec3(1.,.63,.17),progress),primary);
      gl_FragColor=vec4(color,(fill+edge+stream+sides+spine+scan)*alpha*(1.-progress*.75));}`,
      {
        speed: { value: storm.speed / 10 },
        primary: { value: storm.primary ? 1 : 0 },
        reveal: { value: 0 },
        scanAt: { value: -1 },
        origin: { value: new THREE.Vector2() },
        halfSize: { value: new THREE.Vector2(1, 1) },
      },
    )
    material.vertexShader =
      'varying vec2 vUv;varying vec2 mapPoint;void main(){vUv=uv;mapPoint=position.xz;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}'
    const mesh = remember(new THREE.Mesh(geometry, material))
    mesh.renderOrder = 5
    group.add(mesh)
    layers.corridor.add(group)
    return { storm, mesh, group }
  })

  const minePosition = project(DEMO_MINE.center, 0.18)
  const rings = [50, 100, 150, 200].map((radius, index) => {
    const active = radius === 100
    const object = circle(
      DEMO_MINE.center,
      radius,
      active ? '#e8ad5e' : '#4ab7ce',
      active ? 0.65 : 0.17 - index * 0.018,
    )
    layers.rings.add(object)
    const label = textSprite(`${radius} km`, active ? '#e6ae65' : '#547784', 10)
    label.position.copy(project(destination(DEMO_MINE.center, 150, radius), 0.2))
    layers.rings.add(label)
    const bandGeometry = new THREE.BufferGeometry()
    const bandVertices: number[] = [],
      indices: number[] = []
    for (let i = 0; i <= 160; i++) {
      for (const r of [Math.max(0.5, radius - 50), radius])
        bandVertices.push(
          ...project(destination(DEMO_MINE.center, (i * 360) / 160, r), 0.08).toArray(),
        )
      if (i < 160) {
        const n = i * 2
        indices.push(n, n + 1, n + 2, n + 1, n + 3, n + 2)
      }
    }
    bandGeometry.setAttribute('position', new THREE.Float32BufferAttribute(bandVertices, 3))
    bandGeometry.setIndex(indices)
    const band = remember(
      new THREE.Mesh(
        bandGeometry,
        new THREE.MeshBasicMaterial({
          color: '#e8a750',
          opacity: 0,
          transparent: true,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      ),
    )
    layers.rings.add(band)
    return { radius, object, label, band, activation: 0 }
  })
  const radarAxes = new THREE.Group()
  for (let i = 0; i < 4; i++)
    radarAxes.add(
      line(
        [
          project(destination(DEMO_MINE.center, i * 90, 25)),
          project(destination(DEMO_MINE.center, i * 90, 215)),
        ],
        '#5cbad0',
        0.12,
        true,
      ),
    )
  layers.rings.add(radarAxes)

  const pulses: { mesh: THREE.Mesh; id: string; index: number }[] = []
  const assetVisuals: { id: string; group: THREE.Group; detail: THREE.Group; dot: THREE.Mesh }[] =
    []
  for (const [index, mine] of MINES.entries()) {
    const primary = true
    const group = new THREE.Group()
    group.position.copy(project(mine.center, 0.16))
    const color = primary ? '#6cdef3' : '#397c8a'
    for (const radius of primary ? [0.18, 0.29, 0.39] : [0.1, 0.17]) {
      const mesh = remember(
        new THREE.Mesh(
          new THREE.RingGeometry(radius, radius + 0.008, 64),
          new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            opacity: primary ? 0.8 : 0.5,
            side: THREE.DoubleSide,
            depthWrite: false,
          }),
        ),
      )
      mesh.rotation.x = -Math.PI / 2
      group.add(mesh)
    }
    const pulse = remember(
      new THREE.Mesh(
        new THREE.RingGeometry(0.18, 0.19, 48),
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.5,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      ),
    )
    pulse.rotation.x = -Math.PI / 2
    group.add(pulse)
    pulses.push({ mesh: pulse, id: mine.id, index })
    // Small abstract infrastructure glyph, intentionally no expensive building models.
    for (let i = 0; i < 3; i++) {
      const h = (primary ? 0.36 : 0.18) * [0.8, 1.5, 1][i]!
      const geometry = new THREE.BoxGeometry(primary ? 0.1 : 0.06, h, primary ? 0.12 : 0.07)
      const box = remember(
        new THREE.LineSegments(
          new THREE.EdgesGeometry(geometry),
          new THREE.LineBasicMaterial({ color, transparent: true, opacity: primary ? 0.95 : 0.6 }),
        ),
      )
      geometry.dispose()
      box.position.set((i - 1) * (primary ? 0.14 : 0.09), h / 2, 0)
      group.add(box)
    }
    const detail = new THREE.Group()
    detail.add(...[...group.children])
    const dot = remember(
      new THREE.Mesh(
        new THREE.CircleGeometry(0.045, 16),
        new THREE.MeshBasicMaterial({
          color: '#80c6d5',
          transparent: true,
          opacity: 0.7,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      ),
    )
    dot.rotation.x = -Math.PI / 2
    dot.position.y = 0.1
    group.add(detail, dot)
    const hit = remember(
      new THREE.Mesh(
        new THREE.SphereGeometry(0.32, 10, 6),
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
      ),
    )
    hit.position.y = 0.2
    hit.userData = { kind: 'mine', id: mine.id }
    hitTargets.push(hit)
    group.add(hit)
    assetVisuals.push({ id: mine.id, group, detail, dot })
    layers.assets.add(group)
  }
  const lock = line(
    [
      new THREE.Vector3(-0.6, 0.1, -0.4),
      new THREE.Vector3(-0.6, 0.1, -0.6),
      new THREE.Vector3(-0.4, 0.1, -0.6),
    ],
    '#9beafa',
    0.8,
  )
  const lockGroup = new THREE.Group()
  lockGroup.position.copy(minePosition)
  for (let i = 0; i < 4; i++) {
    const corner = lock.clone()
    corner.rotation.y = (i * Math.PI) / 2
    lockGroup.add(corner)
  }
  layers.assets.add(lockGroup)
  const threatPath = line(
    Array.from({ length: 50 }, () => new THREE.Vector3()),
    '#efbc78',
    0.7,
  )
  layers.corridor.add(threatPath)
  const threatJunction = remember(
    new THREE.Points(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3()]),
      new THREE.PointsMaterial({
        color: '#efbc78',
        size: 3,
        sizeAttenuation: false,
        transparent: true,
        opacity: 0.7,
        depthWrite: false,
      }),
    ),
  )
  layers.corridor.add(threatJunction)

  function moveDefenseCenter() {
    if (!analysis.mine) return
    const center = analysis.mine.center
    minePosition.copy(project(center, 0.18))
    lockGroup.position.copy(minePosition)
    for (const ring of rings) {
      const positions = ring.object.geometry.attributes.position as THREE.BufferAttribute
      const bandPositions = ring.band.geometry.attributes.position as THREE.BufferAttribute
      for (let i = 0; i <= 160; i++) {
        const p = project(destination(center, (i * 360) / 160, ring.radius), 0.14)
        positions.setXYZ(i, p.x, p.y, p.z)
        for (let j = 0; j < 2; j++) {
          const b = project(
            destination(center, (i * 360) / 160, j ? ring.radius : Math.max(0.5, ring.radius - 50)),
            0.08,
          )
          bandPositions.setXYZ(i * 2 + j, b.x, b.y, b.z)
        }
      }
      positions.needsUpdate = bandPositions.needsUpdate = true
      ring.object.geometry.computeBoundingSphere()
      ring.band.geometry.computeBoundingSphere()
      ring.label.position.copy(project(destination(center, 150, ring.radius), 0.2))
    }
    radarAxes.children.forEach((axis, i) => {
      const line = axis as THREE.Line
      const position = line.geometry.attributes.position as THREE.BufferAttribute
      for (const [index, radius] of [25, 215].entries()) {
        const p = project(destination(center, i * 90, radius))
        position.setXYZ(index, p.x, p.y, p.z)
      }
      position.needsUpdate = true
      line.geometry.computeBoundingSphere()
      line.computeLineDistances()
    })
  }

  const eventGeometry = new THREE.BufferGeometry()
  eventGeometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      DEMO_EVENTS.flatMap((e) => project(e.position, 0.22).toArray()),
      3,
    ),
  )
  eventGeometry.setAttribute(
    'eventMinute',
    new THREE.Float32BufferAttribute(
      DEMO_EVENTS.map((e) => e.minute),
      1,
    ),
  )
  const eventMaterial = shader(
    `varying float age;uniform float alpha;
    void main(){if(age<0.||age>30.)discard;float d=length(gl_PointCoord-.5);float a=1.-smoothstep(.05,.5,d);gl_FragColor=vec4(1.,.65,.27,a*alpha*(1.-age/35.));}`,
    { minute: { value: minute } },
  )
  eventMaterial.vertexShader = `attribute float eventMinute;uniform float minute;varying float age;void main(){age=minute-eventMinute;vec4 mv=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*mv;gl_PointSize=clamp(65./-mv.z,1.4,3.5);}`
  layers.strikes.add(remember(new THREE.Points(eventGeometry, eventMaterial)))
  const flashes = Array.from({ length: 8 }, () => {
    const mat = shader(
      `varying vec2 vUv;uniform float alpha;uniform float life;
      void main(){float r=length((vUv-.5)*2.);float peak=exp(-r*r*95.)*pow(1.-life,3.);float ring=exp(-pow((r-life*.88)*45.,2.))*(1.-life)*.38;gl_FragColor=vec4(.62,.86,1.,(peak+ring)*alpha);}`,
      { life: { value: 1 } },
    )
    const mesh = remember(new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), mat))
    mesh.rotation.x = -Math.PI / 2
    layers.strikes.add(mesh)
    return { mesh, start: -10 }
  })
  let lastFlash = -1
  let eventCursor = minute

  const relationshipPositions = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]
  function footprint(center: LngLat, radius: number) {
    return {
      width:
        project(destination(center, 90, radius)).x - project(destination(center, 270, radius)).x,
      depth:
        project(destination(center, 180, radius)).z - project(destination(center, 0, radius)).z,
    }
  }
  function updatePositions() {
    for (const visual of stormVisuals) {
      const { storm, group, history, forecast, historyDots, trailMinutes } = visual
      group.position.copy(project(demoPosition(storm, minute), 0))
      const prediction = stormForecast(storm, minute)
      const size = footprint(prediction.center, storm.radius)
      visual.width = size.width
      visual.depth = size.depth
      visual.energy.scale.set(size.width, size.depth, 1)
      visual.bounds.setFromCenterAndSize(
        group.position.clone().setY(0.24),
        new THREE.Vector3(size.width, 0.01, size.depth),
      )
      visual.particlesMaterial.uniforms.extent!.value = Math.min(size.width, size.depth)
      const direction = project(prediction.position(15), 0).sub(group.position).normalize()
      visual.particlesMaterial.uniforms.flowDirection!.value.copy(direction)
      const support =
        1 / Math.sqrt((direction.x / (size.width / 2)) ** 2 + (direction.z / (size.depth / 2)) ** 2)
      const vectorStart = group.position.clone().addScaledVector(direction, support).setY(0.38)
      const tip = vectorStart.clone().addScaledVector(direction, 0.55)
      const side = new THREE.Vector3(-direction.z, 0, direction.x)
      const vectorPoints = [
        vectorStart,
        tip,
        tip.clone().addScaledVector(direction, -0.12).addScaledVector(side, 0.07),
        tip,
        tip.clone().addScaledVector(direction, -0.12).addScaledVector(side, -0.07),
      ]
      const vectorPositions = visual.vector.geometry.attributes.position as THREE.BufferAttribute
      vectorPoints.forEach((p, i) => vectorPositions.setXYZ(i, p.x, p.y, p.z))
      vectorPositions.needsUpdate = true
      visual.vector.geometry.computeBoundingSphere()
      const h = history.geometry.attributes.position as THREE.BufferAttribute
      for (let i = 0; i < h.count; i++) {
        const p = project(
          demoPosition(storm, minute - trailMinutes + (i * trailMinutes) / (h.count - 1)),
          0.28,
        )
        h.setXYZ(i, p.x, p.y, p.z)
      }
      h.needsUpdate = true
      history.geometry.computeBoundingSphere()
      const f = forecast.geometry.attributes.position as THREE.BufferAttribute
      for (let i = 0; i < f.count; i++) {
        const p = project(prediction.position((i * FORECAST_MINUTES) / (f.count - 1)), 0.18)
        f.setXYZ(i, p.x, p.y, p.z)
      }
      f.needsUpdate = true
      forecast.geometry.computeBoundingSphere()
      forecast.computeLineDistances()
      historyDots.children.forEach((dot, i) =>
        dot.position.copy(project(prediction.history[i]!.center, 0.3)),
      )
      const historyPath = visual.historyFlow.material.uniforms.path!.value as THREE.Vector3[]
      const futurePath = visual.forecastFlow.material.uniforms.path!.value as THREE.Vector3[]
      historyPath.forEach((point, i) => point.fromBufferAttribute(h, i * 2))
      futurePath.forEach((point, i) => point.fromBufferAttribute(f, i))
    }
    for (const corridor of corridors) {
      const storm = corridor.storm
      const prediction = stormForecast(storm, minute)
      const active = corridor.storm.id === selected
      const travel = (prediction.speed * FORECAST_MINUTES) / 60
      const size = footprint(prediction.center, storm.radius)
      const current = project(prediction.center)
      const corridorMaterial = corridor.mesh.material as THREE.ShaderMaterial
      corridorMaterial.uniforms.origin!.value.set(current.x, current.z)
      corridorMaterial.uniforms.halfSize!.value.set(size.width / 2, size.depth / 2)
      const attributes = corridor.mesh.geometry.attributes
      const position = attributes.position as THREE.BufferAttribute,
        uv = attributes.uv as THREE.BufferAttribute
      for (let i = 0; i < position.count; i++) {
        const progress = uv.getY(i)
        const along = progress * (travel + storm.radius * 2) - storm.radius
        const capDistance = Math.max(0, -along, along - travel)
        const width = Math.sqrt(Math.max(0, storm.radius ** 2 - capDistance ** 2))
        const time = (along / Math.max(0.01, prediction.speed)) * 60
        const center = prediction.position(time)
        const bearing = bearingTo(center, prediction.position(time + 1))
        const point = project(
          destination(center, bearing + (uv.getX(i) < 0.5 ? -90 : 90), width),
          0.18,
        )
        position.setXYZ(i, point.x, 0.18, point.z)
      }
      position.needsUpdate = true
      corridor.mesh.geometry.computeBoundingSphere()
      ;(corridor.mesh.material as THREE.ShaderMaterial).uniforms.primary!.value =
        active && analysis.relation ? 1 : 0
    }
    if (analysis.storm && analysis.mine && analysis.relation) {
      const prediction = stormForecast(analysis.storm, minute)
      const arrival = analysis.relation.impactMinutes ?? 0
      const position = threatPath.geometry.attributes.position as THREE.BufferAttribute
      const impact = project(prediction.position(arrival), 0.31)
      const branchDirection = minePosition.clone().sub(impact).setY(0)
      const bend = Math.min(0.35, branchDirection.length() * 0.12)
      const side = new THREE.Vector3(-branchDirection.z, 0, branchDirection.x).normalize()
      const points: THREE.Vector3[] = []
      for (let i = 0; i < position.count; i++) {
        // Asset relationship branches from the forecast impact point. Never redraw the
        // storm's own trajectory in the asset color or redirect its forecast particles.
        const t = i / (position.count - 1)
        const p = impact
          .clone()
          .lerp(minePosition, t)
          .addScaledVector(side, 4 * t * (1 - t) * bend)
          .setY(0.31)
        position.setXYZ(i, p.x, p.y, p.z)
        points.push(p)
      }
      const lengths = points.map((point, i) => (i ? point.distanceTo(points[i - 1]!) : 0))
      const total = lengths.reduce((a, b) => a + b, 0)
      relationshipPositions.forEach((point, index) => {
        let remaining = total * [0.5, 0.55, 0.6][index]!
        for (let i = 1; i < points.length; i++) {
          if (remaining <= lengths[i]! || i === points.length - 1) {
            point.copy(points[i - 1]!).lerp(points[i]!, lengths[i]! ? remaining / lengths[i]! : 0)
            break
          }
          remaining -= lengths[i]!
        }
      })
      position.needsUpdate = true
      const junction = threatJunction.geometry.attributes.position as THREE.BufferAttribute
      junction.setXYZ(0, impact.x, impact.y, impact.z)
      junction.needsUpdate = true
      threatJunction.geometry.computeBoundingSphere()
      threatPath.geometry.computeBoundingSphere()
      threatPath.computeLineDistances()
    }
    eventMaterial.uniforms.minute!.value = minute
  }
  updatePositions()

  function fitCamera(instant = false) {
    const aspectFit = Math.min(1.65, Math.max(1, 1.45 / camera.aspect))
    target = scope === 'national' ? new THREE.Vector3(-1, 0, 0) : project([107.3, 36.6], 0)
    const offset =
      scope === 'national'
        ? new THREE.Vector3(0, 43, flat ? 0.01 : 28)
        : new THREE.Vector3(0, 20.5, flat ? 0.01 : 15)
    goal = target.clone().add(offset.multiplyScalar(aspectFit))
    if (instant || reduced) {
      camera.position.copy(goal)
      controls.target.copy(target)
      goal = target = undefined
      controls.update()
    }
  }
  let previousAspect = 0
  const resize = () => {
    camera.aspect = Math.max(1, host.clientWidth) / Math.max(1, host.clientHeight)
    camera.updateProjectionMatrix()
    renderer.setSize(Math.max(1, host.clientWidth), Math.max(1, host.clientHeight), false)
    if (previousAspect && Math.abs(previousAspect - camera.aspect) > 0.1) fitCamera()
    previousAspect = camera.aspect
  }
  resize()
  fitCamera(true)
  const observer = new ResizeObserver(resize)
  observer.observe(host)
  const cancelFlight = () => {
    goal = target = undefined
  }
  controls.addEventListener('start', cancelFlight)
  const motionChange = () => {
    reduced = media.matches
    if (reduced) started = elapsed - 6
  }
  media.addEventListener('change', motionChange)
  const onContextLost = (event: Event) => {
    event.preventDefault()
    cancelAnimationFrame(frame)
    options.onError('图形上下文中断，请刷新页面重新加载。')
  }
  renderer.domElement.addEventListener('webglcontextlost', onContextLost)
  const raycaster = new THREE.Raycaster()
  const pointer = new THREE.Vector2()
  let pointerStart: { x: number; y: number; id: number } | undefined
  function pick(event: PointerEvent) {
    const rect = renderer.domElement.getBoundingClientRect()
    pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      1 - ((event.clientY - rect.top) / rect.height) * 2,
    )
    raycaster.setFromCamera(pointer, camera)
    scene.updateMatrixWorld(true)
    const hits = raycaster
      .intersectObjects(
        hitTargets.filter((object) => {
          const { kind, id } = object.userData
          return kind === 'mine'
            ? phase >= 5 &&
                layerState.assets &&
                MINES.some((m) => m.id === id && mineVisible(m, mineFilter, analysis.mine?.id))
            : phase >= 3 && layerState.energy
        }),
        false,
      )
      .filter(
        (hit) =>
          hit.object.userData.kind === 'mine' ||
          !hit.uv ||
          hit.uv.distanceTo(new THREE.Vector2(0.5, 0.5)) < 0.36,
      )
    // A small asset under a cloud remains selectable.
    return hits.find((hit) => hit.object.userData.kind === 'mine') ?? hits[0]
  }
  const pointerDown = (event: PointerEvent) => {
    if (event.button === 0 && event.isPrimary)
      pointerStart = { x: event.clientX, y: event.clientY, id: event.pointerId }
  }
  function historyTooltip(event: PointerEvent) {
    const visual = stormVisuals.find((v) => v.storm.id === selected)
    if (!visual || !layerState.tracks || blend.tracks < 0.2 || phase < 4) return ''
    const rect = renderer.domElement.getBoundingClientRect()
    const x = event.clientX - rect.left,
      y = event.clientY - rect.top
    const positions = visual.history.geometry.attributes.position as THREE.BufferAttribute
    const count = Math.min(positions.count, visual.history.geometry.drawRange.count)
    let closest = 6,
      sample = -1
    for (let i = 1; i < count; i++) {
      const a = anchor('', new THREE.Vector3().fromBufferAttribute(positions, i - 1))
      const b = anchor('', new THREE.Vector3().fromBufferAttribute(positions, i))
      if (!a.visible || !b.visible) continue
      const dx = b.x - a.x,
        dy = b.y - a.y
      const t = THREE.MathUtils.clamp(
        ((x - a.x) * dx + (y - a.y) * dy) / Math.max(0.001, dx * dx + dy * dy),
        0,
        1,
      )
      const distance = Math.hypot(x - a.x - dx * t, y - a.y - dy * t)
      if (distance < closest) {
        closest = distance
        sample = (i - 1 + t) / (positions.count - 1)
      }
    }
    return sample < 0
      ? ''
      : `${selected} · 历史位置 ${demoClock(minute - visual.trailMinutes * (1 - sample), true)}`
  }
  const pointerMove = (event: PointerEvent) => {
    if (
      pointerStart &&
      Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 5
    )
      pointerStart = undefined
    renderer.domElement.title = event.buttons ? '' : historyTooltip(event)
    if (!event.buttons) renderer.domElement.style.cursor = pick(event) ? 'pointer' : 'grab'
  }
  const pointerUp = (event: PointerEvent) => {
    if (
      pointerStart?.id === event.pointerId &&
      Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) <= 5
    ) {
      const hit = pick(event)
      if (hit) options.onPick(hit.object.userData.kind, hit.object.userData.id)
    }
    pointerStart = undefined
  }
  const pointerCancel = () => {
    pointerStart = undefined
  }
  renderer.domElement.addEventListener('pointerdown', pointerDown)
  renderer.domElement.addEventListener('pointermove', pointerMove)
  renderer.domElement.addEventListener('pointerup', pointerUp)
  renderer.domElement.addEventListener('pointercancel', pointerCancel)
  const projected = new THREE.Vector3()
  function anchor(id: string, position: THREE.Vector3): ScreenAnchor {
    projected.copy(position).project(camera)
    return {
      id,
      x: ((projected.x + 1) * host.clientWidth) / 2,
      y: ((1 - projected.y) * host.clientHeight) / 2,
      visible:
        projected.z > -1 &&
        projected.z < 1 &&
        Math.abs(projected.x) < 0.98 &&
        Math.abs(projected.y) < 0.88,
    }
  }
  function animate(now: number) {
    if (disposed || document.hidden) return
    frame = requestAnimationFrame(animate)
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 0
    last = now
    elapsed += dt
    const build = reduced ? 6 : elapsed - started
    const inspecting = analysis.kind !== 'overview'
    const age = reduced || !inspecting ? ANALYSIS_SECONDS : elapsed - relockAt
    const step = (start: number, end: number) => (inspecting ? smooth(start, end, age) : 1)
    const sequence = analysisFrame(analysis.kind, age)
    const assetReveal = analysis.mine ? sequence.asset : 0
    const nextPhase = demoPhase(build)
    if (nextPhase !== phase) {
      phase = nextPhase
      options.onPhase(phase)
    }
    const ease = 1 - Math.exp(-dt * 5)
    if (Math.abs(targetMinute - minute) > 0.0001) {
      minute = reduced
        ? targetMinute
        : THREE.MathUtils.lerp(minute, targetMinute, 1 - Math.exp(-dt * 8))
      updatePositions()
    }
    for (const key of ['heat', 'track', 'warning'] as const)
      modeBlend[key] = THREE.MathUtils.lerp(modeBlend[key], mode === key ? 1 : 0, ease)
    const reveal: Record<CommandLayer, number> = {
      energy: 1,
      strikes: smooth(1.5, 2.5, build),
      tracks: smooth(3, 3.5, build),
      assets: smooth(3.6, 4.2, build),
      rings: smooth(3.8, 4.5, build),
      corridor: smooth(4.5, 4.9, build),
    }
    for (const key of Object.keys(layerState) as CommandLayer[]) {
      let strength = 1
      if (key === 'tracks') strength = 0.6 + modeBlend.track * 0.4 - modeBlend.heat * 0.48
      if (key === 'corridor') strength = 0.95 + modeBlend.warning * 0.05 - modeBlend.heat * 0.75
      if (key === 'assets') strength = 1 - modeBlend.heat * 0.78
      if (key === 'rings') strength = 0.84 + modeBlend.warning * 0.16 - modeBlend.heat * 0.7
      blend[key] = THREE.MathUtils.lerp(
        blend[key],
        layerState[key] ? reveal[key] * strength : 0,
        reduced ? 1 : ease,
      )
      setAlpha(layers[key], blend[key])
    }
    setAlpha(environment, smooth(0, 0.85, build))
    const scanMaterial = scan.material as THREE.ShaderMaterial
    const ambientScan = elapsed > 18 ? ((elapsed - 18) % 42) / 3.5 : -1
    scanMaterial.uniforms.scanAt!.value = reduced
      ? -1
      : build < 1.6
        ? (build - 0.7) / 0.9
        : ambientScan <= 1
          ? ambientScan
          : -1
    scanMaterial.uniforms.strength!.value = build < 1.6 ? 0.1 : 0.026
    animatedMaterials.forEach((mat) => {
      mat.uniforms.time!.value = reduced ? 0 : elapsed
    })
    for (const visual of stormVisuals) {
      const active = selected === visual.storm.id
      const shown = stormShown(visual.storm.id)
      const weight = active
        ? analysis.kind === 'mine'
          ? 0.3 + 0.7 * sequence.lock
          : 1
        : inspecting
          ? THREE.MathUtils.lerp(0.42, 0.14, step(0, 0.18))
          : 0.36 + modeBlend.heat * 0.3
      setAlpha(
        visual.group,
        blend.energy *
          smooth(1.45 + visual.index * 0.16, 2.2 + visual.index * 0.16, build) *
          (shown ? weight : 0.07),
      )
      ;(visual.energy.material as THREE.ShaderMaterial).uniforms.heat!.value = modeBlend.heat
      ;(visual.energy.material as THREE.ShaderMaterial).uniforms.danger!.value =
        active && analysis.relation?.threatening ? sequence.lock : 0
      ;(visual.energy.material as THREE.ShaderMaterial).uniforms.locked!.value = active
        ? sequence.lock
        : 0
      const historyReveal = active ? sequence.history : 1
      const forecastReveal = inspecting ? sequence.forecast : 1
      visual.history.geometry.setDrawRange(
        0,
        Math.floor(81 * smooth(3, 3.7, build) * historyReveal),
      )
      visual.forecast.geometry.setDrawRange(
        0,
        Math.floor(41 * smooth(3.35, 4.15, build) * forecastReveal),
      )
      visual.vector.visible = active
      visual.vector.geometry.setDrawRange(0, Math.floor(5 * sequence.vector))
      visual.vector.material.opacity = blend.tracks * 0.65
      const trackWeight = active
        ? 1
        : analysis.kind === 'storm'
          ? 0.08
          : 0.2 + modeBlend.track * 0.3
      visual.history.material.opacity = blend.tracks * 0.8 * trackWeight * (shown ? 1 : 0)
      visual.forecast.material.opacity = blend.tracks * 0.62 * trackWeight * (shown ? 1 : 0)
      visual.forecast.material.color.set(active ? '#93d8e3' : '#6ac5d1')
      setAlpha(visual.historyDots, blend.tracks * trackWeight * historyReveal * (shown ? 1 : 0))
      visual.historyDots.children.forEach((dot, index) => {
        ;(dot as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>).material.opacity *=
          sequence.nodes[index]!
      })
      for (const [flow, reveal] of [
        [visual.historyFlow, historyReveal],
        [visual.forecastFlow, forecastReveal],
      ] as const) {
        flow.points.visible = active && shown
        flow.material.uniforms.alpha!.value = blend.tracks * (active && shown ? 0.7 : 0)
        flow.material.uniforms.reveal!.value = reveal * smooth(3, 3.7, build)
      }
      const contraction = inspecting ? sequence.lock : smooth(3.55, 4.25, build)
      const frameScale = 1.03 + 0.07 * (1 - contraction)
      visual.stormLock.scale.set(visual.width * frameScale, 1, visual.depth * frameScale)
      visual.scanArc.visible = !reduced && inspecting && age < ANALYSIS_SECONDS
      visual.scanArc.rotation.y = -Math.min(age, ANALYSIS_SECONDS) * 0.6
      setAlpha(
        visual.stormLock,
        active
          ? blend.energy * contraction * (0.92 + (reduced ? 0 : 0.08 * Math.sin(elapsed * 1.7)))
          : 0,
      )
    }
    for (const corridor of corridors) {
      const active = selected === corridor.storm.id
      const relevant =
        active ||
        (analysis.kind === 'mine' && analysis.threats.some((r) => r.storm.id === corridor.storm.id))
      setAlpha(
        corridor.group,
        relevant ? blend.corridor * sequence.corridor * (active ? 1 : 0.12) : 0,
      )
      const material = corridor.mesh.material as THREE.ShaderMaterial
      material.uniforms.reveal!.value = smooth(4.5, 5.25, build) * sequence.corridor
      material.uniforms.scanAt!.value = sequence.scan
    }
    threatPath.visible = !!analysis.relation
    threatJunction.visible = !!analysis.relation && sequence.link > 0
    threatJunction.material.opacity = blend.corridor * sequence.link * 0.65
    threatPath.geometry.setDrawRange(0, Math.floor(50 * sequence.link))
    threatPath.material.opacity = blend.corridor * 0.5 * sequence.link
    layers.rings.visible = !!analysis.mine && blend.rings > 0.002 && assetReveal > 0.01
    radarAxes.visible = assetReveal > 0.9
    const activated = analysis.relation?.level.radius ?? Infinity
    for (const [index, ring] of rings.entries()) {
      const unfold = analysis.mine ? sequence.rings[index]! : 0
      ring.object.geometry.setDrawRange(0, Math.floor(161 * unfold))
      ring.band.geometry.setDrawRange(0, Math.floor(160 * unfold) * 6)
      ring.activation = THREE.MathUtils.lerp(
        ring.activation,
        ring.radius === activated ? 1 : 0,
        reduced ? 1 : ease,
      )
      const mat = ring.object.material as THREE.LineBasicMaterial
      const riskColor = activated === 50 ? '#ee8063' : '#efb463'
      mat.color.set('#4d95a8').lerp(new THREE.Color(riskColor), ring.activation)
      mat.opacity = blend.rings * unfold * THREE.MathUtils.lerp(0.065, 0.68, ring.activation)
      ring.label.material.color.set('#7194a0').lerp(new THREE.Color(riskColor), ring.activation)
      ring.label.material.opacity = blend.rings * unfold * ring.activation
      ring.band.material.color.set(riskColor)
      ring.band.material.opacity = blend.rings * unfold * ring.activation * 0.065
    }
    for (const asset of assetVisuals) {
      const active = asset.id === analysis.mine?.id
      const visible = MINES.some(
        (m) => m.id === asset.id && mineVisible(m, mineFilter, analysis.mine?.id),
      )
      const candidate =
        analysis.kind === 'storm' && analysis.threats.some((r) => r.mine.id === asset.id)
      const candidateRelation = analysis.threats.find((r) => r.mine.id === asset.id)
      const scanPosition = (candidateRelation?.impactMinutes ?? 0) / FORECAST_MINUTES
      const scanning =
        candidate && sequence.scan >= 0
          ? Math.exp(-Math.pow((sequence.scan - scanPosition) * 8, 2)) * 0.35
          : 0
      asset.group.scale.setScalar(1)
      asset.detail.visible = active && assetReveal > 0.05
      asset.detail.scale.setScalar(0.4 + 0.6 * assetReveal)
      asset.dot.visible = !asset.detail.visible
      setAlpha(
        asset.group,
        visible ? blend.assets * (active ? 0.55 + 0.45 * assetReveal : 0.55 + scanning) : 0,
      )
    }
    pulses.forEach(({ mesh, id, index }) => {
      const primary = id === analysis.mine?.id
      const acquiring = primary && assetReveal > 0 && assetReveal < 1
      const life = acquiring ? assetReveal : reduced ? 0.3 : ((elapsed + index * 0.4) % 6) / 6
      mesh.scale.setScalar(1 + life * (primary ? 4 : 2.5))
      ;(mesh.material as THREE.MeshBasicMaterial).opacity =
        blend.assets * (1 - life) * (primary ? (acquiring ? 0.65 : 0.12) : 0)
    })
    setAlpha(lockGroup, blend.assets * assetReveal)
    lockGroup.scale.setScalar(1 + (1 - assetReveal) * 0.8)
    const burst = Math.floor(elapsed / 3.2)
    if (!reduced && build > 5.3 && burst !== lastFlash && layerState.strikes) {
      lastFlash = burst
      // Only flash events already inside the displayed time window; bounded to eight pooled effects.
      const visible = DEMO_EVENTS.filter((e) => e.minute <= minute && e.minute > minute - 12)
      const event = visible[burst % Math.max(1, visible.length)]
      if (event && Math.abs(minute - eventCursor) < 2) {
        const flash = flashes[burst % flashes.length]!
        flash.mesh.position.copy(project(event.position, 0.3))
        flash.start = elapsed
      }
    }
    eventCursor = minute
    flashes.forEach((flash) => {
      const life = (elapsed - flash.start) / 1.2
      flash.mesh.visible = !reduced && life >= 0 && life <= 1
      ;(flash.mesh.material as THREE.ShaderMaterial).uniforms.life!.value = Math.min(1, life)
    })
    if (goal && target) {
      camera.position.lerp(goal, ease)
      controls.target.lerp(target, ease)
      if (camera.position.distanceTo(goal) < 0.005) {
        camera.position.copy(goal)
        controls.target.copy(target)
        goal = target = undefined
      }
    }
    controls.update()
    renderer.render(scene, camera)
    if (now - lastLabels > 45) {
      lastLabels = now
      options.onAnalysisProgress(Math.min(1, age / ANALYSIS_SECONDS))
      options.onAnchors([
        ...stormVisuals
          .filter((v) => stormShown(v.storm.id))
          .map((v) => {
            const points = [v.bounds.min.x, v.bounds.max.x].flatMap((x) =>
              [v.bounds.min.z, v.bounds.max.z].map((z) =>
                anchor('', new THREE.Vector3(x, 0.24, z)),
              ),
            )
            const x = Math.min(...points.map((p) => p.x)),
              y = Math.min(...points.map((p) => p.y))
            return {
              ...anchor(v.storm.id, v.group.position.clone().setY(0.5)),
              bounds: {
                x,
                y,
                width: Math.max(...points.map((p) => p.x)) - x,
                height: Math.max(...points.map((p) => p.y)) - y,
              },
            }
          }),
        ...MINES.filter((m) => mineVisible(m, mineFilter, analysis.mine?.id)).map((m) =>
          anchor(`mine:${m.id}`, project(m.center, 0.45)),
        ),
        ...(analysis.storm
          ? [
              ...relationshipPositions.map((p, i) => anchor(`relationship:${i}`, p)),
              ...HISTORY_SLICES.map((slice) =>
                anchor(
                  `history:${slice.minutes}`,
                  project(demoPosition(analysis.storm!, minute - slice.minutes), 0.3),
                ),
              ),
              ...stormVisuals
                .filter((v) => v.storm.id === selected)
                .map((v) =>
                  anchor(
                    'vector',
                    new THREE.Vector3().fromBufferAttribute(
                      v.vector.geometry.attributes.position as THREE.BufferAttribute,
                      1,
                    ),
                  ),
                ),
              anchor(
                'forecast-end',
                project(stormForecast(analysis.storm, minute).position(FORECAST_MINUTES), 0.4),
              ),
            ]
          : []),
      ])
    }
  }
  const visibility = () => {
    cancelAnimationFrame(frame)
    last = 0
    if (!document.hidden && !disposed) frame = requestAnimationFrame(animate)
  }
  document.addEventListener('visibilitychange', visibility)
  frame = requestAnimationFrame(animate)
  return {
    setMode(next) {
      mode = next
    },
    setLayer(layer, visible) {
      layerState[layer] = visible
    },
    setTime(value) {
      targetMinute = THREE.MathUtils.clamp(value, 0, 180)
    },
    setScope(next) {
      scope = next
      fitCamera()
    },
    setAnalysis(next, focus = false, restart = false) {
      const changed =
        next.kind !== analysis.kind ||
        (next.storm?.id ?? '') !== selected ||
        next.mine?.id !== analysis.mine?.id
      const moved = next.mine?.id !== analysis.mine?.id
      analysis = next
      selected = next.storm?.id ?? ''
      if (moved) moveDefenseCenter()
      if ((changed || restart) && next.kind !== 'overview') {
        started = elapsed - 6
        relockAt = elapsed
        options.onAnalysisProgress(reduced ? 1 : 0)
      }
      if (next.kind === 'overview') options.onAnalysisProgress(1)
      updatePositions()
      if (focus) {
        const offset = camera.position.clone().sub(controls.target)
        offset.setLength(THREE.MathUtils.clamp(offset.length() * 0.9, 12, 60))
        target = minePosition.clone().setY(0)
        goal = target.clone().add(offset)
        if (reduced) {
          camera.position.copy(goal)
          controls.target.copy(target)
          goal = target = undefined
        }
      }
    },
    setMineFilter(next) {
      mineFilter = next
    },
    setView(next) {
      flat = next
      fitCamera()
    },
    zoom(direction) {
      cancelFlight()
      const offset = camera.position.clone().sub(controls.target)
      offset.setLength(
        THREE.MathUtils.clamp(offset.length() * (direction > 0 ? 0.8 : 1.25), 8, 100),
      )
      target = controls.target.clone()
      goal = target.clone().add(offset)
    },
    reset() {
      fitCamera()
    },
    replay() {
      started = elapsed
      phase = -1
      lastFlash = -1
      flashes.forEach((f) => {
        f.start = -10
      })
    },
    dispose() {
      disposed = true
      cancelAnimationFrame(frame)
      observer.disconnect()
      controls.dispose()
      document.removeEventListener('visibilitychange', visibility)
      media.removeEventListener('change', motionChange)
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost)
      renderer.domElement.removeEventListener('pointerdown', pointerDown)
      renderer.domElement.removeEventListener('pointermove', pointerMove)
      renderer.domElement.removeEventListener('pointerup', pointerUp)
      renderer.domElement.removeEventListener('pointercancel', pointerCancel)
      geometries.forEach((g) => g.dispose())
      materials.forEach((m) => m.dispose())
      textures.forEach((t) => t.dispose())
      scene.clear()
      renderer.dispose()
      renderer.forceContextLoss()
      renderer.domElement.remove()
    },
  }
}
