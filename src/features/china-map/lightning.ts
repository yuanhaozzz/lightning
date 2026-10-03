import * as maplibregl from 'maplibre-gl'
import type { CanvasSource, GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl'
import { MINE_AREAS } from './mines'

type StrikeLevel = 'normal' | 'strong'
type LightningEvent = {
  id: string
  lng: number
  lat: number
  occurredAt: number
  polarity: 'positive' | 'negative'
  current: number
  level: StrikeLevel
}

const SOURCE = 'realtime-lightning'
const HALO = 'lightning-halo'
const CORE = 'lightning-core'
const SYMBOL = 'lightning-symbol'
const SYMBOL_HIT = 'lightning-symbol-hit-area'
const HEATMAP_SOURCE = 'lightning-analysis-events'
const STRENGTH_HEATMAP = 'lightning-strength-heatmap'
const DENSITY_HEATMAP = 'lightning-density-heatmap'
const STRENGTH_DETAIL = 'lightning-strength-detail-glow'
const DENSITY_DETAIL = 'lightning-density-detail-glow'
const HEAT_CANVAS_SOURCE = 'lightning-persistent-heat-canvas'
const HEAT_CANVAS_LAYER = 'lightning-persistent-heat-layer'
const WAVE = 'lightning-impact-wave'
const LIVE_SOURCE = 'live-lightning-strike'
const FLASH_CONTRAST = 'lightning-flash-contrast'
const FLASH_GLOW = 'lightning-flash-glow'
const FLASH_CORE = 'lightning-flash-core'
const FLASH_SYMBOL = 'lightning-flash-symbol'
const ACTIVE_LOCATOR = 'lightning-active-locator'
const IMPACT_SOURCE = 'lightning-impact-rings'
const IMPACT_GLOW = 'lightning-impact-glow'
const IMPACT_CORE = 'lightning-impact-core'
const IMPACT_ECHO = 'lightning-impact-echo'
const IMPACT_ARCS = 'lightning-impact-arcs'
const MINE_LINK_SOURCE = 'lightning-nearest-mine-link'
const MINE_LINK_GLOW = 'lightning-nearest-mine-link-glow'
const MINE_LINK_CORE = 'lightning-nearest-mine-link-core'
const MINE_LINK_TRACER_SOURCE = 'lightning-nearest-mine-tracer'
const MINE_LINK_TRACER_GLOW = 'lightning-nearest-mine-tracer-glow'
const MINE_LINK_TRACER_CORE = 'lightning-nearest-mine-tracer-core'
const MAX_AGE_MS = 30 * 60 * 1000
const EVENT_COUNT = 12_000
const VISIBLE_LIMIT = 280
// National overview uses compact points. Once the camera reaches a province
// scale, every retained strike switches to the bolt glyph (not only fresh or
// strong strikes), so dots and bolts never get mixed at detailed zooms.
const LIGHTNING_SYMBOL_MIN_ZOOM = 4.6

let seed = 0x26_09_2026
const random = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
  return seed / 4294967296
}
const normal = () => Math.sqrt(-2 * Math.log(Math.max(random(), 1e-7))) * Math.cos(2 * Math.PI * random())

const stormCells: Array<[number, number, number, number, number]> = [
  [105.86, 38.70, .72, .42, 2.45], [106.72, 36.11, .24, .15, 1.28],
  [116.9, 32.2, 3.7, 1.35, 1.9], [119.3, 31.1, 3.1, 1.1, 2.3],
  [108.7, 31.5, 2.8, 1.1, 1.2], [113.1, 27.6, 2.4, 1.15, 1.45],
  [116.3, 27.2, 2.2, .9, 1.65], [110.2, 40.6, 2.8, .75, .72],
  [115.7, 39.8, 2.5, .72, .58], [121.6, 39.1, 2.1, .65, .44],
]

function createEvents(now: number, timelineIndex = 180): LightningEvent[] {
  seed = 0x26_09_2026
  const events: LightningEvent[] = [
    { id:'L-DEMO-BAISIKOU', lng:105.86, lat:38.70, occurredAt:now - 18_000, polarity:'positive', current:96, level:'strong' },
    { id:'L-DEMO-GUYUAN-1', lng:106.69, lat:36.10, occurredAt:now - 76_000, polarity:'negative', current:46, level:'normal' },
    { id:'L-DEMO-GUYUAN-2', lng:106.74, lat:36.13, occurredAt:now - 142_000, polarity:'negative', current:38, level:'normal' },
  ]
  for (let index = 0; index < EVENT_COUNT; index += 1) {
    const cell = stormCells[Math.floor(Math.pow(random(), .72) * stormCells.length)]!
    const angle = random() * Math.PI * 2
    const radial = Math.pow(random(), .66)
    const filament = Math.sin(angle * 3.2 + radial * 9) * .18
    const lng = cell[0] + Math.cos(angle) * cell[2] * radial + normal() * .07 + filament
    const lat = cell[1] + Math.sin(angle) * cell[3] * radial + normal() * .055
    const timeBucket = random()
    const ageMinutes = timeBucket < .1
      ? random()
      : timeBucket < .4
        ? 1 + random() * 4
        : timeBucket < .8
          ? 5 + random() * 10
          : 15 + random() * 15
    const current = Math.round(8 + Math.pow(random(), 1.8) * 86 * cell[4])
    events.push({
      id: `L${String(index + 1).padStart(5, '0')}`,
      lng,
      lat,
      occurredAt: now - ageMinutes * 60_000,
      polarity: random() > .72 ? 'positive' : 'negative',
      current,
      level: current >= 78 ? 'strong' : 'normal',
    })
  }
  const driftStep = (timelineIndex - 180) / 30
  for (const event of events) {
    event.lng += driftStep * .18
    event.lat += driftStep * .045
  }
  return events
}

function opacityFor(ageMs: number) {
  if (ageMs <= 60_000) return 1
  return Math.max(0, 1 - ageMs / MAX_AGE_MS)
}

function selectVisibleEvents(events: LightningEvent[], now: number) {
  const candidates = events.filter((event) => now - event.occurredAt < MAX_AGE_MS)
  const cells = new Map<string, number>()
  const selected: LightningEvent[] = []
  const selectedIds = new Set<string>()
  const take = (items: LightningEvent[], limit: number, perCell: number) => {
    for (const event of items) {
      if (selected.length >= limit || selectedIds.has(event.id)) continue
      const key = `${Math.floor(event.lng / .38)}:${Math.floor(event.lat / .3)}`
      const count = cells.get(key) ?? 0
      if (count >= perCell) continue
      cells.set(key, count + 1)
      selectedIds.add(event.id)
      selected.push(event)
    }
  }
  // Keep the strongest event in every analysis cell first. Previously the
  // list was sorted primarily by recency, so the event responsible for a hot
  // core could be removed while a weaker nearby bolt remained visible.
  const strongestByCell = new Map<string, LightningEvent>()
  for (const event of candidates) {
    const key = `${Math.floor(event.lng / .38)}:${Math.floor(event.lat / .3)}`
    const retained = strongestByCell.get(key)
    const score = event.current * opacityFor(now - event.occurredAt)
    const retainedScore = retained ? retained.current * opacityFor(now - retained.occurredAt) : -1
    if (!retained || score > retainedScore) strongestByCell.set(key, event)
  }
  const strongest = [...strongestByCell.values()]
    .sort((a, b) => b.current * opacityFor(now - b.occurredAt) - a.current * opacityFor(now - a.occurredAt))
  take(strongest, Math.min(180, VISIBLE_LIMIT), 1)
  const recent = candidates.sort((a, b) => b.occurredAt - a.occurredAt || b.current - a.current)
  take(recent, VISIBLE_LIMIT, 2)
  if (selected.length < VISIBLE_LIMIT) {
    // Sparse regions may need one extra representative to keep national context.
    for (const event of recent) {
      if (selected.length >= VISIBLE_LIMIT || selectedIds.has(event.id)) continue
    // Roughly 25–40 km cells at China's mid latitudes. Keeping at most two
    // events per cell preserves storm structure without turning it into noise.
      const key = `${Math.floor(event.lng / .38)}:${Math.floor(event.lat / .3)}`
      const count = cells.get(key) ?? 0
      if (count >= 3) continue
      cells.set(key, count + 1)
      selectedIds.add(event.id)
    selected.push(event)
    }
  }
  return selected
}

function featureCollection(events: LightningEvent[], now: number) {
  return {
    type: 'FeatureCollection' as const,
    features: events.flatMap((event) => {
      const ageMs = now - event.occurredAt
      if (ageMs >= MAX_AGE_MS) return []
      return [{
        type: 'Feature' as const,
        id: event.id,
        properties: {
          id: event.id,
          opacity: opacityFor(ageMs),
          ageMinutes: ageMs / 60_000,
          occurredAt: event.occurredAt,
          current: event.current,
          polarity: event.polarity,
          strong: event.level === 'strong',
          fresh: ageMs < 60_000,
        },
        geometry: { type: 'Point' as const, coordinates: [event.lng, event.lat] },
      }]
    }),
  }
}

function createImpactLayer(map: MapLibreMap) {
  type ActiveWave = { lng: number; lat: number; born: number }
  const active: ActiveWave[] = []
  let program: WebGLProgram | null = null
  let buffer: WebGLBuffer | null = null
  let matrixLocation: WebGLUniformLocation | null = null
  let timeLocation: WebGLUniformLocation | null = null
  let viewportLocation: WebGLUniformLocation | null = null
  let positionLocation = -1
  let bornLocation = -1

  const layer: any = {
    id: WAVE,
    type: 'custom',
    renderingMode: '2d',
    onAdd(_map: MapLibreMap, gl: WebGLRenderingContext) {
      const compile = (type: number, source: string) => {
        const shader = gl.createShader(type)!
        gl.shaderSource(shader, source)
        gl.compileShader(shader)
        return shader
      }
      const vertex = compile(gl.VERTEX_SHADER, `
        precision highp float;
        uniform mat4 u_matrix;
        uniform float u_time;
        uniform vec2 u_viewport;
        attribute vec2 a_position;
        attribute float a_born;
        attribute float a_meter;
        varying float v_progress;
        void main() {
          v_progress = clamp((u_time - a_born) / 2600.0, 0.0, 1.0);
          vec4 center = u_matrix * vec4(a_position, 0.0, 1.0);
          vec4 edge = u_matrix * vec4(a_position + vec2(a_meter * 200.0 * v_progress, 0.0), 0.0, 1.0);
          float radiusPx = abs(edge.x / edge.w - center.x / center.w) * u_viewport.x * 0.5;
          gl_Position = center;
          gl_PointSize = clamp(radiusPx * 2.0, 1.0, 96.0);
        }
      `)
      const fragment = compile(gl.FRAGMENT_SHADER, `
        precision mediump float;
        varying float v_progress;
        void main() {
          vec2 p = gl_PointCoord - vec2(0.5);
          float d = length(p);
          float ring = smoothstep(0.49, 0.43, d) * smoothstep(0.36, 0.42, d);
          float flash = (1.0 - smoothstep(0.0, 0.18, v_progress)) * smoothstep(0.2, 0.0, d);
          vec3 hot = mix(vec3(1.0, 0.22, 0.12), vec3(1.0, 0.82, 0.3), v_progress);
          float alpha = (ring * 0.78 + flash * 0.9) * (1.0 - v_progress);
          gl_FragColor = vec4(hot, alpha);
        }
      `)
      program = gl.createProgram()!
      gl.attachShader(program, vertex)
      gl.attachShader(program, fragment)
      gl.linkProgram(program)
      buffer = gl.createBuffer()
      matrixLocation = gl.getUniformLocation(program, 'u_matrix')
      timeLocation = gl.getUniformLocation(program, 'u_time')
      viewportLocation = gl.getUniformLocation(program, 'u_viewport')
      positionLocation = gl.getAttribLocation(program, 'a_position')
      bornLocation = gl.getAttribLocation(program, 'a_born')
    },
    render(gl: WebGLRenderingContext, args: any) {
      if (!program || !buffer) return
      const now = performance.now()
      while (active.length && now - active[0]!.born > 2700) active.shift()
      if (!active.length) return
      const values = new Float32Array(active.length * 4)
      active.forEach((wave, index) => {
        const point = maplibregl.MercatorCoordinate.fromLngLat([wave.lng, wave.lat])
        values[index * 4] = point.x
        values[index * 4 + 1] = point.y
        values[index * 4 + 2] = wave.born
        values[index * 4 + 3] = point.meterInMercatorCoordinateUnits()
      })
      gl.useProgram(program)
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
      gl.bufferData(gl.ARRAY_BUFFER, values, gl.DYNAMIC_DRAW)
      gl.enableVertexAttribArray(positionLocation)
      gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 16, 0)
      gl.enableVertexAttribArray(bornLocation)
      gl.vertexAttribPointer(bornLocation, 1, gl.FLOAT, false, 16, 8)
      const meterLocation = gl.getAttribLocation(program, 'a_meter')
      gl.enableVertexAttribArray(meterLocation)
      gl.vertexAttribPointer(meterLocation, 1, gl.FLOAT, false, 16, 12)
      gl.uniformMatrix4fv(matrixLocation, false, args.defaultProjectionData?.mainMatrix ?? args)
      gl.uniform1f(timeLocation, now)
      gl.uniform2f(viewportLocation, gl.drawingBufferWidth, gl.drawingBufferHeight)
      gl.enable(gl.BLEND)
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE)
      gl.drawArrays(gl.POINTS, 0, active.length)
      map.triggerRepaint()
    },
    onRemove(_map: MapLibreMap, gl: WebGLRenderingContext) {
      if (buffer) gl.deleteBuffer(buffer)
      if (program) gl.deleteProgram(program)
    },
  }

  return {
    layer,
    strike(lng: number, lat: number) {
      active.push({ lng, lat, born: performance.now() })
      map.triggerRepaint()
    },
  }
}

function installLightningSymbol(map: MapLibreMap, onReady?: () => void) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="80" viewBox="0 0 64 80">
    <defs><filter id="g" x="-80%" y="-60%" width="260%" height="240%"><feGaussianBlur stdDeviation="4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
    <path filter="url(#g)" d="M37 4 13 43h17l-5 33 27-44H35z" fill="#fff" stroke="#ffe58f" stroke-width="3" stroke-linejoin="round"/>
  </svg>`
  const image = new Image()
  image.onload = () => {
    if (!map.getSource(SOURCE) || map.getLayer(SYMBOL)) return
    const canvas = document.createElement('canvas')
    canvas.width = 64
    canvas.height = 80
    canvas.getContext('2d')?.drawImage(image, 0, 0)
    const pixels = canvas.getContext('2d')?.getImageData(0, 0, 64, 80)
    if (!pixels) return
    if (!map.hasImage('lightning-bolt-svg')) map.addImage('lightning-bolt-svg', pixels, { pixelRatio: 2 })
    map.addLayer({
      id: SYMBOL, type: 'symbol', source: SOURCE, minzoom: LIGHTNING_SYMBOL_MIN_ZOOM,
      layout: {
        'icon-image': 'lightning-bolt-svg',
        'icon-size': ['interpolate',['linear'],['zoom'],4.6,.18,6.5,.24,10,.33,16,.42],
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
      paint: { 'icon-opacity': ['get','opacity'] },
    })
    onReady?.()
  }
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

function installFlashSymbol(map: MapLibreMap) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="58" viewBox="0 0 48 58">
    <defs><filter id="f" x="-80%" y="-70%" width="260%" height="250%"><feGaussianBlur stdDeviation="3.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
    <path filter="url(#f)" d="M28 2 8 31h14l-4 25 22-34H26z" fill="#ffffff" stroke="#ffe08a" stroke-width="2.2" stroke-linejoin="round"/>
  </svg>`
  const image = new Image()
  image.onload = () => {
    if (!map.getSource(LIVE_SOURCE) || map.getLayer(FLASH_SYMBOL)) return
    const canvas = document.createElement('canvas')
    canvas.width = 48
    canvas.height = 58
    canvas.getContext('2d')?.drawImage(image, 0, 0)
    const pixels = canvas.getContext('2d')?.getImageData(0, 0, 48, 58)
    if (!pixels) return
    if (!map.hasImage('lightning-flash-svg')) map.addImage('lightning-flash-svg', pixels, { pixelRatio: 2 })
    map.addLayer({
      id: FLASH_SYMBOL, type: 'symbol', source: LIVE_SOURCE,
      layout: { 'icon-image':'lightning-flash-svg', 'icon-size':.52, 'icon-allow-overlap':true, 'icon-ignore-placement':true },
      paint: { 'icon-opacity':0 },
    })
  }
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

function createGeographicImpactWaves(map: MapLibreMap) {
  type Wave = { lng: number; lat: number; born: number }
  const active: Wave[] = []
  let frame = 0
  map.addSource(IMPACT_SOURCE, { type:'geojson', lineMetrics:true, data:{ type:'FeatureCollection', features:[] } })
  map.addLayer({
    id:IMPACT_GLOW, type:'line', source:IMPACT_SOURCE,
    paint:{
      'line-color':['interpolate',['linear'],['get','progress'],0,'#ff3b30',.48,'#ff8f24',1,'#ffd45d'],
      'line-width':['interpolate',['linear'],['zoom'],8,3,12,5,16,7],
      'line-blur':['interpolate',['linear'],['zoom'],8,2,16,4],
      'line-opacity':['*',['get','opacity'],.62],
    },
  })
  map.addLayer({
    id:IMPACT_CORE, type:'line', source:IMPACT_SOURCE,
    filter:['==',['get','band'],'front'],
    paint:{
      'line-color':['interpolate',['linear'],['get','progress'],0,'#fff2dc',.42,'#ffc55c',1,'#ffe69a'],
      'line-width':['interpolate',['linear'],['zoom'],8,.8,12,1.25,16,1.7],
      'line-opacity':['get','opacity'],
    },
  })
  map.addLayer({
    id:IMPACT_ECHO, type:'line', source:IMPACT_SOURCE,
    filter:['==',['get','band'],'echo'],
    paint:{
      'line-color':'#ffb33f',
      'line-width':['interpolate',['linear'],['zoom'],8,.7,12,1.1,16,1.5],
      'line-blur':.35,
      'line-opacity':['*',['get','opacity'],.52],
    },
  })
  map.addLayer({
    id:IMPACT_ARCS, type:'line', source:IMPACT_SOURCE,
    filter:['==',['get','band'],'arc'],
    paint:{
      'line-color':'#fff0b0',
      'line-width':['interpolate',['linear'],['zoom'],8,1,12,1.55,16,2.1],
      'line-dasharray':[.35,1.45],
      'line-blur':.2,
      'line-opacity':['*',['get','opacity'],.78],
    },
  })
  const draw = (now: number) => {
    const features: any[] = []
    for (let index = active.length - 1; index >= 0; index -= 1) {
      const wave = active[index]!
      const progress = (now - wave.born) / 10_000
      if (progress >= 1) { active.splice(index, 1); continue }
      const frontRadius = 200 * (1 - Math.pow(1 - progress, 1.18))
      const opacity = Math.pow(1 - progress, .82)
      const ring = (radius: number) => {
        const latRadius = radius / 111_320
        const lngRadius = radius / (111_320 * Math.cos(wave.lat * Math.PI / 180))
        return Array.from({ length:65 }, (_, step) => {
          const angle = step / 64 * Math.PI * 2
          return [wave.lng + Math.cos(angle) * lngRadius, wave.lat + Math.sin(angle) * latRadius]
        })
      }
      features.push({ type:'Feature', properties:{ band:'front', progress, opacity }, geometry:{ type:'LineString', coordinates:ring(frontRadius) } })
      features.push({ type:'Feature', properties:{ band:'echo', progress, opacity }, geometry:{ type:'LineString', coordinates:ring(frontRadius * .78) } })
      features.push({ type:'Feature', properties:{ band:'arc', progress, opacity }, geometry:{ type:'LineString', coordinates:ring(frontRadius * .91) } })
    }
    ;(map.getSource(IMPACT_SOURCE) as GeoJSONSource | undefined)?.setData({ type:'FeatureCollection', features } as any)
    if (active.length) frame = requestAnimationFrame(draw)
  }
  return {
    strike(lng: number, lat: number) {
      active.push({ lng, lat, born:performance.now() })
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(draw)
    },
    dispose() { cancelAnimationFrame(frame) },
  }
}

export type LightningController = {
  dispose: () => void
  setTime: (timelineIndex: number) => void
  setVisible: (visible: boolean) => void
  setDisplayMode: (mode: 'points' | 'heatmap' | 'hidden') => void
  setHeatmapAnalysis: (mode: 'strength' | 'density') => void
}

export function addLightningLayers(map: MapLibreMap): LightningController {
  let timelineIndex = 180
  let displayMode: 'points' | 'heatmap' | 'hidden' = 'points'
  let analysisMode: 'strength' | 'density' = 'strength'
  let events = createEvents(Date.now(), timelineIndex)
  let visibleEvents = selectVisibleEvents(events, Date.now())
  map.addSource(SOURCE, { type: 'geojson', data: featureCollection(visibleEvents, Date.now()) })
  // Analysis keeps the full 12k-event mock dataset. The ordinary lightning
  // view stays spatially thinned, while both heatmaps retain real density.
  map.addSource(HEATMAP_SOURCE, { type: 'geojson', data: featureCollection(events, Date.now()) })
  const heatCanvas = document.createElement('canvas')
  heatCanvas.width = 1536
  heatCanvas.height = 892
  const heatContext = heatCanvas.getContext('2d', { alpha: true, willReadFrequently: true })!
  const heatStamp = document.createElement('canvas')
  heatStamp.width = 72
  heatStamp.height = 72
  const stampContext = heatStamp.getContext('2d')!
  const stampGradient = stampContext.createRadialGradient(36, 36, 0, 36, 36, 36)
  stampGradient.addColorStop(0, 'rgba(255,255,255,1)')
  stampGradient.addColorStop(.3, 'rgba(255,255,255,.78)')
  stampGradient.addColorStop(.68, 'rgba(255,255,255,.24)')
  stampGradient.addColorStop(1, 'rgba(255,255,255,0)')
  stampContext.fillStyle = stampGradient
  stampContext.fillRect(0, 0, 72, 72)
  map.addSource(HEAT_CANVAS_SOURCE, {
    type: 'canvas', canvas: heatCanvas,
    coordinates: [[73, 54], [135, 54], [135, 18], [73, 18]],
    animate: false,
  })
  map.addLayer({
    id: HEAT_CANVAS_LAYER, type: 'raster', source: HEAT_CANVAS_SOURCE,
    layout: { visibility: 'none' },
    paint: { 'raster-opacity': .82, 'raster-fade-duration': 0, 'raster-resampling': 'linear' },
  })

  const colorStops: Array<[number, [number, number, number]]> = [
    [0, [37, 93, 190]], [.2, [34, 150, 210]], [.4, [31, 194, 159]],
    [.57, [87, 218, 92]], [.72, [244, 220, 57]], [.86, [255, 132, 35]], [1, [229, 42, 56]],
  ]
  const colorAt = (value: number) => {
    let upper = 1
    while (upper < colorStops.length && value > colorStops[upper]![0]) upper += 1
    const left = colorStops[Math.max(0, upper - 1)]!
    const right = colorStops[Math.min(colorStops.length - 1, upper)]!
    const mix = right[0] === left[0] ? 0 : (value - left[0]) / (right[0] - left[0])
    return left[1].map((channel, index) => Math.round(channel + (right[1][index]! - channel) * mix))
  }
  const renderPersistentHeat = (mode: 'strength' | 'density') => {
    heatContext.clearRect(0, 0, heatCanvas.width, heatCanvas.height)
    heatContext.globalCompositeOperation = 'lighter'
    const now = Date.now()
    // Strength answers “how strong is this visible strike”, therefore it must
    // use exactly the same retained events as the bolt symbol layer. Density
    // answers “how many strikes occurred here” and intentionally uses all
    // events. This prevents red strength areas with no corresponding bolt.
    const heatEvents = mode === 'strength' ? visibleEvents : events
    for (const event of heatEvents) {
      const ageOpacity = opacityFor(now - event.occurredAt)
      if (ageOpacity <= 0) continue
      const mercatorY = (latitude: number) => {
        const radians = Math.max(-85, Math.min(85, latitude)) * Math.PI / 180
        return (1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) / 2
      }
      const northY = mercatorY(54)
      const southY = mercatorY(18)
      const x = (event.lng - 73) / 62 * heatCanvas.width
      const y = (mercatorY(event.lat) - northY) / (southY - northY) * heatCanvas.height
      const energy = Math.min(1, event.current / 110)
      heatContext.globalAlpha = ageOpacity * (mode === 'density' ? .006 : .002 + energy * .009)
      // Small anisotropic kernels let the real event distribution define the
      // storm shape. Large square stamps produced artificial circular blobs.
      const width = mode === 'density' ? 24 : 17 + energy * 11
      const height = mode === 'density' ? 14 : 10 + energy * 7
      heatContext.drawImage(heatStamp, x - width / 2, y - height / 2, width, height)
    }
    heatContext.globalCompositeOperation = 'source-over'
    heatContext.globalAlpha = 1
    const image = heatContext.getImageData(0, 0, heatCanvas.width, heatCanvas.height)
    const pixels = image.data
    // The geographic kernels are deliberately small. Normalise against the
    // strongest pixel in the current frame so reducing their footprint does
    // not also remove the orange/red core from the colour ramp.
    let peakDensity = 0
    const densityHistogram = new Uint32Array(256)
    let activePixelCount = 0
    for (let index = 3; index < pixels.length; index += 4) {
      const alpha = pixels[index]!
      peakDensity = Math.max(peakDensity, alpha / 255)
      if (alpha > 0) {
        densityHistogram[alpha] = (densityHistogram[alpha] ?? 0) + 1
        activePixelCount += 1
      }
    }
    // A single exceptionally dense pixel must not flatten the colour scale of
    // the rest of China. Use the 98.8th percentile of active heat pixels as
    // the red endpoint; denser values simply remain red.
    const percentileTarget = activePixelCount * .988
    let accumulated = 0
    let scaleDensity = peakDensity
    for (let alpha = 0; alpha < densityHistogram.length; alpha += 1) {
      accumulated += densityHistogram[alpha]!
      if (accumulated >= percentileTarget) {
        scaleDensity = Math.max(.001, alpha / 255)
        break
      }
    }
    const visibleFloor = scaleDensity * .018
    for (let index = 0; index < pixels.length; index += 4) {
      const density = pixels[index + 3]! / 255
      if (density < Math.max(.003, visibleFloor)) { pixels[index + 3] = 0; continue }
      const normalized = Math.min(1, Math.pow(density / scaleDensity, .64))
      const [red, green, blue] = colorAt(normalized)
      pixels[index] = red!; pixels[index + 1] = green!; pixels[index + 2] = blue!
      pixels[index + 3] = Math.round(Math.min(.94, .12 + normalized * .84) * 255)
    }
    heatContext.putImageData(image, 0, 0)
    const source = map.getSource(HEAT_CANVAS_SOURCE) as CanvasSource | undefined
    source?.play(); map.triggerRepaint()
    requestAnimationFrame(() => source?.pause())
  }
  renderPersistentHeat(analysisMode)
  map.addLayer({
    id: STRENGTH_HEATMAP,
    type: 'heatmap',
    source: HEATMAP_SOURCE,
    layout: { visibility: 'none' },
    paint: {
      // Full event data is deliberately retained, but each strike contributes
      // only a small amount. This prevents dense cells from saturating into a
      // solid red polygon while still allowing unusually strong strikes to lead.
      'heatmap-weight': ['*', ['get', 'opacity'], ['interpolate', ['linear'], ['get', 'current'], 8, .008, 30, .022, 60, .065, 100, .16, 180, .28]],
      'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 2, .34, 7, .72, 12, 1.65, 16, 3.4, 20, 6.5],
      'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 2, 8, 7, 18, 12, 36, 18, 68],
      'heatmap-opacity': .78,
      'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'],
        0, 'rgba(30,82,180,0)',
        .006, 'rgba(40,105,205,.08)',
        .035, 'rgba(42,118,214,.2)',
        .08, 'rgba(40,105,205,.3)',
        .2, 'rgba(42,127,216,.3)',
        .36, 'rgba(25,184,190,.48)',
        .52, 'rgba(55,211,112,.62)',
        .68, 'rgba(246,219,61,.76)',
        .83, 'rgba(255,137,39,.88)',
        .95, 'rgba(241,55,57,.95)',
        1, 'rgba(188,28,51,.98)',
      ],
    },
  } as any)
  map.addLayer({
    id: DENSITY_HEATMAP,
    type: 'heatmap',
    source: HEATMAP_SOURCE,
    layout: { visibility: 'none' },
    paint: {
      'heatmap-weight': ['*', .035, ['get', 'opacity']],
      'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 2, .32, 7, .72, 12, 1.6, 16, 3.2, 20, 6.2],
      'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 2, 15, 7, 30, 12, 55, 18, 92],
      'heatmap-opacity': 0,
      'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'],
        0, 'rgba(27,80,169,0)',
        .005, 'rgba(34,104,201,.08)',
        .03, 'rgba(36,119,211,.2)',
        .07, 'rgba(34,104,201,.3)',
        .18, 'rgba(38,132,215,.26)',
        .32, 'rgba(24,182,191,.44)',
        .47, 'rgba(50,207,119,.58)',
        .63, 'rgba(115,220,79,.67)',
        .76, 'rgba(246,219,61,.78)',
        .87, 'rgba(255,137,39,.88)',
        .96, 'rgba(239,51,58,.95)',
        1, 'rgba(184,26,48,.98)',
      ],
    },
  } as any)
  // Heatmap kernels are screen-space textures. At detailed zooms, retain a
  // soft per-event field underneath the bolt symbols so analysis never appears
  // to switch off when neighbouring events spread apart geographically.
  map.addLayer({
    id: STRENGTH_DETAIL, type: 'circle', source: SOURCE, minzoom: 6.5,
    layout: { visibility: 'none' },
    paint: {
      // Strength analysis is event based, not density based. This halo uses
      // the exact same GeoJSON coordinate as the clickable bolt, so a 100+kA
      // strike always owns a compact red core directly beneath its symbol.
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 6.5, 7, 10, 11, 14, 17, 18, 23],
      'circle-color': ['interpolate', ['linear'], ['get', 'current'],
        8, '#348be8', 30, '#20b9c1', 50, '#35cb78', 70, '#f0d846',
        90, '#ff8b2d', 110, '#f04443', 160, '#bd1738'],
      'circle-opacity': ['*', ['get', 'opacity'], ['interpolate', ['linear'], ['get', 'current'],
        8, .16, 50, .28, 90, .5, 110, .7, 160, .86]],
      'circle-blur': .62,
    },
  })
  map.addLayer({
    id: DENSITY_DETAIL, type: 'circle', source: SOURCE, minzoom: 6.5,
    layout: { visibility: 'none' },
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 6.5, 12, 12, 27, 18, 54],
      'circle-color': '#39c99b',
      'circle-opacity': ['*', ['get', 'opacity'], .22],
      'circle-blur': .92,
    },
  })
  map.addLayer({
    id: HALO, type: 'circle', source: SOURCE, maxzoom: LIGHTNING_SYMBOL_MIN_ZOOM,
    paint: {
      'circle-radius': ['interpolate',['linear'],['zoom'],2,1.2,6,4.8,10,8],
      'circle-color': ['case',['get','strong'],'#FFB238','#FFE48A'],
      'circle-blur': .78,
      'circle-opacity': ['*',['get','opacity'],['case',['get','fresh'],.5,.2]],
    },
  })
  map.addLayer({
    id: CORE, type: 'circle', source: SOURCE, maxzoom: LIGHTNING_SYMBOL_MIN_ZOOM,
    paint: {
      'circle-radius': ['interpolate',['linear'],['zoom'],2,.35,6,1.25,10,2.1],
      'circle-color': ['case',['get','strong'],'#FFF4C2','#FFF9E8'],
      'circle-stroke-color': ['case',['get','strong'],'#FF9E2C','#FFD766'],
      'circle-stroke-width': ['interpolate',['linear'],['zoom'],2,.2,8,.75],
      'circle-opacity': ['get','opacity'],
    },
  })
  map.addLayer({
    id: SYMBOL_HIT, type: 'circle', source: SOURCE, minzoom: LIGHTNING_SYMBOL_MIN_ZOOM,
    layout: { visibility: 'visible' },
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 4.6, 10, 8, 14, 14, 18],
      'circle-color': '#ffffff',
      'circle-opacity': .01,
    },
  })
  map.addSource(MINE_LINK_SOURCE, { type:'geojson', lineMetrics:true, data:{ type:'FeatureCollection', features:[] } })
  map.addLayer({ id:MINE_LINK_GLOW, type:'line', source:MINE_LINK_SOURCE, layout:{ 'line-cap':'round', 'line-join':'round' }, paint:{
    'line-color':'#55d9ff', 'line-width':7, 'line-opacity':.2, 'line-blur':5,
  } })
  map.addLayer({ id:MINE_LINK_CORE, type:'line', source:MINE_LINK_SOURCE, layout:{ 'line-cap':'round', 'line-join':'round' }, paint:{
    'line-gradient':['interpolate',['linear'],['line-progress'],0,'#72f0df',.38,'#75d8ff',.78,'#ff9b63',1,'#ffd166'],
    'line-width':1.35, 'line-opacity':.88, 'line-dasharray':[2,2.6],
  } })
  map.addSource(MINE_LINK_TRACER_SOURCE, { type:'geojson', data:{ type:'FeatureCollection', features:[] } })
  map.addLayer({ id:MINE_LINK_TRACER_GLOW, type:'circle', source:MINE_LINK_TRACER_SOURCE, paint:{
    'circle-radius':10, 'circle-color':'#75e7ff', 'circle-opacity':.2, 'circle-blur':.82,
  } })
  map.addLayer({ id:MINE_LINK_TRACER_CORE, type:'circle', source:MINE_LINK_TRACER_SOURCE, paint:{
    'circle-radius':2.4, 'circle-color':'#f3fdff', 'circle-stroke-color':'#5de0ff', 'circle-stroke-width':1.1,
    'circle-opacity':.96,
  } })
  let detailPopup: maplibregl.Popup | undefined
  let symbolInteractionsInstalled = false
  let openingDetail = false
  let triggerSelectionEffect = (_lng: number, _lat: number) => undefined
  let selectionEffectTimer = 0
  let mineLinkAnimation = 0
  const startMineLinkAnimation = (from: [number, number], to: [number, number]) => {
    cancelAnimationFrame(mineLinkAnimation)
    const startedAt = performance.now()
    const duration = 2100
    const animate = (time: number) => {
      const cycle = ((time - startedAt) % duration) / duration
      // Reserve the final 18% for a subtle pause at the mine, then restart.
      const raw = Math.min(1, cycle / .82)
      const progress = raw < .5 ? 2 * raw * raw : 1 - Math.pow(-2 * raw + 2, 2) / 2
      const coordinate:[number, number] = [
        from[0] + (to[0] - from[0]) * progress,
        from[1] + (to[1] - from[1]) * progress,
      ]
      ;(map.getSource(MINE_LINK_TRACER_SOURCE) as GeoJSONSource | undefined)?.setData({
        type:'FeatureCollection', features:[{ type:'Feature', properties:{}, geometry:{ type:'Point', coordinates:coordinate } }],
      } as any)
      mineLinkAnimation = requestAnimationFrame(animate)
    }
    mineLinkAnimation = requestAnimationFrame(animate)
  }
  const distanceKm = (from: [number, number], to: [number, number]) => {
    const radians = (value: number) => value * Math.PI / 180
    const dLat = radians(to[1] - from[1])
    const dLng = radians(to[0] - from[0])
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(radians(from[1])) * Math.cos(radians(to[1])) * Math.sin(dLng / 2) ** 2
    return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  }
  const clearMineLink = () => {
    cancelAnimationFrame(mineLinkAnimation)
    mineLinkAnimation = 0
    ;(map.getSource(MINE_LINK_SOURCE) as GeoJSONSource | undefined)?.setData({ type:'FeatureCollection', features:[] })
    ;(map.getSource(MINE_LINK_TRACER_SOURCE) as GeoJSONSource | undefined)?.setData({ type:'FeatureCollection', features:[] })
  }
  const openLightningDetail = (event: any) => {
    const feature = event.features?.[0]
    if (!feature) return
    event.preventDefault?.()
    openingDetail = true
    queueMicrotask(() => { openingDetail = false })
    const properties = feature.properties ?? {}
    const coordinates = feature.geometry.coordinates.slice() as [number, number]
    const current = Math.round(Number(properties.current) || 0)
    const ageMinutes = Math.max(0, Number(properties.ageMinutes) || 0)
    const positive = properties.polarity === 'positive'
    const strong = properties.strong === true || properties.strong === 'true'
    const nearestMine = MINE_AREAS
      .map((mine) => ({ mine, distance:distanceKm(coordinates, mine.center) }))
      .sort((left, right) => left.distance - right.distance)[0]!
    const nearbyEvents = events
      .map((item) => ({ item, distance:distanceKm(coordinates, [item.lng, item.lat]) }))
      .filter(({ item, distance }) => Date.now() - item.occurredAt <= MAX_AGE_MS && distance <= 20)
    const nearbyCount = nearbyEvents.length
    const nearbyMax = nearbyEvents.reduce((maximum, { item }) => Math.max(maximum, item.current), current)
    const averageInterval = nearbyCount > 1 ? Math.round(30 * 60 / nearbyCount) : 0
    const distributionRadius = nearbyEvents.reduce((maximum, item) => Math.max(maximum, item.distance), 0)
    const occurredAt = new Date(Number(properties.occurredAt) || Date.now())
    const eventTime = occurredAt.toLocaleTimeString('zh-CN', { hour12:false, hour:'2-digit', minute:'2-digit', second:'2-digit' })
    const levelText = strong ? '强雷击' : current >= 45 ? '一般雷击' : '弱雷击'
    const levelClass = strong ? 'is-danger' : current >= 45 ? 'is-warning' : 'is-safe'
    const gaugeProgress = Math.min(100, Math.round(current / 180 * 100))
    triggerSelectionEffect(coordinates[0], coordinates[1])
    ;(map.getSource(MINE_LINK_SOURCE) as GeoJSONSource | undefined)?.setData({ type:'FeatureCollection', features:[{
      type:'Feature', properties:{}, geometry:{ type:'LineString', coordinates:[nearestMine.mine.center, coordinates] },
    }] } as any)
    startMineLinkAnimation(nearestMine.mine.center, coordinates)
    detailPopup?.remove()
    // Place the panel on the opposite side of the mine-link so neither the
    // selected strike nor the route is hidden underneath the card.
    const popupAnchor = nearestMine.mine.center[0] < coordinates[0] ? 'left' : 'right'
    detailPopup = new maplibregl.Popup({ closeButton:true, closeOnClick:false, anchor:popupAnchor, offset:30, className:'lightning-detail-popup', maxWidth:'410px' })
      .setLngLat(coordinates)
      .setHTML(`<article class="lightning-detail">
        <header><i>ϟ</i><span><strong>雷电事件详情</strong><small>事件编号&nbsp; ${String(properties.id ?? feature.id ?? '—')}</small></span><em class="${levelClass}">${levelText}</em></header>
        <section class="lightning-detail__overview">
          <div class="lightning-gauge" style="--gauge:${gaugeProgress * 3.6}deg;--gauge-color:${strong ? '#ff5361' : current >= 45 ? '#ffc34d' : '#42d6b0'}"><i>ϟ</i><b>${current}</b><em>kA</em><small>雷电流强度</small></div>
          <dl>
            <div><dt>⌁ 极性</dt><dd>${positive ? '正极性' : '负极性'}</dd></div>
            <div><dt>☁ 类型</dt><dd>云地闪</dd></div>
            <div><dt>◷ 发生时间</dt><dd>${eventTime}<small>${ageMinutes < 1 ? '刚刚发生' : `${Math.round(ageMinutes)}分钟前`}</small></dd></div>
            <div><dt>⌖ 经纬度</dt><dd>${coordinates[0].toFixed(3)}°E · ${coordinates[1].toFixed(3)}°N</dd></div>
          </dl>
        </section>
        <section class="lightning-detail__location"><header><strong>⌖ 雷击位置</strong><button type="button" data-action="locate">◎ 地图定位</button></header><p>${coordinates[0].toFixed(3)}°E&nbsp;&nbsp;${coordinates[1].toFixed(3)}°N</p></section>
        <section class="lightning-detail__impact" data-action="mine"><header><strong>▦ 矿区影响分析</strong><small>点击查看矿区范围</small></header><div class="lightning-detail__impact-body"><span><small>影响对象</small><b>${nearestMine.mine.name}</b><small>直线距离</small><strong>${nearestMine.distance.toFixed(1)} km</strong></span><figure><i>▦</i><em>${nearestMine.distance.toFixed(1)} km</em><b>ϟ</b><small>${nearestMine.mine.name}</small><small>雷击点</small></figure></div><footer><i></i><em>已在地图绘制矿区至雷击点连线</em></footer></section>
        <section class="lightning-detail__stats"><header><strong>♨ 周边雷电统计</strong><small>30分钟内 · 20 km</small></header><div><span><b>${nearbyCount}</b><em>次</em><small>雷击次数</small></span><span><b>${nearbyMax}</b><em>kA</em><small>最大强度</small></span><span><b>${averageInterval || '—'}</b><em>${averageInterval ? '秒' : ''}</em><small>平均间隔</small></span><span><b>${distributionRadius.toFixed(1)}</b><em>km</em><small>分布半径</small></span></div></section>
      </article>`)
      .addTo(map)
    detailPopup.on('close', clearMineLink)
    detailPopup.getElement().querySelector<HTMLElement>('[data-action="locate"]')?.addEventListener('click', () => {
      map.easeTo({ center:coordinates, zoom:Math.max(map.getZoom(), 8), duration:700 })
    })
    detailPopup.getElement().querySelector<HTMLElement>('[data-action="mine"]')?.addEventListener('click', () => {
      const bounds = new maplibregl.LngLatBounds()
      nearestMine.mine.boundary.coordinates[0]?.forEach((coordinate) => bounds.extend(coordinate as [number, number]))
      if (!bounds.isEmpty()) map.fitBounds(bounds, { padding:{ top:120, right:120, bottom:120, left:120 }, maxZoom:8.3, duration:760 })
    })
  }
  const enterLightning = () => { map.getCanvas().style.cursor = 'pointer' }
  const leaveLightning = () => { map.getCanvas().style.cursor = '' }
  const closeLightningDetail = (event: any) => {
    if (openingDetail || event.defaultPrevented) return
    detailPopup?.remove()
    detailPopup = undefined
    clearMineLink()
  }
  installLightningSymbol(map, () => {
    symbolInteractionsInstalled = true
    map.setLayoutProperty(SYMBOL, 'visibility', displayMode === 'hidden' ? 'none' : 'visible')
    map.on('click', SYMBOL_HIT, openLightningDetail)
    map.on('mouseenter', SYMBOL_HIT, enterLightning)
    map.on('mouseleave', SYMBOL_HIT, leaveLightning)
    map.on('click', closeLightningDetail)
  })

  map.addSource(LIVE_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
  map.addLayer({
    id: FLASH_CONTRAST, type: 'circle', source: LIVE_SOURCE,
    paint: {
      'circle-radius': 12,
      'circle-color': '#071A18',
      'circle-blur': .66,
      'circle-opacity': 0,
    },
  })
  map.addLayer({
    id: FLASH_GLOW, type: 'circle', source: LIVE_SOURCE,
    paint: {
      'circle-radius': 7,
      'circle-color': '#FFF2A8',
      'circle-blur': .72,
      'circle-opacity': 0,
      'circle-pitch-alignment': 'map',
    },
  })
  map.addLayer({
    id: FLASH_CORE, type: 'circle', source: LIVE_SOURCE,
    paint: {
      'circle-radius': 2.5,
      'circle-color': '#FFFFFF',
      'circle-stroke-color': '#FFD04A',
      'circle-stroke-width': 1.5,
      'circle-opacity': 0,
      'circle-stroke-opacity': 0,
    },
  })
  map.addLayer({
    id:ACTIVE_LOCATOR, type:'circle', source:LIVE_SOURCE,
    paint:{
      'circle-radius':7,
      'circle-color':'#FFE8A3',
      'circle-opacity':0,
      'circle-stroke-color':'rgba(255,255,255,0)',
      'circle-stroke-width':0,
      'circle-stroke-opacity':0,
      'circle-blur':.74,
    },
  })
  installFlashSymbol(map)

  const impacts = createGeographicImpactWaves(map)
  map.moveLayer(FLASH_CONTRAST)
  map.moveLayer(FLASH_GLOW)
  map.moveLayer(FLASH_CORE)
  map.moveLayer(ACTIVE_LOCATOR)
  let demoTargets = visibleEvents.filter((event) => event.level === 'strong').slice(0, 96)
  let cursor = 0
  let flashFrame = 0
  let breathFrame = 0
  let lastBreathPaint = 0
  const playFlash = (lng: number, lat: number) => {
    ;(map.getSource(LIVE_SOURCE) as GeoJSONSource | undefined)?.setData({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [lng, lat] } }],
    } as any)
    cancelAnimationFrame(flashFrame)
    const started = performance.now()
    const animateFlash = (now: number) => {
      // Some browsers can deliver an rAF timestamp a fraction earlier than a
      // same-turn performance.now(); clamp it so MapLibre never receives
      // negative radii or opacity values above 1.
      const elapsed = Math.max(0, now - started)
      const progress = Math.min(1, elapsed / 1100)
      const active = Math.min(1, elapsed / 10_000)
      const activePulse = (Math.sin(elapsed / 240) + 1) / 2
      const ignitionRaw = progress < .18
        ? progress / .18
        : progress < .34
          ? 1 - ((progress - .18) / .16) * .68
          : progress < .5
            ? .32 + ((progress - .34) / .16) * .5
            : .82 * (1 - (progress - .5) / .5)
      const ignition = Math.max(0, Math.min(1, ignitionRaw))
      if (map.getLayer(FLASH_GLOW)) {
        map.setPaintProperty(FLASH_CONTRAST, 'circle-radius', 18 + progress * 55)
        map.setPaintProperty(FLASH_CONTRAST, 'circle-opacity', ignition * .46)
        map.setPaintProperty(FLASH_GLOW, 'circle-radius', 14 + progress * 50)
        map.setPaintProperty(FLASH_GLOW, 'circle-opacity', ignition * .96)
        map.setPaintProperty(FLASH_CORE, 'circle-radius', 4 + ignition * 8)
        map.setPaintProperty(FLASH_CORE, 'circle-opacity', 1 - progress)
        map.setPaintProperty(FLASH_CORE, 'circle-stroke-opacity', ignition)
        map.setPaintProperty(ACTIVE_LOCATOR, 'circle-radius', 6.5 + activePulse * 2)
        map.setPaintProperty(ACTIVE_LOCATOR, 'circle-opacity', active < 1 ? .22 + activePulse * .12 : 0)
        if (map.getLayer(FLASH_SYMBOL)) {
          const persistentOpacity = active < 1 ? .88 + activePulse * .12 : 0
          map.setPaintProperty(FLASH_SYMBOL, 'icon-opacity', progress < 1 ? Math.max(persistentOpacity, Math.min(1, ignition * 1.25)) : persistentOpacity)
          map.setLayoutProperty(FLASH_SYMBOL, 'icon-size', progress < 1 ? .58 + ignition * .28 : .5 + activePulse * .025)
        }
      }
      if (active < 1) flashFrame = requestAnimationFrame(animateFlash)
    }
    flashFrame = requestAnimationFrame(animateFlash)
  }
  triggerSelectionEffect = (lng, lat) => {
    window.clearTimeout(selectionEffectTimer)
    const effectLayers = [FLASH_CONTRAST, FLASH_GLOW, FLASH_CORE, FLASH_SYMBOL, ACTIVE_LOCATOR, IMPACT_GLOW, IMPACT_CORE, IMPACT_ECHO, IMPACT_ARCS]
    effectLayers.forEach((id) => map.getLayer(id) && map.setLayoutProperty(id, 'visibility', 'visible'))
    playFlash(lng, lat)
    impacts.strike(lng, lat)
    selectionEffectTimer = window.setTimeout(() => {
      if (displayMode === 'heatmap') effectLayers.forEach((id) => map.getLayer(id) && map.setLayoutProperty(id, 'visibility', 'none'))
    }, 10_000)
  }
  const emitImpact = () => {
    const event = demoTargets[cursor++ % demoTargets.length]
    if (!event) return
    playFlash(event.lng, event.lat)
    impacts.strike(event.lng, event.lat)
  }
  const animateBreathing = (now: number) => {
    if (now - lastBreathPaint > 40 && map.getLayer(HALO)) {
      lastBreathPaint = now
      const wave = (Math.sin(now / 290) + 1) / 2
      map.setPaintProperty(HALO, 'circle-opacity', ['*',['get','opacity'],['case',['get','fresh'],.34 + wave * .24,.13 + wave * .1]])
      map.setPaintProperty(CORE, 'circle-opacity', ['*',['get','opacity'],.72 + wave * .28])
      if (map.getLayer(SYMBOL)) map.setPaintProperty(SYMBOL, 'icon-opacity', ['*',['get','opacity'],.82 + wave * .18])
    }
    breathFrame = requestAnimationFrame(animateBreathing)
  }
  breathFrame = requestAnimationFrame(animateBreathing)

  let demoEnabled = true
  let demoTimer = 0
  const scheduleDemo = () => {
    window.clearTimeout(demoTimer)
    if (!demoEnabled) return
    demoTimer = window.setTimeout(() => {
      emitImpact()
      scheduleDemo()
    }, 5000 + random() * 5000)
  }
  const controlElement = document.createElement('div')
  controlElement.className = 'maplibregl-ctrl lightning-demo-control'
  const controlButton = document.createElement('button')
  controlButton.type = 'button'
  controlButton.className = 'lightning-demo-control__button is-active'
  controlButton.innerHTML = '<i></i><span>雷电演示</span><em>ON</em>'
  controlButton.title = '开启或暂停强雷击演示'
  controlButton.addEventListener('click', () => {
    demoEnabled = !demoEnabled
    controlButton.classList.toggle('is-active', demoEnabled)
    controlButton.querySelector('em')!.textContent = demoEnabled ? 'ON' : 'OFF'
    if (demoEnabled) emitImpact()
    scheduleDemo()
  })
  controlElement.append(controlButton)
  const demoControl: any = {
    onAdd: () => controlElement,
    onRemove: () => controlElement.remove(),
  }
  map.addControl(demoControl, 'top-right')
  emitImpact()
  scheduleDemo()
  const ageTimer = window.setInterval(() => {
    ;(map.getSource(SOURCE) as GeoJSONSource | undefined)?.setData(featureCollection(visibleEvents, Date.now()) as any)
    ;(map.getSource(HEATMAP_SOURCE) as GeoJSONSource | undefined)?.setData(featureCollection(events, Date.now()) as any)
  }, 15_000)

  const pointLayers = [HALO, CORE, SYMBOL, SYMBOL_HIT, FLASH_CONTRAST, FLASH_GLOW, FLASH_CORE, ACTIVE_LOCATOR, IMPACT_GLOW, IMPACT_CORE, IMPACT_ECHO, IMPACT_ARCS]
  const applyHeatmapAnalysis = (mode: 'strength' | 'density') => {
    analysisMode = mode
    if (displayMode !== 'heatmap') return
    renderPersistentHeat(mode)
    // Native heatmap layers remain available as a data/debug fallback, while
    // the visible product uses a geographic canvas field that never changes
    // its footprint or density merely because the camera zoom changed.
    map.setPaintProperty(STRENGTH_HEATMAP, 'heatmap-opacity', 0)
    map.setPaintProperty(DENSITY_HEATMAP, 'heatmap-opacity', 0)
    if (map.getLayer(STRENGTH_DETAIL)) map.setLayoutProperty(STRENGTH_DETAIL, 'visibility', mode === 'strength' ? 'visible' : 'none')
    if (map.getLayer(DENSITY_DETAIL)) map.setLayoutProperty(DENSITY_DETAIL, 'visibility', mode === 'density' ? 'visible' : 'none')
  }
  const applyDisplayMode = (mode: 'points' | 'heatmap' | 'hidden') => {
    displayMode = mode
    pointLayers.forEach((id) => {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', mode === 'points' ? 'visible' : 'none')
    })
    // At province scale SYMBOL's minzoom reveals clickable lightning events on
    // top of the still-visible heat field. The heatmap never gets replaced.
    if (map.getLayer(SYMBOL)) map.setLayoutProperty(SYMBOL, 'visibility', mode === 'hidden' ? 'none' : 'visible')
    if (map.getLayer(SYMBOL_HIT)) map.setLayoutProperty(SYMBOL_HIT, 'visibility', mode === 'hidden' ? 'none' : 'visible')
    if (map.getLayer(HEAT_CANVAS_LAYER)) map.setLayoutProperty(HEAT_CANVAS_LAYER, 'visibility', mode === 'heatmap' ? 'visible' : 'none')
    ;[STRENGTH_HEATMAP, DENSITY_HEATMAP].forEach((id) => {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', mode === 'heatmap' ? 'visible' : 'none')
    })
    if (mode !== 'heatmap') {
      ;[STRENGTH_DETAIL, DENSITY_DETAIL].forEach((id) => map.getLayer(id) && map.setLayoutProperty(id, 'visibility', 'none'))
    }
    if (mode === 'heatmap') applyHeatmapAnalysis(analysisMode)
  }
  return {
    dispose: () => {
      cancelAnimationFrame(flashFrame)
      cancelAnimationFrame(breathFrame)
      cancelAnimationFrame(mineLinkAnimation)
      impacts.dispose()
      window.clearTimeout(demoTimer)
      window.clearTimeout(selectionEffectTimer)
      window.clearInterval(ageTimer)
      detailPopup?.remove()
      if (symbolInteractionsInstalled) {
        map.off('click', SYMBOL_HIT, openLightningDetail)
        map.off('mouseenter', SYMBOL_HIT, enterLightning)
        map.off('mouseleave', SYMBOL_HIT, leaveLightning)
        map.off('click', closeLightningDetail)
      }
      if (map.hasControl(demoControl)) map.removeControl(demoControl)
    },
    setTime: (nextIndex) => {
      if (nextIndex === timelineIndex) return
      timelineIndex = nextIndex
      events = createEvents(Date.now(), timelineIndex)
      visibleEvents = selectVisibleEvents(events, Date.now())
      demoTargets = visibleEvents.filter((event) => event.level === 'strong').slice(0, 96)
      cursor = 0
      ;(map.getSource(SOURCE) as GeoJSONSource | undefined)?.setData(featureCollection(visibleEvents, Date.now()) as any)
      ;(map.getSource(HEATMAP_SOURCE) as GeoJSONSource | undefined)?.setData(featureCollection(events, Date.now()) as any)
      if (displayMode === 'heatmap') renderPersistentHeat(analysisMode)
    },
    setVisible: (visible) => {
      applyDisplayMode(visible ? 'points' : 'hidden')
    },
    setDisplayMode: applyDisplayMode,
    setHeatmapAnalysis: applyHeatmapAnalysis,
  }
}
