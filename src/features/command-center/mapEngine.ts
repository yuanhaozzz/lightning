import * as maplibregl from 'maplibre-gl'
import type {
  GeoJSONSource,
  Map as MapLibreMap,
  MapLayerMouseEvent,
} from 'maplibre-gl'
import mapLibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import { TDT_TILES } from '../china-map/config'
import { assetSites, corridors, gridLines, RISK_META, strikes } from './data'

maplibregl.setWorkerUrl(mapLibreWorkerUrl)

export type LayerKey =
  | 'asset'
  | 'grid'
  | 'label'
  | 'corridor'
  | 'storm'
  | 'lightning'
  | 'mine'
  | 'terrain'

export const CHINA_BOUNDS: [[number, number], [number, number]] = [
  [72.4, 16.8],
  [136.6, 54.6],
]

const SRC = {
  province: 'cc-province',
  border: 'cc-border',
  grid: 'cc-grid',
  asset: 'cc-asset',
  corridor: 'cc-corridor',
  storm: 'cc-storm',
  mine: 'cc-mine',
} as const

type Collection = { type: 'FeatureCollection'; features: unknown[] }
const empty: Collection = { type: 'FeatureCollection', features: [] }

const collection = (features: unknown[]): Collection => ({ type: 'FeatureCollection', features })

const point = (lon: number, lat: number, properties: Record<string, unknown>) => ({
  type: 'Feature',
  properties,
  geometry: { type: 'Point', coordinates: [lon, lat] },
})

const line = (coordinates: [number, number][], properties: Record<string, unknown>) => ({
  type: 'Feature',
  properties,
  geometry: { type: 'LineString', coordinates },
})

const polygon = (coordinates: [number, number][], properties: Record<string, unknown>) => ({
  type: 'Feature',
  properties,
  geometry: { type: 'Polygon', coordinates: [coordinates] },
})

export interface MapController {
  map: MapLibreMap
  setLayer: (key: LayerKey, visible: boolean) => void
  /**
   * 切换"地形底图"层级。
   * 全国尺度需要省界与卫星影像提供地理参照；
   * 一旦进到场区尺度，这张省级粗粒度地图只会变成一团噪点——
   * 场区图必须干净，靠 TwinCanvas 画的安全边界与设备来承载信息。
   */
  setContextLayer: (visible: boolean) => void
  setTimelineProgress: (progress: number) => void
  focusSite: (id: string, options?: { zoom?: number; duration?: number }) => void
  resetView: (duration?: number) => void
  setSelectedSite: (id: string) => void
  dispose: () => void
}

/* —— 资产骨架线：不同类型不同粗细与透明度，绝不喧宾夺主 —— */
function gridCollection() {
  return collection(
    gridLines.flatMap((grid) =>
      [0, 1].map((copy) =>
        line(grid.points, {
          name: grid.name,
          kind: grid.kind,
          width: grid.kind === 'uhv' ? 1.35 : grid.kind === 'backbone' ? 1.05 : 0.8,
          opacity: grid.kind === 'uhv' ? 0.5 : grid.kind === 'backbone' ? 0.38 : 0.24,
          copy,
        }),
      ),
    ),
  )
}

/* —— 风险走廊：沿主轨迹外扩的高概率落雷带 —— */
function corridorCollection() {
  return collection(
    corridors.map((corridor) =>
      polygon(corridor.points, { name: corridor.name, eta: corridor.eta }),
    ),
  )
}

/* —— 雷暴单体：先用暖色实心圆示意核心，再叠加外圈 —— */
function stormCollection() {
  const active = strikes.filter((strike) => strike.t > 4 * 3600)
  const buckets = new Map<string, { lon: number; lat: number; count: number; peak: number }>()
  for (const strike of active) {
    const key = `${Math.floor(strike.lon / 1.6)}:${Math.floor(strike.lat / 1.1)}`
    const bucket = buckets.get(key) ?? { lon: 0, lat: 0, count: 0, peak: 0 }
    bucket.lon += strike.lon
    bucket.lat += strike.lat
    bucket.count += 1
    bucket.peak = Math.max(bucket.peak, strike.current)
    buckets.set(key, bucket)
  }
  return collection(
    [...buckets.values()]
      .filter((bucket) => bucket.count >= 6)
      .map((bucket) =>
        point(bucket.lon / bucket.count, bucket.lat / bucket.count, {
          count: bucket.count,
          peak: bucket.peak,
        }),
      ),
  )
}

function assetCollection(selectedId = '') {
  return collection(
    assetSites.flatMap((site) => [
      point(site.lon, site.lat, {
        id: site.id,
        name: site.name,
        risk: site.risk,
        color: RISK_META[site.risk].color,
        selected: site.id === selectedId,
      }),
    ]),
  )
}

function mineCollection() {
  return collection(
    assetSites
      .filter((site) => site.risk === 'impact' || site.risk === 'warning')
      .flatMap((site) => [
        polygon(
          [
            [site.lon - 0.34, site.lat - 0.2],
            [site.lon + 0.34, site.lat - 0.2],
            [site.lon + 0.34, site.lat + 0.2],
            [site.lon - 0.34, site.lat + 0.2],
          ],
          { id: site.id, name: site.name, color: RISK_META[site.risk].color },
        ),
      ]),
  )
}

/**
 * 取省级行政区的主体陆地环。
 * 必须按"外接矩形面积"挑，绝不能按顶点数挑：这个数据集里近海小岛的
 * 采样点往往比简化后的省域主体还密，按点数会挑中一座礁石，
 * 整个版图就会变成一堆看不见的小碎块（已踩过的坑）。
 */
function mainlandRing(rings: number[][][][]): number[][] {
  let best: number[][] = []
  let bestArea = -1
  for (const polygon of rings) {
    const ring = polygon[0] ?? []
    if (ring.length < 3) continue
    let minLon = Number.POSITIVE_INFINITY
    let maxLon = Number.NEGATIVE_INFINITY
    let minLat = Number.POSITIVE_INFINITY
    let maxLat = Number.NEGATIVE_INFINITY
    for (const [lon = 0, lat = 0] of ring) {
      if (lon < minLon) minLon = lon
      if (lon > maxLon) maxLon = lon
      if (lat < minLat) minLat = lat
      if (lat > maxLat) maxLat = lat
    }
    const area = (maxLon - minLon) * (maxLat - minLat)
    if (area > bestArea) {
      bestArea = area
      best = ring as number[][]
    }
  }
  return best
}

export async function createCommandMap(
  container: HTMLElement,
  handlers: {
    onSiteClick?: (id: string) => void
    onHover?: (id: string | null, x: number, y: number) => void
  } = {},
): Promise<MapController> {
  const map = new maplibregl.Map({
    container,
    style: {
      version: 8,
      sources: {},
      layers: [{ id: 'cc-background', type: 'background', paint: { 'background-color': '#04070f' } }],
    },
    center: [110.6, 36.4],
    zoom: 5.6,
    minZoom: 3.1,
    // 场区尺度要把 600m 见方的场区铺满屏，无级缩放上限必须留到 17
    maxZoom: 17,
    maxBounds: [
      [58, -2],
      [152, 66],
    ],
    pitch: 26,
    bearing: -4,
    maxPitch: 62,
    attributionControl: false,
    localIdeographFontFamily:
      '"PingFang SC", "HarmonyOS Sans SC", "Microsoft YaHei", "Heiti SC", "Noto Sans CJK SC", sans-serif',
    fadeDuration: 260,
  })

  /**
   * 样式就绪守卫。
   * 必须在 new Map() 之后立刻挂监听：maplibre 的 'load' 可能在等待
   * china.geojson 期间就已经触发，晚挂就会永远等不到。
   * 超时兜底是为了在底图源不可达（客户内网/断网）时依旧能挂上业务图层——
   * 指挥舱宁可少一层地形，也不能整片留白。
   */
  const styleReady = new Promise<void>((resolve) => {
    if (map.isStyleLoaded()) {
      resolve()
      return
    }
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      resolve()
    }
    map.once('load', finish)
    window.setTimeout(finish, 4000)
  })

  /* maplibre 要求样式就绪后才能增删图层；风格未加载完时 addSource 会被静默拒绝 */
  await styleReady

  /* —— 卫星影像：重度降噪处理成"暗夜地层"，只保留地形起伏 —— */
  if (TDT_TILES.length) {
    map.addSource('cc-imagery', { type: 'raster', tiles: TDT_TILES, tileSize: 256, maxzoom: 18 })
    map.addLayer({
      id: 'cc-imagery',
      type: 'raster',
      source: 'cc-imagery',
      paint: {
        'raster-opacity': 0.62,
        'raster-saturation': -0.72,
        'raster-contrast': 0.16,
        'raster-brightness-min': 0.02,
        'raster-brightness-max': 0.42,
        'raster-hue-rotate': 8,
        'raster-fade-duration': 320,
      },
    })
  }

  const geojson = await fetch('/china.geojson').then((response) => response.json())
  const provinceRings: number[][][] = []
  const labelFeatures: unknown[] = []
  const borderLines: number[][][] = []
  const provinceAreas: unknown[] = []
  /** 整块国土轮廓（多面），交给单个 MultiPolygon 要素渲染，边界衔接更干净 */
  const landPolygons: number[][][][] = []
  const seen = new Set<string>()
  for (const feature of geojson.features as Array<{
    properties?: { name?: string }
    geometry?: { type?: string; coordinates?: number[][][] | number[][][][] }
  }>) {
    const name = feature.properties?.name ?? ''
    if (feature.geometry?.type === 'MultiPolygon') {
      const widest = mainlandRing(feature.geometry.coordinates as number[][][][])
      if (widest.length) {
        provinceRings.push(widest)
        // 省域面：拼出"国土底盘"，让版图从深空里浮起来，而不是一堆孤立光点
        provinceAreas.push(polygon(widest as [number, number][], { kind: 'province-area' }))
        landPolygons.push([widest as number[][]])
      }
      if (name && !seen.has(name) && widest.length > 24) {
        seen.add(name)
        const lon = widest.reduce((sum, p) => sum + (p[0] ?? 0), 0) / widest.length
        const lat = widest.reduce((sum, p) => sum + (p[1] ?? 0), 0) / widest.length
        labelFeatures.push(
          point(lon, lat, { name: name.replace(/省|市|自治区|维吾尔|壮族|回族|特别行政区/g, '') }),
        )
      }
    } else if (feature.geometry?.type === 'MultiLineString') {
      borderLines.push(...(feature.geometry.coordinates as number[][][]))
    }
  }

  /* "暗夜地层"：让国土从深空里浮起来。
     实测教训：底盘色只比背景亮 2 个色阶时，视觉上等于不存在——
     这里的 fill 与 halo 宽度是经过截图取色校准的，不要凭感觉调小。 */
  map.addSource('cc-land', {
    type: 'geojson',
    data: collection([
      {
        type: 'Feature',
        properties: { kind: 'land' },
        // 一个 MultiPolygon 承载全部省域：比 34 个独立 Polygon 更容易保证
        // 相邻省份之间的填充不出现缝隙，也少 33 次要素分块。
        geometry: { type: 'MultiPolygon', coordinates: landPolygons },
      },
    ]),
  })
  map.addLayer({
    id: 'cc-land-halo',
    type: 'line',
    source: 'cc-land',
    paint: { 'line-color': '#2f9fe0', 'line-width': 22, 'line-opacity': 0.2, 'line-blur': 16 },
  })
  map.addLayer({
    id: 'cc-land',
    type: 'fill',
    source: 'cc-land',
    paint: { 'fill-color': '#0e2439', 'fill-opacity': 0.92 },
  })

  map.addSource(SRC.province, {
    type: 'geojson',
    data: collection(provinceRings.map((ring) => line(ring as [number, number][], { kind: 'province' }))),
  })
  // 省界不是装饰：卫星影像在客户内网经常拉不到，省界就是唯一的空间参照系。
  // 用"底线 + 微光层"两级，既保持高级感，又保证缩到全国也能读懂地形骨架。
  map.addLayer({
    id: 'cc-province-glow',
    type: 'line',
    source: SRC.province,
    paint: {
      'line-color': '#3ba9e0',
      'line-width': ['interpolate', ['linear'], ['zoom'], 3, 3.4, 7, 4.6, 11, 6],
      'line-opacity': 0.18,
      'line-blur': 3,
    },
  })
  map.addLayer({
    id: 'cc-province',
    type: 'line',
    source: SRC.province,
    paint: {
      'line-color': '#a9daf5',
      'line-width': ['interpolate', ['linear'], ['zoom'], 3, 0.7, 6, 1, 10, 1.3],
      'line-opacity': 0.62,
      'line-blur': 0.2,
    },
  })

  map.addSource(SRC.border, {
    type: 'geojson',
    data: collection(borderLines.map((ring) => line(ring as [number, number][], {}))),
  })
  map.addLayer({
    id: 'cc-border-glow',
    type: 'line',
    source: SRC.border,
    paint: { 'line-color': '#35b6f0', 'line-width': 12, 'line-opacity': 0.26, 'line-blur': 7 },
  })
  map.addLayer({
    id: 'cc-border',
    type: 'line',
    source: SRC.border,
    paint: { 'line-color': '#d6f4ff', 'line-width': 1.4, 'line-opacity': 0.95 },
  })

  map.addSource(SRC.grid, { type: 'geojson', data: gridCollection() })
  map.addLayer({
    id: 'cc-grid-glow',
    type: 'line',
    source: SRC.grid,
    paint: {
      'line-color': '#2fd8ff',
      'line-width': ['*', ['get', 'width'], 4],
      'line-opacity': 0.12,
      'line-blur': 4,
    },
  })
  map.addLayer({
    id: 'cc-grid',
    type: 'line',
    source: SRC.grid,
    paint: {
      'line-color': ['match', ['get', 'kind'], 'collect', '#8ff0d8', '#7fe6ff'],
      'line-width': ['get', 'width'],
      'line-opacity': ['get', 'opacity'],
    },
  })

  map.addSource(SRC.corridor, { type: 'geojson', data: corridorCollection() })
  map.addLayer({
    id: 'cc-corridor-fill',
    type: 'fill',
    source: SRC.corridor,
    paint: {
      'fill-color': '#ff3b52',
      'fill-opacity': 0.09,
      'fill-outline-color': 'rgba(255,120,110,.35)',
    },
  })
  map.addLayer({
    id: 'cc-corridor-line',
    type: 'line',
    source: SRC.corridor,
    paint: {
      'line-color': '#ff6a5c',
      'line-width': 1.1,
      'line-opacity': 0.5,
      'line-dasharray': [3, 3],
    },
  })

  map.addSource(SRC.storm, { type: 'geojson', data: stormCollection() })
  map.addLayer({
    id: 'cc-storm-glow',
    type: 'circle',
    source: SRC.storm,
    paint: {
      'circle-color': '#ff7a45',
      'circle-radius': ['interpolate', ['linear'], ['get', 'count'], 6, 22, 60, 62],
      'circle-blur': 1,
      'circle-opacity': 0.16,
    },
  })
  map.addLayer({
    id: 'cc-storm-core',
    type: 'circle',
    source: SRC.storm,
    paint: {
      'circle-color': '#ffb066',
      'circle-radius': ['interpolate', ['linear'], ['get', 'count'], 6, 5, 60, 18],
      'circle-blur': 0.55,
      'circle-opacity': 0.4,
    },
  })

  map.addSource(SRC.mine, { type: 'geojson', data: mineCollection() })
  map.addLayer({
    id: 'cc-mine',
    type: 'fill',
    source: SRC.mine,
    paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.07 },
  })
  map.addLayer({
    id: 'cc-mine-line',
    type: 'line',
    source: SRC.mine,
    paint: { 'line-color': ['get', 'color'], 'line-width': 0.9, 'line-opacity': 0.34 },
  })

  map.addSource(SRC.asset, { type: 'geojson', data: assetCollection() })
  /**
   * 资产图形全部交给 TwinCanvas 绘制：它画的是"预警圈 + 距离读数"这类有语义的图形。
   * 这里保留的三个图层只服务于鼠标命中判定，视觉上完全透明 ——
   * 早先它们带描边，和画布上的环叠在一起，一个矿区会显示成两个点。
   */
  map.addLayer({
    id: 'cc-asset-halo',
    type: 'circle',
    source: SRC.asset,
    paint: { 'circle-color': 'transparent', 'circle-radius': 16, 'circle-opacity': 0 },
  })
  map.addLayer({
    id: 'cc-asset',
    type: 'circle',
    source: SRC.asset,
    paint: { 'circle-color': 'transparent', 'circle-radius': 12, 'circle-opacity': 0 },
  })
  map.addLayer({
    id: 'cc-asset-pulse',
    type: 'circle',
    source: SRC.asset,
    filter: ['==', ['get', 'risk'], 'impact'],
    paint: { 'circle-color': 'transparent', 'circle-radius': 24, 'circle-opacity': 0 },
  })
  map.addSource('cc-label-src', { type: 'geojson', data: collection(labelFeatures) })
  /**
   * 省名标注的字体栈必须给足回退。
   * localIdeographFontFamily 只对 CJK 生效：如果这里写的字体在客户机器上不存在，
   * 而地图样式的 glyphs 端点又不可达，浏览器会退化成"白方块"，
   * 整张图上会飘着一堆亮色小方块——比没有标注难看得多。
   * 所以：字体逐个回退，并且把字号压小、透明度压低，让它只作为地理参照存在。
   */
  map.addLayer({
    id: 'cc-label',
    type: 'symbol',
    source: 'cc-label-src',
    maxzoom: 7.2,
    layout: {
      'text-field': ['get', 'name'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 3, 9.5, 6.5, 11],
      'text-letter-spacing': 0.3,
      'text-allow-overlap': false,
      'text-ignore-placement': false,
      'text-font': ['PingFang SC Regular', 'Microsoft YaHei', 'Heiti SC', 'Noto Sans CJK SC', 'sans-serif'],
    },
    paint: {
      'text-color': 'rgba(178, 208, 232, 0.42)',
      'text-halo-color': 'rgba(3, 7, 14, 0.85)',
      'text-halo-width': 1.2,
      'text-halo-blur': 0.4,
    },
  })

  /* —— 雷达扫描：周期性扩散的传感器探测圈（由组件叠加 canvas 呈现） —— */
  map.addSource('cc-sweep', { type: 'geojson', data: empty })
  map.addLayer({
    id: 'cc-sweep-ring',
    type: 'circle',
    source: 'cc-sweep',
    paint: { 'circle-color': 'transparent', 'circle-radius': 0, 'circle-stroke-opacity': 0 },
  })

  /* —— 资产点击与悬停 —— */
  map.on('mouseenter', 'cc-asset-halo', () => {
    map.getCanvas().style.cursor = 'pointer'
  })
  map.on('mouseleave', 'cc-asset-halo', () => {
    map.getCanvas().style.cursor = ''
    handlers.onHover?.(null, 0, 0)
  })
  map.on('mousemove', 'cc-asset-halo', (event: MapLayerMouseEvent) => {
    const feature = event.features?.[0]
    const id = String(feature?.properties?.id ?? '')
    if (id) {
      map.getCanvas().style.cursor = 'pointer'
      handlers.onHover?.(id, event.point.x, event.point.y)
    }
  })
  map.on('click', 'cc-asset-halo', (event: MapLayerMouseEvent) => {
    const feature = event.features?.[0]
    const id = String(feature?.properties?.id ?? '')
    if (id) handlers.onSiteClick?.(id)
  })

  /* —— 资产脉冲心跳 —— */
  let animation = 0
  let selectedId = ''
  const pulse = (time: number) => {
    if (map.getLayer('cc-asset-pulse')) {
      const wave = (time % 2600) / 2600
      map.setPaintProperty('cc-asset-pulse', 'circle-radius', [
        'interpolate',
        ['linear'],
        ['zoom'],
        4,
        10 + wave * 22,
        9,
        22 + wave * 40,
      ])
      map.setPaintProperty('cc-asset-pulse', 'circle-stroke-opacity', 0.5 * (1 - wave))
    }
    animation = requestAnimationFrame(pulse)
  }
  animation = requestAnimationFrame(pulse)

  const layerIds: Record<LayerKey, string[]> = {
    asset: ['cc-asset-halo', 'cc-asset', 'cc-asset-pulse'],
    grid: ['cc-grid-glow', 'cc-grid'],
    label: ['cc-label'],
    corridor: ['cc-corridor-fill', 'cc-corridor-line'],
    storm: ['cc-storm-glow', 'cc-storm-core'],
    lightning: [],
    mine: ['cc-mine', 'cc-mine-line'],
    // 省界属于"空间参照系"，和地形同开同关，不单独占一个开关
    terrain: ['cc-imagery', 'cc-land', 'cc-land-halo', 'cc-province', 'cc-province-glow'],
  }
  return {
    map,
    setLayer: (key, visible) => {
      for (const id of layerIds[key]) {
        if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none')
      }
    },
    setContextLayer: (visible) => {
      /**
       * 注意：这里刻意【不含】cc-label。
       * 省级地名是地图库带出来的文字，它和小程序式的指标争夺注意力，
       * 而领导根本不需要知道"山西"在哪 —— 他只需要知道哪个矿区在预警。
       * 地名单独放在图层面板里，默认关闭。
       */
      for (const id of [
        'cc-imagery',
        'cc-land',
        'cc-land-halo',
        'cc-province',
        'cc-province-glow',
        'cc-border',
        'cc-border-glow',
      ]) {
        if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none')
      }
    },
    setTimelineProgress: (progress) => {
      if (!map.getLayer('cc-storm-core')) return
      // 推演推进时，雷暴单体随时间增强：透明度即"能量"
      const energy = 0.22 + Math.min(1, progress * 1.35) * 0.34
      map.setPaintProperty('cc-storm-glow', 'circle-opacity', energy * 0.5)
      map.setPaintProperty('cc-storm-core', 'circle-opacity', energy)
      map.setPaintProperty('cc-corridor-fill', 'fill-opacity', progress > 0.72 ? 0.14 : 0.08)
    },
    focusSite: (id, options = {}) => {
      const site = assetSites.find((item) => item.id === id)
      if (!site) return
      selectedId = id
      ;(map.getSource(SRC.asset) as GeoJSONSource | undefined)?.setData(assetCollection(selectedId))
      /**
       * 场区尺度用 0 俯仰 + 0 偏角。
       * 全国总览时的 26° 俯仰是为了"气势"，但一进场区，带俯仰的透视会让
       * 保护半径圆变成椭圆、设备位置互相遮挡——工程图必须是正射的。
       */
      map.flyTo({
        center: [site.lon, site.lat],
        zoom: options.zoom ?? 14.2,
        pitch: 0,
        bearing: 0,
        duration: options.duration ?? 1500,
        essential: true,
      })
    },
    resetView: (duration = 1400) => {
      selectedId = ''
      ;(map.getSource(SRC.asset) as GeoJSONSource | undefined)?.setData(assetCollection())
      map.flyTo({
        center: [108.2, 30.6],
        zoom: 4.15,
        pitch: 26,
        bearing: -4,
        duration,
        essential: true,
      })
    },
    setSelectedSite: (id) => {
      selectedId = id
      ;(map.getSource(SRC.asset) as GeoJSONSource | undefined)?.setData(assetCollection(id))
    },
    dispose: () => {
      cancelAnimationFrame(animation)
      map.remove()
    },
  }
}
