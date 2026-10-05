<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import type { Map as MapLibreMap } from 'maplibre-gl'

/* =========================================================================
   比例尺 / SCALE BAR
   暗色航图式底图最怕"没有尺度感"。一根会随缩放实时变长的比例尺，
   比任何网格线都更克制、更专业——它回答的是一句很实际的话：
   "这个红点离我的变电站到底多远。"
   ========================================================================= */

const props = defineProps<{ map: MapLibreMap | null }>()

const label = ref('—')
const barWidth = ref(70)
let frame = 0

/** 目标宽度（px）→ 取一个"整"的公里数，如 1 / 2 / 5 / 10 / 50 */
function update() {
  frame = requestAnimationFrame(update)
  const map = props.map
  if (!map) return

  // 取地图中心纬度做墨卡托换算：中纬度下经度方向的米/像素误差在 1% 内
  const center = map.getCenter()
  const zoom = map.getZoom()
  const metersPerPixel =
    (156543.03392 * Math.cos((center.lat * Math.PI) / 180)) / Math.pow(2, zoom)

  const targetMeters = metersPerPixel * 84
  const nice = [50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000, 200000, 500000]
  const chosen = nice.find((value) => value >= targetMeters) ?? nice[nice.length - 1]!
  barWidth.value = Math.max(34, chosen / metersPerPixel)
  label.value = chosen >= 1000 ? `${chosen / 1000} km` : `${chosen} m`
}

onMounted(() => {
  frame = requestAnimationFrame(update)
})
onBeforeUnmount(() => cancelAnimationFrame(frame))
</script>

<template>
  <div class="scale" aria-hidden="true">
    <span class="scale__bar" :style="{ width: `${Math.round(barWidth)}px` }">
      <i></i><i></i>
    </span>
    <em class="cc-num">{{ label }}</em>
  </div>
</template>

<style scoped>
.scale {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  pointer-events: none;
}

.scale__bar {
  position: relative;
  display: block;
  height: 7px;
  border-right: 1px solid rgba(190, 226, 248, 0.6);
  border-left: 1px solid rgba(190, 226, 248, 0.6);
  transition: width 0.18s linear;
}

/* 中段刻度：一眼读出 1/2 与全长 */
.scale__bar i {
  position: absolute;
  bottom: 0;
  width: 1px;
  height: 4px;
  background: rgba(190, 226, 248, 0.5);
}

.scale__bar i:first-child {
  left: 50%;
}

.scale__bar i:last-child {
  right: 0;
  height: 7px;
}

.scale__bar::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 1px;
  background: linear-gradient(90deg, rgba(190, 226, 248, 0.2), rgba(190, 226, 248, 0.7));
}

.scale em {
  color: var(--t3);
  font-size: 10.5px;
  font-style: normal;
  letter-spacing: 0.1em;
}
</style>
