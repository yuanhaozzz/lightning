<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import 'maplibre-gl/dist/maplibre-gl.css'
import LightningTrail from './LightningTrail.vue'
import ProtectionChain from './ProtectionChain.vue'
import { createCommandMap, type LayerKey, type MapController } from './mapEngine'
import { createSiteMarkers, type SiteMarkerLayer } from './siteMarkers'
import {
  assetSites,
  corridors,
  DATA_SOURCES,
  devices,
  formatClock,
  formatSeconds,
  onlineRate,
  protectionStats,
  RISK_META,
  siteById,
  strikes,
  threatTracks,
  WINDOW_SECONDS,
} from './data'
import type { Strike } from './data'
import './theme.css'

/* =========================================================================
   雷穹 · 雷电数字孪生指挥舱（极简版）
   -------------------------------------------------------------------------
   设计纪律（比配色重要）：
     1. 全屏常驻元素 ≤ 6 个。屏幕上每多一个元素，领导的注意力就被切走一份。
     2. 视觉张力集中在一处 —— 地图上的雷电能量轨迹。其余全部退成"仪器刻度"。
     3. 不用卡片墙。用细线、留白、对齐来表达层级，而不是用一个个盒子。
     4. 数字用等宽细体，标签极小极灰，字距拉开。这是"精密仪器"而不是"后台系统"。
     5. 颜色只有两种：底色的深空蓝，和一个青色高光。红色只在真出事时出现一次。
   ========================================================================= */

const BASE_HOUR = 8

const mapHost = ref<HTMLDivElement>()
const controller = shallowRef<MapController>()
const markerLayer = shallowRef<SiteMarkerLayer>()
const trail = ref<{ setMap: (value: MapController['map'] | null) => void } | null>(null)
const mapInstance = shallowRef<MapController['map'] | null>(null)
const mapReady = ref(false)

const cursor = ref(WINDOW_SECONDS)
const playing = ref(false)
let playTimer = 0

const view = ref<'situation' | 'asset' | 'event' | 'review'>('situation')
const sheet = ref<'none' | 'event' | 'asset' | 'review'>('none')
const selectedStrike = ref<Strike | null>(null)
const inspectedSite = ref('')
const focusedSite = ref('')
const menuOpen = ref(false)
const emergency = ref(false)
const emergencySeconds = ref(4)
let emergencyTimer = 0
const emergencyStrike = ref<Strike | null>(null)
const filterVoltage = ref('全部')
const deviceQuery = ref('')

const progress = computed(() => Math.max(0, Math.min(1, cursor.value / WINDOW_SECONDS)))
const clockLabel = computed(() => formatClock(cursor.value, BASE_HOUR))
const cursorSeconds = computed(() => progress.value * WINDOW_SECONDS)

const revealed = computed(() => {
  const limit = cursorSeconds.value
  let low = 0
  let high = strikes.length - 1
  let found = -1
  while (low <= high) {
    const mid = (low + high) >> 1
    if (strikes[mid]!.t <= limit) {
      found = mid
      low = mid + 1
    } else {
      high = mid - 1
    }
  }
  return strikes.slice(0, found + 1)
})

/** 现场暴露面：指挥岗真正的心跳指标，不是"今天打了多少雷" */
const exposure = computed(() => {
  const since = cursorSeconds.value - 1800
  const map = new Map<string, { siteId: string; count: number; peak: number; nearest: number }>()
  for (const strike of revealed.value) {
    if (strike.t < since) continue
    const item = map.get(strike.siteId) ?? {
      siteId: strike.siteId,
      count: 0,
      peak: 0,
      nearest: Number.POSITIVE_INFINITY,
    }
    item.count += 1
    item.peak = Math.max(item.peak, strike.current)
    item.nearest = Math.min(item.nearest, strike.distanceKm)
    map.set(strike.siteId, item)
  }
  return [...map.values()].filter((item) => item.nearest <= 10).sort((a, b) => b.peak - a.peak)
})

const interceptedCount = computed(() => revealed.value.filter((s) => s.intercepted).length)
const topRisk = computed(() => exposure.value[0] ?? null)
const topRiskSite = computed(() =>
  topRisk.value ? siteById.get(topRisk.value.siteId) : undefined,
)

const threatSite = computed(() => siteById.get(threatTracks[0]!.siteId)!)
const threatTrack = computed(() => threatTracks[0]!)
const corridor = computed(() => corridors[0]!)

const rankedSites = computed(() =>
  assetSites
    .filter((site) => site.risk !== 'normal')
    .sort((a, b) => {
      const order = { impact: 0, warning: 1, attention: 2, normal: 3 }
      return order[a.risk] - order[b.risk] || a.nearestKm - b.nearestKm
    }),
)

const deviceRows = computed(() =>
  devices
    .filter((device) => {
      const site = siteById.get(device.siteId)
      if (!site) return false
      if (inspectedSite.value && device.siteId !== inspectedSite.value) return false
      if (filterVoltage.value !== '全部' && site.voltage !== filterVoltage.value) return false
      if (deviceQuery.value && !`${device.name}${device.ip}${site.name}`.includes(deviceQuery.value))
        return false
      return device.state !== 'online' || inspectedSite.value !== ''
    })
    .sort((a, b) => b.faults - a.faults),
)

const inspection = computed(() => {
  const site = siteById.get(inspectedSite.value)
  if (!site) return null
  return {
    site,
    devices: devices.filter((device) => device.siteId === site.id),
    strikes: revealed.value.filter((s) => s.siteId === site.id).slice(-8).reverse(),
  }
})

const selectedSite = computed(() =>
  selectedStrike.value ? siteById.get(selectedStrike.value.siteId) : undefined,
)

/** 事件详情的时间序列：近 90 分钟 / 5 分钟一格 */
const eventSeries = computed(() => {
  const end = selectedStrike.value?.t ?? cursorSeconds.value
  const buckets = Array.from({ length: 18 }, () => 0)
  for (const strike of strikes) {
    if (strike.t > end || strike.t < end - 90 * 60) continue
    const index = Math.min(17, Math.floor((strike.t - (end - 90 * 60)) / (5 * 60)))
    buckets[index] = (buckets[index] ?? 0) + 1
  }
  const max = Math.max(1, ...buckets)
  return buckets.map((value) => Math.round((value / max) * 100))
})

const reviewSeries = computed(() =>
  Array.from({ length: 24 }, (_, index) => {
    const start = (index / 24) * WINDOW_SECONDS
    const end = ((index + 1) / 24) * WINDOW_SECONDS
    const bucket = revealed.value.filter((strike) => strike.t >= start && strike.t < end)
    const peak = bucket.reduce((max, strike) => Math.max(max, strike.current), 0)
    return { count: bucket.length, peak }
  }),
)

const viewMeta = {
  situation: { label: '态势', hint: '实时' },
  asset: { label: '资产', hint: `${rankedSites.value.length} 项风险` },
  event: { label: '事件', hint: `${revealed.value.length} 次` },
  review: { label: '复盘', hint: '近 6 小时' },
} as const

/* ============================ 地图 ============================ */

const layerState = ref<Record<LayerKey, boolean>>({
  terrain: true,
  asset: true,
  grid: true,
  label: true,
  // 默认全部关闭：图面越安静，雷电轨迹越有张力
  corridor: false,
  storm: false,
  lightning: true,
  mine: false,
})

function syncMarkers() {
  markerLayer.value?.update({
    focusedId: focusedSite.value,
    strikeCounts: new Map(exposure.value.map((item) => [item.siteId, item.count])),
  })
}

function toggleLayer(key: LayerKey) {
  layerState.value[key] = !layerState.value[key]
  controller.value?.setLayer(key, layerState.value[key])
}

function openEvent(strike: Strike) {
  selectedStrike.value = strike
  sheet.value = 'event'
  view.value = 'event'
  focusedSite.value = strike.siteId
  controller.value?.setSelectedSite(strike.siteId)
}

function inspectSite(id: string) {
  inspectedSite.value = id
  focusedSite.value = id
  sheet.value = 'asset'
  view.value = 'asset'
  controller.value?.setSelectedSite(id)
}

function pickView(next: typeof view.value) {
  view.value = next
  if (next === 'situation') {
    sheet.value = 'none'
    selectedStrike.value = null
    return
  }
  sheet.value = next === 'asset' ? 'asset' : next === 'event' ? 'event' : 'review'
  if (next === 'event' && !selectedStrike.value) {
    selectedStrike.value = worstStrike.value
  }
}

const worstStrike = computed(() => {
  const pool = revealed.value.length ? revealed.value : strikes
  const score = (strike: Strike) => {
    const site = siteById.get(strike.siteId)
    const near = site && strike.distanceKm <= 5 ? 90 : site && strike.distanceKm <= 20 ? 40 : 0
    return strike.current * 2 + near + (strike.intercepted ? 0 : 20)
  }
  return pool.reduce((best, strike) => (score(strike) > score(best) ? strike : best), pool[0]!)
})

function closeSheet() {
  sheet.value = 'none'
  view.value = 'situation'
  selectedStrike.value = null
  inspectedSite.value = ''
}

function togglePlay() {
  if (playing.value) {
    playing.value = false
    window.clearInterval(playTimer)
    return
  }
  playing.value = true
  playTimer = window.setInterval(() => {
    cursor.value = cursor.value >= WINDOW_SECONDS ? 0 : Math.min(WINDOW_SECONDS, cursor.value + 240)
  }, 100)
}

function goLive() {
  playing.value = false
  window.clearInterval(playTimer)
  cursor.value = WINDOW_SECONDS
}

function triggerEmergency(strike?: Strike) {
  const target = strike ?? worstStrike.value
  emergencyStrike.value = target
  emergency.value = true
  emergencySeconds.value = 4
  window.clearInterval(emergencyTimer)
  emergencyTimer = window.setInterval(() => {
    emergencySeconds.value += 1
  }, 1000)
  controller.value?.focusSite(target.siteId, { zoom: 8.6, duration: 1300 })
}

const activeEmergency = computed(() => emergencyStrike.value)
const activeEmergencySite = computed(() =>
  activeEmergency.value ? siteById.get(activeEmergency.value.siteId) : undefined,
)

function exitEmergency() {
  emergency.value = false
  window.clearInterval(emergencyTimer)
  controller.value?.resetView()
}

/* ============================ 生命周期 ============================ */

onMounted(async () => {
  if (!mapHost.value) return
  controller.value = await createCommandMap(mapHost.value, {
    onSiteClick: (id) => inspectSite(id),
    onHover: () => undefined,
  })
  markerLayer.value = createSiteMarkers(controller.value.map, {
    onClick: (id) => inspectSite(id),
  })
  trail.value?.setMap(controller.value.map)
  mapInstance.value = controller.value.map
  // 精简图层：默认只留地形／边界／资产骨架，把注意力让给雷电轨迹
  for (const key of ['corridor', 'storm', 'mine'] as LayerKey[]) {
    controller.value.setLayer(key, layerState.value[key])
  }
  controller.value.setTimelineProgress(1)
  controller.value.map.on('zoom', syncMarkers)
  syncMarkers()
  mapReady.value = true
})

onBeforeUnmount(() => {
  window.clearInterval(playTimer)
  window.clearInterval(emergencyTimer)
  markerLayer.value?.dispose()
  controller.value?.dispose()
})

watch(progress, (value) => controller.value?.setTimelineProgress(value))
watch([focusedSite, exposure], () => syncMarkers())
</script>

<template>
  <main class="hall">
    <!-- 地层：一张安静的地图，没有装饰性网格、没有扫描圈 -->
    <div ref="mapHost" class="hall__map" aria-label="雷电数字孪生地图"></div>
    <div class="hall__vignette" aria-hidden="true"></div>
    <div class="hall__horizon" aria-hidden="true"></div>

    <!-- 精度刻度：视口四周的细刻度，像仪器刻度盘，而不是网格线 -->
    <svg class="hall__ticks" aria-hidden="true">
      <g class="hall__ticks-x">
        <line v-for="x in 23" :key="`x${x}`" :x1="(x - 1) * 80 + 40" y1="0" :x2="(x - 1) * 80 + 40" :y2="x % 4 === 0 ? 11 : 5" />
      </g>
      <g class="hall__ticks-y">
        <line v-for="y in 13" :key="`y${y}`" x1="0" :y1="(y - 1) * 80 + 40" :x2="y % 3 === 0 ? 11 : 5" :y2="(y - 1) * 80 + 40" />
      </g>
    </svg>

    <!-- 唯一的视觉主角：雷电能量轨迹 -->
    <LightningTrail
      ref="trail"
      :strikes="strikes"
      :tracks="threatTracks"
      :progress="progress"
      :selected-id="selectedStrike?.id ?? ''"
      :visible="layerState.lightning"
      @pick="(payload) => openEvent(payload.strike)"
    />

    <!-- ① 页眉：一行字，没有底板 -->
    <header class="hall__head">
      <div class="hall__brand">
        <span class="hall__bolt">ϟ</span>
        <span class="hall__name">雷穹</span>
        <span class="hall__sub">雷电数字孪生指挥舱</span>
      </div>
      <div class="hall__status">
        <span class="hall__pulse"><i></i>实时</span>
        <span class="hall__clock cc-num">{{ clockLabel }}</span>
      </div>
      <div class="hall__tools">
        <button class="hall__tool" :class="{ 'is-hot': exposure.length > 0 }" title="应急指挥" @click="triggerEmergency()">
          <svg viewBox="0 0 24 24"><path d="M13 2 4.5 13.5H11l-1 8.5 8.5-11.5H12l1-8.5Z" /></svg>
        </button>
        <button class="hall__tool" title="设置" @click="menuOpen = !menuOpen">
          <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="2.6" /><path d="M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1m0-12.8-2.1 2.1M7.7 16.3l-2.1 2.1" /></svg>
        </button>
      </div>

      <Transition name="fade">
        <div v-if="menuOpen" class="hall__menu">
          <button v-for="item in [
            { key: 'corridor', label: '未来 1 小时风险走廊' },
            { key: 'storm', label: '雷暴单体能量' },
            { key: 'mine', label: '矿区作业边界' },
            { key: 'label', label: '省级地名' },
          ]" :key="item.key" @click="toggleLayer(item.key as LayerKey)">
            <span>{{ item.label }}</span>
            <i :class="{ 'is-on': layerState[item.key as LayerKey] }"></i>
          </button>
        </div>
      </Transition>
    </header>

    <!-- ② 巨幕指标：一个数字讲清"现在有多危险" -->
    <section class="hall__hero">
      <p class="hall__hero-label">当前暴露面 · 10km 影响圈内</p>
      <p class="hall__hero-value cc-num" :class="{ 'is-clear': exposure.length === 0 }">
        {{ exposure.length }}
        <em>处</em>
      </p>
      <p class="hall__hero-note">
        <template v-if="topRiskSite">
          最近威胁 <b>{{ topRiskSite.name }}</b> · 峰值
          <b class="cc-num">{{ topRisk?.peak }} kA</b> · 距
          <b class="cc-num">{{ topRisk?.nearest }} km</b>
        </template>
        <template v-else> 全域处于安全区间 · 装置运行正常 </template>
      </p>
      <dl class="hall__stats">
        <div>
          <dt>平均防护响应</dt>
          <dd class="cc-num">{{ protectionStats.avgResponseMs }}<i>ms</i></dd>
        </div>
        <div>
          <dt>防护有效率</dt>
          <dd class="cc-num">{{ protectionStats.effectiveRate }}<i>%</i></dd>
        </div>
        <div>
          <dt>窗口内拦截</dt>
          <dd class="cc-num">{{ interceptedCount }}<i>次</i></dd>
        </div>
      </dl>
    </section>

    <!-- ③ 待办：一行一条，只在真有风险时出现，内容取当前实时态势 -->
    <Transition name="slide">
      <button v-if="topRiskSite" class="hall__alert" @click="triggerEmergency()">
        <span class="hall__alert-dot"></span>
        <span class="hall__alert-text">
          <b>{{ topRiskSite.name }}</b>
          <small>
            峰值 <em class="cc-num">{{ topRisk?.peak }} kA</em> · 距
            <em class="cc-num">{{ topRisk?.nearest }} km</em> · 30 分钟内
            <em class="cc-num">{{ topRisk?.count }}</em> 次落雷
          </small>
        </span>
        <span class="hall__alert-count cc-num">{{ exposure.length }}</span>
      </button>
    </Transition>

    <!-- ④ 底部：视图切换 + 时间轴（胶囊，悬浮，不占版面） -->
    <div class="hall__bar">
      <Transition name="rise">
        <div v-if="view === 'situation' || view === 'event' || view === 'review'" class="hall__time cc-glass">
          <button class="hall__play" @click="togglePlay">{{ playing ? '❙❙' : '▶' }}</button>
          <div class="hall__time-main">
            <span class="hall__time-value cc-num">{{ clockLabel }}</span>
            <div class="hall__track">
              <span class="hall__track-fill" :style="{ width: `${progress * 100}%` }"></span>
              <span
                v-for="strike in strikes.filter((_, index) => index % 18 === 0)"
                :key="strike.id"
                class="hall__track-tick"
                :class="{ 'is-strong': strike.current > 90 }"
                :style="{ left: `${(strike.t / WINDOW_SECONDS) * 100}%` }"
              ></span>
              <input v-model.number="cursor" type="range" min="0" :max="WINDOW_SECONDS" step="60" />
            </div>
          </div>
          <button class="hall__live" :class="{ 'is-on': progress > 0.99 }" @click="goLive">LIVE</button>
        </div>
      </Transition>

      <nav class="hall__views cc-glass">
        <button
          v-for="(meta, key) in viewMeta"
          :key="key"
          :class="{ 'is-on': view === key }"
          @click="pickView(key as typeof view)"
        >
          <span>{{ meta.label }}</span>
          <small>{{ meta.hint }}</small>
        </button>
      </nav>
    </div>

    <!-- ⑤ 详情浮层：从底部升起，背景虚化，全景不丢 -->
    <Transition name="sheet">
      <div v-if="sheet !== 'none'" class="hall__sheet-mask" @click.self="closeSheet">
        <section class="hall__sheet cc-glass">
          <span class="hall__grip" @click="closeSheet"></span>

          <header class="hall__sheet-head">
            <div>
              <small>{{ sheet === 'event' ? '雷击事件' : sheet === 'asset' ? '资产与装置' : '态势复盘' }}</small>
              <h2 v-if="sheet === 'event' && selectedStrike" class="cc-num">{{ selectedStrike.id }}</h2>
              <h2 v-else-if="sheet === 'asset'">{{ inspection?.site?.name ?? '受保护资产' }}</h2>
              <h2 v-else>近 6 小时态势</h2>
            </div>
            <button class="hall__tool" title="收起" @click="closeSheet">
              <svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6" /></svg>
            </button>
          </header>

          <!-- 事件：一个数字 + 一条闭环链 -->
          <div v-if="sheet === 'event' && selectedStrike" class="hall__event">
            <div class="hall__peak">
              <p class="hall__peak-label">峰值电流</p>
              <p class="hall__peak-value cc-num">{{ selectedStrike.current }}<em>kA</em></p>
              <p class="hall__peak-tags">
                <span>{{ selectedStrike.type }}</span>
                <span>{{ selectedStrike.polarity === 'positive' ? '正极性' : '负极性' }}</span>
                <span :class="{ 'is-alert': !selectedStrike.intercepted }">
                  {{ selectedStrike.intercepted ? '已拦截' : '未触发保护' }}
                </span>
                <span>{{ selectedSite?.name }}</span>
                <span class="cc-num">距 {{ selectedStrike.distanceKm }} km</span>
              </p>
            </div>
            <ProtectionChain :strike="selectedStrike" />
          </div>

          <!-- 资产 -->
          <div v-else-if="sheet === 'asset'" class="hall__asset">
            <div class="hall__asset-side">
              <input v-model="deviceQuery" class="hall__search" placeholder="搜索装置 / IP / 场区" />
              <div class="hall__chips">
                <button :class="{ 'is-on': filterVoltage === '全部' }" @click="filterVoltage = '全部'">全部</button>
                <button
                  v-for="voltage in ['1000kV', '±1100kV', '500kV', '220kV', '110kV', '低压']"
                  :key="voltage"
                  :class="{ 'is-on': filterVoltage === voltage }"
                  @click="filterVoltage = voltage"
                >
                  {{ voltage }}
                </button>
              </div>
            </div>
            <div class="hall__asset-main">
              <p class="hall__asset-sum">
                <span>在线率 <b class="cc-num">{{ onlineRate }}%</b></span>
                <span>待处置 <b class="cc-num is-alert">{{ deviceRows.length }}</b></span>
                <span v-if="inspection">本场区 <b class="cc-num">{{ inspection.devices.length }}</b> 台</span>
              </p>
              <ul class="hall__devices">
                <li
                  v-for="device in deviceRows.slice(0, 8)"
                  :key="device.id"
                  @click="inspectSite(device.siteId)"
                >
                  <i class="hall__dev-state" :class="`is-${device.state}`"></i>
                  <b :class="{ 'is-alert': device.faults > 0 }">{{ device.name }}</b>
                  <small>{{ siteById.get(device.siteId)?.name }} · {{ device.type }}</small>
                  <em class="cc-num">{{ device.resistance }}Ω</em>
                  <em class="hall__dev-ip cc-num">{{ device.ip }}</em>
                </li>
                <li v-if="!deviceRows.length" class="is-empty">该筛选条件下全部装置运行正常</li>
              </ul>
            </div>
          </div>

          <!-- 复盘 -->
          <div v-else class="hall__review">
            <div class="hall__review-chart">
              <span
                v-for="(item, index) in reviewSeries"
                :key="index"
                :style="{ height: `${Math.max(4, (item.peak / 210) * 100)}%` }"
                :title="`峰值 ${item.peak} kA · ${item.count} 次`"
              ></span>
            </div>
            <p class="hall__review-legend"><span>08:00</span><span>11:00</span><span>14:00</span></p>
            <dl class="hall__review-stats">
              <div>
                <dt>走廊</dt>
                <dd>{{ corridor.name }}<small>{{ corridor.eta }}</small></dd>
              </div>
              <div v-for="source in DATA_SOURCES.slice(0, 3)" :key="source.key">
                <dt>{{ source.label }}</dt>
                <dd>
                  {{ source.value }}
                  <small :class="`is-${source.kind}`">{{ source.kind === 'measured' ? '实测' : '模型预测' }}</small>
                </dd>
              </div>
            </dl>
          </div>
        </section>
      </div>
    </Transition>

    <!-- ⑥ 应急：全屏聚焦，最高的那一件事 -->
    <Transition name="fade">
      <div v-if="emergency" class="hall__sos">
        <div class="hall__sos-veil" aria-hidden="true"></div>
        <section class="hall__sos-panel">
          <header>
            <span class="hall__sos-level"><i></i>一级响应</span>
            <span class="cc-num">{{ formatSeconds(emergencySeconds) }}</span>
          </header>
          <h2>{{ activeEmergencySite?.name }}</h2>
          <p class="hall__sos-line">
            峰值 <b class="cc-num">{{ activeEmergency?.current }} kA</b> · 距离
            <b class="cc-num">{{ activeEmergency?.distanceKm }} km</b> ·
            {{ activeEmergency?.type }} ·
            {{ activeEmergency?.intercepted ? 'SPD 已动作' : '未触发保护' }}
          </p>
          <div class="hall__sos-actions">
            <button v-for="action in ['呼叫运维', '调取视频', '生成工单', '仿真推演', '电网联动', '标记误报']" :key="action">
              {{ action }}
            </button>
          </div>
          <ProtectionChain v-if="activeEmergency" :strike="activeEmergency" />
          <button class="hall__sos-exit" @click="exitEmergency">退出应急模式</button>
        </section>
      </div>
    </Transition>

    <Transition name="fade">
      <div v-if="!mapReady" class="hall__boot"><i></i>正在构建雷电数字孪生场景</div>
    </Transition>
  </main>
</template>

<style scoped>
.hall {
  position: fixed;
  inset: 0;
  overflow: hidden;
  background: #03060c;
  color: #e8f2fb;
  font-family: var(--han);
  -webkit-font-smoothing: antialiased;
}

.hall__map {
  position: absolute;
  inset: 0;
  z-index: 0;
}

.hall__vignette {
  position: absolute;
  inset: 0;
  z-index: 2;
  pointer-events: none;
  background:
    radial-gradient(ellipse at 52% 46%, transparent 44%, rgba(2, 5, 11, 0.72) 100%),
    linear-gradient(180deg, rgba(2, 5, 11, 0.7), transparent 17%, transparent 74%, rgba(2, 5, 11, 0.82));
}

/* 地平线：一道极淡的光弧，给空旷的深空底图一个落点 */
.hall__horizon {
  position: absolute;
  z-index: 2;
  left: 50%;
  bottom: -320px;
  width: 1900px;
  height: 620px;
  margin-left: -950px;
  border-radius: 50%;
  pointer-events: none;
  background: radial-gradient(ellipse at 50% 0%, rgba(60, 190, 255, 0.1), transparent 62%);
  filter: blur(2px);
}

.hall__ticks {
  position: absolute;
  inset: 0;
  z-index: 3;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.hall__ticks line {
  stroke: rgba(150, 205, 240, 0.22);
  stroke-width: 1;
}

/* ============================ ① 页眉 ============================ */
.hall__head {
  position: absolute;
  z-index: 20;
  top: 0;
  left: 0;
  right: 0;
  display: flex;
  align-items: center;
  gap: 26px;
  height: 78px;
  padding: 0 34px;
}

.hall__brand {
  display: flex;
  align-items: baseline;
  gap: 11px;
}

.hall__bolt {
  color: #7fe6ff;
  font-size: 19px;
  text-shadow: 0 0 18px rgba(95, 215, 255, 0.8);
}

.hall__name {
  font-size: 16px;
  font-weight: 500;
  letter-spacing: 0.42em;
}

.hall__sub {
  color: rgba(180, 206, 228, 0.34);
  font-size: 10px;
  letter-spacing: 0.22em;
}

.hall__status {
  display: flex;
  align-items: baseline;
  gap: 16px;
  margin-left: 10px;
}

.hall__pulse {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: rgba(150, 232, 214, 0.7);
  font-size: 10.5px;
  letter-spacing: 0.2em;
}

.hall__pulse i {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #35d6a4;
  box-shadow: 0 0 9px #35d6a4;
  animation: cc-live 2s ease-in-out infinite;
}

.hall__clock {
  color: rgba(224, 240, 252, 0.62);
  font-size: 14px;
  font-weight: 300;
  letter-spacing: 0.14em;
}

.hall__tools {
  display: flex;
  gap: 10px;
  margin-left: auto;
}

.hall__tool {
  display: grid;
  width: 36px;
  height: 36px;
  place-items: center;
  border: 1px solid rgba(150, 198, 240, 0.14);
  border-radius: 50%;
  color: rgba(206, 230, 248, 0.62);
  background: rgba(255, 255, 255, 0.02);
  cursor: pointer;
  transition: 0.24s ease;
}

.hall__tool svg {
  width: 16px;
  height: 16px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.4;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.hall__tool:hover {
  color: #eafaff;
  border-color: rgba(150, 220, 255, 0.4);
  box-shadow: 0 0 20px rgba(35, 200, 255, 0.22);
}

.hall__tool.is-hot {
  color: #ff8f9e;
  border-color: rgba(255, 59, 82, 0.42);
  animation: cc-breathe 2.6s ease-in-out infinite;
}

.hall__menu {
  position: absolute;
  top: 66px;
  right: 34px;
  width: 218px;
  padding: 6px;
  border: 1px solid rgba(150, 198, 240, 0.14);
  border-radius: 16px;
  background: rgba(6, 13, 24, 0.72);
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(22px);
}

.hall__menu button {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: space-between;
  padding: 11px 13px;
  border: 0;
  border-radius: 11px;
  color: rgba(206, 230, 248, 0.66);
  background: transparent;
  font: 400 12.5px var(--han);
  letter-spacing: 0.04em;
  cursor: pointer;
  transition: 0.18s ease;
}

.hall__menu button:hover {
  color: #fff;
  background: rgba(95, 215, 255, 0.07);
}

.hall__menu i {
  position: relative;
  width: 28px;
  height: 15px;
  border: 1px solid rgba(150, 198, 240, 0.18);
  border-radius: 999px;
  transition: 0.22s ease;
}

.hall__menu i::after {
  content: '';
  position: absolute;
  left: 2px;
  top: 2px;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: rgba(180, 206, 228, 0.4);
  transition: 0.22s cubic-bezier(0.2, 0.85, 0.25, 1);
}

.hall__menu i.is-on {
  border-color: rgba(95, 215, 255, 0.5);
  background: rgba(35, 200, 255, 0.16);
}

.hall__menu i.is-on::after {
  left: 15px;
  background: #9fe9ff;
  box-shadow: 0 0 10px rgba(95, 215, 255, 0.8);
}

/* ============================ ② 巨幕指标 ============================ */
.hall__hero {
  position: absolute;
  z-index: 12;
  left: 34px;
  top: 236px;
  width: 384px;
  pointer-events: none;
}

.hall__hero-label {
  margin: 0 0 14px;
  color: rgba(176, 204, 226, 0.4);
  font-size: 10.5px;
  letter-spacing: 0.34em;
}

.hall__hero-value {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin: 0;
  font-size: 132px;
  font-weight: 100;
  line-height: 0.86;
  letter-spacing: -0.05em;
  background: linear-gradient(178deg, #ffffff 6%, #a9e6ff 54%, #2f8fc8 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  filter: drop-shadow(0 0 46px rgba(64, 176, 240, 0.4));
}

.hall__hero-value em {
  font-size: 15px;
  font-weight: 300;
  letter-spacing: 0.14em;
  -webkit-text-fill-color: rgba(176, 204, 226, 0.42);
}

/* 全域平静时数字退回安静的青，不用高饱和制造假紧张 */
.hall__hero-value.is-clear {
  background: linear-gradient(178deg, #ffffff 6%, #8fd4ff 60%, #2b7fa8 100%);
  -webkit-background-clip: text;
  background-clip: text;
}

.hall__hero-note {
  margin: 18px 0 0;
  padding-top: 15px;
  border-top: 1px solid rgba(150, 198, 240, 0.12);
  color: rgba(184, 210, 232, 0.48);
  font-size: 11.5px;
  letter-spacing: 0.03em;
}

.hall__hero-note b {
  color: rgba(232, 246, 255, 0.92);
  font-weight: 500;
}

.hall__stats {
  display: flex;
  gap: 30px;
  margin: 22px 0 0;
}

.hall__stats div {
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.hall__stats dt {
  color: rgba(176, 204, 226, 0.36);
  font-size: 9.5px;
  letter-spacing: 0.2em;
}

.hall__stats dd {
  margin: 0;
  color: #eaf7ff;
  font-size: 25px;
  font-weight: 200;
}

.hall__stats dd i {
  margin-left: 3px;
  color: rgba(176, 204, 226, 0.4);
  font-size: 10px;
  font-style: normal;
}

/* ============================ ③ 待办 ============================ */
.hall__alert {
  position: absolute;
  z-index: 16;
  right: 34px;
  top: 96px;
  display: flex;
  align-items: center;
  gap: 13px;
  padding: 13px 18px;
  border: 1px solid rgba(255, 59, 82, 0.24);
  border-radius: 999px;
  background: rgba(32, 10, 16, 0.5);
  box-shadow: 0 18px 46px rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(20px);
  cursor: pointer;
  transition: 0.24s ease;
}

.hall__alert:hover {
  border-color: rgba(255, 59, 82, 0.5);
  box-shadow: 0 0 34px rgba(255, 59, 82, 0.24);
}

.hall__alert-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #ff2d55;
  animation: cc-breathe 2s ease-in-out infinite;
}

.hall__alert-text {
  display: flex;
  flex-direction: column;
  gap: 3px;
  text-align: left;
}

.hall__alert-text b {
  color: #ffe4e8;
  font-size: 12.5px;
  font-weight: 500;
}

.hall__alert-text small {
  color: rgba(255, 178, 188, 0.6);
  font-size: 10px;
}

.hall__alert-count {
  display: grid;
  min-width: 22px;
  height: 22px;
  place-items: center;
  border-radius: 999px;
  background: linear-gradient(160deg, #ff5d6e, #d8172f);
  color: #fff;
  font-size: 11px;
}

/* ============================ ④ 底部 ============================ */
.hall__bar {
  position: absolute;
  z-index: 18;
  left: 50%;
  bottom: 26px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 11px;
  transform: translateX(-50%);
}

.hall__time {
  display: flex;
  width: min(760px, calc(100vw - 120px));
  align-items: center;
  gap: 16px;
  padding: 11px 18px;
  border-radius: 999px;
}

.hall__play {
  display: grid;
  width: 34px;
  height: 34px;
  flex: none;
  place-items: center;
  border: 1px solid rgba(150, 220, 255, 0.32);
  border-radius: 50%;
  color: #d9f4ff;
  background: rgba(35, 200, 255, 0.1);
  font-size: 11px;
  cursor: pointer;
  transition: 0.22s ease;
}

.hall__play:hover {
  background: rgba(35, 200, 255, 0.22);
  box-shadow: 0 0 22px rgba(35, 200, 255, 0.3);
}

.hall__time-main {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 16px;
}

.hall__time-value {
  color: #eaf8ff;
  font-size: 17px;
  font-weight: 200;
  letter-spacing: 0.1em;
}

.hall__track {
  position: relative;
  height: 2px;
  flex: 1;
  border-radius: 2px;
  background: rgba(190, 220, 245, 0.14);
}

.hall__track-fill {
  position: absolute;
  left: 0;
  top: 0;
  height: 100%;
  border-radius: 2px;
  background: linear-gradient(90deg, rgba(43, 125, 255, 0.5), #7fe6ff);
  box-shadow: 0 0 12px rgba(35, 200, 255, 0.6);
}

.hall__track-tick {
  position: absolute;
  top: -3px;
  width: 1px;
  height: 8px;
  background: rgba(35, 200, 255, 0.34);
}

.hall__track-tick.is-strong {
  background: rgba(255, 59, 82, 0.8);
  box-shadow: 0 0 7px rgba(255, 59, 82, 0.7);
}

.hall__track input {
  position: absolute;
  left: -8px;
  right: -8px;
  top: -12px;
  width: calc(100% + 16px);
  height: 26px;
  margin: 0;
  opacity: 0;
  cursor: ew-resize;
}

.hall__live {
  flex: none;
  padding: 6px 13px;
  border: 1px solid rgba(150, 198, 240, 0.16);
  border-radius: 999px;
  color: rgba(176, 204, 226, 0.5);
  background: transparent;
  font: 400 10px var(--han);
  letter-spacing: 0.18em;
  cursor: pointer;
  transition: 0.22s ease;
}

.hall__live.is-on {
  border-color: rgba(53, 214, 164, 0.4);
  color: #8ff0d0;
  box-shadow: 0 0 18px rgba(53, 214, 164, 0.18);
}

.hall__views {
  display: flex;
  gap: 2px;
  padding: 5px;
  border-radius: 999px;
}

.hall__views button {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 9px 20px;
  border: 0;
  border-radius: 999px;
  color: rgba(190, 214, 236, 0.5);
  background: transparent;
  font: 400 13px var(--han);
  letter-spacing: 0.12em;
  cursor: pointer;
  transition: 0.26s cubic-bezier(0.2, 0.85, 0.25, 1);
}

.hall__views button small {
  color: rgba(176, 204, 226, 0.3);
  font-size: 9.5px;
  letter-spacing: 0.06em;
}

.hall__views button:hover {
  color: #eaf8ff;
}

.hall__views button.is-on {
  color: #04121e;
  background: linear-gradient(150deg, #dcf6ff, #7fe0ff 58%, #37a9ea);
  box-shadow: 0 0 26px rgba(95, 215, 255, 0.34);
}

.hall__views button.is-on small {
  color: rgba(4, 18, 30, 0.55);
}

/* ============================ ⑤ 浮层 ============================ */
.hall__sheet-mask {
  position: absolute;
  z-index: 40;
  inset: 0;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  background: linear-gradient(180deg, rgba(2, 5, 11, 0.06), rgba(2, 5, 11, 0.5));
  backdrop-filter: blur(10px) saturate(1.05);
}

.hall__sheet {
  position: relative;
  width: min(1120px, calc(100vw - 96px));
  max-height: 66vh;
  margin-bottom: 110px;
  padding: 22px 30px 30px;
  overflow-y: auto;
  border-radius: 28px;
  animation: cc-rise 0.38s cubic-bezier(0.16, 0.88, 0.22, 1) both;
  scrollbar-width: thin;
  scrollbar-color: rgba(150, 198, 240, 0.18) transparent;
}

.hall__grip {
  position: absolute;
  left: 50%;
  top: 10px;
  width: 46px;
  height: 3px;
  transform: translateX(-50%);
  border-radius: 2px;
  background: rgba(190, 220, 245, 0.2);
  cursor: pointer;
  transition: 0.2s ease;
}

.hall__grip:hover {
  background: rgba(190, 220, 245, 0.45);
}

.hall__sheet-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 22px;
}

.hall__sheet-head small {
  color: rgba(176, 204, 226, 0.38);
  font-size: 9.5px;
  letter-spacing: 0.3em;
}

.hall__sheet-head h2 {
  margin: 8px 0 0;
  font-size: 21px;
  font-weight: 300;
  letter-spacing: 0.05em;
}

.hall__event {
  display: grid;
  grid-template-columns: 268px 1fr;
  gap: 30px;
}

.hall__peak-label {
  margin: 0 0 10px;
  color: rgba(176, 204, 226, 0.4);
  font-size: 10px;
  letter-spacing: 0.28em;
}

.hall__peak-value {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin: 0;
  font-size: 88px;
  font-weight: 100;
  line-height: 0.92;
  letter-spacing: -0.04em;
  background: linear-gradient(178deg, #ffffff, #a9e6ff 58%, #2f8fc8);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  filter: drop-shadow(0 0 40px rgba(64, 176, 240, 0.4));
}

.hall__peak-value em {
  font-size: 15px;
  letter-spacing: 0.12em;
  -webkit-text-fill-color: rgba(176, 204, 226, 0.42);
}

.hall__peak-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 7px 14px;
  margin: 20px 0 0;
  padding-top: 16px;
  border-top: 1px solid rgba(150, 198, 240, 0.12);
  color: rgba(196, 220, 240, 0.56);
  font-size: 11px;
  letter-spacing: 0.05em;
}

.hall__peak-tags span.is-alert {
  color: #ff8090;
}

.hall__asset {
  display: grid;
  grid-template-columns: 210px 1fr;
  gap: 32px;
}

.hall__asset-side {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.hall__search {
  height: 36px;
  padding: 0 14px;
  border: 1px solid rgba(150, 198, 240, 0.14);
  border-radius: 999px;
  color: #eaf8ff;
  background: rgba(255, 255, 255, 0.03);
  font: 400 12px var(--han);
  outline: none;
}

.hall__search::placeholder {
  color: rgba(176, 204, 226, 0.3);
}

.hall__search:focus {
  border-color: rgba(150, 220, 255, 0.4);
}

.hall__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.hall__chips button {
  padding: 6px 12px;
  border: 1px solid rgba(150, 198, 240, 0.12);
  border-radius: 999px;
  color: rgba(190, 214, 236, 0.52);
  background: transparent;
  font: 400 11px var(--han);
  cursor: pointer;
  transition: 0.2s ease;
}

.hall__chips button.is-on {
  border-color: rgba(150, 220, 255, 0.44);
  color: #04121e;
  background: linear-gradient(150deg, #dcf6ff, #7fe0ff);
}

.hall__asset-sum {
  display: flex;
  gap: 26px;
  margin: 0 0 16px;
  padding-bottom: 14px;
  border-bottom: 1px solid rgba(150, 198, 240, 0.1);
  color: rgba(176, 204, 226, 0.42);
  font-size: 11px;
  letter-spacing: 0.1em;
}

.hall__asset-sum b {
  margin-left: 6px;
  color: #eaf8ff;
  font-size: 16px;
  font-weight: 300;
}

.hall__asset-sum b.is-alert {
  color: #ff6b7d;
}

.hall__devices {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  list-style: none;
}

.hall__devices li {
  display: grid;
  grid-template-columns: 8px 1.4fr 1.5fr 66px 108px;
  align-items: center;
  gap: 16px;
  padding: 11px 0;
  border-bottom: 1px solid rgba(150, 198, 240, 0.06);
  cursor: pointer;
  transition: 0.2s ease;
}

.hall__devices li:hover {
  background: rgba(43, 125, 255, 0.06);
}

.hall__devices li.is-empty {
  display: block;
  color: rgba(176, 204, 226, 0.34);
  font-size: 12px;
  cursor: default;
}

.hall__dev-state {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #35d6a4;
  box-shadow: 0 0 8px currentColor;
}

.hall__dev-state.is-action {
  background: #ffd76b;
}

.hall__dev-state.is-offline {
  background: #ff2d55;
  animation: cc-live 1.6s ease-in-out infinite;
}

.hall__devices b {
  font-size: 13px;
  font-weight: 400;
}

.hall__devices b.is-alert {
  color: #ff8090;
}

.hall__devices small {
  color: rgba(176, 204, 226, 0.36);
  font-size: 10.5px;
}

.hall__devices em {
  color: rgba(206, 230, 248, 0.7);
  font-size: 12px;
  font-style: normal;
  text-align: right;
}

.hall__dev-ip {
  color: rgba(176, 204, 226, 0.3) !important;
  font-size: 10.5px !important;
}

.hall__review {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.hall__review-chart {
  display: flex;
  height: 118px;
  align-items: flex-end;
  gap: 5px;
}

.hall__review-chart span {
  flex: 1;
  border-radius: 2px 2px 1px 1px;
  background: linear-gradient(180deg, #7fe6ff, #1a5fb0);
  box-shadow: 0 0 12px rgba(35, 200, 255, 0.2);
  transition: height 0.4s cubic-bezier(0.2, 0.85, 0.25, 1);
}

.hall__review-legend {
  display: flex;
  justify-content: space-between;
  margin: 0;
  color: rgba(176, 204, 226, 0.3);
  font-size: 10px;
  letter-spacing: 0.1em;
}

.hall__review-stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 22px;
  margin: 0;
  padding-top: 18px;
  border-top: 1px solid rgba(150, 198, 240, 0.1);
}

.hall__review-stats dt {
  margin-bottom: 8px;
  color: rgba(176, 204, 226, 0.36);
  font-size: 9.5px;
  letter-spacing: 0.2em;
}

.hall__review-stats dd {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin: 0;
  color: rgba(232, 246, 255, 0.86);
  font-size: 12px;
  line-height: 1.5;
}

.hall__review-stats small {
  color: rgba(176, 204, 226, 0.36);
  font-size: 10px;
}

.hall__review-stats small.is-measured {
  color: rgba(143, 240, 216, 0.6);
}

.hall__review-stats small.is-predicted {
  color: rgba(255, 176, 102, 0.7);
}

/* ============================ ⑥ 应急 ============================ */
.hall__sos {
  position: absolute;
  z-index: 60;
  inset: 0;
  display: grid;
  place-items: center;
}

.hall__sos-veil {
  position: absolute;
  inset: 0;
  background: radial-gradient(ellipse at 50% 50%, rgba(4, 8, 16, 0.76), rgba(2, 4, 10, 0.95));
  backdrop-filter: blur(18px) saturate(0.8);
}

.hall__sos-panel {
  position: relative;
  z-index: 1;
  width: min(720px, calc(100vw - 80px));
  max-height: calc(100vh - 90px);
  padding: 30px 36px 26px;
  overflow-y: auto;
  border: 1px solid rgba(255, 59, 82, 0.22);
  border-radius: 30px;
  background: linear-gradient(160deg, rgba(28, 12, 20, 0.72), rgba(5, 9, 18, 0.86));
  box-shadow: 0 44px 130px rgba(0, 0, 0, 0.72), 0 0 90px rgba(255, 59, 82, 0.1);
  backdrop-filter: blur(24px);
  animation: cc-rise 0.44s cubic-bezier(0.16, 0.88, 0.22, 1) both;
}

.hall__sos-panel header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
  color: rgba(176, 204, 226, 0.4);
  font-size: 12px;
  letter-spacing: 0.2em;
}

.hall__sos-level {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 5px 13px;
  border: 1px solid rgba(255, 59, 82, 0.34);
  border-radius: 999px;
  background: rgba(255, 59, 82, 0.1);
  color: #ffd0d6;
  font-size: 11px;
  letter-spacing: 0.18em;
}

.hall__sos-level i {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #ff2d55;
  animation: cc-breathe 1.6s ease-in-out infinite;
}

.hall__sos-panel h2 {
  margin: 0 0 12px;
  font-size: 34px;
  font-weight: 200;
  letter-spacing: 0.03em;
}

.hall__sos-line {
  margin: 0 0 26px;
  color: rgba(204, 226, 244, 0.6);
  font-size: 12.5px;
}

.hall__sos-line b {
  color: #fff;
  font-size: 15px;
  font-weight: 400;
}

.hall__sos-actions {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 11px;
  margin-bottom: 26px;
}

.hall__sos-actions button {
  padding: 14px 10px;
  border: 1px solid rgba(150, 198, 240, 0.13);
  border-radius: 999px;
  color: rgba(206, 230, 248, 0.62);
  background: rgba(255, 255, 255, 0.03);
  font: 400 12.5px var(--han);
  letter-spacing: 0.08em;
  cursor: pointer;
  transition: 0.22s ease;
}

.hall__sos-actions button:hover {
  color: #fff;
  border-color: rgba(255, 59, 82, 0.4);
  background: rgba(255, 59, 82, 0.1);
  transform: translateY(-1px);
}

.hall__sos-exit {
  width: 100%;
  margin-top: 22px;
  padding: 14px;
  border: 1px solid rgba(150, 198, 240, 0.13);
  border-radius: 999px;
  color: rgba(206, 230, 248, 0.6);
  background: transparent;
  font: 400 12.5px var(--han);
  letter-spacing: 0.14em;
  cursor: pointer;
  transition: 0.22s ease;
}

.hall__sos-exit:hover {
  color: #fff;
  border-color: rgba(150, 220, 255, 0.4);
}

.hall__boot {
  position: absolute;
  z-index: 70;
  left: 50%;
  bottom: 120px;
  display: flex;
  align-items: center;
  gap: 11px;
  transform: translateX(-50%);
  color: rgba(176, 204, 226, 0.42);
  font-size: 11px;
  letter-spacing: 0.2em;
}

.hall__boot i {
  width: 11px;
  height: 11px;
  border: 1.5px solid rgba(95, 215, 255, 0.24);
  border-top-color: #7fe6ff;
  border-radius: 50%;
  animation: cc-sweep 0.9s linear infinite;
}

/* ============================ 过渡 ============================ */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.slide-enter-active,
.slide-leave-active,
.rise-enter-active,
.rise-leave-active {
  transition: all 0.32s cubic-bezier(0.16, 0.88, 0.22, 1);
}

.slide-enter-from,
.slide-leave-to {
  opacity: 0;
  transform: translateX(16px);
}

.rise-enter-from,
.rise-leave-to {
  opacity: 0;
  transform: translateY(10px);
}

.sheet-enter-active,
.sheet-leave-active {
  transition: opacity 0.3s ease;
}

.sheet-enter-from,
.sheet-leave-to {
  opacity: 0;
}

.sheet-enter-from .hall__sheet,
.sheet-leave-to .hall__sheet {
  transform: translateY(34px);
}

.sheet-enter-active .hall__sheet,
.sheet-leave-active .hall__sheet {
  transition: transform 0.36s cubic-bezier(0.16, 0.88, 0.22, 1);
}

/* ============================ 适配 ============================ */
@media (max-width: 1500px) {
  .hall__hero {
    width: 320px;
  }
  .hall__hero-value {
    font-size: 104px;
  }
  .hall__event {
    grid-template-columns: 268px 1fr;
    gap: 26px;
  }
}

@media (max-width: 1200px) {
  .hall__hero {
    top: 200px;
    left: 20px;
  }
  .hall__hero-value {
    font-size: 82px;
  }
  .hall__sub,
  .hall__stats {
    display: none;
  }
  .hall__sheet {
    width: calc(100vw - 24px);
    margin-bottom: 130px;
  }
  .hall__event,
  .hall__asset {
    grid-template-columns: 1fr;
    gap: 22px;
  }
  .hall__views button small {
    display: none;
  }
  .hall__review-stats {
    grid-template-columns: 1fr 1fr;
  }
}

.hall :deep(.maplibregl-canvas) {
  outline: none;
}

.hall :deep(.maplibregl-ctrl) {
  display: none !important;
}
</style>

<!--
  资产锚点样式必须放在【非 scoped】的样式块里。
  标记节点是 siteMarkers.ts 用 document.createElement 生成、直接挂到 maplibre
  容器上的，它不在组件模板里，scoped 属性选择器命中不到它的子元素；
  而当年这层样式缺失时，浏览器默认的 button 底色会让地图上飘着一片白色小方块——
  这是我在无头截图上抓到的真实缺陷，不要把它挪回 scoped。
-->
<style>
.cc-site-layer {
  position: absolute;
  inset: 0;
  z-index: 4;
  pointer-events: none;
}

.cc-site {
  position: absolute;
  left: 0;
  top: 0;
  display: block;
  width: 0;
  height: 0;
  padding: 0;
  border: 0;
  outline: none;
  background: transparent;
  color: inherit;
  pointer-events: auto;
  cursor: pointer;
  will-change: transform;
}

.cc-site__beacon {
  position: absolute;
  left: 0;
  top: 0;
  display: block;
  filter: drop-shadow(0 0 7px color-mix(in srgb, var(--risk) 55%, transparent));
}

.cc-site__beacon i,
.cc-site__beacon b {
  position: absolute;
  left: 0;
  top: 0;
  transform: translate(-50%, -50%);
}

/* 外层脉冲环：像雷达心跳一样扩散，但幅度极小 */
.cc-site__beacon i:first-child {
  width: 15px;
  height: 15px;
  border: 1px solid color-mix(in srgb, var(--risk) 78%, white);
  border-radius: 50%;
  background: color-mix(in srgb, var(--risk) 10%, transparent);
  animation: cc-site-wave 3.2s cubic-bezier(0.22, 0.68, 0.3, 1) infinite;
}

.cc-site__beacon i:nth-child(2) {
  width: 11px;
  height: 11px;
  border: 1px solid color-mix(in srgb, var(--risk) 60%, white);
  border-radius: 50%;
  animation: cc-site-wave 3.2s 1.1s cubic-bezier(0.22, 0.68, 0.3, 1) infinite;
}

/* 芯点：微拟物，带高光，像一颗带电的铆钉 */
.cc-site__beacon b {
  width: 5.5px;
  height: 5.5px;
  border: 1px solid color-mix(in srgb, var(--risk) 85%, white);
  border-radius: 50%;
  background: #f2fdff;
  box-shadow: 0 0 7px 1.5px color-mix(in srgb, var(--risk) 65%, transparent);
  animation: cc-site-core 2.8s ease-in-out infinite;
}

/* 红色数字角标：整个屏幕上唯一允许出现的红 */
.cc-site__badge {
  position: absolute;
  left: 9px;
  top: -12px;
  display: grid;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  place-items: center;
  border-radius: 9px;
  background: linear-gradient(160deg, #ff5d6e, #d8172f);
  box-shadow: 0 0 10px rgba(255, 59, 82, 0.5);
  color: #fff;
  font: 700 10px/1 var(--din, monospace);
}

.cc-site.is-focused .cc-site__beacon b {
  box-shadow:
    0 0 0 3px rgba(127, 230, 255, 0.26),
    0 0 14px 4px rgba(35, 200, 255, 0.65);
}

@keyframes cc-site-wave {
  0% {
    opacity: 0.75;
    transform: translate(-50%, -50%) scale(0.6);
  }
  70% {
    opacity: 0.24;
  }
  100% {
    opacity: 0;
    transform: translate(-50%, -50%) scale(1.55);
  }
}

@keyframes cc-site-core {
  0%,
  100% {
    filter: brightness(0.92);
  }
  50% {
    filter: brightness(1.28);
  }
}
</style>
