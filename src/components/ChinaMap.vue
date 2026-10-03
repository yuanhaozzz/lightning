<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import * as Cesium from 'cesium'
import { focusChina } from '../services/chinaImagery'

const host = ref<HTMLDivElement>()
const error = ref('')
let viewer: Cesium.Viewer | undefined
let disposed = false
// Geographic texture: compositing province interiors forms one silhouette, without province strokes.
async function chinaOverlay(data: any) {
  const width = 4096, height = 3072
  const west = 45, east = 165, south = -5, north = 70
  const canvas = () => Object.assign(document.createElement('canvas'), { width, height })
  const land = canvas(), ctx = land.getContext('2d')!
  const point = ([lon, lat]: number[]) => [(lon! - west) / (east - west) * width, (north - lat!) / (north - south) * height]
  ctx.fillStyle = '#ffffff'
  for (const feature of data.features) {
    if (feature.geometry.type !== 'MultiPolygon') continue
    for (const polygon of feature.geometry.coordinates) {
      ctx.beginPath()
      for (const ring of polygon) {
        ring.forEach((coordinate: number[], index: number) => {
          const [x, y] = point(coordinate)
          if (index === 0) ctx.moveTo(x!, y!)
          else ctx.lineTo(x!, y!)
        })
        ctx.closePath()
      }
      ctx.fill('evenodd')
    }
  }
  // Seal subpixel seams between adjacent provinces before deriving the outer edge.
  const silhouette = canvas(), s = silhouette.getContext('2d')!
  for (const [x, y] of [[0, 0], [-0.65, 0], [0.65, 0], [0, -0.65], [0, 0.65]]) s.drawImage(land, x!, y!)
  const overlay = canvas(), o = overlay.getContext('2d')!
  // Local exterior relief only: a full inverse white mask also bleaches the sea.
  // A soft halo falls to zero outside the coast/border, keeping the South China Sea clear.
  o.shadowColor = 'rgba(213, 230, 231, 0.65)'
  o.shadowBlur = 48
  o.drawImage(silhouette, 0, 0)
  o.shadowColor = 'rgba(14, 48, 62, 0.65)'
  o.shadowBlur = 13
  o.shadowOffsetY = 4
  o.drawImage(silhouette, 0, 0)
  o.shadowColor = 'transparent'
  // The white rim comes from the union silhouette, never individual province outlines.
  for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 8) {
    o.drawImage(silhouette, Math.cos(angle) * 2.4, Math.sin(angle) * 2.4)
  }
  o.globalCompositeOperation = 'destination-out'
  o.drawImage(silhouette, 0, 0)
  o.globalCompositeOperation = 'source-over'
  // Preserve offshore linework from the supplied dataset; do not invent/extend boundaries.
  o.strokeStyle = 'rgba(248, 252, 255, 0.95)'
  o.lineWidth = 2.2
  o.lineCap = 'round'
  for (const feature of data.features) {
    if (feature.geometry.type !== 'MultiLineString') continue
    for (const line of feature.geometry.coordinates as number[][][]) {
      if (!line.every((coordinate) => coordinate[1]! < 25 && coordinate[0]! > 105)) continue
      o.beginPath()
      line.forEach((coordinate, index) => {
        const [x, y] = point(coordinate)
        if (index === 0) o.moveTo(x!, y!)
        else o.lineTo(x!, y!)
      })
      o.stroke()
    }
  }
  return Cesium.SingleTileImageryProvider.fromUrl(overlay.toDataURL('image/png'), {
    rectangle: Cesium.Rectangle.fromDegrees(west, south, east, north),
  })
}

onMounted(async () => {
  const v = new Cesium.Viewer(host.value!, {
    baseLayer: false, sceneMode: Cesium.SceneMode.SCENE2D,
    mapProjection: new Cesium.WebMercatorProjection(),
    animation: false, timeline: false, geocoder: false, homeButton: false,
    sceneModePicker: false, baseLayerPicker: false, navigationHelpButton: false,
    fullscreenButton: false, infoBox: false, selectionIndicator: false,
    requestRenderMode: true, maximumRenderTimeChange: Infinity,
  })
  viewer = v // Keep Cesium outside Vue's reactive proxy graph.
  v.scene.screenSpaceCameraController.enableTilt = false
  v.scene.screenSpaceCameraController.enableRotate = false
  v.scene.globe.baseColor = Cesium.Color.fromCssColorString('#b6d3e0')
  v.scene.globe.maximumScreenSpaceError = 2
  // Full national extent, including the southern offshore features, without an opening flight.
  v.camera.setView({ destination: Cesium.Rectangle.fromDegrees(72, 1, 137, 55) })
  try {
    const response = await fetch('/china.geojson')
    if (!response.ok) throw new Error('中国边界数据加载失败')
    const data = await response.json()
    const fallback = await Cesium.TileMapServiceImageryProvider.fromUrl('/cesium/Assets/Textures/NaturalEarthII')
    if (disposed) return
    v.imageryLayers.addImageryProvider(focusChina(fallback, data))
    const key = import.meta.env.VITE_TDT_KEY
    if (key) {
      v.imageryLayers.addImageryProvider(focusChina(new Cesium.WebMapTileServiceImageryProvider({
        url: `https://t{s}.tianditu.gov.cn/img_w/wmts?tk=${key}`,
        layer: 'img', style: 'default', format: 'tiles', tileMatrixSetID: 'w',
        tilingScheme: new Cesium.WebMercatorTilingScheme(),
        subdomains: ['0', '1', '2', '3', '4', '5', '6', '7'], maximumLevel: 18,
      }), data))
    }
    const focus = await chinaOverlay(data)
    if (disposed) return
    v.imageryLayers.addImageryProvider(focus)
    v.scene.requestRender()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '地图加载失败'
    console.error(cause)
  }
})
onBeforeUnmount(() => { disposed = true; viewer?.destroy() })
</script>

<template>
  <main class="china-map-stage">
    <div ref="host" class="china-map-canvas"></div>
    <p v-if="error" class="china-map-error">{{ error }}</p>
  </main>
</template>

<style scoped>
.china-map-stage, .china-map-canvas { position: fixed; inset: 0; width: 100%; height: 100%; }
.china-map-stage { background: #dfe9ed; }
.china-map-error { position: absolute; bottom: 24px; left: 24px; background: white; color: #963d2d; padding: 12px 18px; border-radius: 8px; }
</style>
