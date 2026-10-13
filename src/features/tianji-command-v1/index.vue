<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import TwinIcon from './TwinIcon.vue'
import { createWeatherScene, type WeatherScene } from './weatherScene'
import { FOCUS_STAGES, type FocusStage } from './focus'
import {
  LEVELS,
  MINES,
  STORMS,
  distanceKm,
  distanceReading,
  arrivalMinutes,
  nearestStorm,
  stormThreats,
  scenarioTime,
  visibleStrikes,
  type MapScope,
  type Strike,
  type WeatherMode,
} from './weather'
import './weather.css'

const root = ref<HTMLElement>()
const host = ref<HTMLDivElement>()
const scene = shallowRef<WeatherScene>()
const ready = ref(false)
const error = ref('')
const mode = ref<WeatherMode>('live')
const scope = ref<MapScope>('national')
const view = ref<'3D' | '2D'>('3D')
const minute = ref(30)
const playing = ref(!window.matchMedia('(prefers-reduced-motion: reduce)').matches)
const speed = ref(1)
const mineId = ref(MINES[0]!.id)
const mineMenu = ref(false)
const layerMenu = ref(false)
const radarLayer = ref(true)
const lightningLayer = ref(true)
const pickedStrike = ref<Strike | null>(null)
const fullscreen = ref(false)
const focusStage = ref<FocusStage>('overview')
const targetScreen = shallowRef({ x: 0, y: 0, visible: false })
const focusBusy = computed(() => scope.value === 'mine' && mode.value !== 'heat' && focusStage.value !== 'overview' && focusStage.value !== 'locked')
const resultReady = computed(() => !focusBusy.value)
const focusInfo = computed(() => FOCUS_STAGES[focusStage.value])
const mine = computed(() => MINES.find((item) => item.id === mineId.value)!)
const threats = computed(() => stormThreats(mine.value, minute.value))
const nearby = computed(() => threats.value[0]!)
const inRange = computed(() => threats.value.filter((item) => item.distance <= 200))
const localThreats = computed(() => threats.value.filter((item) => item.distance <= 350))
const trackedId = ref('')
const tracked = computed(
  () => localThreats.value.find((item) => item.storm.id === trackedId.value) ?? nearby.value,
)
const approaching = computed(() => nearby.value.approaching)
const nearestReading = computed(() => distanceReading(nearby.value.distance))
const trackedReading = computed(() => distanceReading(tracked.value.distance))
const eta = computed(() => arrivalMinutes(mine.value, nearby.value.storm, minute.value))
const trackedEta = computed(() => arrivalMinutes(mine.value, tracked.value.storm, minute.value))
const strikes = computed(() => visibleStrikes(minute.value))
const modeInfo = {
  live: {
    title: '雷电实时监测',
    heading: '全国雷暴态势',
    hint: '看见每一片雷暴，追踪每一次靠近。',
  },
  heat: {
    title: '雷电热力图',
    heading: '雷电活动分布',
    hint: '近 30 分钟落雷密度，颜色越暖，落雷越集中。',
  },
  track: {
    title: '雷暴移动轨迹',
    heading: '雷暴移动轨迹',
    hint: '实线回溯已发生的移动，虚线外推未来 60 分钟。',
  },
  warning: {
    title: '雷暴临近预警',
    heading: '矿区雷暴临近态势',
    hint: '独立跟踪每片雷暴，按距矿区的最近距离分级。',
  },
} as const
const headline = computed(() =>
  mode.value === 'live' && scope.value === 'mine'
    ? `${mine.value.name}周边雷暴`
    : modeInfo[mode.value].heading,
)
let interval = 0
let mounted = true
let previousTitle = ''

function returnToCurrent() {
  minute.value = 30
  playing.value = false
}

function togglePlayback() {
  if (minute.value >= 90) {
    minute.value = 0
    playing.value = true
  } else playing.value = !playing.value
}

function chooseMode(next: WeatherMode) {
  mode.value = next
  pickedStrike.value = null
  scene.value?.setMode(next)
  if (next === 'warning' || next === 'track') setScope('mine')
}
function setScope(next: MapScope) {
  scope.value = next
  pickedStrike.value = null
  scene.value?.setScope(next)
}
function chooseMine(id: string) {
  mineId.value = id
  mineMenu.value = false
  pickedStrike.value = null
  trackedId.value = ''
  mode.value = 'warning'
  scope.value = 'mine'
  scene.value?.setMode('warning')
  scene.value?.focusMine(id)
}
function replayFocus() { chooseMine(mineId.value) }
function trackStorm(id: string) {
  trackedId.value = id
  scene.value?.selectStorm(id)
  if (scope.value !== 'mine') setScope('mine')
}
function setView(next: '3D' | '2D') {
  view.value = next
  scene.value?.setView(next)
}
function toggleLayer(layer: 'radar' | 'lightning') {
  const state = layer === 'radar' ? radarLayer : lightningLayer
  state.value = !state.value
  scene.value?.setLayer(layer, state.value)
}
function reset() {
  view.value = '3D'
  scene.value?.reset()
}
async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen()
    else await root.value?.requestFullscreen()
  } catch {
    error.value = '浏览器暂未允许全屏，可使用 F11；地图仍可正常操作。'
  }
}
function onFullScreen() {
  fullscreen.value = !!document.fullscreenElement
}
function onKey(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    mineMenu.value = false
    layerMenu.value = false
    pickedStrike.value = null
  }
}
watch(minute, (value) => {
  pickedStrike.value = null
  scene.value?.setTime(value)
})
watch(
  () => tracked.value.storm.id,
  (id) => scene.value?.selectStorm(id),
)

onMounted(async () => {
  previousTitle = document.title
  document.title = '中科天际 · 雷暴临近预警'
  document.addEventListener('keydown', onKey)
  document.addEventListener('fullscreenchange', onFullScreen)
  interval = window.setInterval(() => {
    if (!playing.value || !ready.value || document.hidden || focusBusy.value) return
    if (minute.value >= 90) {
      playing.value = false
      return
    }
    minute.value = Math.min(90, minute.value + speed.value * 0.25)
  }, 1000)
  try {
    const controller = await createWeatherScene(host.value!, {
      onMine: chooseMine,
      onStorm: trackStorm,
      onFocusStage: (stage) => { focusStage.value = stage },
      onTargetScreen: (point) => { targetScreen.value = point },
      onStrike: (strike) => {
        pickedStrike.value = strike
      },
      onError: (message) => {
        error.value = message
      },
    })
    if (!mounted) {
      controller.dispose()
      return
    }
    scene.value = controller
    controller.setMode(mode.value)
    controller.setTime(minute.value)
    controller.selectMine(mineId.value)
    controller.selectStorm(tracked.value.storm.id)
    controller.setScope(scope.value)
    controller.setView(view.value)
    controller.setLayer('radar', radarLayer.value)
    controller.setLayer('lightning', lightningLayer.value)
    ready.value = true
  } catch {
    error.value = '地图加载失败，请检查浏览器硬件加速及本地地图数据后刷新。'
  }
})
onBeforeUnmount(() => {
  mounted = false
  clearInterval(interval)
  scene.value?.dispose()
  document.removeEventListener('keydown', onKey)
  document.removeEventListener('fullscreenchange', onFullScreen)
  document.title = previousTitle
})
</script>

<template>
  <main
    ref="root"
    class="wc-command"
    :class="[`wc-${mode}`, `wc-${scope}`, { 'wc-acquiring': focusBusy }]"
    :style="{ '--risk': nearby.level.color }"
  >
    <div ref="host" class="wc-scene" />
    <div class="wc-shade" aria-hidden="true" />
    <header class="wc-header">
      <div class="wc-brand">
        <svg viewBox="0 0 40 44" aria-hidden="true">
          <path
            d="m20 2 17 10v20L20 42 3 32V12Z"
            fill="none"
            stroke="currentColor"
            stroke-width="1.3"
          />
          <path d="m24 9-13 16h8l-3 10 13-18h-8Z" fill="currentColor" />
        </svg>
        <div>
          <strong>中科天际<span>雷电预警指挥舱</span></strong
          ><small>TIANJI · LIGHTNING INTELLIGENCE</small>
        </div>
      </div>
      <nav class="wc-nav" aria-label="雷电业务模块">
        <button
          v-for="(item, key, index) in modeInfo"
          :key="key"
          :class="{ active: mode === key }"
          :aria-pressed="mode === key"
          @click="chooseMode(key)"
        >
          <span>0{{ index + 1 }}</span
          >{{ item.title }}
        </button>
      </nav>
      <div class="wc-header-actions">
        <span class="wc-demo" :class="{ running: playing }"
          ><i />{{ playing ? '演示运行中' : '模拟演示' }}</span
        ><button :aria-label="fullscreen ? '退出全屏' : '进入全屏'" @click="toggleFullscreen">
          <TwinIcon name="expand" :size="18" />
        </button>
      </div>
    </header>
    <section class="wc-heading">
      <div class="wc-eyebrow">
        {{ scope === 'national' ? 'CHINA / WEATHER SITUATION' : 'MINE / PROXIMITY MONITORING' }}
      </div>
      <h1>{{ headline }}</h1>
      <p>{{ modeInfo[mode].hint }}</p>
      <div v-if="mode === 'live'" class="wc-summary">
        <span
          ><b>{{ STORMS.length }}</b> 片雷暴区域</span
        ><i /><span
          >近 30 分钟 <b>{{ strikes.length }}</b> 次落雷</span
        >
      </div>
    </section>
    <div class="wc-scope" aria-label="地图观察范围">
      <button
        :class="{ active: scope === 'national' }"
        :aria-pressed="scope === 'national'"
        @click="setScope('national')"
      >
        <TwinIcon name="globe" :size="14" />全国总览</button
      ><button
        :class="{ active: scope === 'mine' }"
        :aria-pressed="scope === 'mine'"
        @click="setScope('mine')"
      >
        <TwinIcon name="radar" :size="14" />矿区雷达
      </button>
    </div>

    <div v-if="scope === 'mine' && mode !== 'heat'" class="wc-focus-story" role="status" aria-live="polite">
      <div class="wc-focus-stage"><span>{{ focusInfo.number }}<small> / 05</small></span><i /><strong>{{ focusStage === 'flying' ? `定位${mine.name}` : focusInfo.title }}</strong><TwinIcon v-if="focusStage === 'locked'" name="target" :size="16" /></div>
      <p>{{ focusStage === 'locked' ? `${mine.name} · ${localThreats.length} 片周边雷暴独立跟踪` : focusInfo.detail }}</p>
      <div class="wc-focus-progress"><i :style="{ width: `${Number(focusInfo.number) * 20}%` }" /></div>
    </div>
    <Transition name="wc-target">
      <section v-if="targetScreen.visible && mode !== 'heat'" class="wc-target-readout"
        :style="{ left: `${targetScreen.x}px`, top: `${targetScreen.y}px`, '--target-color': tracked.level.color }"
        aria-label="雷暴锁定测距结果">
        <div class="wc-target-caption"><TwinIcon name="target" :size="13" /><span>{{ tracked.storm.id === nearby.storm.id ? '最近雷暴' : '当前跟踪' }} · {{ tracked.storm.id }}</span><b>{{ tracked.direction }}</b></div>
        <div class="wc-target-distance"><strong>{{ trackedReading.value }}</strong><span>{{ trackedReading.unit }}</span><i /></div>
        <div class="wc-target-arrival"><span>{{ trackedEta === 0 ? '回波已覆盖矿区' : trackedEta === null ? '未来 3 小时未预计抵达' : '预计抵达矿区' }}</span><b v-if="trackedEta !== null && trackedEta > 0">约 {{ trackedEta }} <small>min</small></b></div>
        <small class="wc-target-note">回波边缘测距 · 直线路径外推</small>
      </section>
    </Transition>

    <aside class="wc-mine-panel" aria-label="当前矿区雷暴距离">
      <span class="wc-overline">当前关注矿区</span>
      <button
        class="wc-mine-picker"
        :aria-expanded="mineMenu"
        aria-label="切换关注矿区"
        @click="mineMenu = !mineMenu"
      >
        <h2>{{ mine.name }}</h2>
        <TwinIcon name="chevron" :size="17" />
      </button>
      <p class="wc-region">{{ mine.region }}</p>
      <div class="wc-risk-badge">
        <i />{{ nearby.level.name }}<span>{{ nearby.level.roman }}</span>
      </div>
      <div class="wc-distance">
        <b :class="{ pending: !resultReady }">{{ resultReady ? nearestReading.value : '—' }}</b
        ><span>{{ nearestReading.unit }}</span>
      </div>
      <p class="wc-distance-caption">
        {{ resultReady ? `最近雷暴 · ${nearby.storm.id} · ${nearby.direction}方向` : focusInfo.detail }}
      </p>
      <div v-if="inRange.length > 1" class="wc-multi-alert">
        <i />{{ inRange.length }} 片雷暴进入 200 km 关注区
      </div>
      <div class="wc-motion">
        <TwinIcon :name="approaching ? 'arrow' : 'check'" :size="15" /><span>{{
          nearby.distance === 0 ? '回波已覆盖矿区中心' : approaching ? '正在靠近' : '正在远离'
        }}</span
        ><b>{{ nearby.storm.speed }}<small> km/h</small></b>
      </div>
      <p v-if="!resultReady" class="wc-estimate">{{ focusInfo.title }}后显示距离与预计抵达时间</p>
      <p v-else-if="eta !== null && eta > 0" class="wc-estimate">
        按当前路径，约 <strong>{{ eta }} 分钟</strong> 后回波抵达矿区
      </p>
      <p v-else class="wc-estimate">
        {{ eta === 0 ? '回波已覆盖矿区中心' : '按当前路径，未来 3 小时未预计抵达' }}
      </p>
      <button v-if="mode !== 'warning'" class="wc-focus-action" @click="chooseMode('warning')">
        查看临近预警<TwinIcon name="arrow" :size="16" /></button
      ><button v-else-if="scope === 'national'" class="wc-focus-action" @click="setScope('mine')">
        放大矿区雷达<TwinIcon name="arrow" :size="16" />
      </button><button v-else class="wc-focus-action wc-replay" @click="replayFocus">
        <TwinIcon name="target" :size="15" />重新定位与锁定<TwinIcon name="reset" :size="14" />
      </button>
      <div class="wc-distance-note">距离口径：回波边缘 → 矿区中心</div>
    </aside>
    <Transition name="wc-fade"
      ><section v-if="mineMenu" class="wc-mine-menu" aria-label="矿区选择">
        <div class="wc-popup-title">
          <span>切换矿区</span
          ><button aria-label="关闭矿区选择" @click="mineMenu = false">
            <TwinIcon name="close" :size="17" />
          </button>
        </div>
        <button
          v-for="item in MINES"
          :key="item.id"
          :class="{ selected: mineId === item.id }"
          @click="chooseMine(item.id)"
        >
          <span
            >{{ item.name }}<small>{{ item.region }}</small></span
          ><span class="wc-mine-menu-distance"
            >{{ Math.round(nearestStorm(item, minute).distance) }}<small> km</small></span
          >
        </button>
      </section></Transition
    >

    <div class="wc-right-dock">
      <aside v-if="mode !== 'heat'" class="wc-threat-panel" aria-label="矿区周边雷暴列表">
        <div class="wc-threat-heading">
          <span
            >周边雷暴 <b>{{ localThreats.length.toString().padStart(2, '0') }}</b></span
          ><small>近 → 远</small>
        </div>
        <p class="wc-threat-caption">{{ mine.name }} · 350 km 跟踪范围</p>
        <div class="wc-threat-list">
          <button
            v-for="item in localThreats"
            :key="item.storm.id"
            :class="{ selected: tracked.storm.id === item.storm.id }"
            :style="{ '--cell-color': item.level.color }"
            :aria-label="`跟踪雷暴 ${item.storm.id}`"
            :aria-pressed="tracked.storm.id === item.storm.id"
            @click="trackStorm(item.storm.id)"
          >
            <div class="wc-threat-top">
              <b>{{ item.storm.id }}</b
              ><span>{{ item.direction }}方向</span
              ><strong>{{ Math.round(item.distance) }}<small> km</small></strong>
            </div>
            <div class="wc-threat-bottom">
              <span><i />{{ item.level.name }}</span
              ><small>{{
                item.distance === 0 ? '已覆盖矿区' : item.approaching ? '↘ 正在靠近' : '↗ 正在远离'
              }}</small>
            </div>
          </button>
        </div>
        <p v-if="!localThreats.length" class="wc-no-threat">350 km 内暂未发现雷暴</p>
        <p v-else class="wc-track-status">
          <i />正在跟踪 {{ tracked.storm.id }}<span>{{ tracked.storm.speed }} km/h</span>
        </p>
      </aside>

      <aside v-if="mode === 'warning'" class="wc-thresholds" aria-label="四级预警距离规则">
        <h3>预警距离圈</h3>
        <div
          v-for="level in LEVELS"
          :key="level.level"
          :class="{ active: nearby.level.level === level.level }"
          :style="{ '--level-color': level.color }"
        >
          <i /><span>{{ level.name }}</span
          ><b>{{ level.radius }}<small> km</small></b>
        </div>
        <p>进入更内侧范围，预警等级提升</p>
      </aside>
      <aside
        v-else
        class="wc-legend"
        :aria-label="mode === 'heat' ? '雷电热力图图例' : '雷达回波图例'"
      >
        <template v-if="mode === 'heat'"
          ><span>近 30 分钟落雷密度</span>
          <div class="wc-weather-ramp" />
          <div class="wc-legend-ticks"><span>低</span><span>高</span></div></template
        ><template v-else
          ><span>雷达回波 <small>dBZ</small></span>
          <div class="wc-weather-ramp" />
          <div class="wc-legend-ticks">
            <span>20</span><span>30</span><span>40</span><span>50</span><span>60</span>
          </div>
          <div class="wc-lightning-key"><span>ϟ</span>近 30 分钟落雷</div></template
        >
      </aside>
    </div>
    <div v-if="mode === 'warning'" class="wc-track-key">
      <span><i />流动测距线：矿区 → 回波最近边缘</span>
    </div>
    <div v-if="mode === 'track'" class="wc-track-key">
      <span><i />历史轨迹</span><span><i class="future" />未来 60 分钟外推</span>
    </div>
    <div class="wc-map-controls" aria-label="地图工具">
      <div class="wc-view-buttons">
        <button
          :class="{ active: view === '3D' }"
          :aria-pressed="view === '3D'"
          @click="setView('3D')"
        >
          3D</button
        ><button
          :class="{ active: view === '2D' }"
          :aria-pressed="view === '2D'"
          @click="setView('2D')"
        >
          2D
        </button>
      </div>
      <i /><button aria-label="放大地图" @click="scene?.zoom(1)">
        <TwinIcon name="plus" :size="17" /></button
      ><button aria-label="缩小地图" @click="scene?.zoom(-1)">
        <TwinIcon name="minus" :size="17" /></button
      ><button aria-label="恢复观察视角" @click="reset"><TwinIcon name="reset" :size="17" /></button
      ><button
        v-if="mode !== 'heat'"
        aria-label="设置地图图层"
        :aria-expanded="layerMenu"
        @click="layerMenu = !layerMenu"
      >
        <TwinIcon name="layers" :size="17" />
      </button>
    </div>
    <Transition name="wc-fade"
      ><section v-if="layerMenu && mode !== 'heat'" class="wc-layer-menu" aria-label="地图图层">
        <div class="wc-popup-title">
          可见图层<button aria-label="关闭图层" @click="layerMenu = false">
            <TwinIcon name="close" :size="16" />
          </button>
        </div>
        <button role="switch" :aria-checked="radarLayer" @click="toggleLayer('radar')">
          雷达回波范围<i :class="{ on: radarLayer }" /></button
        ><button role="switch" :aria-checked="lightningLayer" @click="toggleLayer('lightning')">
          落雷位置<i :class="{ on: lightningLayer }" />
        </button></section
    ></Transition>

    <section class="wc-timeline" aria-label="雷暴时间回放">
      <button
        class="wc-play"
        :aria-label="playing ? '暂停回放' : '播放回放'"
        @click="togglePlayback"
      >
        <TwinIcon :name="playing ? 'pause' : 'play'" :size="17" />
      </button>
      <div class="wc-time">
        <b>{{ scenarioTime(minute) }}</b
        ><span>{{ minute > 30 ? '模拟预测' : minute < 30 ? '历史回放' : '当前场景' }}</span>
      </div>
      <div class="wc-slider">
        <input
          v-model.number="minute"
          type="range"
          min="0"
          max="90"
          step="0.25"
          aria-label="场景时间"
          :aria-valuetext="scenarioTime(minute)"
          :style="{ '--progress': `${(minute / 90) * 100}%` }"
          @input="playing = false"
        />
        <div>
          <span>14:00</span><span class="current">14:30 · 当前</span><span>15:00</span
          ><span>15:30</span>
        </div>
      </div>
      <button
        class="wc-speed"
        aria-label="切换回放速度"
        title="1×：每秒推进 15 秒场景时间"
        @click="speed = speed === 1 ? 2 : speed === 2 ? 4 : 1"
      >
        {{ speed }}×</button
      ><button class="wc-now" @click="returnToCurrent">回到当前</button>
    </section>
    <footer class="wc-footer">
      <span>左键平移 · 右键旋转 · 滚轮缩放 · 点选矿区锁定</span
      ><span
        >2026.07.18 · 模拟雷达与落雷数据<span class="wc-footer-dot">/</span>距离规则按演示配置</span
      >
    </footer>
    <Transition name="wc-fade"
      ><section v-if="pickedStrike" class="wc-strike-detail" aria-label="选中落雷详情">
        <div class="wc-popup-title">
          落雷记录<button aria-label="关闭落雷详情" @click="pickedStrike = null">
            <TwinIcon name="close" :size="16" />
          </button>
        </div>
        <b>{{ pickedStrike.current }}<small> kA</small></b>
        <p>{{ scenarioTime(pickedStrike.minute) }} · 峰值电流</p>
        <div>
          距{{ mine.name
          }}<strong>{{ Math.round(distanceKm(mine.center, pickedStrike.position)) }} km</strong>
        </div>
      </section></Transition
    >
    <div v-if="!ready && !error" class="wc-loading" role="status">
      <i /><span>正在加载雷暴态势</span>
    </div>
    <div v-if="error" class="wc-error" role="alert">
      {{ error
      }}<button v-if="ready" aria-label="关闭提示" @click="error = ''">
        <TwinIcon name="close" :size="16" />
      </button>
    </div>
  </main>
</template>
