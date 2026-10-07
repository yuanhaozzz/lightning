<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import type { Map as MapLibreMap } from 'maplibre-gl'
import {
  assetSites,
  computeThreats,
  distanceKm,
  radarCells,
  siteById,
  stormCells,
  strikes,
  WARNING_LADDER,
  type SiteThreat,
} from './data'
import { getSiteTwin } from './twin'
import type { SiteTwin } from './twin'

/* =========================================================================
   数字孪生渲染层 / TWIN CANVAS
   -------------------------------------------------------------------------
   两个尺度共用一块画布。所有图形都只回答一个问题：
     「雷暴在哪里、离我的矿区多远、现在该干什么。」

   【全国尺度】雷暴临近预警
     ① 雷达回波 —— 按 dBZ 着色，一眼看出"这片云有多强、往哪飘"
     ② 闪电点   —— 小实心点 + 细环，只有刚发生的才发光
     ③ 矿区 + 四级预警距离圈（200/150/100/50 km）
     ④ 雷达扫描 —— 从矿区中心向外扫，像扫一扫找附近的人
     ⑤ 最近雷暴的连线与距离读数

   【场区尺度】保护范围孪生
     ① 接闪杆保护半径（工程算法得出）  ② 圈外设备标红  ③ 雷电流路径
   ========================================================================= */

const props = defineProps<{
  strikes: typeof strikes
  progress: number
  selectedId: string
  scale: 'network' | 'site'
  siteId: string
  visible: boolean
  showEnvelope: boolean
}>()

const emit = defineEmits<{
  (event: 'pick-site', value: { siteId: string }): void
  (event: 'pick-strike', value: { strike: (typeof strikes)[number] }): void
}>()

const canvas = ref<HTMLCanvasElement>()
const map = shallowRef<MapLibreMap | null>(null)
let frame = 0
let dpr = 1
let width = 0
let height = 0
const revealed = new Set<string>()
let lastProgress = 0
let cursorX = -999
let cursorY = -999

/** 按客户预案算出的全场区预警（刷新时确定，不随机） */
const threats: SiteThreat[] = computeThreats()
const threatBySite = new Map(threats.map((threat) => [threat.siteId, threat]))

function setMap(value: MapLibreMap | null) {
  map.value = value
  resize()
}
defineExpose({ setMap })

function resize() {
  const element = canvas.value
  if (!element) return
  const rect = element.getBoundingClientRect()
  dpr = Math.min(2, window.devicePixelRatio || 1)
  width = rect.width
  height = rect.height
  element.width = Math.max(1, Math.floor(width * dpr))
  element.height = Math.max(1, Math.floor(height * dpr))
}

function metersToDegrees(lat: number, meters: number) {
  return {
    lonDeg: meters / (111320 * Math.cos((lat * Math.PI) / 180)),
    latDeg: meters / 111320,
  }
}

function circlePoints(
  lon: number,
  lat: number,
  radiusMeters: number,
  segments = 72,
): Array<[number, number]> {
  const { lonDeg, latDeg } = metersToDegrees(lat, radiusMeters)
  return Array.from({ length: segments + 1 }, (_, index) => {
    const angle = (index / segments) * Math.PI * 2
    return [lon + Math.cos(angle) * lonDeg, lat + Math.sin(angle) * latDeg] as [number, number]
  })
}

function hexToRgba(hex: string, alpha: number) {
  const value = hex.replace('#', '')
  return `rgba(${parseInt(value.slice(0, 2), 16)},${parseInt(value.slice(2, 4), 16)},${parseInt(
    value.slice(4, 6),
    16,
  )},${alpha})`
}

/** 雷达回波配色：与气象业务习惯一致（弱=蓝绿，强=黄橙红紫） */
function dbzColor(dbz: number) {
  if (dbz >= 60) return '#e8394f'
  if (dbz >= 50) return '#ff7438'
  if (dbz >= 40) return '#ffd229'
  if (dbz >= 30) return '#b9e72b'
  if (dbz >= 20) return '#22c98a'
  return '#2a9df4'
}

/** 事件按推演进度逐颗显现：分母取最大时间戳，避免写死魔法数字 */
const span = () => props.strikes[props.strikes.length - 1]?.t || 1
const strikeShown = (strike: (typeof strikes)[number]) => strike.t / span() <= props.progress

/* ============================ 全国尺度 ============================ */
function drawNetwork(ctx: CanvasRenderingContext2D, instance: MapLibreMap, now: number) {
  /** 屏幕坐标缓存，供命中判定与连线复用 */
  const project = (lon: number, lat: number) => {
    const point = instance.project([lon, lat])
    return [point.x, point.y] as [number, number]
  }

  /* ① 雷达回波：按 dBZ 着色、按强度给透明度。
     这一层是"云在哪"，必须有体积感，但不能盖过底下的矿区与距离圈。 */
  ctx.globalCompositeOperation = 'lighter'
  for (const cell of radarCells) {
    const point = project(cell.lon, cell.lat)
    if (point[0] < -80 || point[1] < -80 || point[0] > width + 80 || point[1] > height + 80) continue
    // 半径随缩放变化：把 km 折算成像素
    const edge = project(cell.lon + metersToDegrees(cell.lat, cell.radius * 1000).lonDeg, cell.lat)
    const radius = Math.max(6, Math.abs(edge[0] - point[0]))
    const color = dbzColor(cell.dbz)
    const gradient = ctx.createRadialGradient(point[0], point[1], 0, point[0], point[1], radius)
    gradient.addColorStop(0, hexToRgba(color, 0.3))
    gradient.addColorStop(0.55, hexToRgba(color, 0.13))
    gradient.addColorStop(1, hexToRgba(color, 0))
    ctx.fillStyle = gradient
    ctx.beginPath()
    ctx.arc(point[0], point[1], radius, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalCompositeOperation = 'source-over'

  /* ② 闪电点：小实心点 + 细环，只有最新出现的才发光 */
  const live = props.strikes.filter((strike) => strikeShown(strike))
  const strongest = new Set(
    [...live]
      .sort((a, b) => b.current - a.current)
      .slice(0, 26)
      .map((strike) => strike.id),
  )
  ctx.globalCompositeOperation = 'lighter'
  for (const strike of live) {
    const point = project(strike.lon, strike.lat)
    if (point[0] < -30 || point[1] < -30 || point[0] > width + 30 || point[1] > height + 30) continue
    const isNew = !revealed.has(strike.id)
    if (isNew) revealed.add(strike.id)
    const color =
      strike.polarity === 'positive' ? '#ffd76b' : strike.intercepted ? '#7ff5d4' : '#9fdcff'
    const radius = 1.4 + Math.min(3, strike.current / 48)
    if (isNew || strongest.has(strike.id)) {
      const glow = ctx.createRadialGradient(point[0], point[1], 0, point[0], point[1], radius * 4.5)
      glow.addColorStop(0, 'rgba(255,255,255,.2)')
      glow.addColorStop(0.5, hexToRgba(color, 0.14))
      glow.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = glow
      ctx.beginPath()
      ctx.arc(point[0], point[1], radius * 4.5, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.fillStyle = '#ffffff'
    ctx.globalAlpha = 0.9
    ctx.beginPath()
    ctx.arc(point[0], point[1], radius * 0.55, 0, Math.PI * 2)
    ctx.fill()
    ctx.globalAlpha = 0.5
    ctx.strokeStyle = color
    ctx.lineWidth = 0.9
    ctx.beginPath()
    ctx.arc(point[0], point[1], radius, 0, Math.PI * 2)
    ctx.stroke()
    ctx.globalAlpha = 1
  }
  ctx.globalCompositeOperation = 'source-over'

  /* ③ 雷暴移动轨迹：暗线 = 已走过的路径，亮线带箭头 = 未来 30 分钟落区 */
  for (const storm of stormCells) {
    const from = project(storm.lon, storm.lat)
    const predicted = [
      storm.lon + (storm.forecast[1]![0] - storm.lon) * 0.55,
      storm.lat + (storm.forecast[1]![1] - storm.lat) * 0.55,
    ] as [number, number]
    const to = project(predicted[0], predicted[1])
    ctx.setLineDash([4, 5])
    ctx.beginPath()
    ctx.moveTo(from[0], from[1])
    ctx.lineTo(to[0], to[1])
    ctx.strokeStyle = 'rgba(255,180,120,.42)'
    ctx.lineWidth = 1.1
    ctx.stroke()
    ctx.setLineDash([])
    // 箭头：一眼看出"它正朝谁去"
    const angle = Math.atan2(to[1] - from[1], to[0] - from[0])
    ctx.beginPath()
    ctx.moveTo(to[0], to[1])
    ctx.lineTo(to[0] - Math.cos(angle - 0.4) * 8, to[1] - Math.sin(angle - 0.4) * 8)
    ctx.lineTo(to[0] - Math.cos(angle + 0.4) * 8, to[1] - Math.sin(angle + 0.4) * 8)
    ctx.closePath()
    ctx.fillStyle = 'rgba(255,180,120,.7)'
    ctx.fill()
  }

  /* ④ 矿区 + 四级预警距离圈 + 雷达扫描 */
  for (const site of assetSites) {
    const threat = threatBySite.get(site.id)!
    const center = project(site.lon, site.lat)
    if (center[0] < -400 || center[1] < -400 || center[0] > width + 400 || center[1] > height + 400)
      continue
    const level = threat.warning.level
    const color = threat.warning.color

    /* 距离圈：四道，只在被威胁的矿区上实显；其余矿区保持极淡，避免满屏同心圆 */
    const active = level >= 2
    for (const step of WARNING_LADDER) {
      const ring = circlePoints(site.lon, site.lat, step.distance * 1000, 96).map(([lon, lat]) =>
        project(lon, lat),
      )
      ctx.beginPath()
      ctx.moveTo(ring[0]![0], ring[0]![1])
      for (const point of ring) ctx.lineTo(point[0], point[1])
      ctx.closePath()
      const isTriggered = level >= step.level && level > 0
      ctx.strokeStyle = isTriggered
        ? hexToRgba(color, step.level === level ? 0.5 : 0.26)
        : `rgba(150,205,240,${active ? 0.14 : 0.07})`
      ctx.lineWidth = isTriggered && step.level === level ? 1.4 : 1
      if (isTriggered && step.level === level) {
        ctx.setLineDash([])
        ctx.stroke()
        // 被越过的那一道加一圈外发光，作为"已进入该级别"的强调
        ctx.strokeStyle = hexToRgba(color, 0.12)
        ctx.lineWidth = 7
      } else {
        ctx.setLineDash([2, 6])
      }
      ctx.stroke()
      ctx.setLineDash([])
    }

    /* 距离圈标注：只给"最近的那一道"标数字，避免四个数字叠在一起 */
    if (level > 0) {
      const labelStep = WARNING_LADDER.find((step) => step.level === level - 1) ?? WARNING_LADDER[0]!
      const anchor = circlePoints(site.lon, site.lat, labelStep.distance * 1000, 96)[0]!
      const point = project(anchor[0], anchor[1])
      ctx.font = '10px ui-monospace, monospace'
      ctx.fillStyle = hexToRgba(color, 0.8)
      ctx.textAlign = 'center'
      ctx.fillText(`${labelStep.distance} km`, point[0], point[1] - 4)
    }

    /* 雷达扫描：从矿区向外扫一圈。
       这是"扫一扫找附近的人"的那个观感 —— 它同时回答了
       "我在盯着哪个矿区"和"我在探测什么范围"。 */
    if (active) {
      const phase = ((now / 4600) % 1) * Math.PI * 2
      const maxRadius = project(
        site.lon + metersToDegrees(site.lat, 200000).lonDeg,
        site.lat,
      )[0]
      const pixelRadius = Math.abs(maxRadius - center[0])
      const sweep = ctx.createRadialGradient(
        center[0],
        center[1],
        0,
        center[0],
        center[1],
        pixelRadius,
      )
      sweep.addColorStop(0, hexToRgba(color, 0.26))
      sweep.addColorStop(0.55, hexToRgba(color, 0.1))
      sweep.addColorStop(1, hexToRgba(color, 0))
      ctx.beginPath()
      ctx.moveTo(center[0], center[1])
      ctx.arc(center[0], center[1], pixelRadius, phase - 0.42, phase + 0.06)
      ctx.closePath()
      ctx.globalCompositeOperation = 'lighter'
      ctx.fillStyle = sweep
      ctx.fill()
      // 扫描前沿：一道锐利的亮线
      ctx.beginPath()
      ctx.moveTo(center[0], center[1])
      ctx.lineTo(
        center[0] + Math.cos(phase) * pixelRadius,
        center[1] + Math.sin(phase) * pixelRadius,
      )
      ctx.strokeStyle = hexToRgba(color, 0.55)
      ctx.lineWidth = 1.2
      ctx.stroke()
      ctx.globalCompositeOperation = 'source-over'
    }

    /* 矿区锚点：一个环 + 一个芯点，环的颜色就是预警等级颜色 */
    const pulse = (Math.sin(now / 700 + site.lon) + 1) / 2
    ctx.beginPath()
    ctx.arc(center[0], center[1], 8, 0, Math.PI * 2)
    ctx.strokeStyle = hexToRgba(color, active ? 0.9 : 0.45)
    ctx.lineWidth = 1.3
    ctx.stroke()
    if (active) {
      ctx.beginPath()
      ctx.arc(center[0], center[1], 8 + pulse * 10, 0, Math.PI * 2)
      ctx.strokeStyle = hexToRgba(color, 0.34 * (1 - pulse))
      ctx.lineWidth = 1
      ctx.stroke()
    }
    ctx.beginPath()
    ctx.arc(center[0], center[1], 2.8, 0, Math.PI * 2)
    ctx.fillStyle = color
    ctx.fill()
    ctx.beginPath()
    ctx.arc(center[0], center[1], 1.2, 0, Math.PI * 2)
    ctx.fillStyle = '#ffffff'
    ctx.fill()

    /* 矿区名称与预警读数：名称在下（贴着锚点），读数在上。
       上下分置是为了让相邻矿区的文字不挤在一起 —— 光点堆叠时，
       文字互相压住比没有文字更难读。 */
    if (level > 0) {
      ctx.font = '12px "PingFang SC", "Microsoft YaHei", sans-serif'
      ctx.fillStyle = 'rgba(236,246,255,.94)'
      ctx.textAlign = 'center'
      ctx.fillText(site.name, center[0], center[1] + 30)
      ctx.font = '10px ui-monospace, monospace'
      ctx.fillStyle = hexToRgba(color, 0.92)
      ctx.fillText(`${threat.warning.label} · 距雷暴 ${threat.gapKm} km`, center[0], center[1] - 20)
    }

    /* 雷暴来向连线：把"它从哪来、离我多远"直接画出来 */
    if (level >= 2) {
      const stormPoint = project(threat.stormLon, threat.stormLat)
      ctx.setLineDash([3, 5])
      ctx.beginPath()
      ctx.moveTo(center[0], center[1])
      ctx.lineTo(stormPoint[0], stormPoint[1])
      ctx.strokeStyle = hexToRgba(color, 0.42)
      ctx.lineWidth = 1.1
      ctx.stroke()
      ctx.setLineDash([])
    }
  }
}

/* ============================ 场区尺度 ============================ */
function drawSite(ctx: CanvasRenderingContext2D, instance: MapLibreMap, now: number, twin: SiteTwin) {
  const site = siteById.get(twin.siteId)!
  const center = instance.project([site.lon, site.lat])
  const { lonDeg, latDeg } = metersToDegrees(site.lat, 1)
  const toPixel = (x: number, y: number) => {
    const point = instance.project([site.lon + x * lonDeg, site.lat + y * latDeg])
    return [point.x, point.y] as [number, number]
  }
  const oneMeter = toPixel(1, 0)
  const metersPerPixel = Math.hypot(oneMeter[0] - center.x, oneMeter[1] - center.y)
  const scale = metersPerPixel > 0 ? 1 / metersPerPixel : 1
  const placedLabels: Array<{ x: number; y: number; w: number; h: number }> = []

  /* ① 场区作业范围 */
  const corners = [
    [-twin.extent, -twin.extent],
    [twin.extent, -twin.extent],
    [twin.extent, twin.extent],
    [-twin.extent, twin.extent],
  ].map(([x, y]) => toPixel(x!, y!)) as Array<[number, number]>
  ctx.setLineDash([5, 6])
  ctx.beginPath()
  ctx.moveTo(corners[0]![0], corners[0]![1])
  for (const corner of corners.slice(1)) ctx.lineTo(corner[0], corner[1])
  ctx.closePath()
  ctx.strokeStyle = 'rgba(150,205,240,.26)'
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.setLineDash([])

  /* ② 保护半径：看得见的"保护伞" */
  if (props.showEnvelope) {
    for (const zone of twin.zones) {
      const rod = twin.devices.find((device) => `${twin.siteId}-${device.name}` === zone.deviceId)
      if (!rod) continue
      const ring = circlePoints(
        site.lon + rod.x * lonDeg,
        site.lat + rod.y * latDeg,
        zone.radius,
        72,
      ).map(([lon, lat]) => {
        const point = instance.project([lon, lat])
        return [point.x, point.y] as [number, number]
      })
      const rodPoint = toPixel(rod.x, rod.y)
      ctx.beginPath()
      ctx.moveTo(ring[0]![0], ring[0]![1])
      for (const point of ring.slice(1)) ctx.lineTo(point[0], point[1])
      ctx.closePath()
      const gradient = ctx.createRadialGradient(
        rodPoint[0],
        rodPoint[1],
        0,
        rodPoint[0],
        rodPoint[1],
        zone.radius * scale,
      )
      gradient.addColorStop(0, 'rgba(86,224,255,.3)')
      gradient.addColorStop(0.55, 'rgba(70,190,255,.13)')
      gradient.addColorStop(1, 'rgba(70,190,255,.03)')
      ctx.fillStyle = gradient
      ctx.fill()
      ctx.strokeStyle = 'rgba(150,240,255,.6)'
      ctx.lineWidth = 1.3
      ctx.stroke()
      ctx.strokeStyle = 'rgba(80,210,255,.16)'
      ctx.lineWidth = 6
      ctx.stroke()
      ctx.font = '10px ui-monospace, monospace'
      ctx.fillStyle = 'rgba(159,233,255,.66)'
      ctx.textAlign = 'center'
      ctx.fillText(`R${zone.radius}m`, rodPoint[0], rodPoint[1] - 20)
    }
  }

  /* ③ SPD 有效保护距离 */
  for (const device of twin.devices) {
    if (device.kind !== 'SPD' || !device.reach) continue
    const from = toPixel(device.x, device.y)
    ctx.beginPath()
    ctx.arc(from[0], from[1], device.reach * scale, 0, Math.PI * 2)
    ctx.strokeStyle = hexToRgba(device.covered ? '#35d6a4' : '#ff3b52', 0.4)
    ctx.lineWidth = 1
    ctx.stroke()
  }

  /* ④ 设备节点：只有四种形状，每种都能一眼认出是什么 */
  for (const device of twin.devices) {
    const point = toPixel(device.x, device.y)
    const color = !device.covered
      ? '#ff3b52'
      : device.state === 'action'
        ? '#ffd76b'
        : device.state === 'offline'
          ? '#8794a4'
          : '#7fe6ff'

    if (!device.covered) {
      const pulse = (Math.sin(now / 620) + 1) / 2
      ctx.beginPath()
      ctx.arc(point[0], point[1], 15 + pulse * 8, 0, Math.PI * 2)
      ctx.strokeStyle = hexToRgba('#ff3b52', 0.5 * (1 - pulse))
      ctx.lineWidth = 1.2
      ctx.stroke()
    }

    if (device.kind === '接闪杆') {
      ctx.beginPath()
      ctx.moveTo(point[0], point[1])
      ctx.lineTo(point[0], point[1] - 13)
      ctx.strokeStyle = color
      ctx.lineWidth = 1.4
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(point[0], point[1] - 13, 2.6, 0, Math.PI * 2)
      ctx.fillStyle = color
      ctx.fill()
    } else if (device.kind === '接地网') {
      ctx.strokeStyle = hexToRgba(color, 0.85)
      ctx.lineWidth = 1.2
      for (let line = 0; line < 3; line += 1) {
        ctx.beginPath()
        ctx.moveTo(point[0] - 11, point[1] - 6 + line * 6)
        ctx.lineTo(point[0] + 11, point[1] - 6 + line * 6)
        ctx.stroke()
      }
    } else if (device.kind === 'SPD') {
      ctx.beginPath()
      ctx.rect(point[0] - 6, point[1] - 6, 12, 12)
      ctx.strokeStyle = color
      ctx.lineWidth = 1.4
      ctx.stroke()
      ctx.fillStyle = hexToRgba(color, 0.22)
      ctx.fill()
    } else {
      ctx.beginPath()
      ctx.moveTo(point[0], point[1] - 7)
      ctx.lineTo(point[0] + 7, point[1])
      ctx.lineTo(point[0], point[1] + 7)
      ctx.lineTo(point[0] - 7, point[1])
      ctx.closePath()
      ctx.strokeStyle = color
      ctx.lineWidth = 1.3
      ctx.stroke()
    }

    const needsLabel = !device.covered || device.kind === '接闪杆' || device.kind === 'SPD'
    if (needsLabel) {
      const textWidth = device.name.length * 11 + 6
      const candidates: Array<[number, number]> = [
        [point[0] + 13, point[1] + 4],
        [point[0] + 13, point[1] + 18],
        [point[0] - 13 - textWidth, point[1] + 4],
        [point[0] - 13 - textWidth, point[1] + 18],
      ]
      const slot = candidates.find(([x, y]) => {
        const box = { x: x - 2, y: y - 12, w: textWidth, h: 16 }
        return !placedLabels.some(
          (other) =>
            box.x < other.x + other.w &&
            box.x + box.w > other.x &&
            box.y < other.y + other.h &&
            box.y + box.h > other.y,
        )
      })
      if (slot || !device.covered) {
        const [x, y] = slot ?? [point[0] + 13, point[1] + 4]
        placedLabels.push({ x: x - 2, y: y - 12, w: textWidth, h: 16 })
        ctx.font = '11px "PingFang SC", "Microsoft YaHei", sans-serif'
        ctx.textAlign = 'left'
        ctx.fillStyle = device.covered ? 'rgba(232,246,255,.88)' : '#ffd0d6'
        ctx.fillText(device.name, x, y)
      }
    }
  }

  /* ⑤ 雷电流路径：云 → 接闪杆 → 接地网 */
  const recent = twin.events.slice(0, 3)
  recent.forEach((strike, index) => {
    const target = twin.devices.find((device) => device.kind === '接闪杆')
    if (!target) return
    const head = toPixel(target.x + index * 26, target.y + index * 8)
    const cloud: [number, number] = [head[0] - 30 - index * 16, head[1] - 130 - index * 18]
    const gridDevice = twin.devices.find((device) => device.kind === '接地网')
    const grid = toPixel(gridDevice?.x ?? 0, gridDevice?.y ?? 0)
    const cycle = (now / 2200 + index * 0.33) % 1

    ctx.beginPath()
    ctx.moveTo(cloud[0], cloud[1])
    let y = cloud[1]
    while (y < head[1] - 6) {
      y += 8
      ctx.lineTo(head[0] + Math.sin(y * 0.7 + now / 240) * 3, y)
    }
    ctx.strokeStyle = hexToRgba('#ffd76b', 0.28 + cycle * 0.5)
    ctx.lineWidth = 1.2
    ctx.stroke()

    ctx.beginPath()
    ctx.moveTo(head[0], head[1])
    ctx.lineTo(head[0], grid[1])
    ctx.lineTo(grid[0], grid[1])
    ctx.strokeStyle = hexToRgba('#7ff5d4', 0.24 + cycle * 0.42)
    ctx.lineWidth = 1.3
    ctx.stroke()

    ctx.font = '10px ui-monospace, monospace'
    ctx.fillStyle = hexToRgba('#fff3d6', 0.5 + cycle * 0.5)
    ctx.textAlign = 'left'
    ctx.fillText(`${strike.current} kA`, head[0] + 12, head[1] - 26 - index * 13)
  })

  /* ⑥ 比例尺 */
  const barMeters = 100
  const barWidth = barMeters * scale
  ctx.beginPath()
  ctx.moveTo(width - 46 - barWidth, height - 118)
  ctx.lineTo(width - 46, height - 118)
  ctx.moveTo(width - 46 - barWidth, height - 122)
  ctx.lineTo(width - 46 - barWidth, height - 114)
  ctx.moveTo(width - 46, height - 122)
  ctx.lineTo(width - 46, height - 114)
  ctx.strokeStyle = 'rgba(190,226,248,.7)'
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.font = '10px ui-monospace, monospace'
  ctx.fillStyle = 'rgba(190,226,248,.7)'
  ctx.textAlign = 'center'
  ctx.fillText('100 m', width - 46 - barWidth / 2, height - 124)
}

function draw(now: number) {
  frame = requestAnimationFrame(draw)
  const element = canvas.value
  const instance = map.value
  if (!element || !instance) return
  const ctx = element.getContext('2d')
  if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, width, height)
  if (!props.visible) return

  if (props.scale === 'site' && props.siteId) {
    const twin = getSiteTwin(props.siteId)
    if (twin) drawSite(ctx, instance, now, twin)
    return
  }
  drawNetwork(ctx, instance, now)

  /* 矿区命中区：鼠标移到锚点附近时给出手型光标 */
  const hovered = hoverSite(instance)
  element.style.cursor = hovered ? 'pointer' : 'default'
}

/** 命中"矿区锚点"：半径 22px，比视觉锚点大一圈，方便鼠标点中 */
function hoverSite(instance: MapLibreMap) {
  for (const site of assetSites) {
    const point = instance.project([site.lon, site.lat])
    if (Math.hypot(point.x - cursorX, point.y - cursorY) < 22) return site
  }
  return null
}

function hitStrike(instance: MapLibreMap) {
  let best: (typeof strikes)[number] | null = null
  let bestDistance = 20
  for (const strike of props.strikes) {
    if (!strikeShown(strike)) continue
    const point = instance.project([strike.lon, strike.lat])
    const distance = Math.hypot(point.x - cursorX, point.y - cursorY)
    if (distance < bestDistance) {
      bestDistance = distance
      best = strike
    }
  }
  return best
}

function onMove(event: MouseEvent) {
  const rect = canvas.value?.getBoundingClientRect()
  cursorX = event.clientX - (rect?.left ?? 0)
  cursorY = event.clientY - (rect?.top ?? 0)
}

function onClick() {
  const instance = map.value
  if (!instance) return
  const site = hoverSite(instance)
  if (site) {
    emit('pick-site', { siteId: site.id })
    return
  }
  const strike = hitStrike(instance)
  if (strike) emit('pick-strike', { strike })
}

onMounted(() => {
  resize()
  window.addEventListener('resize', resize)
  frame = requestAnimationFrame(draw)
})

onBeforeUnmount(() => {
  cancelAnimationFrame(frame)
  window.removeEventListener('resize', resize)
})

watch(
  () => props.progress,
  (value) => {
    if (value < lastProgress - 0.04) revealed.clear()
    lastProgress = value
  },
)
</script>

<template>
  <canvas ref="canvas" class="twin" @click="onClick" @mousemove="onMove"></canvas>
</template>

<style scoped>
.twin {
  position: absolute;
  inset: 0;
  z-index: 3;
  width: 100%;
  height: 100%;
  background: transparent;
}
</style>
