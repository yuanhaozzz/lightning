import * as maplibregl from 'maplibre-gl'
import type { Map } from 'maplibre-gl'
import mapLibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import { CHINA_BOUNDS, MAP_COLORS, TDT_TILES } from './config'
import { addChinaLayers, keepChinaLayersOnTop, LAYER, revealNationalFocus, revealSkeleton, SOURCE } from './layers'
import { addNationalRadar, type RadarController } from './radar'
import { addMineLayers, type MineRisk } from './mines'
import { addLightningLayers, type LightningController } from './lightning'
import { addStormTrack, type StormTrackController } from './storm-track'

maplibregl.setWorkerUrl(mapLibreWorkerUrl)

export type MapStage = 'skeleton' | 'focus' | 'tiles' | 'ready' | 'offline'
export type ChinaMapController = {
  dispose: () => void
  setTimeline: (timelineIndex: number) => void
  setOverlayVisible: (overlay: 'radar' | 'lightning', visible: boolean) => void
  setLayerMode: (mode: 'radar' | 'heatmap' | 'track') => void
  setHeatmapAnalysis: (mode: 'strength' | 'density') => void
}

type ChinaCollection = { type: 'FeatureCollection'; features: any[]; [key: string]: any }

async function loadGeoJson(path: string, signal: AbortSignal) {
  const response = await fetch(path, { signal })
  if (!response.ok) throw new Error(`中国边界数据加载失败 (${response.status})`)
  return (await response.json()) as ChinaCollection
}

function prepareProvinceDetail(data: ChinaCollection): ChinaCollection {
  const displayName = (name = '') => name
    .replace('维吾尔自治区', '')
    .replace('壮族自治区', '')
    .replace('回族自治区', '')
    .replace('自治区', '')
    .replace(/特别行政区|省|市$/u, '')

  const largestPolygon = (geometry: any): number[][][] => {
    const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
    return polygons.sort((a: number[][][], b: number[][][]) => {
      const area = (polygon: number[][][]) => {
        const ring = polygon[0] ?? []
        if (!ring.length) return 0
        const xs = ring.map((point) => point[0] ?? 0)
        const ys = ring.map((point) => point[1] ?? 0)
        return (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys))
      }
      return area(b) - area(a)
    })[0] ?? []
  }

  // Province datasets include hundreds of tiny offshore polygons. Drawing all
  // polygon rings makes those generalized island extents look like misplaced
  // boxes over the satellite imagery. The national overview only needs each
  // province's primary land mass; keep the source file intact and simplify the
  // display geometry here.
  const provinces = data.features
    .filter((feature) => feature.geometry?.type === 'Polygon' || feature.geometry?.type === 'MultiPolygon')
    .map((feature) => {
      const polygon = largestPolygon(feature.geometry)
      return {
        ...feature,
        properties: { ...feature.properties, kind: 'province', displayName: displayName(feature.properties?.name) },
        geometry: { type: 'Polygon', coordinates: polygon },
      }
    })

  const interiorLabelPoint = (polygon: number[][][]): [number, number] => {
    const ring = polygon[0] ?? []
    if (!ring.length) return [104, 35]
    const ys = ring.map((point) => point[1] ?? 0)
    const minY = Math.min(...ys)
    const maxY = Math.max(...ys)
    let best: [number, number] = [ring[0]?.[0] ?? 104, ring[0]?.[1] ?? 35]
    let bestWidth = -1
    for (let step = 1; step < 20; step += 1) {
      const y = minY + ((maxY - minY) * step) / 20
      const intersections: number[] = []
      for (let index = 0; index < ring.length - 1; index += 1) {
        const start = ring[index]
        const end = ring[index + 1]
        if (!start || !end) continue
        const x1 = start[0] ?? 0
        const y1 = start[1] ?? 0
        const x2 = end[0] ?? 0
        const y2 = end[1] ?? 0
        if ((y1 > y) === (y2 > y) || y1 === y2) continue
        intersections.push(x1 + ((y - y1) * (x2 - x1)) / (y2 - y1))
      }
      intersections.sort((a, b) => a - b)
      for (let index = 0; index + 1 < intersections.length; index += 2) {
        const left = intersections[index]
        const right = intersections[index + 1]
        if (left === undefined || right === undefined) continue
        const width = right - left
        if (width > bestWidth) { bestWidth = width; best = [(left + right) / 2, y] }
      }
    }
    return best
  }

  const seen = new Set<string>()
  const labels = provinces.flatMap((feature) => {
    const name = feature.properties?.name ?? ''
    if (!name || seen.has(name)) return []
    seen.add(name)
    const polygon = largestPolygon(feature.geometry)
    if (!polygon.length) return []
    return [{ type: 'Feature', properties: { ...feature.properties, kind: 'province-label' }, geometry: { type: 'Point', coordinates: interiorLabelPoint(polygon) } }]
  })
  return { type: 'FeatureCollection', features: [...provinces, ...labels] }
}

function addImagery(map: Map, setStage: (stage: MapStage) => void) {
  if (!TDT_TILES.length) {
    setStage('offline')
    return
  }
  map.addSource(SOURCE.imagery, { type: 'raster', tiles: TDT_TILES, tileSize: 256, minzoom: 1, maxzoom: 18 })
  map.addLayer({
    id: LAYER.imagery,
    type: 'raster',
    source: SOURCE.imagery,
    paint: {
      'raster-opacity': 0,
      'raster-opacity-transition': { duration: 260, delay: 0 },
      'raster-fade-duration': 180,
      // Apply the colour grade to the imagery itself (all raster tiles), not
      // to a country-shaped overlay. This keeps terrain detail while unifying
      // China and neighbouring countries under the same cool command-centre
      // palette.
      'raster-saturation': -0.25,
      'raster-contrast': 0.05,
      'raster-brightness-min': 0.04,
      'raster-brightness-max': 0.85,
      'raster-hue-rotate': 0,
    },
  }, map.getLayer(LAYER.fill) ? LAYER.fill : undefined)
  keepChinaLayersOnTop(map)
  setStage('tiles')
  // Show imagery immediately; vector focus layers are added independently.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    map.setPaintProperty(LAYER.imagery, 'raster-opacity', 0.96)
    if (map.getLayer(LAYER.fill)) map.setPaintProperty(LAYER.fill, 'fill-opacity', 0.045)
    if (map.getLayer(LAYER.provinceUnderlay)) map.setPaintProperty(LAYER.provinceUnderlay, 'line-opacity', 0.18)
    if (map.getLayer(LAYER.province)) map.setPaintProperty(LAYER.province, 'line-opacity', 0.48)
  }))
  const onIdle = () => {
    setStage('ready')
    map.off('idle', onIdle)
  }
  map.on('idle', onIdle)
}

function addSouthSeaInset(map: Map, data: ChinaCollection) {
  const features = data.features.filter((feature) => feature.properties?.kind === 'south-sea' && feature.geometry?.type === 'LineString')
  const root = document.createElement('aside')
  root.className = 'south-sea-inset'
  root.setAttribute('aria-label', '南海诸岛附图')
  const insetMapElement = document.createElement('div')
  insetMapElement.className = 'south-sea-inset__map'
  const title = document.createElement('div')
  title.className = 'south-sea-inset__title'
  title.textContent = '南海诸岛'
  root.append(insetMapElement, title)
  map.getContainer().append(root)

  const insetMap = new maplibregl.Map({
    container: insetMapElement,
    style: { version: 8, sources: {}, layers: [{ id: 'south-inset-background', type: 'background', paint: { 'background-color': '#31495a' } }] },
    center: [113.6, 13.6],
    zoom: 2.25,
    attributionControl: false,
    interactive: false,
    fadeDuration: 0,
  })
  insetMap.once('load', () => {
    if (TDT_TILES.length) {
      insetMap.addSource('south-inset-basemap', { type: 'raster', tiles: TDT_TILES, tileSize: 256, minzoom: 1, maxzoom: 18 })
      insetMap.addLayer({ id: 'south-inset-basemap', type: 'raster', source: 'south-inset-basemap', paint: { 'raster-opacity': 1, 'raster-saturation': .24, 'raster-contrast': .16, 'raster-brightness-min': .1, 'raster-brightness-max': 1 } })
    }
    insetMap.addSource('south-inset-lines', { type: 'geojson', data: { type: 'FeatureCollection', features } as any })
    insetMap.addLayer({ id: 'south-inset-line-glow', type: 'line', source: 'south-inset-lines', paint: { 'line-color': '#df675b', 'line-width': 4, 'line-blur': 3, 'line-opacity': .5 } })
    insetMap.addLayer({ id: 'south-inset-lines', type: 'line', source: 'south-inset-lines', paint: { 'line-color': '#ffe0ca', 'line-width': 1.35, 'line-opacity': .96 } })
    insetMap.fitBounds([[107.4, 2.8], [122.6, 24.8]], { padding: { top: 24, right: 7, bottom: 7, left: 7 }, duration: 0 })
  })

  const syncVisibility = () => root.classList.toggle('is-hidden', map.getZoom() > 5.8)
  map.on('zoom', syncVisibility)
  syncVisibility()
  return () => {
    map.off('zoom', syncVisibility)
    insetMap.remove()
    root.remove()
  }
}

export function createChinaMap(
  container: HTMLElement,
  onStageChange: (stage: MapStage) => void,
  onError: (message: string) => void,
): ChinaMapController {
  const controller = new AbortController()
  let radarController: RadarController | undefined
  let lightningController: LightningController | undefined
  let stormTrackController: StormTrackController | undefined
  let disposeSouthSeaInset: (() => void) | undefined
  let timelineIndex = 180
  const overlayVisibility = { radar: true, lightning: true }
  const nationalPadding = { top: 36, right: 52, bottom: 36, left: 52 }
  const syncNationalMinZoom = () => {
    const camera = map.cameraForBounds(CHINA_BOUNDS, { padding: nationalPadding })
    if (camera?.zoom !== undefined) {
      // A tiny epsilon prevents wheel/inertia rounding from briefly exposing
      // a wider world view than the approved national overview.
      map.setMinZoom(camera.zoom + .001)
      if (map.getZoom() < camera.zoom) map.setZoom(camera.zoom)
    }
  }
  let mineLayers: ReturnType<typeof addMineLayers> | undefined
  let pendingMineRisks: Array<{ id: string; dbz: number; risk: MineRisk; distanceKm?: number }> = []
  const map = new maplibregl.Map({
    container,
    style: {
      version: 8,
      sources: {},
      layers: [{ id: 'background', type: 'background', paint: { 'background-color': MAP_COLORS.background } }],
    },
    center: [104.2, 34.4],
    zoom: 2.65,
    minZoom: 2,
    maxZoom: 16,
    maxBounds: [[45, -8], [165, 73]],
    attributionControl: false,
    localIdeographFontFamily: '"Noto Serif CJK SC", "Source Han Serif SC", "Songti SC", "Microsoft YaHei", serif',
    fadeDuration: 500,
  })
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right')

  map.once('load', async () => {
    try {
      // Start raster requests immediately; there is no separate skeleton stage.
      addImagery(map, onStageChange)
      radarController = addNationalRadar(map, (values) => {
        pendingMineRisks = values
        mineLayers?.update(values)
      })
      radarController.setTime(timelineIndex)
      radarController.setVisible(overlayVisibility.radar)
      const [detailData, focusData] = await Promise.all([
        loadGeoJson('/china.geojson', controller.signal),
        loadGeoJson('/china-map-focus.geojson', controller.signal),
      ])
      focusData.features.push({
        type: 'Feature',
        properties: { kind: 'south-sea-label', displayName: '南海诸岛' },
        geometry: { type: 'Point', coordinates: [113.25, 13.25] },
      })
      disposeSouthSeaInset = addSouthSeaInset(map, focusData)
      map.addSource(SOURCE.china, { type: 'geojson', data: focusData })
      map.addSource(SOURCE.detail, { type: 'geojson', data: prepareProvinceDetail(detailData) })
      addChinaLayers(map)
      mineLayers = addMineLayers(map)
      if (pendingMineRisks.length) mineLayers.update(pendingMineRisks)
      lightningController = addLightningLayers(map)
      lightningController.setTime(timelineIndex)
      lightningController.setVisible(overlayVisibility.lightning)
      stormTrackController = addStormTrack(map)
      stormTrackController.setTime(timelineIndex)
      if (map.getLayer(LAYER.provinceLabel)) map.moveLayer(LAYER.provinceLabel)
      if (map.getLayer(LAYER.southLabel)) map.moveLayer(LAYER.southLabel)
      map.fitBounds(CHINA_BOUNDS, { padding: nationalPadding, duration: 0 })
      // The furthest zoom-out is the complete national extent. This keeps the
      // mainland, Taiwan, Hainan and the South China Sea territory visible,
      // while preventing users from shrinking China into a small world view.
      // Lock to the zoom actually produced by fitBounds. It is more reliable
      // than a separately calculated camera while the container is settling.
      map.setMinZoom(map.getZoom())
      map.on('resize', syncNationalMinZoom)
      requestAnimationFrame(() => requestAnimationFrame(() => {
        revealSkeleton(map)
        revealNationalFocus(map)
        onStageChange('focus')
      }))
    } catch (cause) {
      if (!controller.signal.aborted) onError(cause instanceof Error ? cause.message : '地图初始化失败')
    }
  })

  map.on('error', (event: maplibregl.ErrorEvent) => {
    const message = event.error?.message ?? ''
    if (message && !message.includes('AJAXError')) console.warn('[china-map]', message)
  })

  return {
    dispose: () => {
      controller.abort()
      radarController?.dispose()
      lightningController?.dispose()
      stormTrackController?.dispose()
      disposeSouthSeaInset?.()
      map.off('resize', syncNationalMinZoom)
      mineLayers?.dispose()
      map.remove()
    },
    setTimeline: (nextIndex) => {
      timelineIndex = Math.max(0, Math.min(240, nextIndex))
      radarController?.setTime(timelineIndex)
      lightningController?.setTime(timelineIndex)
      stormTrackController?.setTime(timelineIndex)
    },
    setOverlayVisible: (overlay, visible) => {
      overlayVisibility[overlay] = visible
      if (overlay === 'radar') radarController?.setVisible(visible)
      else lightningController?.setVisible(visible)
    },
    setLayerMode: (mode) => {
      if (mode === 'radar') {
        radarController?.setVisible(true)
        radarController?.setOpacity(.78)
        lightningController?.setDisplayMode('points')
        stormTrackController?.setVisible(false)
      } else if (mode === 'heatmap') {
        radarController?.setVisible(false)
        lightningController?.setDisplayMode('heatmap')
        stormTrackController?.setVisible(false)
      } else {
        radarController?.setVisible(true)
        radarController?.setOpacity(.43)
        lightningController?.setDisplayMode('hidden')
        stormTrackController?.setVisible(true)
      }
    },
    setHeatmapAnalysis: (mode) => lightningController?.setHeatmapAnalysis(mode),
  }
}
