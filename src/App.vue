<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as Cesium from 'cesium'
import 'cesium/Build/Cesium/Widgets/widgets.css'
import { dbzColors, lightning, radarCells, riskMeta, storms, tenants } from './services/mockWeather'
import type { Tenant } from './types'
import ChinaMap from './features/china-map/index.vue'
import DigitalTwin from './features/digital-twin/index.vue'
import WaterScreen from './features/water-screen/index.vue'
import { useRoute } from 'vue-router'

const route = useRoute()

const mapEl = ref<HTMLDivElement>(),
  viewer = ref<Cesium.Viewer>(),
  selected = ref<Tenant | null>(null),
  hovered = ref<Tenant | null>(null)
const showRisk = ref(false),
  showLayers = ref(false),
  showDetails = ref(false),
  search = ref(''),
  showSearch = ref(false),
  playing = ref(false),
  live = ref(true),
  timeline = ref(72)
const now = ref(new Date(2024, 7, 20, 14, 32, 18)),
  zoomLevel = ref<'national' | 'regional' | 'site'>('national'),
  cursor = ref({ x: 0, y: 0 }),
  clock = ref('')
const viewportWidth = ref(1920)
// 当前评审阶段只展示中国地图。业务图层与交互代码保留，确认地图视觉后再恢复。
const CHINA_MAP_ONLY = true
const layers = ref({
  radar: true,
  lightning: true,
  storms: true,
  tenants: true,
  warning: false,
  devices: false,
  labels: true,
})
const collections: Cesium.PrimitiveCollection[] = []
let chinaFocus: Cesium.PrimitiveCollection | undefined
let timer = 0,
  flashTimer = 0
const riskTenants = computed(() => tenants)
const searchResults = computed(() =>
  search.value.trim()
    ? tenants.filter((t) => `${t.name}${t.type}`.includes(search.value.trim())).slice(0, 6)
    : [],
)
const selectedMeta = computed(() => (selected.value ? riskMeta[selected.value.risk] : null))
const TDT_KEY = import.meta.env.VITE_TDT_KEY || ''
const colorOfDbz = (dbz: number) =>
  [...dbzColors].reverse().find((c) => dbz >= c.min)?.color || dbzColors[0]!.color

async function addBaseMaps(v: Cesium.Viewer) {
  v.imageryLayers.removeAll()
  const fallback = await Cesium.TileMapServiceImageryProvider.fromUrl(
    '/cesium/Assets/Textures/NaturalEarthII',
  )
  const fallbackLayer = v.imageryLayers.addImageryProvider(fallback)
  fallbackLayer.brightness = 1.1
  fallbackLayer.contrast = 0.9
  fallbackLayer.saturation = 0.78
  fallbackLayer.gamma = 1.08
  if (!TDT_KEY) return
  const subdomains = ['0', '1', '2', '3', '4', '5', '6', '7']
  const imageLayer = v.imageryLayers.addImageryProvider(
    new Cesium.WebMapTileServiceImageryProvider({
      url: `https://t{s}.tianditu.gov.cn/img_w/wmts?tk=${TDT_KEY}`,
      layer: 'img',
      style: 'default',
      format: 'tiles',
      tileMatrixSetID: 'w',
      subdomains,
      maximumLevel: 18,
    }),
  )
  imageLayer.brightness = 1.08
  imageLayer.contrast = 0.92
  imageLayer.saturation = 0.82
  imageLayer.gamma = 1.06
}
async function addChinaFocus(v: Cesium.Viewer) {
  const data = await fetch('/china.geojson').then((response) => response.json())
  const provinceRings: number[][][] = []
  const borderLines: number[][][] = []

  for (const feature of data.features as any[]) {
    const geometry = feature.geometry
    if (geometry?.type === 'MultiPolygon') {
      for (const polygon of geometry.coordinates as number[][][][]) {
        if (polygon[0]?.length) provinceRings.push(polygon[0])
      }
    } else if (geometry?.type === 'MultiLineString') {
      borderLines.push(...(geometry.coordinates as number[][][]))
    }
  }

  chinaFocus = new Cesium.PrimitiveCollection()
  v.scene.primitives.add(chinaFocus)

  const maskHoles = provinceRings.map(
    (ring) =>
      new Cesium.PolygonHierarchy(
        ring.map(([lon = 0, lat = 0]) => Cesium.Cartesian3.fromDegrees(lon, lat)),
      ),
  )
  chinaFocus.add(
    new Cesium.GroundPrimitive({
      geometryInstances: new Cesium.GeometryInstance({
        geometry: new Cesium.PolygonGeometry({
          polygonHierarchy: new Cesium.PolygonHierarchy(
            Cesium.Cartesian3.fromDegreesArray([-179, -80, 179, -80, 179, 80, -179, 80]),
            maskHoles,
          ),
          vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT,
        }),
        attributes: {
          color: Cesium.ColorGeometryInstanceAttribute.fromColor(
            Cesium.Color.fromCssColorString('#eaf1f5').withAlpha(0.46),
          ),
        },
      }),
      appearance: new Cesium.PerInstanceColorAppearance({ flat: true, translucent: true }),
    }),
  )

  const boundaryLines = chinaFocus.add(new Cesium.PolylineCollection()) as Cesium.PolylineCollection
  for (const line of borderLines) {
    const positions = line.map(([lon = 0, lat = 0]) => Cesium.Cartesian3.fromDegrees(lon, lat, 120))
    boundaryLines.add({
      positions,
      width: 8,
      material: Cesium.Material.fromType('Color', {
        color: Cesium.Color.fromCssColorString('#173f58').withAlpha(0.38),
      }),
    })
    boundaryLines.add({
      positions: line.map(([lon = 0, lat = 0]) => Cesium.Cartesian3.fromDegrees(lon, lat, 120)),
      width: 3.2,
      material: Cesium.Material.fromType('Color', {
        color: Cesium.Color.fromCssColorString('#f7fcff').withAlpha(1),
      }),
    })
  }
}
function clearData() {
  const v = viewer.value
  if (!v) return
  collections.splice(0).forEach((p) => v.scene.primitives.remove(p))
}
function addCollection(v: Cesium.Viewer) {
  const c = new Cesium.PrimitiveCollection()
  collections.push(c)
  v.scene.primitives.add(c)
  return c
}
function addPolygon(v: Cesium.Viewer, t: Tenant, color: string) {
  const c = addCollection(v)
  c.add(
    new Cesium.GroundPrimitive({
      geometryInstances: new Cesium.GeometryInstance({
        geometry: new Cesium.PolygonGeometry({
          polygonHierarchy: new Cesium.PolygonHierarchy(
            Cesium.Cartesian3.fromDegreesArray(t.polygon.flat()),
          ),
          vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT,
        }),
        attributes: {
          color: Cesium.ColorGeometryInstanceAttribute.fromColor(
            Cesium.Color.fromCssColorString(color).withAlpha(0.14),
          ),
        },
      }),
      appearance: new Cesium.PerInstanceColorAppearance({ flat: true, translucent: true }),
    }),
  )
}
function addStorms(v: Cesium.Viewer) {
  const c = addCollection(v),
    labels = c.add(new Cesium.LabelCollection({ scene: v.scene })) as Cesium.LabelCollection,
    points = c.add(new Cesium.PointPrimitiveCollection()) as Cesium.PointPrimitiveCollection
  storms.forEach((s) => {
    points.add({
      position: Cesium.Cartesian3.fromDegrees(s.lon, s.lat),
      pixelSize: 36,
      color: Cesium.Color.fromCssColorString('#762cff').withAlpha(0.36),
      outlineColor: Cesium.Color.fromCssColorString('#cfb7ff'),
      outlineWidth: 3,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    })
    labels.add({
      position: Cesium.Cartesian3.fromDegrees(s.lon, s.lat),
      text: `雷暴 ${s.name}  ↘\n${s.speed} km/h`,
      font: '600 13px sans-serif',
      fillColor: Cesium.Color.WHITE,
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 3,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      pixelOffset: new Cesium.Cartesian2(0, -34),
      horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    })
  })
}
function rebuildData() {
  const v = viewer.value
  if (!v) return
  clearData()
  if (layers.value.radar) {
    const c = addCollection(v),
      instances = radarCells.map(
        (x) =>
          new Cesium.GeometryInstance({
            geometry: new Cesium.RectangleGeometry({
              rectangle: Cesium.Rectangle.fromDegrees(
                x.lon - x.size,
                x.lat - x.size * 0.62,
                x.lon + x.size,
                x.lat + x.size * 0.62,
              ),
              vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT,
            }),
            attributes: {
              color: Cesium.ColorGeometryInstanceAttribute.fromColor(
                Cesium.Color.fromCssColorString(colorOfDbz(x.dbz)).withAlpha(0.48),
              ),
            },
          }),
      )
    c.add(
      new Cesium.GroundPrimitive({
        geometryInstances: instances,
        appearance: new Cesium.PerInstanceColorAppearance({ flat: true, translucent: true }),
      }),
    )
  }
  if (layers.value.tenants) {
    const c = addCollection(v),
      markers = c.add(new Cesium.PointPrimitiveCollection()) as Cesium.PointPrimitiveCollection,
      labels = c.add(new Cesium.LabelCollection({ scene: v.scene })) as Cesium.LabelCollection
    tenants.forEach((t) => {
      markers.add({
        position: Cesium.Cartesian3.fromDegrees(t.lon, t.lat),
        pixelSize: t.risk === 'impact' ? 22 : t.risk === 'normal' ? 13 : 18,
        color: Cesium.Color.fromCssColorString(riskMeta[t.risk].color),
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 3,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        id: { kind: 'tenant', tenant: t },
      })
      labels.add({
        position: Cesium.Cartesian3.fromDegrees(t.lon, t.lat),
        text: t.name,
        font: '600 14px "Microsoft YaHei"',
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.fromCssColorString('#10264c'),
        outlineWidth: 4,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, 14),
        verticalOrigin: Cesium.VerticalOrigin.TOP,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
          show: zoomLevel.value !== 'national' || t.risk === 'impact',
      })
      if (zoomLevel.value !== 'national') addPolygon(v, t, riskMeta[t.risk].color)
      if (zoomLevel.value === 'site' && layers.value.devices) {
        const pts = c.add(new Cesium.PointPrimitiveCollection()) as Cesium.PointPrimitiveCollection
        t.devices.forEach((d) =>
          pts.add({
            position: Cesium.Cartesian3.fromDegrees(d.lon, d.lat),
            pixelSize: 9,
            color: Cesium.Color.CYAN,
            outlineColor: Cesium.Color.WHITE,
            outlineWidth: 2,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          }),
        )
      }
    })
  }
  if (layers.value.lightning) {
    const c = addCollection(v),
      pts = c.add(new Cesium.PointPrimitiveCollection()) as Cesium.PointPrimitiveCollection
    lightning
      .filter((_, i) => (zoomLevel.value === 'national' ? i % 2 === 0 : true))
      .forEach((s) =>
        pts.add({
          position: Cesium.Cartesian3.fromDegrees(s.lon, s.lat),
          pixelSize: s.ageMinutes < 5 ? 8 : 5,
          color: Cesium.Color.fromCssColorString(
            s.polarity === 'positive' ? '#ffec63' : '#aa79ff',
          ).withAlpha(Math.max(0.2, 1 - s.ageMinutes / 38)),
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: s.ageMinutes < 5 ? 2 : 0,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        }),
      )
  }
  if (layers.value.storms) addStorms(v)
}
function flyTo(t: Tenant) {
  selected.value = t
  showRisk.value = false
  showSearch.value = false
  search.value = ''
  viewer.value?.camera.flyTo({
    destination: Cesium.Rectangle.fromDegrees(t.lon - 2.2, t.lat - 1.5, t.lon + 2.2, t.lat + 1.5),
    duration: 1.4,
  })
  setTimeout(() => {
    zoomLevel.value = 'regional'
    rebuildData()
  }, 1100)
}
function flyHome() {
  selected.value = null
  showDetails.value = false
  zoomLevel.value = 'national'
  viewer.value?.camera.setView({
    destination: Cesium.Rectangle.fromDegrees(72, 13, 137, 55),
  })
  rebuildData()
}
function toggleLayer(key: keyof typeof layers.value) {
  layers.value[key] = !layers.value[key]
  rebuildData()
}
function openDetails() {
  showDetails.value = true
  zoomLevel.value = 'site'
  rebuildData()
}
function goLive() {
  timeline.value = 100
  live.value = true
}
function triggerRealtimeStrike() {
  if (!viewer.value) return
  const t = tenants[Math.random() < 0.55 ? 0 : 7]!,
    lon = t.lon + (Math.random() - 0.5) * 0.5,
    lat = t.lat + (Math.random() - 0.5) * 0.35,
    el = document.createElement('div')
  el.className = 'strike-flash'
  el.innerHTML = '<i></i><b>⚡</b>'
  document.querySelector('.map-shell')?.append(el)
  const p = Cesium.SceneTransforms.worldToWindowCoordinates(
    viewer.value.scene,
    Cesium.Cartesian3.fromDegrees(lon, lat),
  )
  if (p) {
    el.style.left = `${p.x}px`
    el.style.top = `${p.y}px`
  }
  setTimeout(() => {
    el.remove()
  }, 650)
  selected.value = t
  setTimeout(() => (selected.value = null), 1200)
}
onMounted(async () => {
  if (CHINA_MAP_ONLY) return
  viewportWidth.value = window.innerWidth
  ;(window as any).CESIUM_BASE_URL = '/cesium/'
  const v = new Cesium.Viewer(mapEl.value!, {
    baseLayer: false,
    sceneMode: Cesium.SceneMode.SCENE2D,
    mapProjection: new Cesium.WebMercatorProjection(),
    animation: false,
    timeline: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    baseLayerPicker: false,
    navigationHelpButton: false,
    fullscreenButton: false,
    infoBox: false,
    selectionIndicator: false,
    requestRenderMode: true,
    maximumRenderTimeChange: Number.POSITIVE_INFINITY,
    showRenderLoopErrors: false,
  })
  viewer.value = v
  v.resolutionScale = window.devicePixelRatio > 1.25 ? 0.85 : 1
  v.scene.globe.baseColor = Cesium.Color.fromCssColorString('#173b52')
  if (v.scene.skyAtmosphere) v.scene.skyAtmosphere.show = false
  v.scene.backgroundColor = Cesium.Color.fromCssColorString('#071a2f')
  v.scene.screenSpaceCameraController.enableTilt = false
  v.scene.screenSpaceCameraController.enableRotate = false
  await addBaseMaps(v)
  await addChinaFocus(v)
  flyHome()
  if (CHINA_MAP_ONLY) return
  rebuildData()
  const h = new Cesium.ScreenSpaceEventHandler(v.scene.canvas)
  h.setInputAction((m: Cesium.ScreenSpaceEventHandler.MotionEvent) => {
    cursor.value = { x: m.endPosition.x, y: m.endPosition.y }
    const p = v.scene.pick(m.endPosition) as any
    hovered.value = p?.id?.tenant || p?.primitive?.id?.tenant || null
  }, Cesium.ScreenSpaceEventType.MOUSE_MOVE)
  h.setInputAction((m: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
    const p = v.scene.pick(m.position) as any,
      t = p?.id?.tenant || p?.primitive?.id?.tenant
    if (t) {
      selected.value = t
      cursor.value = { x: m.position.x, y: m.position.y }
    }
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK)
  v.camera.moveEnd.addEventListener(() => {
    const height = v.camera.positionCartographic.height,
      next = height < 350000 ? 'site' : height < 1800000 ? 'regional' : 'national'
    if (next !== zoomLevel.value) {
      zoomLevel.value = next
      rebuildData()
    }
  })
  timer = window.setInterval(() => {
    now.value = new Date(now.value.getTime() + 1000)
    clock.value = now.value.toLocaleTimeString('zh-CN', { hour12: false })
  }, 1000)
  flashTimer = window.setInterval(triggerRealtimeStrike, 8500)
})
onBeforeUnmount(() => {
  clearInterval(timer)
  clearInterval(flashTimer)
  viewer.value?.destroy()
})
watch(timeline, (v) => (live.value = v > 94))
</script>

<template>
  <DigitalTwin v-if="route.name === 'digital-twin-map'" />
  <WaterScreen v-else-if="route.name === 'water-screen'" />
  <template v-else>
  <ChinaMap v-if="CHINA_MAP_ONLY" />
  <template v-if="!CHINA_MAP_ONLY">
  <main class="app">
    <header class="topbar">
      <button class="brand" @click="flyHome">
        <span class="logo">ϟ</span><span>中国雷电监测预警平台</span>
      </button>
      <div class="search-wrap">
        <span class="search-icon">⌕</span
        ><input
          v-model="search"
          @focus="showSearch = true"
          placeholder="搜索租户 / 场区 / 地区 / 设备..."
        /><button v-if="search" @click="search = ''">×</button>
        <div v-if="showSearch && search" class="search-results">
          <button v-for="t in searchResults" :key="t.id" @click="flyTo(t)">
            <span :style="{ background: riskMeta[t.risk].color }">⌂</span
            ><em
              ><b>{{ t.name }}</b
              ><small>{{ t.type }} · {{ riskMeta[t.risk].label }}</small></em
            ><i>定位 ›</i>
          </button>
          <div v-if="!searchResults.length" class="empty">未找到匹配结果</div>
        </div>
      </div>
      <div class="status">
        <span class="live-dot"></span><b>实时</b><time>2024-08-20 {{ clock || '14:32:18' }}</time>
      </div>
      <button class="icon-btn">? <span>帮助</span></button
      ><button class="user"><b>A</b><span>管理员⌄</span></button><button class="menu">☰</button>
    </header>
    <section class="map-shell" @click.self="showSearch = false">
      <div ref="mapEl" class="map"></div>
      <div v-if="!TDT_KEY" class="key-tip">
        当前为开发底图 · 在 <code>.env.local</code> 填写 VITE_TDT_KEY 即切换天地图影像
      </div>
      <aside class="risk-panel" :class="{ collapsed: !showRisk }">
        <button class="risk-head" @click="showRisk = !showRisk">
          <span
            >⚠ 风险租户 <b>{{ riskTenants.length }}</b></span
          ><i>{{ showRisk ? '‹' : '›' }}</i>
        </button>
        <div v-if="showRisk" class="risk-list">
          <button v-for="t in tenants.slice(0, 4)" :key="t.id" @click="flyTo(t)">
            <span class="tenant-icon" :class="t.risk">⌂</span
            ><em
              ><strong>{{ t.name }}</strong
              ><small v-if="t.risk === 'impact'">最近闪电 {{ t.lightningDistance }} km</small
              ><small v-else-if="t.eta"
                >预计影响 {{ t.eta }} min · 雷暴 {{ t.stormDistance }} km</small
              ><small v-else>最近闪电 {{ t.lightningDistance }} km</small></em
            ><label :class="t.risk">{{ riskMeta[t.risk].label }}</label
            ><i>›</i></button
          ><button class="all-risk">查看全部风险租户 <span>›</span></button>
        </div>
      </aside>
      <aside class="layers" :class="{ open: showLayers }">
        <button class="layers-head" @click="showLayers = !showLayers">
          <span>◉</span><b>综合态势</b><i>{{ showLayers ? '⌃' : '···' }}</i>
        </button>
        <div v-if="showLayers" class="layer-list">
          <button
            v-for="item in [
              { k: 'radar', n: '雷达回波 (dBZ)', i: '◉' },
              { k: 'lightning', n: '闪电定位', i: 'ϟ' },
              { k: 'storms', n: '雷暴单体', i: '☁' },
              { k: 'tenants', n: '租户 / 场区', i: '⌂' },
              { k: 'warning', n: '预警区域', i: '△' },
              { k: 'devices', n: '设备', i: '▣' },
              { k: 'labels', n: '地名标注', i: 'T' },
            ]"
            :key="item.k"
            @click="toggleLayer(item.k as keyof typeof layers)"
          >
            <span>{{ item.i }}</span
            ><b>{{ item.n }}</b
            ><i :class="{ on: layers[item.k as keyof typeof layers] }"></i>
          </button>
        </div>
      </aside>
      <div class="map-tools">
        <button @click="flyHome">⌖</button>
        <div>
          <button @click="viewer?.camera.zoomIn(viewer.camera.positionCartographic.height * 0.38)">
            ＋</button
          ><button
            @click="viewer?.camera.zoomOut(viewer.camera.positionCartographic.height * 0.55)"
          >
            −
          </button>
        </div>
      </div>
      <div class="view-label">
        {{
          zoomLevel === 'national' ? '全国态势' : zoomLevel === 'regional' ? '区域态势' : '场区详情'
        }}
      </div>
      <div
        v-if="hovered && !selected"
        class="hover-card"
        :style="{
          left: Math.min(cursor.x + 18, viewportWidth - 330) + 'px',
          top: Math.max(90, cursor.y - 80) + 'px',
        }"
      >
        <b>{{ hovered.name }}</b
        ><span :style="{ color: riskMeta[hovered.risk].color }"
          >● {{ riskMeta[hovered.risk].label }}</span
        ><small>雷暴距离 {{ hovered.stormDistance }} km</small>
      </div>
      <div v-if="selected && !showDetails" class="tenant-popover">
        <button class="close" @click="selected = null">×</button>
        <h3>{{ selected.name }}</h3>
        <p :style="{ color: selectedMeta?.color }">● {{ selectedMeta?.label }}</p>
        <dl>
          <div>
            <dt>雷暴距离</dt>
            <dd>{{ selected.stormDistance }} km</dd>
          </div>
          <div>
            <dt>预计影响</dt>
            <dd>{{ selected.eta ? selected.eta + ' min' : '影响中' }}</dd>
          </div>
          <div>
            <dt>最大反射率</dt>
            <dd>{{ selected.maxDbz }} dBZ</dd>
          </div>
          <div>
            <dt>近10分钟闪电</dt>
            <dd>{{ selected.lightning10m }} 次</dd>
          </div>
        </dl>
        <button
          class="details-btn"
          @click="openDetails"
        >
          查看详情 <span>→</span>
        </button>
      </div>
      <aside v-if="selected && showDetails" class="detail-drawer">
        <button class="close" @click="showDetails = false">×</button><small>租户风险分析</small>
        <h2>{{ selected.name }}</h2>
        <div class="detail-risk" :style="{ color: selectedMeta?.color }">
          ● {{ selectedMeta?.label }}
        </div>
        <div class="metric-grid">
          <div>
            <span>最大反射率</span><b>{{ selected.maxDbz }} <small>dBZ</small></b>
          </div>
          <div>
            <span>雷暴距离</span><b>{{ selected.stormDistance }} <small>km</small></b>
          </div>
          <div>
            <span>近10分钟闪电</span><b>{{ selected.lightning10m }} <small>次</small></b>
          </div>
          <div>
            <span>最近闪电</span><b>{{ selected.lightningDistance }} <small>km</small></b>
          </div>
        </div>
        <h4>风险研判</h4>
        <p>
          强对流云团正向场区移动，场区及风险范围内已监测到实时闪电活动。建议关注生产设备和户外作业安全。
        </p>
        <h4>场区设备</h4>
        <button v-for="d in selected.devices" :key="d.name" class="device-row">
          <span>▣</span
          ><em
            ><b>{{ d.name }}</b
            ><small>{{ d.type }} · 在线</small></em
          ><i>›</i>
        </button>
      </aside>
      <div class="legend">
        <b>雷达回波强度 (dBZ)</b>
        <div class="gradient"></div>
        <div class="ticks">
          <span v-for="n in [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70]" :key="n">{{
            n
          }}</span>
        </div>
      </div>
      <div class="timeline">
        <button class="play" @click="playing = !playing">{{ playing ? 'Ⅱ' : '▶' }}</button>
        <div class="date">
          <small>8月20日</small
          ><b
            >14:{{
              Math.round(6 + timeline * 0.28)
                .toString()
                .padStart(2, '0')
            }}</b
          >
        </div>
        <div class="track">
          <input v-model="timeline" type="range" min="0" max="100" />
          <div class="times">
            <span>13:30</span><span>13:40</span><span>13:50</span><span>14:00</span
            ><span>14:10</span><span>14:20</span><span>14:30</span>
          </div>
        </div>
        <button
          class="live-btn"
          :class="{ active: live }"
          @click="goLive"
        >
          ● LIVE</button
        ><button class="speed">1x⌄</button><button class="calendar">▦</button>
      </div>
    </section>
  </main>
  </template>
  </template>
</template>

<style src="./assets/monitor.css"></style>
<style>
.china-map-only,
.china-map-only .map {
  position: fixed;
  inset: 0;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  background: #dfe8ec;
}
</style>
