<script setup lang="ts">
import { computed, ref } from 'vue'

const props = defineProps<{
  points: number[]
  yMax: number
  yTicks: number[]
  xLabels: string[]
  accent: string
  unit: string
}>()

const VIEW_W = 434
const VIEW_H = 254
const PAD = { left: 46, right: 16, top: 16, bottom: 30 }
const PLOT_W = VIEW_W - PAD.left - PAD.right
const PLOT_H = VIEW_H - PAD.top - PAD.bottom

const gradientId = `ws-line-${Math.random().toString(36).slice(2, 9)}`
const glowId = `${gradientId}-glow`

const coordinates = computed(() =>
  props.points.map((value, index) => {
    const x = PAD.left + (props.points.length === 1 ? PLOT_W / 2 : (index / (props.points.length - 1)) * PLOT_W)
    const y = PAD.top + (1 - Math.min(value, props.yMax) / props.yMax) * PLOT_H
    return { x, y, value, label: props.xLabels[index] ?? '' }
  }),
)

const linePath = computed(() =>
  coordinates.value.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' '),
)
const areaPath = computed(() => {
  const list = coordinates.value
  if (!list.length) return ''
  const base = PAD.top + PLOT_H
  return `M${list[0]!.x.toFixed(2)} ${base} ${list
    .map((point) => `L${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(' ')} L${list.at(-1)!.x.toFixed(2)} ${base} Z`
})

const hovered = ref<number | null>(null)
const tickY = (tick: number) => PAD.top + (1 - tick / props.yMax) * PLOT_H
</script>

<template>
  <div class="ws-chart ws-chart--line">
    <svg :viewBox="`0 0 ${VIEW_W} ${VIEW_H}`" role="img" :aria-label="`${unit} 折线图`">
      <defs>
        <linearGradient :id="gradientId" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" :stop-color="accent" stop-opacity="0.52" />
          <stop offset="55%" :stop-color="accent" stop-opacity="0.16" />
          <stop offset="100%" :stop-color="accent" stop-opacity="0" />
        </linearGradient>
        <filter :id="glowId" x="-30%" y="-60%" width="160%" height="260%">
          <feGaussianBlur stdDeviation="3.4" />
        </filter>
      </defs>

      <!-- 网格与刻度 -->
      <g class="ws-chart__grid">
        <template v-for="tick in yTicks" :key="tick">
          <line :x1="PAD.left" :y1="tickY(tick)" :x2="VIEW_W - PAD.right" :y2="tickY(tick)" />
        </template>
      </g>
      <g class="ws-chart__axis">
        <template v-for="tick in [...yTicks].reverse()" :key="`l-${tick}`">
          <text :x="PAD.left - 8" :y="tickY(tick) + 3.6" text-anchor="end">{{ tick }}</text>
        </template>
        <template v-for="(point, index) in coordinates" :key="`x-${index}`">
          <text :x="point.x" :y="VIEW_H - 10" text-anchor="middle">{{ point.label }}</text>
        </template>
      </g>

      <path class="ws-chart__area" :d="areaPath" :fill="`url(#${gradientId})`" />
      <path class="ws-chart__line-glow" :d="linePath" :stroke="accent" :filter="`url(#${glowId})`" />
      <path class="ws-chart__line" pathLength="1" :d="linePath" :stroke="accent" />

      <g class="ws-chart__dots">
        <template v-for="(point, index) in coordinates" :key="`d-${index}`">
          <g
            :style="{ animationDelay: `${260 + index * 90}ms` }"
            @mouseenter="hovered = index"
            @mouseleave="hovered = null"
          >
            <circle class="ws-chart__hit" :cx="point.x" :cy="point.y" r="11" />
            <circle class="ws-chart__halo" :cx="point.x" :cy="point.y" r="7.4" :fill="accent" />
            <circle class="ws-chart__dot" :cx="point.x" :cy="point.y" r="3.1" :stroke="accent" />
          </g>
        </template>
      </g>

      <g v-if="hovered !== null" class="ws-chart__cursor">
        <line
          :x1="coordinates[hovered]!.x"
          :y1="PAD.top"
          :x2="coordinates[hovered]!.x"
          :y2="PAD.top + PLOT_H"
          :stroke="accent"
        />
        <g :transform="`translate(${coordinates[hovered]!.x}, ${coordinates[hovered]!.y - 22})`">
          <rect x="-25" y="-13" width="50" height="20" rx="3" />
          <text y="1.4" text-anchor="middle">{{ coordinates[hovered]!.value }} {{ unit }}</text>
        </g>
      </g>
    </svg>
  </div>
</template>

<style scoped>
.ws-chart {
  width: 100%;
  height: 100%;
}
svg {
  width: 100%;
  height: 100%;
  display: block;
  overflow: visible;
}
.ws-chart__grid line {
  stroke: rgba(88, 186, 255, 0.16);
  stroke-width: 0.8;
  stroke-dasharray: 3 4;
}
.ws-chart__axis text {
  fill: #6f9fc4;
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.04em;
}
.ws-chart__line-glow {
  fill: none;
  stroke-width: 4.6;
  stroke-linecap: round;
  opacity: 0.5;
}
.ws-chart__line {
  fill: none;
  stroke-width: 1.7;
  stroke-linecap: round;
  stroke-dasharray: 1;
  stroke-dashoffset: 1;
  animation: ws-draw 1150ms cubic-bezier(0.42, 0, 0.28, 1) 120ms forwards;
  filter: drop-shadow(0 0 5px rgba(120, 230, 255, 0.55));
}
.ws-chart__area {
  opacity: 0;
  animation: ws-fade 900ms ease 420ms forwards;
}
.ws-chart__dots > g {
  opacity: 0;
  transform-box: fill-box;
  transform-origin: center;
  animation: ws-pop 460ms cubic-bezier(0.28, 1.4, 0.5, 1) forwards;
  cursor: crosshair;
}
.ws-chart__hit {
  fill: transparent;
}
.ws-chart__halo {
  opacity: 0.22;
}
.ws-chart__dot {
  fill: #eafcff;
  stroke-width: 1.8;
}
.ws-chart__cursor line {
  stroke-width: 0.9;
  stroke-dasharray: 3 3;
  opacity: 0.7;
}
.ws-chart__cursor rect {
  fill: rgba(6, 32, 62, 0.94);
  stroke: rgba(96, 206, 255, 0.5);
  stroke-width: 0.8;
}
.ws-chart__cursor text {
  fill: #d6f4ff;
  font-size: 10px;
  font-weight: 600;
}
@keyframes ws-draw {
  to {
    stroke-dashoffset: 0;
  }
}
@keyframes ws-fade {
  to {
    opacity: 1;
  }
}
@keyframes ws-pop {
  from {
    opacity: 0;
    transform: scale(0.4);
  }
  to {
    opacity: 1;
  }
}
</style>
