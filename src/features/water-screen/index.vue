<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import BackdropCanvas from './BackdropCanvas.vue'
import RainLineChart from './RainLineChart.vue'
import RampChart from './RampChart.vue'
import { tabs, type StatCard } from './data'
import { createWaterScene, type WaterSceneHandle } from './scene'

const mapHost = ref<HTMLDivElement>()
const stage = ref<HTMLDivElement>()
const scale = ref(1)
const active = ref(tabs[0]!.key)
const selectedStation = ref('')
const clock = ref('')

const tab = computed(() => tabs.find((item) => item.key === active.value) ?? tabs[0]!)

/* --------------------------------------------------------------- 数字滚动 ---- */

const rendered = ref<number[]>(tabs[0]!.stats.map(() => 0))
let tweenFrame = 0

function tweenStats(targets: number[]) {
  cancelAnimationFrame(tweenFrame)
  const from = targets.map((_, index) => rendered.value[index] ?? 0)
  const start = performance.now()
  const duration = 900
  const step = (now: number) => {
    const progress = Math.min(1, (now - start) / duration)
    const eased = 1 - Math.pow(1 - progress, 3)
    rendered.value = targets.map((value, index) => from[index]! + (value - from[index]!) * eased)
    if (progress < 1) tweenFrame = requestAnimationFrame(step)
  }
  tweenFrame = requestAnimationFrame(step)
}

watch(tab, (next) => tweenStats(next.stats.map((stat) => stat.value)), { immediate: false })

const format = (value: number, stat: StatCard) =>
  value.toLocaleString('zh-CN', {
    minimumFractionDigits: stat.decimals ?? 0,
    maximumFractionDigits: stat.decimals ?? 0,
  })

/* ------------------------------------------------------------------ 图标 ---- */

const ICONS: Record<string, string> = {
  river:
    '<path d="M3.4 11.6 8.6 4.8l4.2 5.4"/><path d="M13.4 11.6 16.2 8l3.4 3.2"/><path d="M2.6 15.4c2.4 0 2.4-1.8 4.8-1.8s2.4 1.8 4.8 1.8 2.4-1.8 4.8-1.8 2.4 1.8 4.8 1.8"/><path d="M2.6 19.2c2.4 0 2.4-1.8 4.8-1.8s2.4 1.8 4.8 1.8 2.4-1.8 4.8-1.8 2.4 1.8 4.8 1.8"/>',
  reservoir:
    '<path d="M3.4 9.8a8.6 8.6 0 0 0 17.2 0"/><path d="M2.4 13.6h19.2"/><path d="M4.6 17h14.8"/><path d="M8.2 20v-2.2"/><path d="M12 20.6v-2.8"/><path d="M15.8 20v-2.2"/>',
  station:
    '<circle cx="12" cy="12" r="8.6"/><path d="M12 12l4.2-3.8"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/><path d="M12 3.4v2.2"/><path d="M20.6 12h-2.2"/><path d="M12 20.6v-2.2"/><path d="M3.4 12h2.2"/>',
  alert:
    '<path d="M12 3.2c3.1 4.1 5.3 7.1 5.3 9.7a5.3 5.3 0 0 1-10.6 0c0-2.6 2.2-5.6 5.3-9.7z"/><path d="M3.6 20.8c2.4 0 2.4-1.7 4.8-1.7s2.4 1.7 4.8 1.7 2.4-1.7 4.8-1.7"/>',
  level:
    '<path d="M5 3.4v17.2"/><path d="M3 20.6h18"/><path d="M7.6 8.4h9"/><path d="M7.6 12.4h13"/><path d="M7.6 16.4h10.6"/>',
  online:
    '<path d="M12 20.4v-2.6"/><path d="M8.2 15.6a5.4 5.4 0 0 1 7.6 0"/><path d="M5 12.2a10.2 10.2 0 0 1 14 0"/><circle cx="12" cy="19.8" r="1.1" fill="currentColor" stroke="none"/>',
  dispatch:
    '<path d="M3.4 12.4 20.6 4.4l-8.1 17.2-2.3-7.3z"/><path d="M10.2 14.3 20.6 4.4"/>',
}

/* ------------------------------------------------------------------ 交互 ---- */

let scene: WaterSceneHandle | undefined
let clockTimer = 0

function fitStage() {
  scale.value = Math.min(window.innerWidth / 1920, window.innerHeight / 1080)
}

function select(key: string) {
  if (key === active.value) return
  active.value = key
  selectedStation.value = ''
  scene?.focus(tab.value.scene)
}

onMounted(() => {
  document.body.classList.add('ws-lock')
  fitStage()
  window.addEventListener('resize', fitStage)
  clockTimer = window.setInterval(() => {
    clock.value = new Date().toLocaleTimeString('zh-CN', { hour12: false })
  }, 1000)
  clock.value = new Date().toLocaleTimeString('zh-CN', { hour12: false })
  tweenStats(tab.value.stats.map((stat) => stat.value))
  if (mapHost.value) {
    scene = createWaterScene(mapHost.value, { onSelect: (name) => (selectedStation.value = name) })
  }
})

onBeforeUnmount(() => {
  document.body.classList.remove('ws-lock')
  window.removeEventListener('resize', fitStage)
  window.clearInterval(clockTimer)
  cancelAnimationFrame(tweenFrame)
  scene?.dispose()
})
</script>

<template>
  <main class="water-screen">
    <div ref="mapHost" class="water-screen__map" aria-label="全域水利态势地图"></div>
    <div class="water-screen__shade" aria-hidden="true"></div>
    <BackdropCanvas />

    <div
      ref="stage"
      class="water-screen__stage"
      :style="{ transform: `translate(-50%, -50%) scale(${scale})` }"
    >
      <div class="water-screen__grid" aria-hidden="true"></div>

      <!-- 顶部标题 -->
      <header class="ws-header">
        <RouterLink class="ws-header__back" to="/digital-twin">‹ 返回原页面</RouterLink>
        <div class="ws-header__plate">
          <small>SMART WATER CONSERVANCY · ONE MAP</small>
          <h1>全域水利系统</h1>
        </div>
        <svg class="ws-header__deco" viewBox="0 0 1920 150" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id="ws-header-rule" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stop-color="#0d6fd0" stop-opacity="0" />
              <stop offset="0.2" stop-color="#2ea8ff" stop-opacity="0.5" />
              <stop offset="0.42" stop-color="#8ceaff" stop-opacity="1" />
              <stop offset="0.5" stop-color="#ffffff" stop-opacity="1" />
              <stop offset="0.58" stop-color="#8ceaff" stop-opacity="1" />
              <stop offset="0.8" stop-color="#2ea8ff" stop-opacity="0.5" />
              <stop offset="1" stop-color="#0d6fd0" stop-opacity="0" />
            </linearGradient>
            <linearGradient id="ws-header-wing-l" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stop-color="#2ea8ff" stop-opacity="0" />
              <stop offset="1" stop-color="#9beeff" stop-opacity="0.8" />
            </linearGradient>
            <linearGradient id="ws-header-wing-r" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stop-color="#9beeff" stop-opacity="0.8" />
              <stop offset="1" stop-color="#2ea8ff" stop-opacity="0" />
            </linearGradient>
          </defs>
          <path class="ws-header__rule" d="M474 105 H1446" stroke="url(#ws-header-rule)" />
          <path class="ws-header__wing-line" d="M474 105 L188 80 H30" stroke="url(#ws-header-wing-l)" />
          <path class="ws-header__wing-line" d="M1446 105 L1732 80 H1890" stroke="url(#ws-header-wing-r)" />
          <path class="ws-header__echo" d="M566 122 H1354" />
          <path class="ws-header__notch" d="M84 70 l32 0 l-12 13 l-32 0 z" />
          <path class="ws-header__notch" d="M1836 70 l-32 0 l12 13 l32 0 z" />
        </svg>
        <div class="ws-header__badge">
          <i></i>空天地一体化感知<em>{{ clock }}</em>
        </div>
      </header>

      <!-- 左侧指标 -->
      <section class="ws-overview">
        <h2><i></i>{{ tab.overview }}</h2>
        <article
          v-for="(stat, index) in tab.stats"
          :key="`${active}-${stat.label}`"
          class="ws-stat"
          :data-tone="stat.tone"
        >
          <span class="ws-stat__icon">
            <svg viewBox="0 0 24 24" v-html="ICONS[stat.icon]"></svg>
          </span>
          <div class="ws-stat__body">
            <p>{{ stat.label }}</p>
            <strong>{{ format(rendered[index] ?? 0, stat) }}<em>{{ stat.unit }}</em></strong>
          </div>
          <span class="ws-stat__sheen" aria-hidden="true"></span>
        </article>
      </section>

      <!-- 右侧图表 -->
      <aside class="ws-charts">
        <article v-for="chart in tab.charts" :key="`${active}-${chart.title}`" class="ws-panel">
          <header>
            <span class="ws-panel__glyph">
              <svg v-if="chart.kind === 'line'" viewBox="0 0 16 16">
                <path d="M1.6 12.4 5.4 7.6l3 2.6L14.4 3.4" />
                <circle cx="5.4" cy="7.6" r="1.05" />
                <circle cx="8.4" cy="10.2" r="1.05" />
              </svg>
              <svg v-else viewBox="0 0 16 16">
                <path d="M2.2 13.4V9.2" /><path d="M5.8 13.4V6" /><path d="M9.4 13.4V8.2" />
                <path d="M13 13.4V4.4" />
              </svg>
            </span>
            <div>
              <h3>{{ chart.title }}</h3>
              <p>{{ chart.subtitle }}</p>
            </div>
            <span class="ws-panel__live"><i></i>实时</span>
          </header>
          <div class="ws-panel__body">
            <RainLineChart
              v-if="chart.kind === 'line'"
              :points="chart.points"
              :y-max="chart.yMax"
              :y-ticks="chart.yTicks"
              :x-labels="chart.xLabels"
              :accent="chart.accent"
              :unit="chart.unit"
            />
            <RampChart
              v-else
              :points="chart.points"
              :y-max="chart.yMax"
              :y-ticks="chart.yTicks"
              :x-labels="chart.xLabels"
              :accent="chart.accent"
              :unit="chart.unit"
            />
          </div>
          <span class="ws-panel__corner" aria-hidden="true"></span>
        </article>
      </aside>

      <!-- 站点详情 -->
      <Transition name="ws-fade">
        <div v-if="selectedStation" class="ws-chip">
          <i></i>
          <div>
            <small>当前选中测站</small>
            <b>{{ selectedStation }}</b>
          </div>
          <button type="button" @click="selectedStation = ''">×</button>
        </div>
      </Transition>

      <!-- 底部导航 -->
      <nav class="ws-nav">
        <div class="ws-nav__rail">
          <span
            v-for="index in 5"
            :key="`node-${index}`"
            class="ws-nav__node"
            :class="{ 'is-active': tabs[index - 1]?.key === active }"
            :style="{ left: `${((index - 1) / 4) * 100}%` }"
          ></span>
        </div>
        <button
          v-for="(item, index) in tabs"
          :key="item.key"
          type="button"
          class="ws-nav__tab"
          :class="{ 'is-active': item.key === active }"
          :style="{ left: `${(index * 2 + 1) * 12.5}%` }"
          @click="select(item.key)"
        >
          <em>{{ item.glyph }}</em>{{ item.name }}
        </button>
      </nav>
    </div>
  </main>
</template>

<style scoped>
.water-screen {
  position: fixed;
  inset: 0;
  overflow: hidden;
  background: #02080f;
  color: #e8f7ff;
  font-family: 'Microsoft YaHei', 'PingFang SC', 'Hiragino Sans GB', system-ui, sans-serif;
  user-select: none;
}
.water-screen__map {
  position: fixed;
  inset: 0;
}
/* 中央亮、四周暗；把卫星影像压进深蓝色域并让边缘与背景无缝衔接 */
.water-screen__shade {
  position: fixed;
  inset: 0;
  pointer-events: none;
  background:
    radial-gradient(48% 46% at 50% 47%, rgba(34, 128, 214, 0.2) 0%, rgba(34, 128, 214, 0) 72%),
    radial-gradient(120% 78% at 50% 42%, rgba(4, 24, 52, 0) 22%, rgba(2, 12, 28, 0.42) 60%, rgba(1, 6, 16, 0.86) 100%),
    linear-gradient(90deg, #02080f 0%, rgba(2, 8, 15, 0.72) 14%, rgba(2, 8, 15, 0) 32%, rgba(2, 8, 15, 0) 68%, rgba(2, 8, 15, 0.72) 86%, #02080f 100%),
    linear-gradient(180deg, rgba(1, 7, 18, 0.86) 0%, rgba(2, 10, 22, 0.1) 22%, rgba(2, 10, 22, 0.1) 68%, rgba(1, 6, 16, 0.9) 100%);
}
.water-screen__stage {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 1920px;
  height: 1080px;
  transform-origin: center center;
  pointer-events: none;
}
.water-screen__stage > * {
  pointer-events: auto;
}
/* 极淡的科技网格，只在中部可见 */
.water-screen__grid {
  position: absolute;
  inset: 0;
  pointer-events: none;
  opacity: 0.35;
  background-image:
    repeating-linear-gradient(0deg, rgba(74, 158, 224, 0.07) 0 1px, transparent 1px 44px),
    repeating-linear-gradient(90deg, rgba(74, 158, 224, 0.07) 0 1px, transparent 1px 44px);
  mask-image: radial-gradient(70% 60% at 50% 50%, #000 0%, transparent 78%);
  -webkit-mask-image: radial-gradient(70% 60% at 50% 50%, #000 0%, transparent 78%);
}

/* ------------------------------------------------------------------ 标题 ---- */
.ws-header {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  height: 150px;
}
.ws-header__plate {
  position: absolute;
  left: 50%;
  top: 6px;
  width: 620px;
  height: 108px;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: linear-gradient(180deg, rgba(9, 52, 104, 0.5) 0%, rgba(6, 30, 66, 0.14) 62%, rgba(4, 20, 46, 0) 100%);
  clip-path: polygon(4.5% 0, 95.5% 0, 100% 100%, 0 100%);
}
.ws-header__plate::before {
  content: '';
  position: absolute;
  inset: 0 12% auto;
  height: 2px;
  background: linear-gradient(90deg, transparent, rgba(96, 214, 255, 0.5), transparent);
}
.ws-header__plate small {
  font-size: 11px;
  letter-spacing: 0.42em;
  color: #4f9dc8;
  transform: scale(0.94);
}
.ws-header__plate h1 {
  margin: 4px 0 0;
  font-size: 46px;
  font-weight: 700;
  letter-spacing: 0.2em;
  text-indent: 0.2em;
  background: linear-gradient(180deg, #ffffff 6%, #d8f2ff 42%, #6cc6f2 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  filter: drop-shadow(0 0 16px rgba(56, 178, 255, 0.65)) drop-shadow(0 0 42px rgba(20, 120, 220, 0.45));
}
.ws-header__deco {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
}
.ws-header__rule {
  fill: none;
  stroke-width: 2;
  filter: drop-shadow(0 0 12px rgba(70, 195, 255, 0.85)) drop-shadow(0 0 34px rgba(30, 130, 230, 0.5));
}
.ws-header__wing-line {
  fill: none;
  stroke-width: 1.5;
  stroke-linejoin: round;
  filter: drop-shadow(0 0 8px rgba(60, 180, 255, 0.6));
}
.ws-header__echo {
  fill: none;
  stroke: rgba(24, 116, 196, 0.6);
  stroke-width: 1;
}
.ws-header__notch {
  fill: rgba(38, 142, 214, 0.32);
  stroke: rgba(120, 220, 255, 0.45);
  stroke-width: 0.8;
}
.ws-header__back {
  position: absolute;
  left: 28px;
  top: 30px;
  z-index: 2;
  padding: 9px 15px;
  font-size: 13px;
  color: #9fd8f6;
  text-decoration: none;
  border: 1px solid rgba(64, 176, 240, 0.32);
  background: linear-gradient(180deg, rgba(8, 40, 78, 0.72), rgba(4, 20, 44, 0.6));
  clip-path: polygon(9px 0, 100% 0, 100% calc(100% - 9px), calc(100% - 9px) 100%, 0 100%, 0 9px);
  transition: color 0.2s, border-color 0.2s, background 0.2s;
}
.ws-header__back:hover {
  color: #ecfeff;
  border-color: rgba(120, 224, 255, 0.7);
  background: linear-gradient(180deg, rgba(12, 66, 128, 0.85), rgba(6, 32, 66, 0.7));
}
.ws-header__badge {
  position: absolute;
  right: 28px;
  top: 30px;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 9px 16px;
  font-size: 13px;
  color: #9fd8f6;
  border: 1px solid rgba(64, 176, 240, 0.28);
  background: linear-gradient(180deg, rgba(8, 40, 78, 0.7), rgba(4, 20, 44, 0.55));
}
.ws-header__badge i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #35e6ff;
  box-shadow: 0 0 10px #35e6ff;
  animation: ws-blink 1.8s ease-in-out infinite;
}
.ws-header__badge em {
  font-style: normal;
  padding-left: 10px;
  margin-left: 3px;
  border-left: 1px solid rgba(70, 170, 225, 0.3);
  color: #cfeeff;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.06em;
}

/* -------------------------------------------------------------- 指标卡片 ---- */
.ws-overview {
  position: absolute;
  left: 30px;
  top: 136px;
  width: 400px;
}
.ws-overview h2 {
  display: flex;
  align-items: center;
  gap: 12px;
  height: 38px;
  margin: 0 0 20px;
  font-size: 22px;
  font-weight: 600;
  letter-spacing: 0.09em;
  color: #eaf9ff;
  text-shadow: 0 0 16px rgba(45, 160, 240, 0.6);
}
.ws-overview h2 i {
  width: 5px;
  height: 22px;
  background: linear-gradient(180deg, #8ceaff, #1b7fe0);
  box-shadow: 0 0 14px rgba(70, 200, 255, 0.85);
}
.ws-stat {
  position: relative;
  display: flex;
  align-items: center;
  gap: 18px;
  height: 160px;
  padding: 0 22px;
  margin-bottom: 23px;
  --ws-accent: #45d6ff;
  border: 1px solid rgba(58, 176, 244, 0.34);
  border-radius: 8px;
  background:
    linear-gradient(135deg, rgba(11, 56, 108, 0.78) 0%, rgba(5, 24, 52, 0.6) 46%, rgba(3, 14, 32, 0.72) 100%);
  box-shadow:
    inset 0 0 30px rgba(24, 118, 210, 0.22),
    inset 0 1px 0 rgba(150, 226, 255, 0.18),
    0 8px 34px rgba(0, 0, 0, 0.35);
  overflow: hidden;
  transition: transform 0.25s ease, border-color 0.25s ease, box-shadow 0.25s ease;
}
.ws-stat[data-tone='amber'] {
  --ws-accent: #ffb246;
  border-color: rgba(255, 178, 84, 0.4);
  box-shadow:
    inset 0 0 30px rgba(200, 126, 40, 0.18),
    inset 0 1px 0 rgba(255, 226, 176, 0.16),
    0 8px 34px rgba(0, 0, 0, 0.35);
}
.ws-stat[data-tone='green'] {
  --ws-accent: #63e6a8;
  border-color: rgba(80, 220, 160, 0.3);
}
.ws-stat:hover {
  transform: translateX(6px);
  border-color: color-mix(in srgb, var(--ws-accent) 70%, transparent);
  box-shadow:
    inset 0 0 40px color-mix(in srgb, var(--ws-accent) 22%, transparent),
    0 10px 40px rgba(0, 0, 0, 0.42);
}
.ws-stat__sheen {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  height: 1px;
  background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--ws-accent) 70%, transparent), transparent);
}
.ws-stat::before,
.ws-stat::after {
  content: '';
  position: absolute;
  width: 16px;
  height: 16px;
  border: 2px solid color-mix(in srgb, var(--ws-accent) 78%, transparent);
  opacity: 0.85;
}
.ws-stat::before {
  left: -1px;
  top: -1px;
  border-right: none;
  border-bottom: none;
  border-radius: 8px 0 0 0;
}
.ws-stat::after {
  right: -1px;
  bottom: -1px;
  border-left: none;
  border-top: none;
  border-radius: 0 0 8px 0;
}
.ws-stat__icon {
  position: relative;
  flex: none;
  width: 62px;
  height: 62px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  color: var(--ws-accent);
  border: 1px solid color-mix(in srgb, var(--ws-accent) 45%, transparent);
  background:
    radial-gradient(circle at 50% 42%, color-mix(in srgb, var(--ws-accent) 26%, transparent) 0%, rgba(4, 22, 46, 0.35) 62%, rgba(3, 16, 34, 0.1) 100%);
  box-shadow:
    0 0 18px color-mix(in srgb, var(--ws-accent) 30%, transparent),
    inset 0 0 16px color-mix(in srgb, var(--ws-accent) 18%, transparent);
}
.ws-stat__icon::after {
  content: '';
  position: absolute;
  inset: 5px;
  border-radius: 50%;
  border: 1px dashed color-mix(in srgb, var(--ws-accent) 30%, transparent);
  animation: ws-spin 22s linear infinite;
}
.ws-stat__icon svg {
  width: 30px;
  height: 30px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.35;
  stroke-linecap: round;
  stroke-linejoin: round;
  filter: drop-shadow(0 0 6px color-mix(in srgb, var(--ws-accent) 70%, transparent));
}
.ws-stat__body {
  min-width: 0;
}
.ws-stat__body p {
  margin: 0 0 6px;
  font-size: 19px;
  letter-spacing: 0.1em;
  color: #b6dcf2;
}
.ws-stat__body strong {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 46px;
  font-weight: 700;
  line-height: 1;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.01em;
  color: #ffffff;
  text-shadow: 0 0 20px color-mix(in srgb, var(--ws-accent) 60%, transparent), 0 2px 10px rgba(0, 0, 0, 0.5);
}
.ws-stat__body strong em {
  font-style: normal;
  font-size: 17px;
  font-weight: 500;
  letter-spacing: 0.04em;
  color: color-mix(in srgb, var(--ws-accent) 82%, #ffffff);
}

/* -------------------------------------------------------------- 图表面板 ---- */
.ws-charts {
  position: absolute;
  right: 30px;
  top: 132px;
  width: 470px;
  display: flex;
  flex-direction: column;
  gap: 26px;
}
.ws-panel {
  position: relative;
  height: 320px;
  border: 1px solid rgba(58, 176, 244, 0.3);
  border-radius: 6px;
  background: linear-gradient(160deg, rgba(9, 46, 92, 0.72) 0%, rgba(4, 20, 44, 0.62) 55%, rgba(3, 13, 30, 0.7) 100%);
  box-shadow: inset 0 0 34px rgba(20, 100, 190, 0.2), 0 10px 36px rgba(0, 0, 0, 0.32);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.ws-panel:nth-child(2) {
  height: 396px;
}
.ws-panel > header {
  position: relative;
  display: flex;
  align-items: center;
  gap: 12px;
  height: 52px;
  padding: 0 18px;
  background: linear-gradient(180deg, rgba(16, 68, 128, 0.5), rgba(6, 26, 56, 0));
}
.ws-panel > header::after {
  content: '';
  position: absolute;
  left: 18px;
  right: 18px;
  bottom: 0;
  height: 1px;
  background: linear-gradient(90deg, rgba(70, 190, 255, 0.55), rgba(70, 190, 255, 0.12) 55%, transparent);
}
.ws-panel__glyph {
  flex: none;
  width: 26px;
  height: 26px;
  display: grid;
  place-items: center;
  border: 1px solid rgba(70, 190, 255, 0.45);
  background: linear-gradient(180deg, rgba(20, 84, 156, 0.7), rgba(6, 30, 64, 0.5));
  box-shadow: 0 0 12px rgba(50, 170, 255, 0.35), inset 0 0 10px rgba(60, 180, 255, 0.2);
}
.ws-panel__glyph svg {
  width: 15px;
  height: 15px;
  fill: none;
  stroke: #7fe3ff;
  stroke-width: 1.3;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.ws-panel__glyph svg circle {
  fill: #bff4ff;
  stroke: none;
}
.ws-panel h3 {
  margin: 0;
  font-size: 19px;
  font-weight: 600;
  letter-spacing: 0.12em;
  color: #f0fbff;
  text-shadow: 0 0 14px rgba(60, 180, 255, 0.55);
}
.ws-panel header p {
  margin: 1px 0 0;
  font-size: 11px;
  letter-spacing: 0.08em;
  color: #5f96bb;
}
.ws-panel__live {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  letter-spacing: 0.1em;
  color: #63d8ff;
}
.ws-panel__live i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #35e6ff;
  box-shadow: 0 0 9px #35e6ff;
  animation: ws-blink 1.6s ease-in-out infinite;
}
.ws-panel__body {
  flex: 1;
  min-height: 0;
  padding: 12px 16px 16px;
}
.ws-panel__corner {
  position: absolute;
  right: 0;
  bottom: 0;
  width: 22px;
  height: 22px;
  border-right: 2px solid rgba(90, 210, 255, 0.7);
  border-bottom: 2px solid rgba(90, 210, 255, 0.7);
  border-radius: 0 0 6px 0;
}

/* -------------------------------------------------------------- 站点标签 ---- */
.ws-chip {
  position: absolute;
  left: 50%;
  top: 168px;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px 10px 16px;
  border: 1px solid rgba(70, 190, 255, 0.4);
  background: linear-gradient(180deg, rgba(9, 48, 92, 0.88), rgba(4, 20, 44, 0.82));
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4), inset 0 0 20px rgba(30, 130, 220, 0.24);
  backdrop-filter: blur(6px);
}
.ws-chip > i {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: #ffd75e;
  box-shadow: 0 0 12px #ffb246;
}
.ws-chip small {
  display: block;
  font-size: 10px;
  letter-spacing: 0.16em;
  color: #6ea6c9;
}
.ws-chip b {
  font-size: 16px;
  letter-spacing: 0.06em;
  color: #f2fbff;
}
.ws-chip button {
  margin-left: 6px;
  width: 22px;
  height: 22px;
  border: 1px solid rgba(70, 170, 225, 0.35);
  background: transparent;
  color: #a9d8f2;
  font-size: 15px;
  line-height: 1;
  cursor: pointer;
}
.ws-chip button:hover {
  color: #fff;
  border-color: rgba(120, 224, 255, 0.8);
}

/* -------------------------------------------------------------- 底部导航 ---- */
.ws-nav {
  position: absolute;
  left: 460px;
  top: 932px;
  width: 1000px;
  height: 120px;
}
.ws-nav__rail {
  position: relative;
  height: 2px;
  margin: 0 10px;
  background: linear-gradient(90deg, transparent, rgba(56, 168, 240, 0.5) 8%, rgba(120, 226, 255, 0.85) 50%, rgba(56, 168, 240, 0.5) 92%, transparent);
  box-shadow: 0 0 16px rgba(48, 180, 255, 0.55);
}
.ws-nav__node {
  position: absolute;
  top: 50%;
  width: 9px;
  height: 9px;
  margin: -4.5px 0 0 -4.5px;
  transform: rotate(45deg);
  background: linear-gradient(135deg, #bff2ff, #2f9de0);
  box-shadow: 0 0 12px rgba(90, 210, 255, 0.9);
  transition: transform 0.25s ease, box-shadow 0.25s ease;
}
.ws-nav__node.is-active {
  transform: rotate(45deg) scale(1.5);
  background: linear-gradient(135deg, #ffffff, #6fe0ff);
  box-shadow: 0 0 20px rgba(140, 235, 255, 1);
}
.ws-nav__tab {
  position: absolute;
  top: 32px;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 12px 28px;
  white-space: nowrap;
  font-family: inherit;
  font-size: 21px;
  letter-spacing: 0.16em;
  color: #8dbcd8;
  cursor: pointer;
  border: 1px solid transparent;
  background: transparent;
  transition: color 0.25s ease, background 0.25s ease, border-color 0.25s ease, box-shadow 0.25s ease;
}
.ws-nav__tab em {
  font-style: normal;
  font-size: 16px;
  opacity: 0.85;
}
.ws-nav__tab:hover {
  color: #dcf2ff;
}
.ws-nav__tab.is-active {
  color: #ffffff;
  border-color: rgba(96, 208, 255, 0.55);
  background: linear-gradient(180deg, rgba(24, 96, 176, 0.66), rgba(8, 40, 84, 0.5));
  box-shadow: 0 0 22px rgba(40, 160, 255, 0.35), inset 0 0 20px rgba(60, 180, 255, 0.28);
  text-shadow: 0 0 14px rgba(120, 220, 255, 0.8);
}
.ws-nav__tab.is-active::before,
.ws-nav__tab.is-active::after {
  content: '';
  position: absolute;
  top: 50%;
  width: 10px;
  height: 1px;
  background: rgba(120, 224, 255, 0.7);
}
.ws-nav__tab.is-active::before {
  left: -14px;
}
.ws-nav__tab.is-active::after {
  right: -14px;
}

/* ------------------------------------------------------------------ 动效 ---- */
.ws-fade-enter-active,
.ws-fade-leave-active {
  transition: opacity 0.22s ease, transform 0.22s ease;
}
.ws-fade-enter-from,
.ws-fade-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(-8px);
}
@keyframes ws-blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.28; }
}
@keyframes ws-spin {
  to { transform: rotate(360deg); }
}
@media (prefers-reduced-motion: reduce) {
  .ws-stat__icon::after,
  .ws-panel__live i,
  .ws-header__badge i {
    animation: none;
  }
}
</style>

<style>
body.ws-lock {
  margin: 0;
  overflow: hidden;
  background: #02080f;
}

/*
 * 站点图钉由 MapLibre 以 DOM Marker 的形式挂到地图容器上，
 * 不在组件模板内，因此必须用全局样式，scoped 选择器不会命中。
 *
 * 注意：MapLibre 依赖 .maplibregl-marker 的 position:absolute 来定位，
 * 这里必须保持 absolute —— 改成 relative 会让所有图钉退回普通文档流并按顺序向下堆叠。
 */
body.ws-lock .ws-station {
  position: absolute;
  top: 0;
  left: 0;
  display: block;
  width: 26px;
  height: 36px;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
  transition: transform 0.22s ease;
}
body.ws-lock .ws-station:hover {
  z-index: 5;
}
body.ws-lock .ws-station__pin {
  display: block;
  width: 100%;
  height: 100%;
  overflow: visible;
  filter: drop-shadow(0 3px 6px rgba(0, 8, 20, 0.7));
}
body.ws-lock .ws-station__pin path {
  fill: #0a3c66;
  stroke: #7fe9ff;
  stroke-width: 1.5;
}
body.ws-lock .ws-station__pin circle {
  fill: #dffbff;
}
body.ws-lock .ws-station[data-level='watch'] .ws-station__pin path {
  stroke: #ffd75e;
}
body.ws-lock .ws-station[data-level='watch'] .ws-station__pin circle {
  fill: #ffe9a8;
}
body.ws-lock .ws-station[data-level='alarm'] .ws-station__pin path {
  fill: #6d2410;
  stroke: #ff9a63;
}
body.ws-lock .ws-station[data-level='alarm'] .ws-station__pin circle {
  fill: #ffd0b4;
}
body.ws-lock .ws-station[data-kind='gauge'] .ws-station__pin {
  transform: scale(0.84);
  transform-origin: 50% 100%;
}
body.ws-lock .ws-station__ring {
  position: absolute;
  left: 50%;
  bottom: 2px;
  width: 44px;
  height: 18px;
  margin-left: -22px;
  border-radius: 50%;
  border: 1px solid rgba(120, 226, 255, 0.5);
  background: radial-gradient(ellipse at center, rgba(60, 200, 255, 0.28), rgba(60, 200, 255, 0) 70%);
  animation: ws-station-pulse 2.4s ease-out infinite;
  pointer-events: none;
}
body.ws-lock .ws-station[data-level='alarm'] .ws-station__ring {
  border-color: rgba(255, 150, 100, 0.6);
  background: radial-gradient(ellipse at center, rgba(255, 130, 80, 0.32), rgba(255, 130, 80, 0) 70%);
}
body.ws-lock .ws-station__label {
  position: absolute;
  left: 50%;
  bottom: 40px;
  transform: translateX(-50%);
  padding: 2px 8px;
  white-space: nowrap;
  font-family: 'Microsoft YaHei', system-ui, sans-serif;
  font-size: 12.5px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: #eafcff;
  background: rgba(3, 20, 42, 0.72);
  border: 1px solid rgba(90, 200, 255, 0.28);
  border-radius: 3px;
  text-shadow: 0 0 8px rgba(0, 0, 0, 0.9), 0 1px 2px rgba(0, 0, 0, 0.8);
  pointer-events: none;
}
/* 相邻测站上下交错，避免文字互相压盖 */
body.ws-lock .ws-station[data-side='bottom'] .ws-station__label {
  top: 40px;
  bottom: auto;
  color: #dbeeff;
  border-color: rgba(90, 200, 255, 0.22);
  background: rgba(3, 20, 42, 0.62);
}
body.ws-lock .ws-station[data-level='alarm'] .ws-station__label {
  color: #ffe3d2;
  border-color: rgba(255, 160, 110, 0.4);
}
body.ws-lock .ws-station__badge {
  position: absolute;
  left: 21px;
  bottom: 12px;
  display: grid;
  place-items: center;
  width: 19px;
  height: 19px;
  border-radius: 50%;
  font-size: 10px;
  font-weight: 700;
  color: #04202f;
  background: linear-gradient(180deg, #ffffff, #8fe6ff);
  box-shadow: 0 0 10px rgba(120, 230, 255, 0.9);
  pointer-events: none;
}
@keyframes ws-station-pulse {
  0% { transform: scale(0.55); opacity: 0.9; }
  70% { transform: scale(1.5); opacity: 0; }
  100% { transform: scale(1.5); opacity: 0; }
}
@media (prefers-reduced-motion: reduce) {
  body.ws-lock .ws-station__ring { animation: none; }
}

/* Vite 的 Vue DevTools 悬浮面板只在开发环境注入，截图/演示时隐藏以免遮挡界面。 */
body.ws-lock #__vue-devtools-container__,
body.ws-lock #vue-inspector-container {
  display: none !important;
}
</style>
