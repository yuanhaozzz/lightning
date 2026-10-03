import type { CanvasSource, Map } from 'maplibre-gl'
import { LAYER } from './layers'
import { MINE_AREAS, type MineRisk } from './mines'

const RADAR_SOURCE = 'national-radar-canvas'
const RADAR_LAYER = 'national-radar-layer'
const RADAR_BOUNDS: [[number, number], [number, number], [number, number], [number, number]] = [
  [73, 54], [135, 54], [135, 18], [73, 18],
]

export type RadarController = {
  dispose: () => void
  setTime: (timelineIndex: number) => void
  setVisible: (visible: boolean) => void
  setOpacity: (opacity: number) => void
}

export function addNationalRadar(map: Map, onMineRisk?: (values: Array<{ id: string; dbz: number; risk: MineRisk; distanceKm?: number }>) => void): RadarController {
  const canvas = document.createElement('canvas')
  canvas.width = 1024
  canvas.height = 600
  const context = canvas.getContext('2d', { alpha: true })
  if (!context) return { dispose: () => undefined, setTime: () => undefined, setVisible: () => undefined, setOpacity: () => undefined }

  map.addSource(RADAR_SOURCE, { type: 'canvas', canvas, coordinates: RADAR_BOUNDS, animate: false })
  map.addLayer({
    id: RADAR_LAYER,
    type: 'raster',
    source: RADAR_SOURCE,
    paint: {
      'raster-opacity': 0.78,
      'raster-fade-duration': 0,
      'raster-resampling': 'linear',
    },
  }, map.getLayer(LAYER.provinceUnderlay) ? LAYER.provinceUnderlay : undefined)

  const worker = new Worker(new URL('./radar.worker.ts', import.meta.url), { type: 'module' })
  let timelineIndex = 180
  let visible = true
  let opacity = .78
  let requestSerial = 0
  let inFlightRequest = 0
  let pendingTimelineIndex: number | undefined
  let latestDrawnRequest = 0

  const requestFrame = (requestedIndex = timelineIndex) => {
    if (inFlightRequest) {
      pendingTimelineIndex = requestedIndex
      return
    }
    const requestId = ++requestSerial
    inFlightRequest = requestId
    if (map.getLayer(RADAR_LAYER)) map.setPaintProperty(RADAR_LAYER, 'raster-opacity', 0)
    worker.postMessage({
      width: 2048,
      height: 1189,
      bounds: { west: 73, east: 135, south: 18, north: 54 },
      mines: MINE_AREAS.map(({ id, boundary }) => ({ id, boundary })),
      timelineIndex: requestedIndex,
      requestId,
    })
  }

  worker.onmessage = (event: MessageEvent<any>) => {
    if (event.data.type === 'mine-risks') {
      if (event.data.requestId === latestDrawnRequest) onMineRisk?.(event.data.values)
      return
    }
    if (event.data.requestId !== inFlightRequest) return
    latestDrawnRequest = event.data.requestId
    inFlightRequest = 0
    canvas.width = event.data.width
    canvas.height = event.data.height
    const pixels = new Uint8ClampedArray(event.data.pixels.length)
    pixels.set(event.data.pixels)
    context.putImageData(new ImageData(pixels, event.data.width, event.data.height), 0, 0)
    const source = map.getSource(RADAR_SOURCE) as CanvasSource | undefined
    source?.play()
    map.triggerRepaint()
    requestAnimationFrame(() => {
      source?.pause()
      if (map.getLayer(RADAR_LAYER)) map.setPaintProperty(RADAR_LAYER, 'raster-opacity', visible ? opacity : 0)
    })
    if (pendingTimelineIndex !== undefined) {
      const nextIndex = pendingTimelineIndex
      pendingTimelineIndex = undefined
      requestFrame(nextIndex)
    }
  }

  // Render one stable national raster. Zooming only transforms this texture;
  // the meteorological field never regenerates or shifts under the cursor.
  requestFrame()

  return {
    dispose: () => worker.terminate(),
    setTime: (nextIndex) => {
      if (nextIndex === timelineIndex) return
      timelineIndex = nextIndex
      requestFrame(nextIndex)
    },
    setVisible: (nextVisible) => {
      visible = nextVisible
      if (map.getLayer(RADAR_LAYER)) map.setPaintProperty(RADAR_LAYER, 'raster-opacity', visible ? opacity : 0)
    },
    setOpacity: (nextOpacity) => {
      opacity = Math.max(0, Math.min(1, nextOpacity))
      if (map.getLayer(RADAR_LAYER)) map.setPaintProperty(RADAR_LAYER, 'raster-opacity', visible ? opacity : 0)
    },
  }
}
