import type { GeoJSONSource, Map } from 'maplibre-gl'

type TrackPoint = {
  frame: number
  time: string
  lng: number
  lat: number
  dbz: number
  lightningCount: number
  speed: number
}

const TRACK_SOURCE = 'storm-track-analysis'
const STRIKE_SOURCE = 'storm-track-lightning'
const LAYERS = {
  influence: 'storm-track-influence',
  ring: 'storm-track-distance-rings',
  glow: 'storm-track-line-glow',
  line: 'storm-track-line',
  future: 'storm-track-future',
  nodeGlow: 'storm-track-node-glow',
  node: 'storm-track-node',
  nodeLabel: 'storm-track-node-label',
  strikesGlow: 'storm-track-strikes-glow',
  strikes: 'storm-track-strikes',
  arrow: 'storm-track-arrow',
} as const

const anchors: TrackPoint[] = Array.from({ length: 17 }, (_, index) => {
  const progress = index / 16
  const hour = 8 + index * .5
  const wholeHour = Math.floor(hour)
  const minute = hour % 1 ? '30' : '00'
  const lifecycle = Math.sin(progress * Math.PI)
  return {
    frame: index * 15,
    time: `${String(wholeHour).padStart(2, '0')}:${minute}`,
    lng: 104.35 + progress * 14.4 + Math.sin(progress * Math.PI * 2) * .42,
    lat: 39.45 - progress * 8.7 + Math.sin(progress * Math.PI * 1.6) * .55,
    dbz: Math.round(34 + lifecycle * 27),
    lightningCount: Math.round(35 + lifecycle * 310 + Math.sin(index * 1.7) * 26),
    speed: Math.round(17 + progress * 11 + Math.sin(index) * 2),
  }
})

let randomSeed = 0x9237ab
const random = () => {
  randomSeed = (Math.imul(randomSeed, 1664525) + 1013904223) >>> 0
  return randomSeed / 4294967296
}

const lightningEvents = (() => {
  randomSeed = 0x9237ab
  return Array.from({ length: 1200 }, (_, index) => {
    const progress = Math.pow(random(), .92)
    const segment = Math.min(15, Math.floor(progress * 16))
    const local = progress * 16 - segment
    const start = anchors[segment]!
    const end = anchors[segment + 1]!
    const spread = .12 + Math.sin(progress * Math.PI) * .42
    return {
      id: index,
      frame: Math.round(progress * 240),
      lng: start.lng + (end.lng - start.lng) * local + (random() - .5) * spread * 2.4,
      lat: start.lat + (end.lat - start.lat) * local + (random() - .5) * spread,
      intensity: Math.round(15 + random() * 92),
      progress,
    }
  })
})()

function circle(center: [number, number], radiusKm: number, kind: string) {
  const coordinates: number[][] = []
  const latitudeScale = 110.574
  const longitudeScale = 111.32 * Math.cos(center[1] * Math.PI / 180)
  for (let index = 0; index <= 72; index += 1) {
    const angle = index / 72 * Math.PI * 2
    coordinates.push([
      center[0] + Math.cos(angle) * radiusKm / longitudeScale,
      center[1] + Math.sin(angle) * radiusKm / latitudeScale,
    ])
  }
  return { type: 'Feature' as const, properties: { kind, radiusKm }, geometry: { type: 'Polygon' as const, coordinates: [coordinates] } }
}

function interpolatePoint(frame: number) {
  const bounded = Math.max(0, Math.min(240, frame))
  const segment = Math.min(15, Math.floor(bounded / 15))
  const ratio = (bounded - segment * 15) / 15
  const start = anchors[segment]!
  const end = anchors[segment + 1]!
  return {
    lng: start.lng + (end.lng - start.lng) * ratio,
    lat: start.lat + (end.lat - start.lat) * ratio,
    dbz: Math.round(start.dbz + (end.dbz - start.dbz) * ratio),
    lightningCount: Math.round(start.lightningCount + (end.lightningCount - start.lightningCount) * ratio),
    speed: Math.round(start.speed + (end.speed - start.speed) * ratio),
  }
}

function trackData(frame: number) {
  const current = interpolatePoint(frame)
  const past = anchors.filter((point) => point.frame <= frame)
  const pastCoordinates = [...past.map((point) => [point.lng, point.lat]), [current.lng, current.lat]]
  const future = [[current.lng, current.lat], ...anchors.filter((point) => point.frame > frame).map((point) => [point.lng, point.lat])]
  const nodeFeatures = past.filter((_, index) => index % 2 === 0).map((point, index) => ({
    type: 'Feature' as const,
    properties: { kind: 'node', time: point.time, phase: point.frame / 240, showLabel: index % 2 === 0 },
    geometry: { type: 'Point' as const, coordinates: [point.lng, point.lat] },
  }))
  return {
    type: 'FeatureCollection' as const,
    features: [
      circle([current.lng, current.lat], current.dbz >= 50 ? 72 : 48, 'influence'),
      circle([current.lng, current.lat], 100, 'ring'),
      circle([current.lng, current.lat], 200, 'ring'),
      { type: 'Feature' as const, properties: { kind: 'past-line' }, geometry: { type: 'LineString' as const, coordinates: pastCoordinates } },
      { type: 'Feature' as const, properties: { kind: 'future-line' }, geometry: { type: 'LineString' as const, coordinates: future } },
      ...nodeFeatures,
      { type: 'Feature' as const, properties: { kind: 'current', bearing: 122 }, geometry: { type: 'Point' as const, coordinates: [current.lng, current.lat] } },
    ],
  }
}

function strikeData(frame: number) {
  const visible = lightningEvents.filter((event) => event.frame <= frame && event.frame >= frame - 75)
  return {
    type: 'FeatureCollection' as const,
    features: visible.map((event) => ({
      type: 'Feature' as const,
      properties: { intensity: event.intensity, phase: event.progress },
      geometry: { type: 'Point' as const, coordinates: [event.lng, event.lat] },
    })),
  }
}

export type StormTrackController = {
  dispose: () => void
  setTime: (frame: number) => void
  setVisible: (visible: boolean) => void
}

export function addStormTrack(map: Map): StormTrackController {
  let frame = 180
  let visible = false
  map.addSource(TRACK_SOURCE, { type: 'geojson', data: trackData(frame) as any, lineMetrics: true })
  map.addSource(STRIKE_SOURCE, { type: 'geojson', data: strikeData(frame) as any })
  const hidden = { visibility: 'none' as const }
  map.addLayer({ id: LAYERS.influence, type: 'fill', source: TRACK_SOURCE, filter: ['==', ['get', 'kind'], 'influence'], layout: hidden, paint: { 'fill-color': '#ff4e5e', 'fill-opacity': .105, 'fill-outline-color': '#ff8590' } })
  map.addLayer({ id: LAYERS.ring, type: 'line', source: TRACK_SOURCE, filter: ['==', ['get', 'kind'], 'ring'], layout: hidden, paint: { 'line-color': '#d8f3ff', 'line-width': 1, 'line-opacity': .62, 'line-dasharray': [3, 3] } })
  map.addLayer({ id: LAYERS.glow, type: 'line', source: TRACK_SOURCE, filter: ['==', ['get', 'kind'], 'past-line'], layout: hidden, paint: { 'line-color': '#ff5b58', 'line-width': 11, 'line-blur': 8, 'line-opacity': .38 } })
  map.addLayer({ id: LAYERS.line, type: 'line', source: TRACK_SOURCE, filter: ['==', ['get', 'kind'], 'past-line'], layout: hidden, paint: { 'line-width': 3.2, 'line-opacity': .98, 'line-gradient': ['interpolate', ['linear'], ['line-progress'], 0, '#ffd83d', .38, '#ff8a2e', .68, '#ff405e', 1, '#b94dff'] } })
  map.addLayer({ id: LAYERS.future, type: 'line', source: TRACK_SOURCE, filter: ['==', ['get', 'kind'], 'future-line'], layout: hidden, paint: { 'line-color': '#9f73ff', 'line-width': 2, 'line-opacity': .72, 'line-dasharray': [2, 2] } })
  map.addLayer({ id: LAYERS.strikesGlow, type: 'circle', source: STRIKE_SOURCE, layout: hidden, paint: { 'circle-radius': ['interpolate', ['linear'], ['get', 'intensity'], 10, 3, 100, 8], 'circle-color': ['interpolate', ['linear'], ['get', 'phase'], 0, '#ffe348', .35, '#ff922e', .65, '#ff3e63', 1, '#7c5cff'], 'circle-blur': .78, 'circle-opacity': .45 } })
  map.addLayer({ id: LAYERS.strikes, type: 'circle', source: STRIKE_SOURCE, layout: hidden, paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 2, 1.2, 7, 2.8, 12, 4.2], 'circle-color': ['interpolate', ['linear'], ['get', 'phase'], 0, '#ffe348', .35, '#ff922e', .65, '#ff3e63', 1, '#7c5cff'], 'circle-stroke-color': '#fff7df', 'circle-stroke-width': .45, 'circle-opacity': .9 } })
  map.addLayer({ id: LAYERS.nodeGlow, type: 'circle', source: TRACK_SOURCE, filter: ['==', ['get', 'kind'], 'node'], layout: hidden, paint: { 'circle-radius': 9, 'circle-color': ['interpolate', ['linear'], ['get', 'phase'], 0, '#ffe348', .5, '#ff5d3d', 1, '#a85cff'], 'circle-blur': .72, 'circle-opacity': .7 } })
  map.addLayer({ id: LAYERS.node, type: 'circle', source: TRACK_SOURCE, filter: ['==', ['get', 'kind'], 'node'], layout: hidden, paint: { 'circle-radius': 4.2, 'circle-color': ['interpolate', ['linear'], ['get', 'phase'], 0, '#ffe348', .5, '#ff5d3d', 1, '#a85cff'], 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.3 } })
  map.addLayer({ id: LAYERS.nodeLabel, type: 'symbol', source: TRACK_SOURCE, filter: ['==', ['get', 'kind'], 'node'], layout: { ...hidden, 'text-field': ['get', 'time'], 'text-size': 10, 'text-offset': [0, -1.35], 'text-allow-overlap': false }, paint: { 'text-color': '#fff1b0', 'text-halo-color': '#15213a', 'text-halo-width': 1.5 } })
  map.addLayer({ id: LAYERS.arrow, type: 'symbol', source: TRACK_SOURCE, filter: ['==', ['get', 'kind'], 'current'], layout: { ...hidden, 'text-field': '➤', 'text-size': 24, 'text-rotate': ['get', 'bearing'], 'text-allow-overlap': true }, paint: { 'text-color': '#c68aff', 'text-halo-color': '#fff', 'text-halo-width': 1.2, 'text-halo-blur': 1 } })

  const applyVisibility = () => Object.values(LAYERS).forEach((id) => map.getLayer(id) && map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none'))
  return {
    dispose: () => undefined,
    setTime: (nextFrame) => {
      frame = Math.max(0, Math.min(240, nextFrame))
      ;(map.getSource(TRACK_SOURCE) as GeoJSONSource | undefined)?.setData(trackData(frame) as any)
      ;(map.getSource(STRIKE_SOURCE) as GeoJSONSource | undefined)?.setData(strikeData(frame) as any)
    },
    setVisible: (nextVisible) => { visible = nextVisible; applyVisibility() },
  }
}
