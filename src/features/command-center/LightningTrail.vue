<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
// 别名导入：本组件内部使用原生 Map/Set 做索引，避免命名冲突
import type { Map as MapLibreMap } from 'maplibre-gl'
import type { Strike, ThreatTrack } from './data'
import { RISK_META, siteById } from './data'

/* =========================================================================
   特斯拉式"威胁防御轨迹"渲染层
   传统系统：静态打点。本层：动态轨迹推演 ——
     · 雷暴来向 → 放电点 → 地面落雷点 的发光能量弧
     · 落雷瞬间的冲击环与垂直击穿光柱
     · 传感器心跳脉冲（雷达探测圈）
     · 空间粒子质感（让底图像"活着的电磁场"）
   ========================================================================= */

const props = defineProps<{
  strikes: Strike[]
  tracks: ThreatTrack[]
  /** 推演进度 0–1，控制轨迹"绘制"到哪一刻 */
  progress: number
  selectedId: string
  visible: boolean
}>()

const emit = defineEmits<{ (event: 'pick', value: { strike: Strike; x: number; y: number }): void }>()

/**
 * 地图实例通过命令式注入，而不是 prop：
 * maplibre 的 Map 是一个 80+ 成员的重类，Vue 模板在做结构类型比较时会被
 * 深度展开，既慢又容易误判。命令式注入同时避免了把地图对象包进响应式代理。
 */
const map = shallowRef<MapLibreMap | null>(null)
function setMap(value: MapLibreMap | null) {
  map.value = value
  resize()
}
defineExpose({ setMap })

const canvas = ref<HTMLCanvasElement>()
let frame = 0
let dpr = 1
let width = 0
let height = 0
let hovered = false
let reveal = new Map<string, number>()
let particles: Array<{ x: number; y: number; vx: number; vy: number; r: number; a: number }> = []
const rings: Array<{ lon: number; lat: number; born: number; strength: number; color: string }> = []
let lastProgress = 0
/** 全部事件的推演进度索引，避免每帧重复除法 */
let showAt = new Map<string, number>()
let byId = new Map<string, Strike>()

function reindex() {
  const span = props.strikes[props.strikes.length - 1]?.t || 1
  showAt = new Map(props.strikes.map((strike) => [strike.id, strike.t / span]))
  byId = new Map(props.strikes.map((strike) => [strike.id, strike]))
}

const isPositive = (strike: Strike) => strike.polarity === 'positive'
const colorFor = (strike: Strike) =>
  isPositive(strike) ? '#ffd76b' : strike.intercepted ? '#7ff5d4' : '#8fd4ff'

/** #rrggbb → rgba()：Canvas 渐变需要带 alpha 的颜色停靠点 */
function hexToRgba(hex: string, alpha: number) {
  const value = hex.replace('#', '')
  const r = parseInt(value.slice(0, 2), 16)
  const g = parseInt(value.slice(2, 4), 16)
  const b = parseInt(value.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

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

function seedParticles() {
  // 数量刻意压到 42：粒子是氛围，不是主角。多一颗，数据的锐度就少一分。
  particles = Array.from({ length: 42 }, () => ({
    x: Math.random(),
    y: Math.random(),
    vx: (Math.random() - 0.5) * 0.00012,
    vy: -0.00004 - Math.random() * 0.00009,
    r: 0.5 + Math.random() * 1.1,
    a: 0.04 + Math.random() * 0.12,
  }))
}

/* —— 轨迹取点：按弧长比例定位"能量流"当前位置 —— */
function pointAt(points: Array<[number, number]>, fraction: number): [number, number] {
  if (points.length < 2) return points[0] ?? [0, 0]
  let total = 0
  const segments: number[] = []
  for (let index = 0; index < points.length - 1; index += 1) {
    const a = points[index]!
    const b = points[index + 1]!
    const length = Math.hypot(b[0] - a[0], b[1] - a[1])
    segments.push(length)
    total += length
  }
  let target = total * Math.min(1, Math.max(0, fraction))
  for (let index = 0; index < segments.length; index += 1) {
    const length = segments[index]!
    if (target <= length) {
      const a = points[index]!
      const b = points[index + 1]!
      const k = length === 0 ? 0 : target / length
      return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]
    }
    target -= length
  }
  return points[points.length - 1]!
}

/**
 * 威胁轨迹 = 一条"正在被绘制"的导航路线。
 * 用细描边分层模拟辉光，比 shadowBlur 快一个数量级，观感也更像精密仪器。
 * 关键改动：路线不再整条高亮，而是"全程暗线 + 已推演段的亮线"，
 * 时间推进因此可以被眼睛直接看见，而不是等一个滑块数字跳变。
 */
function strokeTrail(
  ctx: CanvasRenderingContext2D,
  projected: Array<[number, number]>,
  upto: number,
  color: string,
) {
  if (projected.length < 2) return
  const path = (limit: number) => {
    const count = Math.max(2, Math.floor(projected.length * limit))
    ctx.beginPath()
    ctx.moveTo(projected[0]![0], projected[0]![1])
    for (let index = 1; index < count; index += 1) {
      const current = projected[index]!
      const previous = projected[index - 1]!
      const cx = (previous[0] + current[0]) / 2
      const cy = (previous[1] + current[1]) / 2
      ctx.quadraticCurveTo(previous[0], previous[1], cx, cy)
    }
    const last = projected[Math.min(count, projected.length) - 1]!
    ctx.lineTo(last[0], last[1])
  }

  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  // ① 全程暗线：这场雷暴是从哪里压过来的
  path(1)
  ctx.strokeStyle = color
  ctx.globalAlpha = 0.14
  ctx.lineWidth = 1
  ctx.stroke()

  // ② 已推演段：柔和的底光
  path(upto)
  ctx.globalAlpha = 0.2
  ctx.lineWidth = 6
  ctx.stroke()

  // ③ 已推演段：细而亮的芯
  ctx.globalAlpha = 0.9
  ctx.lineWidth = 1.5
  ctx.strokeStyle = '#ffe9d2'
  ctx.stroke()
  ctx.globalAlpha = 1
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

  /* —— 1. 空间粒子：只留极少数，作为"活着的场"而不是星尘特效 —— */
  ctx.globalCompositeOperation = 'lighter'
  for (const particle of particles) {
    particle.x += particle.vx
    particle.y += particle.vy
    if (particle.y < -0.05) {
      particle.y = 1.05
      particle.x = Math.random()
    }
    if (particle.x < -0.05) particle.x = 1.05
    if (particle.x > 1.05) particle.x = -0.05
    ctx.beginPath()
    ctx.arc(particle.x * width, particle.y * height, particle.r, 0, Math.PI * 2)
    ctx.fillStyle = `rgba(150,220,255,${particle.a})`
    ctx.fill()
  }
  ctx.globalCompositeOperation = 'source-over'

  /* —— 2. 能量轨迹：把雷暴移动画成一条"导航路线" —— */
  for (const track of props.tracks) {
    const projected = track.points.map(([lon, lat]) => {
      const point = instance.project([lon, lat])
      return [point.x, point.y] as [number, number]
    })
    // 轨迹随推演"被绘制出来"，而不是跳变
    const upto = Math.min(1, 0.28 + props.progress * 0.86)
    strokeTrail(ctx, projected, upto, '#ff8a5c')

    const head = pointAt(track.points, upto)
    const headPixel = instance.project(head)
    const pulse = 0.6 + Math.sin(now / 260) * 0.4
    const gradient = ctx.createRadialGradient(
      headPixel.x,
      headPixel.y,
      0,
      headPixel.x,
      headPixel.y,
      46,
    )
    gradient.addColorStop(0, `rgba(255,214,160,${0.5 * pulse})`)
    gradient.addColorStop(0.35, 'rgba(255,138,92,.24)')
    gradient.addColorStop(1, 'rgba(255,138,92,0)')
    ctx.fillStyle = gradient
    ctx.beginPath()
    ctx.arc(headPixel.x, headPixel.y, 46, 0, Math.PI * 2)
    ctx.fill()

    // 防御响应线：从雷暴核心指向被保护资产
    const site = siteById.get(track.siteId)
    if (site) {
      const target = instance.project([site.lon, site.lat])
      ctx.setLineDash([4, 6])
      ctx.beginPath()
      ctx.moveTo(headPixel.x, headPixel.y)
      ctx.lineTo(target.x, target.y)
      ctx.strokeStyle = 'rgba(255,159,69,.42)'
      ctx.lineWidth = 1
      ctx.stroke()
      ctx.setLineDash([])
    }
  }

  /* —— 3. 落雷事件：精度，而不是雾 ——
     早期版本给每一颗落雷都叠了三层加色发光，420 颗在屏幕上互相叠加，
     最后糊成几团白斑。那是"眼花缭乱"的根源。
     现在的规则：
       · 每颗落雷 = 一个极小的实心白芯 + 一圈细色环（锐利、可辨、可点）
       · 只有"刚出现的 3 秒内"和"最强的前 40 颗"才允许发光
       · 永不对落雷做整片填充
  */
  const visibleStrikes: Strike[] = []
  for (const strike of props.strikes) {
    if ((showAt.get(strike.id) ?? 1) > props.progress) continue
    if (reveal.get(strike.id) === undefined) {
      reveal.set(strike.id, now)
      if (strike.intercepted && strike.current > 60) {
        rings.push({
          lon: strike.lon,
          lat: strike.lat,
          born: now,
          strength: strike.current,
          color: colorFor(strike),
        })
      }
    }
    visibleStrikes.push(strike)
  }

  const strongest = new Set(
    [...visibleStrikes]
      .sort((a, b) => b.current - a.current)
      .slice(0, 40)
      .map((strike) => strike.id),
  )

  ctx.globalCompositeOperation = 'lighter'
  for (const strike of visibleStrikes) {
    const point = instance.project([strike.lon, strike.lat])
    if (point.x < -40 || point.y < -40 || point.x > width + 40 || point.y > height + 40) continue
    const born = now - (reveal.get(strike.id) ?? now)
    const fresh = born < 3000
    const age = props.progress - (showAt.get(strike.id) ?? 0)
    const fade = age < 0.02 ? 1 : Math.max(0.22, 1 - age * 1.4)
    const color = colorFor(strike)
    // 尺寸只跟幅值挂钩，且刻意压得很小：地图上要能数得清，而不是糊成一片
    const radius = 1.5 + Math.min(3.6, strike.current / 42)

    // 冲击波：只给刚发生的那一颗，制造"刚刚打下来"的即时感
    if (fresh) {
      const wave = born / 3000
      ctx.beginPath()
      ctx.arc(point.x, point.y, radius + wave * 26, 0, Math.PI * 2)
      ctx.strokeStyle = color
      ctx.globalAlpha = (1 - wave) * 0.5
      ctx.lineWidth = 1.1
      ctx.stroke()
    }

    // 发光：只给最新的与最强的，其余保持锐利
    if (fresh || strongest.has(strike.id)) {
      const glow = ctx.createRadialGradient(point.x, point.y, 0, point.x, point.y, radius * 5)
      glow.addColorStop(0, `rgba(255,255,255,${0.24 * fade})`)
      glow.addColorStop(0.4, `${hexToRgba(color, 0.18 * fade)}`)
      glow.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = glow
      ctx.globalAlpha = 1
      ctx.beginPath()
      ctx.arc(point.x, point.y, radius * 5, 0, Math.PI * 2)
      ctx.fill()
    }

    ctx.globalAlpha = 0.9 * fade
    ctx.beginPath()
    ctx.arc(point.x, point.y, radius * 0.5, 0, Math.PI * 2)
    ctx.fillStyle = '#ffffff'
    ctx.fill()

    ctx.globalAlpha = 0.62 * fade
    ctx.beginPath()
    ctx.arc(point.x, point.y, radius, 0, Math.PI * 2)
    ctx.strokeStyle = color
    ctx.lineWidth = 0.9
    ctx.stroke()
  }
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'

  /* —— 4. 冲击环：落雷在地面像雨滴入湖 —— */
  for (let index = rings.length - 1; index >= 0; index -= 1) {
    const ring = rings[index]!
    const life = (now - ring.born) / 2200
    if (life > 1) {
      rings.splice(index, 1)
      continue
    }
    const point = instance.project([ring.lon, ring.lat])
    ctx.beginPath()
    ctx.arc(point.x, point.y, 6 + life * (60 + ring.strength * 0.5), 0, Math.PI * 2)
    ctx.strokeStyle = ring.color
    ctx.globalAlpha = (1 - life) * 0.42
    ctx.lineWidth = 1.6 - life
    ctx.stroke()
    ctx.globalAlpha = 1
  }

  /* —— 5. 选中事件：垂直击穿光柱 + 目标资产护盾 —— */
  const selected = props.selectedId ? byId.get(props.selectedId) : undefined
  if (selected) {
    const point = instance.project([selected.lon, selected.lat])
    const flash = 0.55 + Math.sin(now / 90) * 0.45
    ctx.strokeStyle = isPositive(selected) ? '#ffe6a8' : '#d7f2ff'
    ctx.globalAlpha = flash
    ctx.lineWidth = 1.2
    ctx.beginPath()
    ctx.moveTo(point.x, point.y - 74)
    let segmentY = point.y - 74
    while (segmentY < point.y - 6) {
      segmentY += 7
      const offset = Math.sin(segmentY * 1.7 + now / 60) * 4.2
      ctx.lineTo(point.x + offset, segmentY)
    }
    ctx.stroke()
    ctx.globalAlpha = 0.3
    ctx.lineWidth = 4
    ctx.stroke()
    ctx.globalAlpha = 1

    const site = siteById.get(selected.siteId)
    if (site) {
      const target = instance.project([site.lon, site.lat])
      ctx.beginPath()
      ctx.arc(target.x, target.y, 16 + Math.sin(now / 420) * 2, 0, Math.PI * 2)
      ctx.strokeStyle = RISK_META[site.risk].color
      ctx.globalAlpha = 0.5
      ctx.lineWidth = 1.2
      ctx.stroke()
      ctx.globalAlpha = 0.16
      ctx.lineWidth = 6
      ctx.stroke()
      ctx.globalAlpha = 1
    }
  }

  /* —— 6. 传感器心跳：定位仪在地图上产生周期性脉冲 —— */
  for (const site of siteById.values()) {
    if (site.risk !== 'impact' && site.risk !== 'warning') continue
    const point = instance.project([site.lon, site.lat])
    const beat = (now / 2600 + site.lon * 0.01) % 1
    ctx.beginPath()
    ctx.arc(point.x, point.y, 8 + beat * 30, 0, Math.PI * 2)
    ctx.strokeStyle = RISK_META[site.risk].color
    ctx.globalAlpha = 0.3 * (1 - beat)
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.globalAlpha = 1
  }

  lastProgress = props.progress
}

/* —— 拾取：在 canvas 上做像素级命中，不依赖地图要素 —— */
function projectHit(clientX: number, clientY: number, tolerance: number) {
  const instance = map.value
  const element = canvas.value
  if (!instance || !element) return null
  const rect = element.getBoundingClientRect()
  const x = clientX - rect.left
  const y = clientY - rect.top
  let best: Strike | null = null
  let bestDistance = tolerance
  for (const strike of props.strikes) {
    if ((showAt.get(strike.id) ?? 1) > props.progress) continue
    const point = instance.project([strike.lon, strike.lat])
    const distance = Math.hypot(point.x - x, point.y - y)
    if (distance < bestDistance) {
      bestDistance = distance
      best = strike
    }
  }
  return best
}

function onClick(event: MouseEvent) {
  const strike = projectHit(event.clientX, event.clientY, 26)
  if (!strike) return
  const rect = canvas.value?.getBoundingClientRect()
  emit('pick', { strike, x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) })
}

function onMove(event: MouseEvent) {
  const element = canvas.value
  if (!element) return
  const found = projectHit(event.clientX, event.clientY, 16)
  hovered = !!found
  element.style.cursor = found ? 'pointer' : ''
  if (found) {
    element.title = `雷击事件 ${found.id} · 峰值 ${found.current} kA`
  } else {
    element.removeAttribute('title')
  }
}

onMounted(() => {
  reindex()
  seedParticles()
  resize()
  window.addEventListener('resize', resize)
  frame = requestAnimationFrame(draw)
})

onBeforeUnmount(() => {
  cancelAnimationFrame(frame)
  window.removeEventListener('resize', resize)
})

watch(() => props.strikes, () => reindex())
watch(
  () => props.progress,
  (value) => {
    if (value < lastProgress - 0.04) {
      // 时间回退：清空绘制状态，让轨迹重新被"画"出来
      reveal = new Map()
      rings.length = 0
    }
  },
)
watch(
  () => props.visible,
  (value) => {
    if (!value) canvas.value?.getContext('2d')?.clearRect(0, 0, width, height)
  },
)
</script>

<template>
  <canvas
    ref="canvas"
    class="cc-trail"
    :class="{ 'is-hover': hovered }"
    @click="onClick"
    @mousemove="onMove"
    @mouseleave="hovered = false"
  ></canvas>
</template>

<style scoped>
.cc-trail {
  position: absolute;
  inset: 0;
  z-index: 3;
  width: 100%;
  height: 100%;
  pointer-events: auto;
  background: transparent;
}

.cc-trail.is-hover {
  filter: brightness(1.06);
}
</style>
