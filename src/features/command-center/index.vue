<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import 'maplibre-gl/dist/maplibre-gl.css'
import TwinCanvas from './TwinCanvas.vue'
import ProtectionChain from './ProtectionChain.vue'
import { createCommandMap, type LayerKey, type MapController } from './mapEngine'
import {
  assetSites,
  computeThreats,
  DATA_SOURCES,
  devices,
  formatClock,
  formatSeconds,
  protectionStats,
  siteById,
  stormCells,
  strikes,
  WARNING_LADDER,
  WINDOW_SECONDS,
} from './data'
import type { AssetSite, Strike } from './data'
import { gapSummary, getSiteTwin } from './twin'
import './theme.css'

/* =========================================================================
   雷穹 · 雷电数字孪生指挥舱
   -------------------------------------------------------------------------
   屏幕只回答三个问题，顺序都不许乱：

     ① 雷暴在哪里            → 雷达回波（按 dBZ 着色）
     ② 离我的矿区多远        → 四条预警距离圈 200/150/100/50 km
     ③ 现在该干什么          → 预警等级 + 客户预案里的动作原话

   对应 V1 的四个业务模块，做成底部四个视图：
     实时监测 / 热力分析 / 移动轨迹 / 临近预警

   减法原则：地图上只放"能回答上面三件事"的图形。
   省界保留（它是空间参照系），地名、输电通道、矿区边界一律默认关闭。
   ========================================================================= */

const BASE_HOUR = 8

const mapHost = ref<HTMLDivElement>()
const controller = shallowRef<MapController>()
const twin = ref<{ setMap: (value: MapController['map'] | null) => void } | null>(null)
const mapReady = ref(false)

type ModuleKey = 'monitor' | 'heat' | 'track' | 'warning'
const module = ref<ModuleKey>('warning')

const scale = ref<'network' | 'site'>('network')
const activeSiteId = ref('')
const cursor = ref(WINDOW_SECONDS)
const playing = ref(false)
let playTimer = 0

const sheet = ref<'none' | 'event' | 'twin' | 'sources'>('none')
const selectedStrike = ref<Strike | null>(null)
const emergency = ref(false)
const emergencyStrike = ref<Strike | null>(null)
const emergencySeconds = ref(4)
let emergencyTimer = 0

const threats = computeThreats()
const threatOf = (siteId: string) => threats.find((item) => item.siteId === siteId)!

/** 按"离雷暴最近"排序：领导第一眼就要看到最危险的那一处 */
const rankedSites = computed(() =>
  [...assetSites].sort((a, b) => threatOf(a.id).gapKm - threatOf(b.id).gapKm),
)

const exposed = computed(() => rankedSites.value.filter((site) => threatOf(site.id).warning.level > 0))
const topSite = computed<AssetSite | undefined>(() => exposed.value[0])
const topThreat = computed(() => (topSite.value ? threatOf(topSite.value.id) : null))

/** 主指标：最近雷暴到场区的距离。全场区里最小的那个，就是指挥岗的焦点 */
const hero = computed(() => {
  if (scale.value === 'site' && siteTwin.value) {
    return {
      label: '本场区保护覆盖率',
      value: String(siteTwin.value.coverage),
      unit: '%',
      note:
        siteTwin.value.uncovered > 0
          ? `${siteTwin.value.devices.length} 个防护节点中，${siteTwin.value.uncovered} 个落在接闪杆保护半径之外`
          : `全部 ${siteTwin.value.devices.length} 个防护节点均在保护范围内`,
      tone: siteTwin.value.uncovered > 0 ? 'alarm' : 'safe',
    }
  }
  const threat = topThreat.value
  if (!threat) {
    return { label: '最近雷暴距离', value: '—', unit: 'km', note: '暂无雷暴单体', tone: 'safe' }
  }
  return {
    label: `最近雷暴 · ${topSite.value?.name ?? ''}`,
    value: String(threat.gapKm),
    unit: 'km',
    note: `${threat.warning.label} · ${threat.warning.action}`,
    tone: threat.warning.level <= 2 ? 'alarm' : threat.warning.level === 3 ? 'warn' : 'safe',
  }
})

const activeSite = computed(() => siteById.get(activeSiteId.value))
const siteTwin = computed(() => (activeSiteId.value ? getSiteTwin(activeSiteId.value) : undefined))

const progress = computed(() => Math.max(0, Math.min(1, cursor.value / WINDOW_SECONDS)))
const clockLabel = computed(() => formatClock(cursor.value, BASE_HOUR))

const worstStrike = computed(() => {
  const pool = revealedStrikes.value.length ? revealedStrikes.value : strikes
  return pool.reduce((best, strike) => (strike.current > best.current ? strike : best), pool[0]!)
})

const revealedStrikes = computed(() => {
  const limit = progress.value * WINDOW_SECONDS
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

const activeEmergency = computed(() => emergencyStrike.value)
const activeEmergencySite = computed(() =>
  activeEmergency.value ? siteById.get(activeEmergency.value.siteId) : undefined,
)

/* ============================ 交互 ============================ */

function enterSite(id: string) {
  if (!siteById.get(id)) return
  activeSiteId.value = id
  scale.value = 'site'
  sheet.value = 'none'
  selectedStrike.value = null
  controller.value?.focusSite(id, { zoom: 16 })
}

function exitSite() {
  scale.value = 'network'
  activeSiteId.value = ''
  sheet.value = 'none'
  controller.value?.resetView()
}

function openEvent(strike: Strike) {
  selectedStrike.value = strike
  sheet.value = 'event'
}

async function triggerEmergency(strike?: Strike) {
  const target = strike ?? worstStrike.value
  emergencyStrike.value = target
  emergency.value = true
  emergencySeconds.value = 4
  window.clearInterval(emergencyTimer)
  emergencyTimer = window.setInterval(() => {
    emergencySeconds.value += 1
  }, 1000)
  const siteId = target.siteId
  if (siteId !== activeSiteId.value) {
    activeSiteId.value = siteId
    scale.value = 'site'
    controller.value?.focusSite(siteId, { zoom: 16, duration: 1300 })
  }
}

function exitEmergency() {
  emergency.value = false
  window.clearInterval(emergencyTimer)
  exitSite()
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

/**
 * 四个业务模块对应四套图层组合（对齐 V1 的四个模块）。
 * 每个模块只开必要的图层：模块化本身就是最强的降噪手段。
 */
const LAYER_RECIPES: Record<ModuleKey, LayerKey[]> = {
  monitor: ['terrain', 'lightning'],
  heat: ['terrain', 'storm', 'lightning'],
  track: ['terrain', 'storm', 'grid'],
  warning: ['terrain', 'storm', 'lightning'],
}

/** 地名默认关闭：地图上的文字越少，预警结论越突出 */
const labelOn = ref(false)

function applyModule(next: ModuleKey) {
  module.value = next
  const allowed = new Set(LAYER_RECIPES[next])
  const all: LayerKey[] = ['terrain', 'asset', 'grid', 'label', 'corridor', 'storm', 'lightning', 'mine']
  for (const key of all) {
    controller.value?.setLayer(key, key === 'label' ? labelOn.value : allowed.has(key))
  }
}

/** 预警等级 → 颜色，和右侧清单、地图圈保持一致 */
const levelColor = (level: number) => WARNING_LADDER.find((step) => step.level === level)?.level
  ? threatOfColor(level)
  : threatOfColor(level)

function threatOfColor(level: number) {
  if (level === 1) return '#ff3b52'
  if (level === 2) return '#ff9f45'
  if (level === 3) return '#ffd76b'
  if (level === 4) return '#4fb2e8'
  return 'rgba(150,205,240,.4)'
}

onMounted(async () => {
  if (!mapHost.value) return
  controller.value = await createCommandMap(mapHost.value, {
    onSiteClick: (id) => enterSite(id),
  })
  twin.value?.setMap(controller.value.map)
  applyModule('warning')
  mapReady.value = true
})

onBeforeUnmount(() => {
  window.clearInterval(playTimer)
  window.clearInterval(emergencyTimer)
  controller.value?.dispose()
})

watch(progress, (value) => controller.value?.setTimelineProgress(value))
// 尺度切换时同步地理底图：场区图必须是工程图，不要省级噪点
watch(scale, (value) => controller.value?.setContextLayer(value === 'network'), { immediate: true })
</script>

<template>
  <main class="hall">
    <div ref="mapHost" class="hall__map" aria-label="雷电数字孪生地图"></div>
    <div class="hall__vignette" aria-hidden="true"></div>

    <TwinCanvas
      ref="twin"
      :strikes="strikes"
      :progress="progress"
      :selected-id="selectedStrike?.id ?? ''"
      :scale="scale"
      :site-id="activeSiteId"
      :visible="true"
      :show-envelope="true"
      @pick-site="(payload) => enterSite(payload.siteId)"
      @pick-strike="(payload) => openEvent(payload.strike)"
    />

    <!-- ① 页眉：品牌 + 位置 + 时钟 -->
    <header class="hall__head">
      <div class="hall__brand">
        <span class="hall__bolt">ϟ</span>
        <span class="hall__name">雷穹</span>
        <span class="hall__sub">雷电数字孪生指挥舱</span>
      </div>

      <nav class="hall__crumb">
        <button :class="{ 'is-on': scale === 'network' }" @click="scale === 'site' && exitSite()">
          雷暴临近预警
        </button>
        <template v-if="scale === 'site' && activeSite">
          <i>›</i>
          <span>{{ activeSite.name }}</span>
          <em>{{ activeSite.owner }}</em>
        </template>
      </nav>

      <div class="hall__status">
        <span class="hall__pulse"><i></i>实时</span>
        <span class="hall__clock cc-num">{{ clockLabel }}</span>
      </div>

      <div class="hall__tools">
        <button class="hall__tool" :class="{ 'is-hot': exposed.length > 0 }" title="应急指挥" @click="triggerEmergency()">
          <svg viewBox="0 0 24 24"><path d="M13 2 4.5 13.5H11l-1 8.5 8.5-11.5H12l1-8.5Z" /></svg>
        </button>
        <button class="hall__tool" title="数据来源" @click="sheet = 'sources'">
          <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 11v5m0-8.5v.5" /></svg>
        </button>
      </div>
    </header>

    <!-- ② 主指标：一个数字 = 最近雷暴离我多远 -->
    <section class="hall__hero">
      <p class="hall__hero-label">{{ hero.label }}</p>
      <p class="hall__hero-value cc-num" :class="`is-${hero.tone}`">
        {{ hero.value }}<em>{{ hero.unit }}</em>
      </p>
      <p class="hall__hero-note">{{ hero.note }}</p>

      <!-- 预警梯子：把客户的四级预案直接摆在屏幕上，领导不用记 -->
      <ul v-if="scale === 'network'" class="hall__ladder">
        <li v-for="step in [...WARNING_LADDER].reverse()" :key="step.level" :class="`is-lv${step.level}`">
          <b class="cc-num">{{ step.distance }}</b>
          <small>km</small>
          <span>{{ step.level }} 级</span>
        </li>
      </ul>
      <dl v-else-if="siteTwin" class="hall__stats">
        <div>
          <dt>防护节点</dt>
          <dd class="cc-num">{{ siteTwin.devices.length }}<i>个</i></dd>
        </div>
        <div>
          <dt>保护空档</dt>
          <dd class="cc-num" :class="{ 'is-alarm': siteTwin.uncovered }">
            {{ siteTwin.uncovered }}<i>台</i>
          </dd>
        </div>
      </dl>
    </section>

    <!-- ③ 场区预警清单：按"离雷暴最近"排序，只有这一列文字 -->
    <aside v-if="scale === 'network'" class="hall__list">
      <header>
        <strong>受保护场区</strong>
        <small>{{ exposed.length }} / {{ assetSites.length }} 处于预警</small>
      </header>
      <ul>
        <li
          v-for="site in rankedSites"
          :key="site.id"
          :class="{ 'is-off': threatOf(site.id).warning.level === 0 }"
          @click="enterSite(site.id)"
        >
          <i class="hall__dot" :style="{ background: threatOfColor(threatOf(site.id).warning.level) }"></i>
          <span class="hall__site">
            <b>{{ site.name }}</b>
            <small>{{ site.kind }} · {{ site.owner }}</small>
          </span>
          <span class="hall__gap">
            <b class="cc-num">{{ threatOf(site.id).gapKm }}</b>
            <small>km</small>
          </span>
          <em
            v-if="threatOf(site.id).warning.level > 0"
            class="hall__level"
            :style="{ color: threatOfColor(threatOf(site.id).warning.level) }"
          >
            {{ threatOf(site.id).warning.level }} 级
          </em>
          <em v-else class="hall__level is-off">正常</em>
        </li>
      </ul>
    </aside>

    <!-- 场区尺度的节点清单 -->
    <aside v-else-if="siteTwin" class="hall__list hall__list--nodes">
      <header>
        <strong>场区防护节点</strong>
        <small>{{ siteTwin.devices.length }} 个</small>
      </header>
      <ul>
        <li
          v-for="device in siteTwin.devices"
          :key="device.id"
          :class="{ 'is-gap': !device.covered }"
        >
          <i class="hall__dot" :style="{ background: device.covered ? '#7fe6ff' : '#ff3b52' }"></i>
          <span class="hall__site">
            <b>{{ device.name }}</b>
            <small>
              {{ device.kind }}
              <template v-if="device.resistance"> · 接地 {{ device.resistance }}Ω</template>
              <template v-if="device.reach"> · 保护距离 {{ device.reach }}m</template>
            </small>
          </span>
          <em class="hall__level" :class="{ 'is-off': device.covered }">
            {{ device.covered ? '圈内' : `距杆 ${Math.abs(device.margin)}m` }}
          </em>
        </li>
      </ul>
      <button class="hall__back" @click="exitSite">← 返回雷暴临近预警</button>
    </aside>

    <!-- ④ 一句话结论：现在该干什么（原话来自客户应急预案） -->
    <Transition name="slide">
      <button
        v-if="scale === 'network' && topSite && topThreat"
        class="hall__verdict"
        :class="`is-lv${topThreat.warning.level}`"
        @click="enterSite(topSite.id)"
      >
        <span class="hall__verdict-dot"></span>
        <span class="hall__verdict-text">
          <b>{{ topSite.name }} · 距雷暴 {{ topThreat.gapKm }} km · {{ topThreat.warning.label }}</b>
          <small>{{ topThreat.warning.action }} · 点击进入场区孪生</small>
        </span>
      </button>
      <button
        v-else-if="scale === 'site' && siteTwin?.uncovered"
        class="hall__verdict is-lv1"
        @click="sheet = 'twin'"
      >
        <span class="hall__verdict-dot"></span>
        <span class="hall__verdict-text">
          <b>{{ siteTwin.uncovered }} 台设备不在保护范围内</b>
          <small>接闪杆保护半径未覆盖该设备 → 查看空档详情与整改建议</small>
        </span>
      </button>
      <button v-else-if="scale === 'network'" class="hall__verdict is-lv0">
        <span class="hall__verdict-dot is-safe"></span>
        <span class="hall__verdict-text">
          <b>全部场区雷暴距离 > 200 km</b>
          <small>正常运行 · 无预警</small>
        </span>
      </button>
    </Transition>

    <!-- ⑤ 底部：四个业务模块 + 时间复盘 -->
    <div class="hall__bar">
      <Transition name="rise">
        <div v-if="scale === 'network'" class="hall__time cc-glass">
          <button class="hall__play" @click="togglePlay">{{ playing ? '❙❙' : '▶' }}</button>
          <span class="hall__time-value cc-num">{{ clockLabel }}</span>
          <div class="hall__track">
            <span class="hall__track-fill" :style="{ width: `${progress * 100}%` }"></span>
            <input v-model.number="cursor" type="range" min="0" :max="WINDOW_SECONDS" step="60" />
          </div>
          <button class="hall__live" :class="{ 'is-on': progress > 0.99 }" @click="goLive">LIVE</button>
        </div>
      </Transition>

      <nav class="hall__modules cc-glass">
        <button
          v-for="item in [
            { key: 'monitor', label: '实时监测', hint: '闪电定位' },
            { key: 'heat', label: '热力分析', hint: '雷达回波' },
            { key: 'track', label: '移动轨迹', hint: '路径外推' },
            { key: 'warning', label: '临近预警', hint: '分级告警' },
          ]"
          :key="item.key"
          :class="{ 'is-on': module === item.key }"
          @click="applyModule(item.key as ModuleKey)"
        >
          <b>{{ item.label }}</b>
          <small>{{ item.hint }}</small>
        </button>
      </nav>
    </div>

    <!-- ⑥ 浮层：事件 / 空档诊断 / 数据来源 -->
    <Transition name="sheet">
      <div v-if="sheet !== 'none'" class="hall__sheet-mask" @click.self="sheet = 'none'">
        <section class="hall__sheet cc-glass">
          <span class="hall__grip" @click="sheet = 'none'"></span>
          <header class="hall__sheet-head">
            <div>
              <small>{{
                sheet === 'event' ? '雷击事件' : sheet === 'twin' ? '保护范围诊断' : '数据来源'
              }}</small>
              <h2 v-if="sheet === 'event' && selectedStrike" class="cc-num">{{ selectedStrike.id }}</h2>
              <h2 v-else-if="sheet === 'twin'">{{ activeSite?.name }}</h2>
              <h2 v-else>每一条结论都要能溯源</h2>
            </div>
            <button class="hall__tool" @click="sheet = 'none'">
              <svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6" /></svg>
            </button>
          </header>

          <div v-if="sheet === 'event' && selectedStrike" class="hall__event">
            <div>
              <p class="hall__peak-label">峰值电流</p>
              <p class="hall__peak-value cc-num">{{ selectedStrike.current }}<em>kA</em></p>
              <p class="hall__peak-tags">
                <span>{{ selectedStrike.type }}</span>
                <span>{{ siteById.get(selectedStrike.siteId)?.name }}</span>
                <span class="cc-num">距 {{ selectedStrike.distanceKm }} km</span>
                <span :class="{ 'is-alert': !selectedStrike.intercepted }">
                  {{ selectedStrike.intercepted ? '已拦截' : '未触发保护' }}
                </span>
              </p>
            </div>
            <ProtectionChain :strike="selectedStrike" />
          </div>

          <div v-else-if="sheet === 'twin' && siteTwin" class="hall__gap">
            <ul>
              <li v-for="device in siteTwin.devices.filter((item) => !item.covered)" :key="device.id">
                <b>{{ device.name }}</b>
                <small>
                  {{ device.kind }} · 落在全部接闪杆保护半径之外
                  <em class="cc-num">{{ Math.abs(device.margin) }} m</em>
                </small>
              </li>
            </ul>
            <div class="hall__gap-advice">
              <strong>整改建议（按 GB 50057 滚球法）</strong>
              <p>1. 该设备上方增补接闪杆，或加装独立接闪短杆；</p>
              <p>2. 若无法加装，需在其电源与信号入口补装 SPD，并明确标注"非直击雷保护区"；</p>
              <p>3. 整改后重新测绘保护范围并归档，作为年度防雷检测依据。</p>
            </div>
          </div>

          <div v-else class="hall__review">
            <dl class="hall__review-stats">
              <div v-for="source in DATA_SOURCES" :key="source.key">
                <dt>{{ source.label }}</dt>
                <dd>
                  {{ source.value }}
                  <small :class="`is-${source.kind}`">
                    {{ source.kind === 'measured' ? '实测' : '模型预测' }}
                  </small>
                </dd>
              </div>
            </dl>
            <p class="hall__review-note">
              预警分级依据：雷暴单体边缘到矿区边界的距离（200 / 150 / 100 / 50 km）。
              该阈值与客户《防雷应急预案》一致，可直接对应处置动作。
              <br />
              装置平均响应 {{ protectionStats.avgResponseMs }} ms · 防护有效率
              {{ protectionStats.effectiveRate }}% · 全网保护空档
              {{ gapSummary.devices }} 台 / {{ gapSummary.sites }} 个场区。
            </p>
          </div>
        </section>
      </div>
    </Transition>

    <!-- ⑦ 应急 -->
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
            <button
              v-for="action in ['呼叫运维', '调取视频', '生成工单', '保护范围复核', '电网联动', '标记误报']"
              :key="action"
            >
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
    radial-gradient(ellipse at 56% 46%, transparent 48%, rgba(2, 5, 11, 0.68) 100%),
    linear-gradient(180deg, rgba(2, 5, 11, 0.74), transparent 15%, transparent 78%, rgba(2, 5, 11, 0.8));
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
  gap: 22px;
  height: 74px;
  padding: 0 32px;
}

.hall__brand {
  display: flex;
  align-items: baseline;
  gap: 11px;
}

.hall__bolt {
  color: #7fe6ff;
  font-size: 18px;
  text-shadow: 0 0 18px rgba(95, 215, 255, 0.8);
}

.hall__name {
  font-size: 15.5px;
  font-weight: 500;
  letter-spacing: 0.4em;
}

.hall__sub {
  color: rgba(180, 206, 228, 0.32);
  font-size: 10px;
  letter-spacing: 0.2em;
}

.hall__crumb {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-left: 14px;
  font-size: 12px;
}

.hall__crumb button {
  padding: 0;
  border: 0;
  color: rgba(176, 204, 226, 0.44);
  background: transparent;
  font: 400 12px var(--han);
  letter-spacing: 0.08em;
  cursor: pointer;
}

.hall__crumb button.is-on {
  color: rgba(232, 246, 255, 0.9);
}

.hall__crumb i {
  color: rgba(176, 204, 226, 0.24);
  font-style: normal;
}

.hall__crumb span {
  color: #eaf8ff;
}

.hall__crumb em {
  color: rgba(176, 204, 226, 0.36);
  font-size: 10.5px;
  font-style: normal;
}

.hall__status {
  display: flex;
  align-items: baseline;
  gap: 14px;
  margin-left: auto;
}

.hall__pulse {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: rgba(150, 232, 214, 0.68);
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
  color: rgba(224, 240, 252, 0.6);
  font-size: 14px;
  font-weight: 300;
  letter-spacing: 0.14em;
}

.hall__tools {
  display: flex;
  gap: 10px;
}

.hall__tool {
  display: grid;
  width: 34px;
  height: 34px;
  place-items: center;
  border: 1px solid rgba(150, 198, 240, 0.14);
  border-radius: 50%;
  color: rgba(206, 230, 248, 0.6);
  background: rgba(255, 255, 255, 0.02);
  cursor: pointer;
  transition: 0.24s ease;
}

.hall__tool svg {
  width: 15px;
  height: 15px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.4;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.hall__tool:hover {
  color: #eafaff;
  border-color: rgba(150, 220, 255, 0.4);
  box-shadow: 0 0 20px rgba(35, 200, 255, 0.2);
}

.hall__tool.is-hot {
  color: #ff8f9e;
  border-color: rgba(255, 59, 82, 0.42);
  animation: cc-breathe 2.6s ease-in-out infinite;
}

/* ============================ ② 主指标 + 预警梯子 ============================ */
.hall__hero {
  position: absolute;
  z-index: 12;
  left: 32px;
  top: 150px;
  width: 336px;
  pointer-events: none;
}

.hall__hero-label {
  margin: 0 0 10px;
  color: rgba(176, 204, 226, 0.4);
  font-size: 10.5px;
  letter-spacing: 0.24em;
}

.hall__hero-value {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin: 0;
  font-size: 104px;
  font-weight: 100;
  line-height: 0.88;
  letter-spacing: -0.05em;
  background: linear-gradient(178deg, #ffffff 6%, #a9e6ff 56%, #2f8fc8 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  filter: drop-shadow(0 0 40px rgba(64, 176, 240, 0.34));
}

.hall__hero-value.is-alarm {
  background: linear-gradient(178deg, #ffffff 6%, #ffc9d0 52%, #d8344c 100%);
  -webkit-background-clip: text;
  background-clip: text;
  filter: drop-shadow(0 0 40px rgba(255, 59, 82, 0.32));
}

.hall__hero-value.is-warn {
  background: linear-gradient(178deg, #ffffff 6%, #ffe2b8 52%, #e08a24 100%);
  -webkit-background-clip: text;
  background-clip: text;
  filter: drop-shadow(0 0 40px rgba(255, 159, 69, 0.3));
}

.hall__hero-value em {
  font-size: 14px;
  font-weight: 300;
  letter-spacing: 0.14em;
  -webkit-text-fill-color: rgba(176, 204, 226, 0.42);
}

.hall__hero-note {
  margin: 14px 0 0;
  padding-top: 12px;
  border-top: 1px solid rgba(150, 198, 240, 0.12);
  color: rgba(190, 214, 236, 0.6);
  font-size: 11.5px;
  line-height: 1.6;
}

/* 预警梯子：把客户的四级预案直接摆在屏幕上 */
.hall__ladder {
  display: flex;
  gap: 6px;
  margin: 16px 0 0;
  padding: 0;
  list-style: none;
}

.hall__ladder li {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 8px 4px 7px;
  border: 1px solid rgba(150, 198, 240, 0.1);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.02);
}

.hall__ladder b {
  font-size: 16px;
  font-weight: 300;
  color: rgba(232, 246, 255, 0.9);
}

.hall__ladder small {
  color: rgba(176, 204, 226, 0.36);
  font-size: 9px;
}

.hall__ladder span {
  font-size: 10px;
  letter-spacing: 0.06em;
}

.hall__ladder li.is-lv1 span {
  color: #ff6b7d;
}
.hall__ladder li.is-lv2 span {
  color: #ffb066;
}
.hall__ladder li.is-lv3 span {
  color: #ffd76b;
}
.hall__ladder li.is-lv4 span {
  color: #7fc4ef;
}

.hall__stats {
  display: flex;
  gap: 26px;
  margin: 18px 0 0;
}

.hall__stats div {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.hall__stats dt {
  color: rgba(176, 204, 226, 0.36);
  font-size: 9.5px;
  letter-spacing: 0.18em;
}

.hall__stats dd {
  margin: 0;
  color: #eaf7ff;
  font-size: 23px;
  font-weight: 200;
}

.hall__stats dd.is-alarm {
  color: #ff8090;
}

.hall__stats dd i {
  margin-left: 3px;
  color: rgba(176, 204, 226, 0.4);
  font-size: 10px;
  font-style: normal;
}

/* ============================ ③ 场区清单 ============================ */
.hall__list {
  position: absolute;
  z-index: 14;
  right: 32px;
  top: 96px;
  display: flex;
  width: 322px;
  max-height: calc(100vh - 300px);
  flex-direction: column;
  border: 1px solid rgba(150, 198, 240, 0.12);
  border-radius: 20px;
  background: rgba(8, 16, 28, 0.58);
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.48);
  backdrop-filter: blur(20px);
  overflow: hidden;
}

.hall__list header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding: 15px 17px 11px;
  border-bottom: 1px solid rgba(150, 198, 240, 0.08);
}

.hall__list header strong {
  font-size: 12.5px;
  font-weight: 500;
  letter-spacing: 0.1em;
}

.hall__list header small {
  color: rgba(176, 204, 226, 0.36);
  font-size: 10px;
}

.hall__list ul {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 6px 7px 10px;
  list-style: none;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: rgba(150, 198, 240, 0.16) transparent;
}

.hall__list li {
  display: grid;
  grid-template-columns: 8px 1fr auto auto;
  align-items: center;
  gap: 11px;
  padding: 7px 10px;
  border-radius: 12px;
  cursor: pointer;
  transition: 0.2s ease;
}

.hall__list li:hover {
  background: rgba(43, 125, 255, 0.09);
}

.hall__list li.is-off {
  opacity: 0.42;
}

.hall__dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
}

.hall__site {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 3px;
}

.hall__site b {
  overflow: hidden;
  font-size: 13px;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.hall__site small {
  overflow: hidden;
  color: rgba(176, 204, 226, 0.38);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.hall__gap {
  display: flex;
  align-items: baseline;
  gap: 2px;
  color: rgba(232, 246, 255, 0.94);
}

.hall__gap b {
  font-size: 19px;
  font-weight: 200;
}

.hall__gap small {
  color: rgba(176, 204, 226, 0.4);
  font-size: 9.5px;
}

.hall__level {
  min-width: 34px;
  font-size: 10.5px;
  font-style: normal;
  text-align: right;
  letter-spacing: 0.04em;
}

.hall__level.is-off {
  color: rgba(143, 240, 216, 0.7);
}

.hall__back {
  margin: 0 12px 12px;
  padding: 10px;
  border: 1px solid rgba(150, 198, 240, 0.13);
  border-radius: 999px;
  color: rgba(206, 230, 248, 0.56);
  background: transparent;
  font: 400 12px var(--han);
  cursor: pointer;
  transition: 0.22s ease;
}

.hall__back:hover {
  color: #fff;
  border-color: rgba(150, 220, 255, 0.4);
}

.hall__list--nodes li.is-gap {
  background: linear-gradient(90deg, rgba(255, 59, 82, 0.1), transparent);
}

.hall__list--nodes li.is-gap .hall__level {
  color: #ff8090;
}

/* ============================ ④ 结论 ============================ */
.hall__verdict {
  position: absolute;
  z-index: 16;
  left: 32px;
  bottom: 152px;
  display: flex;
  max-width: 400px;
  align-items: center;
  gap: 12px;
  padding: 13px 17px;
  border: 1px solid rgba(150, 198, 240, 0.14);
  border-radius: 18px;
  background: rgba(8, 16, 28, 0.62);
  box-shadow: 0 18px 46px rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(20px);
  cursor: pointer;
  text-align: left;
  transition: 0.24s ease;
}

.hall__verdict:hover {
  border-color: rgba(150, 220, 255, 0.4);
}

.hall__verdict.is-lv1 {
  border-color: rgba(255, 59, 82, 0.3);
  background: rgba(34, 10, 16, 0.56);
  animation: cc-breathe 3.4s ease-in-out infinite;
}

.hall__verdict.is-lv2 {
  border-color: rgba(255, 159, 69, 0.28);
}

.hall__verdict-dot {
  width: 7px;
  height: 7px;
  flex: none;
  border-radius: 50%;
  background: #ff2d55;
  box-shadow: 0 0 10px rgba(255, 45, 85, 0.8);
}

.hall__verdict-dot.is-safe {
  background: #35d6a4;
  box-shadow: 0 0 10px rgba(53, 214, 164, 0.7);
}

.hall__verdict-text {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.hall__verdict-text b {
  color: #f2fbff;
  font-size: 12.5px;
  font-weight: 500;
}

.hall__verdict-text small {
  color: rgba(198, 220, 238, 0.6);
  font-size: 10.5px;
  line-height: 1.5;
}

/* ============================ ⑤ 底部 ============================ */
.hall__bar {
  position: absolute;
  z-index: 18;
  left: 50%;
  bottom: 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  transform: translateX(-50%);
}

.hall__time {
  display: flex;
  width: min(620px, calc(100vw - 200px));
  align-items: center;
  gap: 14px;
  padding: 9px 17px;
  border-radius: 999px;
}

.hall__play {
  display: grid;
  width: 30px;
  height: 30px;
  flex: none;
  place-items: center;
  border: 1px solid rgba(150, 220, 255, 0.3);
  border-radius: 50%;
  color: #d9f4ff;
  background: rgba(35, 200, 255, 0.1);
  font-size: 10px;
  cursor: pointer;
}

.hall__time-value {
  color: #eaf8ff;
  font-size: 15px;
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
  box-shadow: 0 0 12px rgba(35, 200, 255, 0.55);
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
  padding: 5px 12px;
  border: 1px solid rgba(150, 198, 240, 0.16);
  border-radius: 999px;
  color: rgba(176, 204, 226, 0.5);
  background: transparent;
  font: 400 10px var(--han);
  letter-spacing: 0.18em;
  cursor: pointer;
}

.hall__live.is-on {
  border-color: rgba(53, 214, 164, 0.4);
  color: #8ff0d0;
}

/* 四个业务模块 = V1 的四个模块 */
.hall__modules {
  display: flex;
  gap: 3px;
  padding: 5px;
  border-radius: 999px;
}

.hall__modules button {
  display: flex;
  align-items: baseline;
  gap: 7px;
  padding: 8px 18px;
  border: 0;
  border-radius: 999px;
  color: rgba(190, 214, 236, 0.5);
  background: transparent;
  font: 400 13px var(--han);
  letter-spacing: 0.1em;
  cursor: pointer;
  transition: 0.26s cubic-bezier(0.2, 0.85, 0.25, 1);
}

.hall__modules button small {
  color: rgba(176, 204, 226, 0.28);
  font-size: 9.5px;
}

.hall__modules button:hover {
  color: #eaf8ff;
}

.hall__modules button.is-on {
  color: #04121e;
  background: linear-gradient(150deg, #dcf6ff, #7fe0ff 58%, #37a9ea);
  box-shadow: 0 0 24px rgba(95, 215, 255, 0.32);
}

.hall__modules button.is-on small {
  color: rgba(4, 18, 30, 0.55);
}

/* ============================ ⑥ 浮层 ============================ */
.hall__sheet-mask {
  position: absolute;
  z-index: 40;
  inset: 0;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  background: linear-gradient(180deg, rgba(2, 5, 11, 0.06), rgba(2, 5, 11, 0.52));
  backdrop-filter: blur(10px) saturate(1.05);
}

.hall__sheet {
  position: relative;
  width: min(1040px, calc(100vw - 96px));
  max-height: 66vh;
  margin-bottom: 132px;
  padding: 22px 30px 28px;
  overflow-y: auto;
  border-radius: 26px;
  animation: cc-rise 0.38s cubic-bezier(0.16, 0.88, 0.22, 1) both;
  scrollbar-width: thin;
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
}

.hall__sheet-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 20px;
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
}

.hall__event {
  display: grid;
  grid-template-columns: 254px 1fr;
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
  font-size: 80px;
  font-weight: 100;
  line-height: 0.92;
  background: linear-gradient(178deg, #ffffff, #a9e6ff 58%, #2f8fc8);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

.hall__peak-value em {
  font-size: 14px;
  letter-spacing: 0.12em;
  -webkit-text-fill-color: rgba(176, 204, 226, 0.42);
}

.hall__peak-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 7px 14px;
  margin: 18px 0 0;
  padding-top: 15px;
  border-top: 1px solid rgba(150, 198, 240, 0.12);
  color: rgba(196, 220, 240, 0.56);
  font-size: 11px;
}

.hall__peak-tags span.is-alert {
  color: #ff8090;
}

.hall__gap ul {
  display: flex;
  flex-direction: column;
  margin: 0 0 20px;
  padding: 0;
  list-style: none;
}

.hall__gap li {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 13px 0;
  border-bottom: 1px solid rgba(255, 59, 82, 0.16);
}

.hall__gap li b {
  color: #ffd0d6;
  font-size: 14px;
  font-weight: 500;
}

.hall__gap li small {
  color: rgba(198, 220, 238, 0.5);
  font-size: 11px;
}

.hall__gap li em {
  margin-left: 6px;
  color: #ff8090;
  font-style: normal;
}

.hall__gap-advice strong {
  display: block;
  margin-bottom: 10px;
  color: rgba(232, 246, 255, 0.9);
  font-size: 12.5px;
  font-weight: 500;
}

.hall__gap-advice p {
  margin: 0 0 8px;
  color: rgba(198, 220, 238, 0.62);
  font-size: 12px;
  line-height: 1.7;
}

.hall__review-stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 22px;
  margin: 0;
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
  color: rgba(232, 246, 255, 0.84);
  font-size: 11.5px;
  line-height: 1.55;
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

.hall__review-note {
  margin: 20px 0 0;
  padding-top: 16px;
  border-top: 1px solid rgba(150, 198, 240, 0.1);
  color: rgba(176, 204, 226, 0.46);
  font-size: 11px;
  line-height: 1.8;
}

/* ============================ ⑦ 应急 ============================ */
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
  background: radial-gradient(ellipse at 50% 50%, rgba(4, 8, 16, 0.78), rgba(2, 4, 10, 0.95));
  backdrop-filter: blur(18px) saturate(0.8);
}

.hall__sos-panel {
  position: relative;
  z-index: 1;
  width: min(680px, calc(100vw - 80px));
  max-height: calc(100vh - 90px);
  padding: 28px 34px 24px;
  overflow-y: auto;
  border: 1px solid rgba(255, 59, 82, 0.22);
  border-radius: 28px;
  background: linear-gradient(160deg, rgba(28, 12, 20, 0.74), rgba(5, 9, 18, 0.88));
  box-shadow: 0 44px 130px rgba(0, 0, 0, 0.72);
  backdrop-filter: blur(24px);
  animation: cc-rise 0.44s cubic-bezier(0.16, 0.88, 0.22, 1) both;
}

.hall__sos-panel header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 18px;
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
  font-size: 30px;
  font-weight: 200;
}

.hall__sos-line {
  margin: 0 0 24px;
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
  margin-bottom: 24px;
}

.hall__sos-actions button {
  padding: 13px 10px;
  border: 1px solid rgba(150, 198, 240, 0.13);
  border-radius: 999px;
  color: rgba(206, 230, 248, 0.6);
  background: rgba(255, 255, 255, 0.03);
  font: 400 12.5px var(--han);
  cursor: pointer;
  transition: 0.22s ease;
}

.hall__sos-actions button:hover {
  color: #fff;
  border-color: rgba(255, 59, 82, 0.4);
  background: rgba(255, 59, 82, 0.1);
}

.hall__sos-exit {
  width: 100%;
  margin-top: 20px;
  padding: 13px;
  border: 1px solid rgba(150, 198, 240, 0.13);
  border-radius: 999px;
  color: rgba(206, 230, 248, 0.58);
  background: transparent;
  font: 400 12.5px var(--han);
  letter-spacing: 0.12em;
  cursor: pointer;
}

.hall__sos-exit:hover {
  color: #fff;
  border-color: rgba(150, 220, 255, 0.4);
}

.hall__boot {
  position: absolute;
  z-index: 70;
  left: 50%;
  bottom: 128px;
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
  transform: translateY(10px);
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

.sheet-enter-active .hall__sheet,
.sheet-leave-active .hall__sheet {
  transition: transform 0.36s cubic-bezier(0.16, 0.88, 0.22, 1);
}

.sheet-enter-from .hall__sheet,
.sheet-leave-to .hall__sheet {
  transform: translateY(32px);
}

/* ============================ 适配 ============================ */
@media (max-width: 1500px) {
  .hall__hero-value {
    font-size: 88px;
  }
  .hall__list {
    width: 292px;
  }
}

@media (max-width: 1200px) {
  .hall__sub,
  .hall__ladder {
    display: none;
  }
  .hall__hero-value {
    font-size: 70px;
  }
  .hall__list {
    display: none;
  }
  .hall__modules button small {
    display: none;
  }
  .hall__event {
    grid-template-columns: 1fr;
    gap: 20px;
  }
}

.hall :deep(.maplibregl-canvas) {
  outline: none;
}

.hall :deep(.maplibregl-ctrl) {
  display: none !important;
}
</style>
