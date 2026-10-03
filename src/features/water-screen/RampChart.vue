<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  points: number[]
  yMax: number
  yTicks: number[]
  xLabels: string[]
  accent: string
  unit: string
}>()

const VIEW_W = 434
const VIEW_H = 330
const PAD = { left: 46, right: 16, top: 26, bottom: 36 }
const PLOT_W = VIEW_W - PAD.left - PAD.right
const PLOT_H = VIEW_H - PAD.top - PAD.bottom
const BASELINE = PAD.top + PLOT_H

const rampId = `ws-ramp-${Math.random().toString(36).slice(2, 9)}`
const glowId = `${rampId}-glow`

/** 每根柱子的宽度与位置；柱子之间留出细缝，形成参考图中的“密排面”。 */
const bars = computed(() => {
  const count = props.points.length
  const slot = PLOT_W / count
  return props.points.map((value, index) => {
    const height = Math.max(1.5, (Math.min(value, props.yMax) / props.yMax) * PLOT_H)
    return {
      x: PAD.left + index * slot + slot * 0.08,
      y: BASELINE - height,
      width: slot * 0.84,
      height,
    }
  })
})

const tickY = (tick: number) => PAD.top + (1 - tick / props.yMax) * PLOT_H
const labelX = (index: number) => PAD.left + (index / (props.xLabels.length - 1)) * PLOT_W

/** 按参考图密度铺开雨滴，参数固定以保证每次渲染一致。 */
const drops = Array.from({ length: 34 }, (_, index) => {
  const golden = (index * 0.6180339887) % 1
  return {
    x: PAD.left + 6 + golden * (PLOT_W - 12),
    delay: -(index * 0.37) % 3.1,
    duration: 2.4 + ((index * 7) % 11) * 0.14,
    scale: 0.7 + ((index * 5) % 7) * 0.09,
  }
})
</script>

<template>
  <div class="ws-chart ws-chart--ramp">
    <svg :viewBox="`0 0 ${VIEW_W} ${VIEW_H}`" role="img" :aria-label="`${unit} 面雨量分布图`">
      <defs>
        <linearGradient :id="rampId" gradientUnits="userSpaceOnUse" x1="0" :y1="BASELINE" x2="0" :y2="PAD.top">
          <stop offset="0%" stop-color="#0a2a6e" />
          <stop offset="14%" stop-color="#1257c4" />
          <stop offset="30%" stop-color="#159fe0" />
          <stop offset="46%" stop-color="#1fd3b4" />
          <stop offset="60%" stop-color="#6ee06a" />
          <stop offset="74%" stop-color="#ecd83c" />
          <stop offset="87%" stop-color="#ff9a2e" />
          <stop offset="100%" stop-color="#f0432a" />
        </linearGradient>
        <linearGradient :id="`${rampId}-floor`" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#5fd0ff" stop-opacity="0.34" />
          <stop offset="100%" stop-color="#5fd0ff" stop-opacity="0" />
        </linearGradient>
        <filter :id="glowId" x="-25%" y="-25%" width="150%" height="150%">
          <feGaussianBlur stdDeviation="5.2" />
        </filter>
      </defs>

      <g class="ws-chart__grid">
        <template v-for="tick in yTicks" :key="tick">
          <line :x1="PAD.left" :y1="tickY(tick)" :x2="VIEW_W - PAD.right" :y2="tickY(tick)" />
        </template>
      </g>

      <!-- 面雨量“山体”：柱高决定颜色，因此颜色是高度的函数，与参考图一致 -->
      <g class="ws-chart__ramp" :filter="`url(#${glowId})`">
        <rect
          v-for="(bar, index) in bars"
          :key="`g-${index}`"
          :x="bar.x"
          :y="bar.y"
          :width="bar.width"
          :height="bar.height"
          :fill="`url(#${rampId})`"
        />
      </g>
      <g class="ws-chart__ramp ws-chart__ramp--core">
        <rect
          v-for="(bar, index) in bars"
          :key="`c-${index}`"
          :x="bar.x"
          :y="bar.y"
          :width="bar.width"
          :height="bar.height"
          :fill="`url(#${rampId})`"
        />
      </g>
      <rect
        class="ws-chart__floor"
        :x="PAD.left"
        :y="BASELINE - 26"
        :width="PLOT_W"
        height="26"
        :fill="`url(#${rampId}-floor)`"
      />

      <!-- 雨滴 -->
      <g class="ws-chart__drops">
        <g v-for="(drop, index) in drops" :key="`r-${index}`" :transform="`translate(${drop.x}, ${PAD.top})`">
          <path
            :d="`M0 0 C ${2.6 * drop.scale} ${3.4 * drop.scale} ${4.2 * drop.scale} ${5.6 * drop.scale} ${4.2 * drop.scale} ${7.6 * drop.scale} A ${4.2 * drop.scale} ${4.2 * drop.scale} 0 0 1 ${-4.2 * drop.scale} ${7.6 * drop.scale} C ${-4.2 * drop.scale} ${5.6 * drop.scale} ${-2.6 * drop.scale} ${3.4 * drop.scale} 0 0 Z`"
            :style="{ animationDuration: `${drop.duration}s`, animationDelay: `${drop.delay}s` }"
          />
        </g>
      </g>

      <g class="ws-chart__axis">
        <template v-for="tick in [...yTicks].reverse()" :key="`l-${tick}`">
          <text :x="PAD.left - 8" :y="tickY(tick) + 3.6" text-anchor="end">{{ tick }}</text>
        </template>
        <template v-for="(label, index) in xLabels" :key="`x-${label}-${index}`">
          <text :x="labelX(index)" :y="VIEW_H - 10" text-anchor="middle">{{ label }}</text>
        </template>
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
.ws-chart__ramp {
  opacity: 0;
  animation: ws-ramp-in 900ms ease 180ms forwards;
}
.ws-chart__ramp rect {
  opacity: 0.55;
}
.ws-chart__ramp--core {
  opacity: 0;
  animation: ws-ramp-in 900ms ease 400ms forwards;
}
.ws-chart__ramp--core rect {
  opacity: 0.98;
}
.ws-chart__floor {
  opacity: 0;
  animation: ws-ramp-in 900ms ease 620ms forwards;
}
.ws-chart__drops path {
  fill: rgba(150, 233, 255, 0.62);
  opacity: 0;
  animation-name: ws-fall;
  animation-timing-function: linear;
  animation-iteration-count: infinite;
}
@keyframes ws-ramp-in {
  to {
    opacity: 1;
  }
}
@keyframes ws-fall {
  0% {
    transform: translateY(-16px);
    opacity: 0;
  }
  18% {
    opacity: 0.85;
  }
  82% {
    opacity: 0.5;
  }
  100% {
    transform: translateY(286px);
    opacity: 0;
  }
}
</style>
