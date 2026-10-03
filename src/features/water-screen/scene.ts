import * as maplibregl from 'maplibre-gl'
import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import {
  bufferLine,
  changshouLake,
  levelMeta,
  patrolRoute,
  rivers,
  stations,
  type LngLat,
} from './data'

maplibregl.setWorkerUrl(workerUrl)

type FeatureCollection = { type: 'FeatureCollection'; features: unknown[] }

const collection = (features: unknown[]): FeatureCollection => ({ type: 'FeatureCollection', features })

const lineFeature = (coords: LngLat[], properties: Record<string, unknown> = {}) => ({
  type: 'Feature',
  properties,
  geometry: { type: 'LineString', coordinates: coords },
})

const polygonFeature = (ring: LngLat[], properties: Record<string, unknown> = {}) => ({
  type: 'Feature',
  properties,
  geometry: { type: 'Polygon', coordinates: [ring] },
})

const WORLD_RING: LngLat[] = [
  [-179, -85], [179, -85], [179, 85], [-179, 85], [-179, -85],
]

/* ------------------------------------------------------- 线路流光（彗尾） ---- */

interface Traversal {
  cumulative: number[]
  total: number
  coords: LngLat[]
}

function prepare(coords: LngLat[]): Traversal {
  const cumulative = [0]
  for (let index = 1; index < coords.length; index += 1) {
    const previous = coords[index - 1]!
    const current = coords[index]!
    cumulative.push(cumulative[index - 1]! + Math.hypot(current[0] - previous[0], current[1] - previous[1]))
  }
  return { cumulative, total: cumulative.at(-1) || 1, coords }
}

/** 取折线上 [from, to]（0~1 归一化弧长）之间的分段，用于流光扫掠。 */
function slice(traversal: Traversal, from: number, to: number): LngLat[] {
  const { coords, cumulative, total } = traversal
  const start = Math.max(0, Math.min(1, from)) * total
  const end = Math.max(0, Math.min(1, to)) * total
  const output: LngLat[] = []
  for (let index = 1; index < coords.length; index += 1) {
    const segStart = cumulative[index - 1]!
    const segEnd = cumulative[index]!
    if (segEnd < start || segStart > end) continue
    const a = coords[index - 1]!
    const b = coords[index]!
    const span = segEnd - segStart || 1
    if (segStart < start) {
      const t = (start - segStart) / span
      output.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
    } else {
      output.push([a[0], a[1]])
    }
    if (segEnd > end) {
      const t = (end - segStart) / span
      output.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
      break
    }
  }
  if (output.length < 2) output.push(coords.at(-1) ?? [0, 0])
  return output
}

/* --------------------------------------------------------------- 场景构建 ---- */

export interface WaterSceneHandle {
  dispose: () => void
  focus: (scene: string) => void
}

export interface WaterSceneOptions {
  onSelect?: (name: string) => void
}

/** 行政区边界只需读取一次，缓存 Promise 避免并发重复请求。 */
let ringsPromise: Promise<LngLat[][]> | undefined

function loadRegionRings(): Promise<LngLat[][]> {
  ringsPromise ??= fetch('/china.geojson')
    .then((response) => response.json())
    .then((data: any) => {
      const feature = (data.features as any[]).find((item) => item.properties?.name === '重庆市')
      const geometry = feature?.geometry
      const rings: LngLat[][] = []
      if (geometry?.type === 'MultiPolygon') {
        for (const polygon of geometry.coordinates as LngLat[][][]) {
          if (polygon[0]?.length) rings.push(polygon[0])
        }
      } else if (geometry?.type === 'Polygon') {
        rings.push(geometry.coordinates[0] as LngLat[])
      }
      if (!rings.length) throw new Error('china.geojson 中未找到重庆市边界')
      return rings
    })
    .catch((error) => {
      ringsPromise = undefined
      throw error
    })
  return ringsPromise
}

export function createWaterScene(
  host: HTMLElement,
  options: WaterSceneOptions = {},
): WaterSceneHandle {
  const token = import.meta.env.VITE_TDT_KEY?.trim()
  const tiles = token
    ? Array.from({ length: 8 }, (_, index) =>
        `https://t${index}.tianditu.gov.cn/img_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=img&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&tk=${token}`,
      )
    : ['https://tile.openstreetmap.org/{z}/{x}/{y}.png']

  const map: MapLibreMap = new maplibregl.Map({
    container: host,
    center: [107.9, 30.1],
    zoom: 6.9,
    pitch: 0,
    bearing: 0,
    attributionControl: false,
    style: {
      version: 8,
      sources: {
        satellite: { type: 'raster', tiles, tileSize: 256, maxzoom: 18 },
      },
      layers: [
        // 底色贴近影像的暗青色调：瓦片陆续到达时不会出现明显的色块边界
        { id: 'bg', type: 'background', paint: { 'background-color': '#0a1f2a' } },
        {
          id: 'satellite',
          type: 'raster',
          source: 'satellite',
          paint: {
            'raster-opacity': 0.99,
            'raster-saturation': -0.18,
            'raster-contrast': 0.2,
            'raster-brightness-min': 0.06,
            'raster-brightness-max': 0.98,
            'raster-hue-rotate': -12,
          },
        },
        { id: 'tint', type: 'background', paint: { 'background-color': '#0b3f78', 'background-opacity': 0.24 } },
        { id: 'tint-vignette', type: 'background', paint: { 'background-color': '#020a18', 'background-opacity': 0.1 } },
      ],
    },
  })

  let disposed = false
  let added = false
  let rings: LngLat[][] | undefined
  let frame = 0
  let lastPulse = 0
  const markers: maplibregl.Marker[] = []
  let boundaryTraversal: Traversal | undefined
  const routeTraversal = prepare(patrolRoute)

  const setSource = (id: string, data: FeatureCollection) => {
    const source = map.getSource(id) as GeoJSONSource | undefined
    source?.setData(data as never)
  }

  /**
   * 叠加自定义图层。
   * 卫星栅格瓦片会持续加载，`map.isStyleLoaded()` 在瓦片流式加载期间可能长时间为 false，
   * 因此这里不依赖该判断，而是在样式对象可用时直接尝试写入，失败后由 load/styledata/idle 重试。
   */
  function addScene() {
    if (disposed || added || !rings) return
    if (!map.style || !map.getSource('satellite')) return
    try {
      writeScene()
      added = true
    } catch (error) {
      // 样式尚未就绪时会抛出异常，等待下一个事件重试
      if (import.meta.env.DEV) console.warn('[water-screen] 图层写入重试', error)
    }
  }

  function writeScene() {
    const regionRings = rings!
    const primary = regionRings.slice().sort((a, b) => b.length - a.length)[0]!
    boundaryTraversal = prepare(primary)

    map.addSource('region', { type: 'geojson', data: collection([polygonFeature(primary)]) })
    map.addSource('outside', {
      type: 'geojson',
      data: collection([
        {
          type: 'Feature',
          properties: {},
          geometry: { type: 'Polygon', coordinates: [WORLD_RING, ...regionRings.map((ring) => [...ring].reverse())] },
        },
      ]),
    })
    map.addSource('rivers', {
      type: 'geojson',
      data: collection(rivers.map((river) => lineFeature(river.coords, { level: river.level }))),
    })
    map.addSource('reservoir', {
      type: 'geojson',
      data: collection([
        polygonFeature(
          bufferLine(
            rivers[0]!.coords.filter(([, lat]) => lat >= 30.24),
            0.088,
          ),
          { kind: 'three-gorges' },
        ),
      ]),
    })
    map.addSource('lakes', {
      type: 'geojson',
      data: collection([polygonFeature(changshouLake, { name: '长寿湖' })]),
    })
    map.addSource('route', {
      type: 'geojson',
      lineMetrics: true,
      data: collection([lineFeature(patrolRoute)]),
    })
    map.addSource('traffic', {
      type: 'geojson',
      data: collection([lineFeature(slice(routeTraversal, 0, 0.07))]),
    })
    map.addSource('edge-flow', {
      type: 'geojson',
      data: collection([lineFeature(slice(boundaryTraversal, 0, 0.05))]),
    })
    map.addSource('station-points', {
      type: 'geojson',
      data: collection(
        stations.map((station) => ({
          type: 'Feature',
          properties: { level: station.level, name: station.name },
          geometry: { type: 'Point', coordinates: station.coord },
        })),
      ),
    })

    // —— 行政区内的浅色底衬，让辖区比周边更亮
    map.addLayer({
      id: 'region-fill',
      type: 'fill',
      source: 'region',
      paint: { 'fill-color': '#3f9fe0', 'fill-opacity': 0.11 },
    })

    // —— 区域外压暗，把视觉重心锁在行政区内
    map.addLayer({
      id: 'outside-mask',
      type: 'fill',
      source: 'outside',
      paint: { 'fill-color': '#020b1a', 'fill-opacity': 0.52 },
    })

    // —— 库区水面
    map.addLayer({
      id: 'reservoir-glow',
      type: 'line',
      source: 'reservoir',
      paint: { 'line-color': '#2fd0ff', 'line-width': 14, 'line-opacity': 0.22, 'line-blur': 10 },
    })
    map.addLayer({
      id: 'reservoir-fill',
      type: 'fill',
      source: 'reservoir',
      paint: { 'fill-color': '#1f8fd6', 'fill-opacity': 0.82 },
    })
    map.addLayer({
      id: 'lakes-fill',
      type: 'fill',
      source: 'lakes',
      paint: { 'fill-color': '#2b93d6', 'fill-opacity': 0.88 },
    })
    map.addLayer({
      id: 'lakes-line',
      type: 'line',
      source: 'lakes',
      paint: { 'line-color': '#8ceaff', 'line-width': 1.1, 'line-opacity': 0.8 },
    })

    // —— 河网：外发光 → 水体 → 高光芯
    map.addLayer({
      id: 'river-glow',
      type: 'line',
      source: 'rivers',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#2fc4ff',
        'line-width': ['match', ['get', 'level'], 1, 26, 13],
        'line-opacity': 0.28,
        'line-blur': 13,
      },
    })
    map.addLayer({
      id: 'river-base',
      type: 'line',
      source: 'rivers',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': ['match', ['get', 'level'], 1, '#1f9ae8', '#1a7fd0'],
        'line-width': ['match', ['get', 'level'], 1, 7.4, 3.2],
        'line-opacity': 0.96,
      },
    })
    map.addLayer({
      id: 'river-core',
      type: 'line',
      source: 'rivers',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': ['match', ['get', 'level'], 1, '#a5f2ff', '#6dd3f8'],
        'line-width': ['match', ['get', 'level'], 1, 2.1, 1.1],
        'line-opacity': 0.94,
      },
    })

    // —— 行政边界
    map.addLayer({
      id: 'edge-shadow',
      type: 'line',
      source: 'region',
      paint: { 'line-color': '#000914', 'line-width': 18, 'line-opacity': 0.5, 'line-blur': 7, 'line-translate': [0, 8] },
    })
    map.addLayer({
      id: 'edge-glow-wide',
      type: 'line',
      source: 'region',
      paint: { 'line-color': '#0f8dff', 'line-width': 18, 'line-opacity': 0.28, 'line-blur': 11 },
    })
    map.addLayer({
      id: 'edge-glow',
      type: 'line',
      source: 'region',
      paint: { 'line-color': '#35d8ff', 'line-width': 5.4, 'line-opacity': 0.42, 'line-blur': 3 },
    })
    map.addLayer({
      id: 'edge-core',
      type: 'line',
      source: 'region',
      paint: { 'line-color': '#7df0ff', 'line-width': 2, 'line-opacity': 0.97 },
    })
    map.addLayer({
      id: 'edge-highlight',
      type: 'line',
      source: 'region',
      paint: { 'line-color': '#f2ffff', 'line-width': 0.7, 'line-opacity': 0.85 },
    })
    map.addLayer({
      id: 'edge-flow-glow',
      type: 'line',
      source: 'edge-flow',
      layout: { 'line-cap': 'round' },
      paint: { 'line-color': '#bff6ff', 'line-width': 10, 'line-opacity': 0.5, 'line-blur': 7 },
    })
    map.addLayer({
      id: 'edge-flow-core',
      type: 'line',
      source: 'edge-flow',
      layout: { 'line-cap': 'round' },
      paint: { 'line-color': '#ffffff', 'line-width': 2.6, 'line-opacity': 0.95 },
    })

    // —— 重点巡检线路：暗色包边 + 青绿渐变 + 流光
    map.addLayer({
      id: 'route-casing',
      type: 'line',
      source: 'route',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#03192e', 'line-width': 8.4, 'line-opacity': 0.95 },
    })
    map.addLayer({
      id: 'route-glow',
      type: 'line',
      source: 'route',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#7dffc4', 'line-width': 15, 'line-opacity': 0.26, 'line-blur': 8 },
    })
    map.addLayer({
      id: 'route-core',
      type: 'line',
      source: 'route',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-width': 3.2,
        'line-opacity': 1,
        'line-gradient': [
          'interpolate', ['linear'], ['line-progress'],
          0, '#6ef2b0', 0.45, '#d8f26e', 0.7, '#ffd75e', 1, '#ffe9a8',
        ],
      },
    })
    map.addLayer({
      id: 'traffic-glow',
      type: 'line',
      source: 'traffic',
      layout: { 'line-cap': 'round' },
      paint: { 'line-color': '#ffffff', 'line-width': 12, 'line-opacity': 0.5, 'line-blur': 8 },
    })
    map.addLayer({
      id: 'traffic-core',
      type: 'line',
      source: 'traffic',
      layout: { 'line-cap': 'round' },
      paint: { 'line-color': '#ffffff', 'line-width': 2.4, 'line-opacity': 0.95 },
    })

    // —— 超警站点脉冲（位于 DOM 图钉之下）
    map.addLayer({
      id: 'alarm-pulse',
      type: 'circle',
      source: 'station-points',
      filter: ['==', ['get', 'level'], 'alarm'],
      paint: {
        'circle-radius': 16,
        'circle-color': 'rgba(255,107,74,0.16)',
        'circle-stroke-color': '#ff8a5c',
        'circle-stroke-width': 1.6,
        'circle-stroke-opacity': 0.7,
      },
    })

    addMarkers()
    frameRegion()
    animate()
  }

  function addMarkers() {
    for (const station of stations) {
      const element = document.createElement('button')
      element.type = 'button'
      element.className = 'ws-station'
      element.dataset.level = station.level
      element.dataset.kind = station.kind
      element.dataset.side = station.side ?? 'top'
      element.title = `${station.name} · ${levelMeta[station.level].label}`
      element.innerHTML = `
        <span class="ws-station__label">${station.name}</span>
        ${station.badge ? `<b class="ws-station__badge">${station.badge}</b>` : ''}
        <span class="ws-station__ring"></span>
        <svg class="ws-station__pin" viewBox="0 0 26 36" aria-hidden="true">
          <path d="M13 35.2C13 35.2 25.2 21.6 25.2 13.4 25.2 6.1 19.7.6 13 .6 6.3.6.8 6.1.8 13.4.8 21.6 13 35.2 13 35.2Z" />
          <circle cx="13" cy="13.2" r="4.5" />
        </svg>
      `
      element.addEventListener('click', (event) => {
        event.stopPropagation()
        options.onSelect?.(station.name)
      })
      markers.push(
        new maplibregl.Marker({ element, anchor: 'bottom', offset: [0, 3] })
          .setLngLat(station.coord)
          .addTo(map),
      )
    }
  }

  /**
   * 把行政区框进 HUD 中部留白。
   * HUD 以 1920×1080 设计稿等比缩放居中，这里按同一套缩放参数换算安全边距，
   * 保证任意窗口比例下，行政区都不会被左右面板或底部导航遮挡。
   */
  /**
   * 把行政区框进 HUD 中部留白。
   * HUD 以 1920×1080 设计稿等比缩放居中，这里按同一套缩放参数换算安全边距，
   * 保证任意窗口比例下，行政区都不会被左右面板或底部导航遮挡。
   * 说明：左右边距必须始终大于面板宽度，因此各专题共用同一套视野，不做额外放大。
   */
  function frameRegion(duration = 0) {
    if (!rings) return
    const width = window.innerWidth
    const height = window.innerHeight
    if (!width || !height) return
    const scale = Math.min(width / 1920, height / 1080)
    const offsetX = Math.max(0, (width - 1920 * scale) / 2)
    const offsetY = Math.max(0, (height - 1080 * scale) / 2)
    const narrow = width < 900
    const sidePad = (base: number) => Math.round(offsetX + (narrow ? 24 : base * scale))
    const verticalPad = (base: number, narrowValue: number) =>
      Math.round(offsetY + (narrow ? narrowValue : base * scale))
    const bounds = new maplibregl.LngLatBounds()
    for (const ring of rings) {
      const stride = Math.max(1, Math.floor(ring.length / 120))
      for (let index = 0; index < ring.length; index += stride) bounds.extend(ring[index]!)
    }
    if (bounds.isEmpty()) return
    map.fitBounds(bounds, {
      padding: {
        left: sidePad(425),
        right: sidePad(445),
        top: verticalPad(148, 110),
        bottom: verticalPad(182, 150),
      },
      duration,
      maxZoom: 8.6,
    })
  }

  function animate() {
    if (disposed) return
    const time = performance.now()

    // 呼吸与流光按 ~15fps 更新即可：既能保持“活着”的观感，
    // 又不会因为每帧 setPaintProperty 让地图一直全速重绘。
    if (time - lastPulse > 66) {
      lastPulse = time
      const breath = (Math.sin(time / 1500) + 1) / 2

      if (map.getLayer('edge-glow')) {
        map.setPaintProperty('edge-glow', 'line-opacity', 0.3 + breath * 0.26)
        map.setPaintProperty('edge-glow', 'line-blur', 2 + breath * 3)
      }
      if (map.getLayer('reservoir-fill')) {
        map.setPaintProperty('reservoir-fill', 'fill-opacity', 0.76 + breath * 0.12)
      }
      if (map.getLayer('alarm-pulse')) {
        map.setPaintProperty('alarm-pulse', 'circle-radius', 12 + breath * 14)
        map.setPaintProperty('alarm-pulse', 'circle-opacity', 0.06 + (1 - breath) * 0.2)
        map.setPaintProperty('alarm-pulse', 'circle-stroke-opacity', 0.24 + (1 - breath) * 0.6)
      }
      // 巡检线路与行政边界上的流光扫掠
      const routeProgress = (time / 5200) % 1
      setSource('traffic', collection([lineFeature(slice(routeTraversal, routeProgress, routeProgress + 0.07))]))
      if (boundaryTraversal) {
        const edgeProgress = (time / 9000) % 1
        setSource('edge-flow', collection([lineFeature(slice(boundaryTraversal, edgeProgress, edgeProgress + 0.045))]))
      }
    }

    frame = requestAnimationFrame(animate)
  }

  const retry = () => addScene()
  map.on('load', retry)
  map.on('styledata', retry)
  map.on('idle', retry)
  void loadRegionRings()
    .then((value) => {
      rings = value
      addScene()
    })
    .catch((error) => console.error('[water-screen] 行政区边界读取失败', error))

  let resizeTimer = 0
  const onResize = () => {
    window.clearTimeout(resizeTimer)
    resizeTimer = window.setTimeout(frameRegion, 240)
  }
  window.addEventListener('resize', onResize)

  if (import.meta.env.DEV) {
    // 开发期自检入口：便于在浏览器控制台/自动化脚本里确认场景是否完整写入。
    ;(window as unknown as Record<string, unknown>).__waterMap = map
    ;(window as unknown as Record<string, unknown>).__waterSceneDebug = () => ({
      added,
      rings: rings?.length ?? 0,
      layers: map.getStyle()?.layers?.map((layer) => layer.id) ?? [],
      sources: Object.keys(map.getStyle()?.sources ?? {}),
      styleLoaded: map.isStyleLoaded(),
      zoom: Number(map.getZoom().toFixed(2)),
      center: map.getCenter().toArray().map((value) => Number(value.toFixed(3))),
    })
  }

  return {
    focus() {
      // 各专题共用同一套视野：行政区完整落在地图留白内，切换时做一次轻微回落
      frameRegion(700)
    },
    dispose() {
      disposed = true
      cancelAnimationFrame(frame)
      window.clearTimeout(resizeTimer)
      window.removeEventListener('resize', onResize)
      map.off('load', retry)
      map.off('styledata', retry)
      map.off('idle', retry)
      markers.splice(0).forEach((marker) => marker.remove())
      map.remove()
    },
  }
}
