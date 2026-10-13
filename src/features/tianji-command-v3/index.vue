<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import TwinIcon from './TwinIcon.vue'
import { createCommandScene } from './cesiumScene'
import type { CommandScene, ScreenAnchor, DemoStatus, SceneTelemetry, ViewLevel } from './sceneTypes'
import { measurementFrame } from './cinematicCamera'
import { RESOURCE_LABELS, type GeographicStatus } from './geographicResources'
import {
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
import { MINES, warningLevel, distanceReading, type WeatherMode } from './weather'
import {
  movementDirection,
  resolveAnalysis,
  mineVisible,
  rankedThreats,
  stormForecast,
  formatEta,
  type AnalysisSelection,
  type MineFilter,
} from './commandAnalysis'
import { placeMapLabel, type LabelRect, type MapLabel } from './commandLabels'
import './weather.css'
import './immersive.css'

const root = ref<HTMLElement>()
const host = ref<HTMLElement>()
const scene = shallowRef<CommandScene>()
const ready = ref(false)
const error = ref('')
const mode = ref<WeatherMode>('live')
const scope = ref<CommandScope>('national')
const phase = ref(0)
const minute = ref(DEMO_NOW)
const playing = ref(false)
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
const demoStatus = ref<DemoStatus>({
  state: 'INITIALIZING',
  title: '初始化三维态势',
  detail: '加载地理底图',
  step: 0,
})
const demoBusy = computed(() =>
  ['OVERVIEW', 'TARGET_LOCKED', 'FLYING', 'MEASURING'].includes(demoStatus.value.state),
)
const reveal = computed(() => measurementFrame(analysisProgress.value))
const targetRevealed = computed(() => phase.value >= 2)
const sourceStatus = ref('正在加载地图数据源')
const geography = shallowRef<GeographicStatus>({
  terrain: 'unconfigured',
  buildings: 'unconfigured',
  terrainMs: null,
  buildingsMs: null,
  modelMemoryMb: null,
})
const heading = ref(0)
const viewLevel = ref<ViewLevel>('national')
const levelLabel = computed(() => ({ national: '全国远景', regional: '区域中景', local: '矿区近景' })[viewLevel.value])
const devMode = import.meta.env.DEV
const telemetry = shallowRef<SceneTelemetry>()
const sequence = computed(() => ({
  lock: targetRevealed.value ? 1 : 0,
  vector: reveal.value.direction,
}))
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
  distance: analysis.value.relation?.distance ?? null,
  eta: analysis.value.relation?.eta ?? null,
}))
const displayDistance = computed(() =>
  distanceReading((reading.value.distance ?? 0) * reveal.value.number),
)
const etaText = computed(() => (reveal.value.eta < 1 ? '—' : formatEta(reading.value.eta)))
const threatCount = computed(() => new Set(rankedThreats(minute.value).map((r) => r.mine.id)).size)
const eventCount = computed(
  () =>
    DEMO_EVENTS.filter((event) => event.minute <= minute.value && event.minute > minute.value - 60)
      .length,
)
const risk = computed(() => analysis.value.relation?.level ?? warningLevel(Infinity))
const highRisk = computed(() => analysisComplete.value && risk.value.level === 1)
const threatName = computed(() => risk.value.name.replace('预警', '威胁'))
const threatRoman = computed(() => risk.value.roman)
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
          ? '暂无法估算 · 缺少可靠的轨迹覆盖结果'
          : analysis.value.kind === 'storm'
            ? `首个受影响煤矿 · ${analysis.value.mine?.name}`
            : `最危险云团 · ${selected.value}`,
)
const currentMode = computed(() => MODES.find((m) => m.id === mode.value)!)
const timelineEvents = DEMO_EVENTS.filter((_, i) => i % 13 === 0)
const shownMines = computed(() =>
  MINES.filter((m) => mineVisible(m, mineFilter.value, analysis.value.mine?.id)),
)
const abort = new AbortController()
let mounted = true,
  interval = 0,
  previousTitle = ''

function chooseMode(next: WeatherMode, interrupt = true) {
  if (interrupt) scene.value?.interrupt()
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
  playing.value = false
  scene.value?.interrupt()
  focusNextSelection = true
  restartNextSelection = true
  analysisProgress.value = 0
  selection.value = { kind: 'storm', id }
  chooseMode('live', false)
  for (const layer of ['energy', 'assets', 'tracks', 'corridor', 'rings'] as CommandLayer[]) {
    layers.value[layer] = true
    scene.value?.setLayer(layer, true)
  }
}
function selectMine(id: string) {
  playing.value = false
  scene.value?.interrupt()
  focusNextSelection = true
  restartNextSelection = true
  analysisProgress.value = 0
  selection.value = { kind: 'mine', id }
  chooseMode('warning', false)
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
  scene.value?.interrupt()
  playing.value = false
  setTime(Number((event.target as HTMLInputElement).value))
}
function returnNow() {
  scene.value?.interrupt()
  playing.value = false
  setTime(DEMO_NOW)
}
function togglePlayback() {
  scene.value?.interrupt()
  if (minute.value >= DEMO_END) setTime(0)
  playing.value = !playing.value
}
function forecast() {
  scene.value?.interrupt()
  chooseMode('track')
  setTime(DEMO_NOW)
  playing.value = true
}
function replay() {
  returnNow()
  for (const layer of ['energy', 'assets', 'tracks', 'corridor', 'rings'] as CommandLayer[]) {
    layers.value[layer] = true
    scene.value?.setLayer(layer, true)
  }
  selection.value = { kind: 'overview' }
  scene.value?.setAnalysis(resolveAnalysis(selection.value, minute.value))
  scene.value?.replay()
}
function toggleView() {
  flat.value = !flat.value
  scene.value?.setView(flat.value)
}
function resetView() {
  playing.value = false
  selection.value = { kind: 'overview' }
  scene.value?.reset()
}
function screen(id: string) {
  return anchors.value.find((a) => a.id === id)
}
function labelStyle(id: string) {
  const layout = mapLabels.value.tags.find((tag) => tag.id === id)?.layout
  return { left: `${layout?.x ?? 0}px`, top: `${layout?.y ?? 0}px`,
    width: `${layout?.width ?? 0}px`, height: `${layout?.height ?? 0}px`, transform: 'none' }
}
const mapLabels = computed(() => {
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
        '.wc-header, .wc-metrics, .wc-focus, .wc-layer-panel, .wc-map-scope, .wc-mine-filter, .wc-map-tools, .wc-build-status, .wc-timeline, .wc-mode-key, .wc-source-status, .wc-performance',
      )
      .forEach((element) => {
        const r = element.getBoundingClientRect()
        if (r.width && r.height && getComputedStyle(element).opacity !== '0')
          obstacles.push({ x: r.x - origin.x, y: r.y - origin.y, width: r.width, height: r.height })
      })
  const result: { id: string; kind: string; text: string; layout: MapLabel }[] = []
  const tags: { id: string; layout: MapLabel }[] = []
  const addTag = (id: string, width: number, height: number) => {
    const anchor = screen(id)
    if (!anchor?.visible) return
    const candidates = anchor.bounds
      ? [{ x: anchor.bounds.x + anchor.bounds.width / 2, y: anchor.bounds.y }, anchor]
      : [anchor]
    const layout = placeMapLabel(candidates, width, height, viewport, obstacles)
    if (layout) {
      // Keep the leader attached to the actual geographic anchor, even if an edge was preferred.
      tags.push({ id, layout: { ...layout, anchor } })
      obstacles.push(layout)
    }
  }
  if (layers.value.assets && targetRevealed.value && analysis.value.mine)
    addTag(`mine:${analysis.value.mine.id}`, viewport.width <= 760 ? 136 : 172, 34)
  if (layers.value.energy && selected.value)
    addTag(selected.value, sequence.value.lock > .9 ? 148 : 65, 30)
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
  const finish = () => {
    if (layers.value.energy && viewLevel.value !== 'local') {
      for (const storm of DEMO_STORMS) {
        if (storm.id !== selected.value) addTag(storm.id, 65, 30)
      }
    }
    return { tags, overlays: result }
  }
  if (phase.value < 6) return finish()
  if (
    reveal.value.number > 0 &&
    analysis.value.relation &&
    layers.value.corridor &&
    layers.value.assets &&
    layers.value.energy
  )
    add('result', 'relation', '', ['relationship:1', 'relationship:0', 'relationship:2'], 266)
  if (analysisComplete.value && !analysis.value.relation)
    add(
      'empty',
      'empty',
      analysisHint.value,
      [analysis.value.kind === 'storm' ? 'forecast-end' : `mine:${analysis.value.mine?.id}`],
      240,
      34,
    )
  if (layers.value.tracks && selectedStorm.value) {
    if (sequence.value.vector > 0.9 && motion.value)
      add(
        'vector',
        'vector',
        `${movementDirection(motion.value.bearing)} / ${Math.round(motion.value.speed)} km/h`,
        ['vector'],
        118,
      )
  }
  return finish()
})
const mapOverlays = computed(() => mapLabels.value.overlays)
const hasTag = (id: string) => mapLabels.value.tags.some((tag) => tag.id === id)
watch(layersOpen, () => scene.value?.reframe(), { flush: 'post' })
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
function getSafeInsets() {
  const width = host.value?.clientWidth ?? window.innerWidth
  const height = host.value?.clientHeight ?? window.innerHeight
  const origin = host.value?.getBoundingClientRect()
  const rect = (selector: string) =>
    root.value?.querySelector<HTMLElement>(selector)?.getBoundingClientRect()
  const timeline = rect('.wc-timeline')
  const metrics = rect('.wc-metrics')
  const panels = rect('.wc-layer-panel')
  const focus = rect('.wc-focus')
  const top = width <= 760 ? 285 : Math.max(160, (metrics?.bottom ?? 150) - (origin?.top ?? 0) + 20)
  return {
    left: width <= 760 ? 24 : 310,
    right:
      width <= 760
        ? layersOpen.value
          ? (panels?.width ?? 125) + 36
          : 56
        : layersOpen.value
          ? (panels?.width ?? 172) + 52
          : 70,
    top: Math.min(top, height * 0.4),
    bottom:
      width <= 760
        ? Math.min(Math.max(335, height - (focus?.top ?? height - 335) + 16), height * 0.46)
        : Math.min(height - (timeline?.top ?? height - 110) + 52, height * 0.36),
  }
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
      demoBusy.value ||
      !analysisComplete.value ||
      document.hidden
    )
      return
    setTime(minute.value + speed.value * 0.05)
    if (minute.value >= DEMO_END) playing.value = false
  }, 200)
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
      onStatus: (status) => {
        demoStatus.value = status
      },
      onScope: (value) => {
        scope.value = value
      },
      onSource: (value) => {
        sourceStatus.value = value
      },
      onHeading: (value) => {
        heading.value = value
      },
      onViewLevel: (value) => { viewLevel.value = value },
      onGeography: (value) => {
        geography.value = value
      },
      onTelemetry: (value) => {
        telemetry.value = value
      },
      getSafeInsets,
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
    controller.start()
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
    class="wc-command wc-immersive"
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
        <span>雷电事件 <small>模拟 · 近 1 小时</small></span>
        <div>
          <strong>{{ eventCount }}</strong
          ><svg viewBox="0 0 72 25" aria-hidden="true">
            <path d="m1 22 5-10 6 6 5-14 7 18 6-8 5 4 7-15 7 13 5-5 5 9 5-16 6 11" />
          </svg>
        </div>
        <small class="wc-metric-note">LIGHTNING EVENTS</small>
      </div>
      <div class="wc-metric">
        <span>活动雷暴</span>
        <div>
          <strong>{{ String(DEMO_STORMS.length).padStart(2, '0') }}</strong
          ><TwinIcon name="signal" :size="24" />
        </div>
        <small class="wc-metric-note">ACTIVE STORMS</small>
      </div>
      <div class="wc-metric wc-metric-risk">
        <span>受威胁资产</span>
        <div>
          <strong>{{ String(threatCount).padStart(2, '0') }}</strong
          ><TwinIcon name="shield" :size="23" />
        </div>
        <small class="wc-metric-note">ASSET AT RISK</small>
      </div>
      <div class="wc-metric">
        <span>监测矿区</span>
        <div>
          <strong>{{ String(MINES.length).padStart(2, '0') }}</strong
          ><TwinIcon name="target" :size="25" />
        </div>
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
      <select
        aria-label="切换分析矿区"
        :value="analysis.mine?.id ?? ''"
        @change="selectMine(($event.target as HTMLSelectElement).value)"
      >
        <option value="" disabled>选择矿区</option>
        <option v-for="mine in MINES" :key="mine.id" :value="mine.id">{{ mine.name }}</option>
      </select>
    </div>
    <div class="wc-map-labels" :class="{ identified: ready }">
      <template v-for="mine in shownMines" :key="mine.id">
        <button
          v-if="layers.assets && screen(`mine:${mine.id}`)?.visible"
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
          v-if="hasTag(storm.id)"
          class="wc-storm-tag"
          :class="{
            primary: selected === storm.id,
            selected: selected === storm.id,
            subdued: selected !== storm.id,
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
        v-if="analysis.mine && hasTag(`mine:${analysis.mine.id}`)"
        class="wc-mine-tag"
        :class="{ visible: targetRevealed }"
        :style="labelStyle(`mine:${analysis.mine.id}`)"
        :aria-label="`查看${analysis.mine.name}防御态势`"
        @click="selectMine(analysis.mine.id)"
      >
        <div class="wc-mine-tag-title">
          <span aria-hidden="true">◎</span><strong>{{ analysis.mine.name }}</strong>
        </div>
      </button>
      <svg class="wc-map-leaders" aria-hidden="true">
        <line v-for="tag in mapLabels.tags" :key="`tag:${tag.id}`"
          :x1="tag.layout.anchor.x" :y1="tag.layout.anchor.y"
          :x2="tag.layout.leader.x" :y2="tag.layout.leader.y" />
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
          ><b
            >{{ displayDistance.value }} <small>{{ displayDistance.unit }}</small></b
          ><i /> <span title="按预测轨迹首次覆盖计算；时:分">ETA {{ etaText }}</span
          ><em>{{ threatRoman }}</em></template
        >
        <template v-else>{{ item.text }}</template>
      </div>
    </div>
    <aside
      v-if="analysis.mine || analysis.storm"
      class="wc-focus"
      :class="{ visible: targetRevealed }"
      aria-label="重点资产威胁结论"
    >
      <p v-if="analysis.kind !== 'overview'" class="wc-analysis-context">
        {{ analysis.kind === 'storm' ? `云团分析 · ${selected}` : '资产防御分析' }}
      </p>
      <h1>{{ analysis.mine?.name ?? `雷暴 ${selected}` }}</h1>
      <p class="wc-focus-source">模拟场景 · {{ analysis.mine?.region ?? '无命中矿区' }}</p>
      <div v-if="analysis.relation" class="wc-risk-line">
        <strong>{{ threatRoman }}</strong
        ><span>{{ threatName }}</span
        ><i /><small>{{ selected || '—' }}</small>
      </div>
      <div v-if="analysis.relation && phase >= 6" class="wc-focus-numbers">
        <div>
          <strong
            >{{ displayDistance.value }}<small> {{ displayDistance.unit }}</small></strong
          ><span>云团边界 → 矿区</span>
        </div>
        <div>
          <strong :class="{ 'wc-eta-unavailable': reading.eta === null }">{{ etaText }}</strong>
          ><span>首次覆盖 · 时:分</span>
        </div>
      </div>
      <p v-else-if="analysis.relation" class="wc-analysis-hint">正在建立矿区与雷暴的空间关系…</p>
      <div v-if="motion && phase >= 6" class="wc-movement">
        <div :style="{ opacity: reveal.speed }">
          <TwinIcon name="arrow" :size="17" /><span
            ><b>{{ Math.round(motion.speed) }} <small>km/h</small></b></span
          >
        </div>
        <div :style="{ opacity: reveal.direction }">
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
    <div class="wc-north" aria-hidden="true" :style="{ transform: `rotate(${-heading}deg)` }">
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
        <strong>{{ demoStatus.title }}</strong>
        <p>{{ demoStatus.detail }}</p>
      </div>
      <div class="wc-build-bars" aria-hidden="true">
        <i v-for="n in 8" :key="n" :class="{ active: phase >= n - 1 }" />
      </div>
      <button v-if="demoBusy" class="wc-skip-demo" @click="scene?.skip()">跳过演示</button>
      <button
        v-if="ready"
        class="wc-replay-demo"
        aria-label="重播沉浸式演示"
        title="重播沉浸式演示"
        @click="replay"
      >
        <TwinIcon name="reset" :size="14" /><span>重播演示</span>
      </button>
    </div>
    <div class="wc-source-status">
      <span>{{ levelLabel }} · {{ sourceStatus }}</span>
      <span class="wc-geographic-status"
        >地形 {{ RESOURCE_LABELS[geography.terrain] }} · 矿区模型
        {{ RESOURCE_LABELS[geography.buildings] }}</span
      >
      <small>矿区与雷暴均为演示数据 · 云体为示意高度</small>
    </div>
    <details v-if="devMode && telemetry" class="wc-performance">
      <summary>DEV · {{ telemetry.fps }} FPS <small>按需渲染</small></summary>
      <dl>
        <dt>场景初始化</dt>
        <dd>{{ Math.round(telemetry.initMs) }} ms</dd>
        <dt>首次可交互</dt>
        <dd>
          {{ telemetry.interactiveMs === null ? '—' : `${Math.round(telemetry.interactiveMs)} ms` }}
        </dd>
        <dt>最近镜头飞行</dt>
        <dd>{{ telemetry.flightMs === null ? '—' : `${Math.round(telemetry.flightMs)} ms` }}</dd>
        <dt>JS Heap</dt>
        <dd>{{ telemetry.heapMb === null ? '浏览器未提供' : `${telemetry.heapMb} MB` }}</dd>
        <dt>顶层 Primitive 数</dt>
        <dd>{{ telemetry.primitives }}</dd>
        <dt>云团单元 / 画质</dt>
        <dd>
          {{ telemetry.cloudPrimitives }} / {{ telemetry.quality === 'economy' ? '节能' : '标准' }}
        </dd>
        <dt>Heap 相对初始化</dt>
        <dd>
          {{
            telemetry.heapDeltaMb === null
              ? '浏览器未提供'
              : `${telemetry.heapDeltaMb > 0 ? '+' : ''}${telemetry.heapDeltaMb} MB`
          }}
        </dd>
        <dt>地形首次加载</dt>
        <dd>
          {{
            telemetry.geography.terrainMs === null
              ? RESOURCE_LABELS[geography.terrain]
              : `${Math.round(telemetry.geography.terrainMs)} ms`
          }}
        </dd>
        <dt>矿区首次加载</dt>
        <dd>
          {{
            telemetry.geography.buildingsMs === null
              ? RESOURCE_LABELS[geography.buildings]
              : `${Math.round(telemetry.geography.buildingsMs)} ms`
          }}
        </dd>
        <dt>模型资源估算 / GPU 显存</dt>
        <dd>
          {{
            telemetry.geography.modelMemoryMb === null
              ? '—'
              : `${telemetry.geography.modelMemoryMb} MB`
          }}
          / 未提供
        </dd>
      </dl>
    </details>
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
