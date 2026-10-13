<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import TwinIcon from './TwinIcon.vue'
import { createCommandScene, type CommandScene, type ScreenAnchor } from './commandScene'
import {
  BUILD_PHASES,
  DEMO_END,
  DEMO_EVENTS,
  DEMO_NOW,
  DEMO_STORMS,
  LAYERS,
  MODES,
  demoClock,
  type CommandLayer,
  type CommandScope,
} from './commandDemo'
import { MINES, warningLevel, type WeatherMode } from './weather'
import {
  movementDirection,
  resolveAnalysis,
  mineVisible,
  ANALYSIS_SECONDS,
  ANALYSIS_STEPS,
  ASSET_ANALYSIS_STEPS,
  analysisFrame,
  stormForecast,
  formatEta,
  type AnalysisSelection,
  type MineFilter,
} from './commandAnalysis'
import { placeMapLabel, type LabelRect, type MapLabel } from './commandLabels'
import './weather.css'

const root = ref<HTMLElement>()
const host = ref<HTMLElement>()
const scene = shallowRef<CommandScene>()
const ready = ref(false)
const error = ref('')
const mode = ref<WeatherMode>('live')
const scope = ref<CommandScope>('national')
const phase = ref(0)
const minute = ref(DEMO_NOW)
const playing = ref(!matchMedia('(prefers-reduced-motion: reduce)').matches)
const speed = ref(1)
const flat = ref(false)
const fullscreen = ref(false)
const selection = ref<AnalysisSelection>({ kind: 'overview' })
const mineFilter = ref<MineFilter>('priority')
const analysis = computed(() => resolveAnalysis(selection.value, minute.value))
const selected = computed(() => analysis.value.storm?.id ?? '')
let focusNextSelection = false
let restartNextSelection = false
const analysisProgress = ref(1)
const analysisComplete = computed(() => analysisProgress.value >= 1)
const sequence = computed(() =>
  analysisFrame(analysis.value.kind, analysisProgress.value * ANALYSIS_SECONDS),
)
const targetRevealed = computed(() => sequence.value.asset >= 0.95)
const analysisStage = computed(() => {
  const age = analysisProgress.value * ANALYSIS_SECONDS
  if (!analysis.value.relation && age >= 2.15) return '轨迹扫描完成'
  const stages = analysis.value.kind === 'mine' ? ASSET_ANALYSIS_STEPS : ANALYSIS_STEPS
  return [...stages].reverse().find(([at]) => at <= age)?.[1] ?? ''
})
const narrowScreen = matchMedia('(max-width: 760px)')
const layersOpen = ref(!narrowScreen.matches)
const anchors = shallowRef<ScreenAnchor[]>([])
const layers = ref<Record<CommandLayer, boolean>>({
  energy: true,
  strikes: true,
  tracks: true,
  corridor: true,
  assets: true,
  rings: true,
})
const reading = computed(() => ({
  distance: analysis.value.relation ? Math.round(analysis.value.relation.distance) : null,
  eta: analysis.value.relation?.eta ?? null,
}))
const risk = computed(() => analysis.value.relation?.level ?? warningLevel(Infinity))
const highRisk = computed(() => analysisComplete.value && risk.value.level === 1)
const threatName = computed(() => risk.value.name.replace('预警', '威胁'))
const threatRoman = computed(() => risk.value.roman)
const stage = computed(() => BUILD_PHASES[phase.value]!)
const timeState = computed(() =>
  minute.value < DEMO_NOW - 0.1
    ? '历史回放'
    : minute.value > DEMO_NOW + 0.1
      ? '预测推演'
      : '当前态势',
)
const selectedStorm = computed(() => analysis.value.storm)
const motion = computed(() =>
  selectedStorm.value ? stormForecast(selectedStorm.value, minute.value) : null,
)
const analysisHint = computed(() =>
  analysis.value.kind === 'overview'
    ? ''
    : !analysis.value.relation
      ? analysis.value.kind === 'storm'
        ? '当前预测轨迹范围内暂无受威胁煤矿'
        : '未来 3 小时内暂无轨迹影响该煤矿'
      : analysis.value.relation.distance === 0
        ? '雷暴范围已覆盖煤矿'
        : analysis.value.relation.eta === null
          ? `${analysis.value.relation.approaching ? '正在接近' : '正在远离'} · 3 小时内无预计抵达`
          : analysis.value.kind === 'storm'
            ? `首个受影响煤矿 · ${analysis.value.mine?.name}`
            : `最危险云团 · ${selected.value}`,
)
const currentMode = computed(() => MODES.find((m) => m.id === mode.value)!)
const timelineEvents = DEMO_EVENTS.filter((_, i) => i % 13 === 0)
const mineAnchor = computed(() =>
  anchors.value.find((a) => a.id === `mine:${analysis.value.mine?.id}`),
)
const shownMines = computed(() =>
  MINES.filter((m) => mineVisible(m, mineFilter.value, analysis.value.mine?.id)),
)
const abort = new AbortController()
let mounted = true,
  interval = 0,
  previousTitle = ''

function chooseMode(next: WeatherMode) {
  mode.value = next
  scene.value?.setMode(next)
}
function chooseScope(next: CommandScope) {
  scope.value = next
  scene.value?.setScope(next)
}
function toggleLayer(id: CommandLayer) {
  layers.value[id] = !layers.value[id]
  scene.value?.setLayer(id, layers.value[id])
}
function selectStorm(id: string) {
  restartNextSelection = true
  analysisProgress.value = 0
  selection.value = { kind: 'storm', id }
  chooseMode('live')
  for (const layer of ['energy', 'assets', 'tracks', 'corridor', 'rings'] as CommandLayer[]) {
    layers.value[layer] = true
    scene.value?.setLayer(layer, true)
  }
}
function selectMine(id: string) {
  focusNextSelection = true
  restartNextSelection = true
  analysisProgress.value = 0
  selection.value = { kind: 'mine', id }
  chooseMode('warning')
  for (const layer of ['energy', 'assets', 'rings', 'corridor', 'tracks'] as CommandLayer[]) {
    layers.value[layer] = true
    scene.value?.setLayer(layer, true)
  }
}
function chooseMineFilter(value: MineFilter) {
  mineFilter.value = value
  scene.value?.setMineFilter(value)
  if (value === 'all') chooseScope('national')
}
watch(analysis, (value) => {
  scene.value?.setAnalysis(value, focusNextSelection, restartNextSelection)
  focusNextSelection = false
  restartNextSelection = false
})
function setTime(value: number) {
  minute.value = Math.max(0, Math.min(DEMO_END, value))
  scene.value?.setTime(minute.value)
}
function scrub(event: Event) {
  playing.value = false
  setTime(Number((event.target as HTMLInputElement).value))
}
function returnNow() {
  playing.value = false
  setTime(DEMO_NOW)
}
function togglePlayback() {
  if (minute.value >= DEMO_END) setTime(0)
  playing.value = !playing.value
}
function forecast() {
  chooseMode('track')
  setTime(DEMO_NOW)
  playing.value = true
}
function replay() {
  returnNow()
  selection.value = { kind: 'overview' }
  scene.value?.replay()
}
function toggleView() {
  flat.value = !flat.value
  scene.value?.setView(flat.value)
}
function resetView() {
  selection.value = { kind: 'overview' }
  scene.value?.reset()
}
function screen(id: string) {
  return anchors.value.find((a) => a.id === id)
}
function labelStyle(id: string) {
  const a = screen(id)
  const width = host.value?.clientWidth ?? window.innerWidth
  if (!id.startsWith('mine:') && a?.bounds)
    return {
      left: `${Math.max(12, Math.min(width - 95, a.bounds.x))}px`,
      top: `${a.bounds.y - 26}px`,
      transform: 'none',
    }
  if (width <= 760 && a) {
    const labelWidth = id.startsWith('mine:') ? 132 : id === selected.value ? 116 : 54
    const offset = id.startsWith('mine:') ? 17 : id === selected.value ? -132 : 20
    return {
      left: `${Math.max(12, Math.min(width - labelWidth - 12, a.x + offset))}px`,
      top: `${a.y - (id.startsWith('mine:') ? 18 : id === selected.value ? 48 : 14)}px`,
      transform: 'none',
    }
  }
  return { left: `${a?.x ?? 0}px`, top: `${a?.y ?? 0}px` }
}
const mapOverlays = computed(() => {
  const viewport = { width: host.value?.clientWidth ?? 0, height: host.value?.clientHeight ?? 0 }
  const obstacles: LabelRect[] = anchors.value
    .filter((a) => a.visible)
    .flatMap((a) =>
      a.bounds
        ? [a.bounds]
        : a.id.startsWith('mine:')
          ? [{ x: a.x - 14, y: a.y - 14, width: 28, height: 28 }]
          : [],
    )
  const origin = host.value?.getBoundingClientRect()
  if (origin)
    root.value
      ?.querySelectorAll<HTMLElement>(
        '.wc-header, .wc-metrics, .wc-focus, .wc-layer-panel, .wc-map-scope, .wc-mine-filter, .wc-map-tools, .wc-build-status, .wc-timeline, .wc-mine-tag, .wc-storm-tag, .wc-mode-key',
      )
      .forEach((element) => {
        const r = element.getBoundingClientRect()
        if (r.width && r.height && getComputedStyle(element).opacity !== '0')
          obstacles.push({ x: r.x - origin.x, y: r.y - origin.y, width: r.width, height: r.height })
      })
  const result: { id: string; kind: string; text: string; layout: MapLabel }[] = []
  const add = (
    id: string,
    kind: string,
    text: string,
    sourceIds: string[],
    width: number,
    height = 22,
  ) => {
    const sources = sourceIds.map(screen).filter((a) => a?.visible) as ScreenAnchor[]
    const layout = placeMapLabel(
      sources,
      Math.min(width, viewport.width - 24),
      height,
      viewport,
      obstacles,
    )
    if (layout) {
      result.push({ id, kind, text, layout })
      obstacles.push(layout)
    }
  }
  if (phase.value < 7) return result
  if (analysisComplete.value && analysis.value.relation && layers.value.corridor)
    add('result', 'relation', '', ['relationship:1', 'relationship:0', 'relationship:2'], 232)
  if (analysisComplete.value && !analysis.value.relation)
    add(
      'empty',
      'empty',
      analysisHint.value,
      [analysis.value.kind === 'storm' ? 'forecast-end' : `mine:${analysis.value.mine?.id}`],
      240,
      34,
    )
  if (analysis.value.kind !== 'overview' && layers.value.tracks && selectedStorm.value) {
    if (sequence.value.vector > 0.9 && motion.value)
      add(
        'vector',
        'vector',
        `${movementDirection(motion.value.bearing)} / ${Math.round(motion.value.speed)} km/h`,
        ['vector'],
        118,
      )
  }
  return result
})
async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen()
    else await root.value?.requestFullscreen()
  } catch {
    error.value = '浏览器暂未允许全屏，可使用 F11。'
  }
}
function onFullScreen() {
  fullscreen.value = !!document.fullscreenElement
}
function onKey(event: KeyboardEvent) {
  if (event.key === 'Escape') layersOpen.value = false
}
function onNarrowScreen() {
  if (narrowScreen.matches) layersOpen.value = false
}
onMounted(async () => {
  previousTitle = document.title
  document.title = '中科天际 · 雷电数字战场'
  document.addEventListener('fullscreenchange', onFullScreen)
  document.addEventListener('keydown', onKey)
  narrowScreen.addEventListener('change', onNarrowScreen)
  interval = window.setInterval(() => {
    if (
      !playing.value ||
      !ready.value ||
      phase.value < 7 ||
      !analysisComplete.value ||
      document.hidden
    )
      return
    setTime(minute.value + speed.value * 0.25)
    if (minute.value >= DEMO_END) playing.value = false
  }, 1000)
  try {
    const controller = await createCommandScene(host.value!, {
      signal: abort.signal,
      onPhase: (value) => {
        phase.value = value
      },
      onAnchors: (value) => {
        anchors.value = value
      },
      onAnalysisProgress: (value) => {
        analysisProgress.value = value
      },
      onError: (message) => {
        error.value = message
      },
      onPick: (kind, id) => {
        if (kind === 'storm') selectStorm(id)
        else selectMine(id)
      },
    })
    if (!mounted) {
      controller.dispose()
      return
    }
    scene.value = controller
    controller.setMode(mode.value)
    controller.setTime(minute.value)
    controller.setScope(scope.value)
    controller.setView(flat.value)
    controller.setAnalysis(analysis.value)
    controller.setMineFilter(mineFilter.value)
    for (const layer of LAYERS) controller.setLayer(layer.id, layers.value[layer.id])
    ready.value = true
  } catch (cause) {
    if (!abort.signal.aborted)
      error.value =
        cause instanceof Error
          ? `场景加载失败：${cause.message}`
          : '场景加载失败，请检查硬件加速后刷新。'
  }
})
onBeforeUnmount(() => {
  mounted = false
  abort.abort()
  clearInterval(interval)
  scene.value?.dispose()
  document.removeEventListener('fullscreenchange', onFullScreen)
  document.removeEventListener('keydown', onKey)
  narrowScreen.removeEventListener('change', onNarrowScreen)
  document.title = previousTitle
})
</script>

<template>
  <main
    ref="root"
    class="wc-command"
    :class="[
      `wc-${mode}`,
      {
        'wc-ready': ready,
        'wc-built': phase === 7,
        'wc-high-risk': highRisk,
        'wc-inspecting': analysis.kind !== 'overview',
      },
    ]"
  >
    <div ref="host" class="wc-scene" />
    <div class="wc-vignette" aria-hidden="true" />
    <div class="wc-grain" aria-hidden="true" />
    <header class="wc-header">
      <div class="wc-brand">
        <svg viewBox="0 0 44 48" aria-hidden="true">
          <path
            d="m22 2 18 10v24L22 46 4 36V12Z"
            fill="none"
            stroke="currentColor"
            stroke-width="1.2"
            opacity=".4"
          />
          <path d="M12 15h20v5H12zm7 8h6v13h-6z" fill="currentColor" />
          <path
            d="M7 17v17l10 6M37 17v17l-10 6M15 8l7-4 7 4"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          />
        </svg>
        <div>
          <strong>中科天际<span>雷电预警指挥舱</span></strong
          ><small>TIANJI · LIGHTNING INTELLIGENCE</small>
        </div>
      </div>
      <nav class="wc-nav" aria-label="分析模式">
        <button
          v-for="(item, index) in MODES"
          :key="item.id"
          :class="{ active: mode === item.id }"
          :aria-pressed="mode === item.id"
          @click="chooseMode(item.id)"
        >
          <span>0{{ index + 1 }}</span
          >{{ item.name }}<i />
        </button>
      </nav>
      <div class="wc-header-status">
        <div class="wc-clock">
          <span>2026-07-18</span><time>{{ demoClock(minute, true) }}</time>
        </div>
        <span class="wc-demo"><i />模拟演示</span
        ><button
          class="wc-icon-button"
          :aria-label="fullscreen ? '退出全屏' : '进入全屏'"
          @click="toggleFullscreen"
        >
          <TwinIcon name="expand" :size="19" />
        </button>
      </div>
    </header>
    <section class="wc-metrics" aria-label="模拟态势概览">
      <div class="wc-metric">
        <span>全国雷电 <small>近 1 小时</small></span>
        <div>
          <strong>2,834</strong
          ><svg viewBox="0 0 72 25" aria-hidden="true">
            <path d="m1 22 5-10 6 6 5-14 7 18 6-8 5 4 7-15 7 13 5-5 5 9 5-16 6 11" />
          </svg>
        </div>
        <small class="wc-metric-note">LIGHTNING EVENTS</small>
      </div>
      <div class="wc-metric">
        <span>活动雷暴</span>
        <div><strong>04</strong><TwinIcon name="signal" :size="24" /></div>
        <small class="wc-metric-note">ACTIVE STORMS</small>
      </div>
      <div class="wc-metric wc-metric-risk">
        <span>受威胁资产</span>
        <div><strong>01</strong><TwinIcon name="shield" :size="23" /></div>
        <small class="wc-metric-note">ASSET AT RISK</small>
      </div>
      <div class="wc-metric">
        <span>监测矿区</span>
        <div><strong>06</strong><TwinIcon name="target" :size="25" /></div>
        <small class="wc-metric-note">ASSETS ONLINE</small>
      </div>
    </section>
    <div class="wc-map-caption">
      <span class="wc-live-dot" /><span>雷电数字战场</span><i /><small>{{
        currentMode.subtitle
      }}</small>
    </div>
    <div class="wc-map-scope" aria-label="观察范围">
      <button
        :class="{ active: scope === 'theater' }"
        :aria-pressed="scope === 'theater'"
        @click="chooseScope('theater')"
      >
        <TwinIcon name="target" :size="12" />态势视角</button
      ><button
        :class="{ active: scope === 'national' }"
        :aria-pressed="scope === 'national'"
        @click="chooseScope('national')"
      >
        全国总览
      </button>
    </div>
    <div class="wc-mine-filter" aria-label="煤矿显示范围">
      <button
        :class="{ active: mineFilter === 'priority' }"
        :aria-pressed="mineFilter === 'priority'"
        @click="chooseMineFilter('priority')"
      >
        重点煤矿
      </button>
      <button
        :class="{ active: mineFilter === 'all' }"
        :aria-pressed="mineFilter === 'all'"
        @click="chooseMineFilter('all')"
      >
        全部煤矿
      </button>
    </div>
    <div class="wc-map-labels" :class="{ identified: phase >= 3 }">
      <template v-for="mine in shownMines" :key="mine.id">
        <button
          v-if="layers.assets && screen(`mine:${mine.id}`)?.visible && phase >= 5"
          class="wc-mine-hit"
          :style="{
            left: `${screen(`mine:${mine.id}`)!.x}px`,
            top: `${screen(`mine:${mine.id}`)!.y}px`,
          }"
          :aria-label="`防御分析：${mine.name}`"
          :title="mine.name"
          @click="selectMine(mine.id)"
        />
      </template>
      <template v-for="storm in DEMO_STORMS" :key="storm.id">
        <button
          v-if="screen(storm.id)?.visible && layers.energy"
          class="wc-storm-tag"
          :class="{
            primary: selected === storm.id,
            selected: selected === storm.id,
            subdued: analysis.kind === 'storm' && selected !== storm.id,
          }"
          :style="labelStyle(storm.id)"
          :aria-label="`分析云团 ${storm.id}`"
          :aria-pressed="selected === storm.id"
          @click="selectStorm(storm.id)"
        >
          <span class="wc-tag-heading"
            ><i />{{ storm.id
            }}<small v-if="selected === storm.id && sequence.lock > 0.9">TRACKING</small></span
          >
        </button>
      </template>
      <button
        v-if="analysis.mine && mineAnchor?.visible && layers.assets && targetRevealed"
        class="wc-mine-tag"
        :class="{ visible: phase >= 5 }"
        :style="labelStyle(`mine:${analysis.mine.id}`)"
        :aria-label="`查看${analysis.mine.name}防御态势`"
        @click="selectMine(analysis.mine.id)"
      >
        <div class="wc-mine-tag-title">
          <span aria-hidden="true">◎</span><strong>{{ analysis.mine.name }}</strong>
        </div>
      </button>
      <svg class="wc-map-leaders" aria-hidden="true">
        <line
          v-for="item in mapOverlays"
          :key="item.id"
          :x1="item.layout.anchor.x"
          :y1="item.layout.anchor.y"
          :x2="item.layout.leader.x"
          :y2="item.layout.leader.y"
          :class="`wc-${item.kind}-leader`"
        />
      </svg>
      <div
        v-for="item in mapOverlays"
        :key="item.id"
        class="wc-overlay-label"
        :class="`wc-${item.kind}-label`"
        :style="{
          left: `${item.layout.x}px`,
          top: `${item.layout.y}px`,
          width: `${item.layout.width}px`,
          minHeight: `${item.layout.height}px`,
        }"
      >
        <template v-if="item.kind === 'relation'"
          ><b>{{ reading.distance }} <small>KM</small></b
          ><i /> <span title="预计抵达，时:分">ETA {{ formatEta(reading.eta) }}</span
          ><em>{{ threatRoman }}</em></template
        >
        <template v-else>{{ item.text }}</template>
      </div>
    </div>
    <aside
      v-if="analysis.kind === 'overview' || analysisComplete"
      class="wc-focus"
      :class="{ visible: phase >= 7 }"
      aria-label="重点资产威胁结论"
    >
      <p v-if="analysis.kind !== 'overview'" class="wc-analysis-context">
        {{ analysis.kind === 'storm' ? `云团分析 · ${selected}` : '资产防御分析' }}
      </p>
      <h1>{{ analysis.mine?.name ?? '暂无受威胁煤矿' }}</h1>
      <div v-if="analysis.relation" class="wc-risk-line">
        <strong>{{ threatRoman }}</strong
        ><span>{{ threatName }}</span
        ><i /><small>{{ selected || '—' }}</small>
      </div>
      <div v-if="analysis.relation" class="wc-focus-numbers">
        <div>
          <strong>{{ reading.distance ?? '—' }}<small> km</small></strong
          ><span>重点雷暴距离</span>
        </div>
        <div>
          <strong>{{ formatEta(reading.eta) }}</strong>
          ><span>预计抵达 · 时:分</span>
        </div>
      </div>
      <div v-if="motion" class="wc-movement">
        <div>
          <TwinIcon name="arrow" :size="17" /><span
            ><b>{{ Math.round(motion.speed) }} <small>km/h</small></b></span
          >
        </div>
        <div>
          <span class="wc-northeast" :style="{ transform: `rotate(${motion.bearing - 45}deg)` }"
            >↗</span
          ><span
            ><b>{{ `${movementDirection(motion.bearing)}方向` }}</b></span
          >
        </div>
      </div>
      <p v-if="!analysis.relation" class="wc-analysis-hint">{{ analysisHint }}</p>
    </aside>
    <aside class="wc-layer-panel" :class="{ collapsed: !layersOpen }" aria-label="地图图层控制">
      <button
        class="wc-layer-heading"
        :aria-expanded="layersOpen"
        @click="layersOpen = !layersOpen"
      >
        <TwinIcon name="layers" :size="14" /><strong>图层控制</strong
        ><span>{{ layersOpen ? '−' : '+' }}</span>
      </button>
      <div v-show="layersOpen" class="wc-layer-list">
        <button
          v-for="layer in LAYERS"
          :key="layer.id"
          :class="{ active: layers[layer.id] }"
          :aria-pressed="layers[layer.id]"
          @click="toggleLayer(layer.id)"
        >
          <span class="wc-layer-eye"><i /></span><TwinIcon :name="layer.icon" :size="15" /><span>{{
            layer.name
          }}</span>
        </button>
        <div class="wc-layer-foot"><i /><span>本地场景 · 模拟数据</span></div>
      </div>
    </aside>
    <div
      v-if="analysis.kind === 'overview'"
      class="wc-mode-key"
      :class="{ visible: phase === 7 && analysisComplete }"
    >
      <span>0{{ MODES.findIndex((m) => m.id === mode) + 1 }} / {{ currentMode.name }}</span
      ><template v-if="mode === 'heat'"
        ><div class="wc-energy-key" />
        <p><span>弱</span><span>雷暴能量 / dBZ</span><span>强</span></p></template
      >
      <p v-else-if="mode === 'track'">实线 · 历史航迹<br />虚线 · 未来 180 分钟</p>
      <p v-else-if="mode === 'warning'">
        50 / 100 / 150 / 200 km<br />{{
          risk.level ? `当前激活 ${risk.radius} km 防御层` : '防御圈待命'
        }}
      </p>
      <p v-else-if="selectedStorm">
        正在跟踪 {{ selectedStorm.id }}<br /><b>{{ selectedStorm.dbz }}</b> dBZ <i />{{
          selectedStorm.speed
        }}
        km/h
      </p>
    </div>
    <div class="wc-map-tools">
      <button aria-label="放大地图" @click="scene?.zoom(1)">
        <TwinIcon name="plus" :size="17" /></button
      ><button aria-label="缩小地图" @click="scene?.zoom(-1)">
        <TwinIcon name="minus" :size="17" /></button
      ><button
        :aria-label="flat ? '切换三维视角' : '切换二维视角'"
        :aria-pressed="flat"
        @click="toggleView"
      >
        {{ flat ? '2D' : '3D' }}</button
      ><button aria-label="复位地图与分析目标" @click="resetView">
        <TwinIcon name="reset" :size="15" />
      </button>
    </div>
    <div class="wc-north" aria-hidden="true">
      <span>N</span
      ><svg viewBox="0 0 38 48">
        <path d="m19 4 13 33-13-8L6 37Z" fill="#3e7386" />
        <path d="M19 4v25L6 37Z" fill="#173847" />
      </svg>
    </div>
    <div
      class="wc-build-status"
      :class="{ complete: phase === 7 }"
      role="status"
      aria-live="polite"
    >
      <span class="wc-build-counter">0{{ phase + 1 }}<small> / 08</small></span>
      <div>
        <strong>{{
          phase < 7 || analysis.kind === 'overview'
            ? stage.title
            : !analysisComplete
              ? analysis.kind === 'mine' && analysisProgress < 0.16
                ? '展开资产防御纵深'
                : analysisStage
              : analysis.kind === 'storm'
                ? `云团分析 · ${selected}`
                : `资产防御 · ${analysis.mine?.name}`
        }}</strong>
        <p>
          {{
            phase < 7 || analysis.kind === 'overview'
              ? stage.detail
              : analysisComplete
                ? analysisHint
                : '沿当前运动方向推演 · 未来 3 小时'
          }}
        </p>
      </div>
      <div class="wc-build-bars" aria-hidden="true">
        <i v-for="n in 8" :key="n" :class="{ active: phase >= n - 1 }" />
      </div>
      <button v-if="phase === 7" aria-label="重播态势构建" title="重播态势构建" @click="replay">
        <TwinIcon name="reset" :size="14" />
      </button>
    </div>
    <footer class="wc-timeline" aria-label="态势时间轴">
      <button
        class="wc-play"
        :aria-label="playing ? '暂停回放' : '播放时间轴'"
        :disabled="!ready || phase < 7"
        @click="togglePlayback"
      >
        <TwinIcon :name="playing ? 'pause' : 'play'" :size="20" />
      </button>
      <div class="wc-time-readout">
        <small>2026-07-18</small><strong>{{ demoClock(minute, true) }}</strong
        ><span>{{ timeState }}</span>
      </div>
      <div class="wc-time-track">
        <div class="wc-time-legend">
          <span><i class="event" />雷击事件</span><span><i class="track" />历史航迹</span
          ><span><i class="forecast" />预测轨迹</span
          ><span class="wc-time-axis-copy">HISTORY <b>←</b> NOW <b>→</b> FORECAST</span>
        </div>
        <div class="wc-slider-shell">
          <div class="wc-time-base" />
          <div class="wc-time-fill" :style="{ width: `${(minute / DEMO_END) * 100}%` }" />
          <div class="wc-now-line" :style="{ left: `${(DEMO_NOW / DEMO_END) * 100}%` }">
            <span>NOW</span>
          </div>
          <i
            v-for="(event, index) in timelineEvents"
            :key="index"
            class="wc-time-event"
            :class="{ future: event.minute > DEMO_NOW }"
            :style="{
              left: `${(event.minute / DEMO_END) * 100}%`,
              top: `${19 + (index % 2) * 5}px`,
            }"
          /><input
            aria-label="拖动时间轴，查看历史与预测态势"
            type="range"
            min="0"
            :max="DEMO_END"
            step="0.25"
            :value="minute"
            :aria-valuetext="`${demoClock(minute)} ${timeState}`"
            @input="scrub"
          />
        </div>
        <div class="wc-time-ticks">
          <span v-for="value in [0, 30, 60, 90, 120, 150, 180]" :key="value">{{
            demoClock(value)
          }}</span>
        </div>
      </div>
      <div class="wc-time-actions">
        <button
          class="wc-forecast-button"
          :class="{ active: mode === 'track' && playing }"
          @click="forecast"
        >
          <TwinIcon name="play" :size="12" />未来 2 小时推演
        </button>
        <div class="wc-playback-options">
          <button
            v-for="value in [1, 2, 4]"
            :key="value"
            :class="{ active: speed === value }"
            :aria-pressed="speed === value"
            @click="speed = value"
          >
            {{ value }}×</button
          ><button class="wc-now-button" @click="returnNow">回到当前</button>
        </div>
      </div>
    </footer>
    <div v-if="!ready && !error" class="wc-loading">
      <span /><strong>正在建立数字战场</strong><small>加载本地地理数据与雷暴场景</small>
    </div>
    <div v-if="error" class="wc-error" role="alert">
      <TwinIcon name="signal" :size="18" /><span>{{ error }}</span
      ><button aria-label="关闭提示" @click="error = ''">
        <TwinIcon name="close" :size="16" />
      </button>
    </div>
  </main>
</template>
