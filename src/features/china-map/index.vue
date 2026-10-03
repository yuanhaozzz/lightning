<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import 'maplibre-gl/dist/maplibre-gl.css'
import { createChinaMap, type ChinaMapController } from './map'

const mapHost = ref<HTMLDivElement>()
const START_HOUR = 8
const END_HOUR = 16
const MAX_TIMELINE_SECONDS = (END_HOUR - START_HOUR) * 3600
const hourTicks = Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, index) => `${String(START_HOUR + index).padStart(2, '0')}:00`)
const timelineSeconds = ref(6 * 3600)
const selectedDate = ref('2026-09-27')
const playing = ref(false)
const toolsExpanded = ref(false)
const avatarOpen = ref(false)
const toolMode = ref<'radar' | 'heatmap' | 'track'>('radar')
const heatmapAnalysis = ref<'strength' | 'density'>('strength')
const trackTab = ref<'distribution' | 'movement' | 'lifecycle'>('distribution')
let controller: ChinaMapController | undefined
let playbackTimer = 0
let timelineThrottleTimer = 0
let lastTimelineDispatch = 0
let lastTimelineFrame = -1

const formatTimelineTime = (seconds: number, includeSeconds = true) => {
  const safe = Math.max(0, Math.min(MAX_TIMELINE_SECONDS, Math.round(seconds)))
  const hour = START_HOUR + Math.floor(safe / 3600)
  const minute = Math.floor((safe % 3600) / 60)
  const second = safe % 60
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}${includeSeconds ? `:${String(second).padStart(2, '0')}` : ''}`
}
const currentTimeLabel = computed(() => formatTimelineTime(timelineSeconds.value))
const timelineProgress = computed(() => timelineSeconds.value / MAX_TIMELINE_SECONDS * 100)
const trackProgress = computed(() => timelineSeconds.value / MAX_TIMELINE_SECONDS)
const trackStats = computed(() => {
  const progress = trackProgress.value
  const lifecycle = Math.sin(progress * Math.PI)
  return {
    lng: (104.35 + progress * 14.4 + Math.sin(progress * Math.PI * 2) * .42).toFixed(2),
    lat: (39.45 - progress * 8.7 + Math.sin(progress * Math.PI * 1.6) * .55).toFixed(2),
    dbz: Math.round(34 + lifecycle * 27),
    speed: Math.round(17 + progress * 11),
    count: Math.round(240 + lifecycle * 1102),
    mines: lifecycle > .72 ? 3 : lifecycle > .35 ? 2 : 1,
  }
})
const trendBars = computed(() => Array.from({ length: 64 }, (_, index) => {
  const progress = index / 63
  const envelope = Math.pow(Math.sin(progress * Math.PI), 1.7)
  const texture = .7 + Math.sin(index * 1.83) * .18 + Math.sin(index * .47) * .12
  const active = progress <= trackProgress.value
  return { outer: Math.max(3, envelope * texture * 92), inner: Math.max(2, envelope * texture * 61), active }
}))
const miniStrikes = Array.from({ length: 74 }, (_, index) => ({
  left: 8 + (index / 73) * 84 + Math.sin(index * 2.1) * 5,
  top: 18 + (index / 73) * 60 + Math.sin(index * .83) * 14,
  phase: index / 73,
}))
const sendTimelineFrame = (frame: number) => {
  if (frame === lastTimelineFrame) return
  lastTimelineFrame = frame
  lastTimelineDispatch = performance.now()
  controller?.setTimeline(frame)
}
const commitTimeline = (force = true) => {
  const frame = Math.round(timelineSeconds.value / 120)
  const elapsed = performance.now() - lastTimelineDispatch
  window.clearTimeout(timelineThrottleTimer)
  if (force || elapsed >= 200) {
    sendTimelineFrame(frame)
    return
  }
  timelineThrottleTimer = window.setTimeout(() => sendTimelineFrame(Math.round(timelineSeconds.value / 120)), 200 - elapsed)
}
const onTimelineInput = (event: Event) => {
  timelineSeconds.value = Number((event.target as HTMLInputElement).value)
  commitTimeline(false)
}
const onTimelineCommit = () => commitTimeline(true)
const stepTime = (direction: number) => {
  timelineSeconds.value = (timelineSeconds.value + direction * 120 + MAX_TIMELINE_SECONDS + 120) % (MAX_TIMELINE_SECONDS + 120)
  commitTimeline()
}
const selectHour = (index: number) => { timelineSeconds.value = index * 3600; commitTimeline() }
const stopPlayback = () => { playing.value = false; window.clearInterval(playbackTimer) }
const togglePlayback = () => {
  if (playing.value) { stopPlayback(); return }
  playing.value = true
  playbackTimer = window.setInterval(() => stepTime(1), 1500)
}
const selectToolMode = (mode: 'radar' | 'heatmap' | 'track') => {
  toolMode.value = mode
  controller?.setLayerMode(mode)
}
const selectHeatmapAnalysis = (mode: 'strength' | 'density') => {
  heatmapAnalysis.value = mode
  controller?.setHeatmapAnalysis(mode)
}

onMounted(() => {
  controller = createChinaMap(
    mapHost.value!,
    () => undefined,
    (message) => console.error('[china-map]', message),
  )
})
onBeforeUnmount(() => { stopPlayback(); window.clearTimeout(timelineThrottleTimer); controller?.dispose() })
</script>

<template>
  <main class="china-map-page" :class="{ 'is-track-mode': toolMode === 'track' }">
    <div ref="mapHost" class="map-host" aria-label="中国态势地图"></div>
    <div class="vignette" aria-hidden="true"></div>
    <header class="command-header">
      <div class="brand"><i>ϟ</i><strong>雷电防护系统</strong></div>
      <span class="header-divider"></span>
      <nav><button class="is-active">实时监测</button><button>设备管理</button></nav>
      <div class="account">
        <button class="avatar" aria-label="用户菜单" @click="avatarOpen = !avatarOpen"><span>●</span></button>
        <div v-if="avatarOpen" class="account-menu"><button>个人中心</button><button>退出登录</button></div>
      </div>
    </header>

    <aside class="tool-rail" :class="{ 'is-expanded': toolsExpanded }" @mouseenter="toolsExpanded = true" @mouseleave="toolsExpanded = false">
      <button data-label="雷达云图" :class="{ 'is-active': toolMode === 'radar' }" @click="selectToolMode('radar')">
        <i class="mode-icon"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="M8.5 23.5h15.2a5.3 5.3 0 0 0 .4-10.6A8.7 8.7 0 0 0 7.7 11a6.3 6.3 0 0 0 .8 12.5Z"/><path class="signal" d="M7 17.2c2.5-2.3 5.2-3.4 8.3-3.4m-5.1 5.7c1.8-1.5 3.8-2.1 6-1.9"/></svg></i>
        <span class="mode-copy"><strong>雷达云图</strong><small>查看雷达回波和云层分布</small></span>
      </button>
      <button data-label="雷电热力分析" :class="{ 'is-active': toolMode === 'heatmap' }" @click="selectToolMode('heatmap')">
        <i class="mode-icon mode-icon--bolt"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="m18.7 3-9 15h7l-2.2 11 9-15h-7L18.7 3Z"/></svg></i>
        <span class="mode-copy"><strong>雷电热力分析</strong><small>雷电强度 / 密度分析</small></span>
      </button>
      <button data-label="雷暴移动轨迹" :class="{ 'is-active': toolMode === 'track' }" @click="selectToolMode('track')">
        <i class="mode-icon mode-icon--track"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="M7 22c3.4-8.4 7.3-12.2 12-9.6 3.8 2.1 2.4 6.8-1.1 8.5-3.4 1.6-6.1-.8-4.7-3.2 1.3-2.2 5.1-.8 7.5 1.4"/><path class="arrow" d="m19 15 5 5-6.4 2.2"/><circle cx="7" cy="22" r="2"/></svg></i>
        <span class="mode-copy"><strong>雷暴移动轨迹</strong><small>查看雷暴演变和移动路径</small></span>
      </button>
    </aside>

    <Transition name="analysis-panel">
      <section v-if="toolMode === 'heatmap'" class="heatmap-analysis" :class="{ 'is-shifted': toolsExpanded }" aria-label="雷电热力分析模式">
        <header><i>ϟ</i><strong>雷电热力分析</strong><small>ANALYSIS</small></header>
        <button :class="{ 'is-active': heatmapAnalysis === 'strength' }" @click="selectHeatmapAnalysis('strength')">
          <i>ϟ</i><span><strong>雷电强度</strong><small>单次雷击能量 · kA</small></span><em></em>
        </button>
        <button :class="{ 'is-active': heatmapAnalysis === 'density' }" @click="selectHeatmapAnalysis('density')">
          <i>▥</i><span><strong>雷电密度</strong><small>区域单位时间雷击次数</small></span><em></em>
        </button>
      </section>
    </Transition>

    <Transition name="legend-fade">
      <aside v-if="toolMode === 'heatmap'" class="heatmap-legend">
        <header>{{ heatmapAnalysis === 'strength' ? '雷电强度' : '雷击密度' }}<small>{{ heatmapAnalysis === 'strength' ? 'kA' : '次 / 10min' }}</small></header>
        <div :class="['legend-ramp', `is-${heatmapAnalysis}`]"></div>
        <div v-if="heatmapAnalysis === 'strength'" class="legend-labels"><span>0</span><span>30</span><span>60</span><span>100+</span></div>
        <div v-else class="legend-labels"><span>少</span><span>一般</span><span>集中</span><span>多</span></div>
      </aside>
    </Transition>

    <Transition name="track-panel">
      <aside v-if="toolMode === 'track'" class="storm-analysis">
        <header><span><i>➤</i><strong>雷暴移动轨迹分析</strong></span><em>LIVE ANALYSIS</em></header>
        <nav>
          <button :class="{ 'is-active': trackTab === 'distribution' }" @click="trackTab = 'distribution'">时空分布</button>
          <button :class="{ 'is-active': trackTab === 'movement' }" @click="trackTab = 'movement'">移动轨迹</button>
          <button :class="{ 'is-active': trackTab === 'lifecycle' }" @click="trackTab = 'lifecycle'">生命周期</button>
        </nav>
        <section class="track-mini-map">
          <div class="track-mini-map__grid"></div>
          <i v-for="(strike, index) in miniStrikes" :key="index" :style="{ left: `${strike.left}%`, top: `${strike.top}%`, '--phase': strike.phase }"></i>
          <svg viewBox="0 0 260 118" preserveAspectRatio="none"><path d="M22 27 C72 36 96 61 139 69 S207 77 242 101"/><path class="is-future" d="M170 79 C204 87 225 97 248 108"/></svg>
          <span>08:00</span><span>12:00</span><span>16:00</span>
        </section>
        <div class="storm-analysis__title"><strong>当前雷暴单体</strong><small>STORM CELL A-01</small></div>
        <dl>
          <div><dt>中心位置</dt><dd>{{ trackStats.lng }}°E · {{ trackStats.lat }}°N</dd></div>
          <div><dt>最大回波</dt><dd class="is-danger">{{ trackStats.dbz }} dBZ</dd></div>
          <div><dt>移动方向</dt><dd>东南 · 122°</dd></div>
          <div><dt>移动速度</dt><dd>{{ trackStats.speed }} km/h</dd></div>
          <div><dt>闪电次数</dt><dd>{{ trackStats.count.toLocaleString() }} 次</dd></div>
          <div><dt>影响矿区</dt><dd>{{ trackStats.mines }} 个</dd></div>
        </dl>
        <footer><span>预计影响</span><strong>{{ trackStats.dbz >= 50 ? '2小时30分钟' : '1小时20分钟' }}</strong></footer>
      </aside>
    </Transition>

    <Transition name="trend-panel">
      <section v-if="toolMode === 'track'" class="storm-trend">
        <header><strong>闪电活动趋势</strong><span><i class="outer"></i>200 km 范围<i class="inner"></i>100 km 范围</span></header>
        <div class="storm-trend__chart">
          <div class="storm-trend__axis"><span>150</span><span>100</span><span>50</span><span>0</span></div>
          <div class="storm-trend__bars">
            <i v-for="(bar, index) in trendBars" :key="index" :class="{ 'is-future': !bar.active }" :style="{ '--outer': `${bar.outer}%`, '--inner': `${bar.inner}%` }"><b></b><em></em></i>
          </div>
          <div class="storm-trend__labels"><span>08:00</span><span>10:00</span><span>12:00</span><span>14:00</span><span>16:00</span></div>
        </div>
      </section>
    </Transition>

    <section class="timeline-panel" aria-label="态势时间控制">
      <label class="date-control"><i>▦</i><input v-model="selectedDate" type="date" aria-label="选择日期"></label>
      <span class="timeline-divider"></span>
      <button class="step-button" aria-label="上一个时刻" @click="stepTime(-1)">‹</button>
      <button class="play-button" :class="{ 'is-playing': playing }" :aria-label="playing ? '暂停播放' : '开始播放'" @click="togglePlayback">{{ playing ? 'Ⅱ' : '▶' }}</button>
      <button class="step-button" aria-label="下一个时刻" @click="stepTime(1)">›</button>
      <div class="time-track">
        <div class="time-track__line"><span :style="{ width: `${timelineProgress}%` }"></span></div>
        <input class="time-track__range" type="range" min="0" :max="MAX_TIMELINE_SECONDS" step="1" :value="timelineSeconds" aria-label="选择精确时间" @input="onTimelineInput" @change="onTimelineCommit" @pointerup="onTimelineCommit">
        <em class="time-bubble" :style="{ left: `${timelineProgress}%` }">{{ currentTimeLabel }}</em>
        <button v-for="(time, index) in hourTicks" :key="time" class="time-tick" :class="{ 'is-active': Math.abs(timelineSeconds - index * 3600) < 60 }" :style="{ left: `${index / (hourTicks.length - 1) * 100}%` }" @click="selectHour(index)">
          <i></i><small>{{ time }}</small>
        </button>
      </div>
      <button class="speed-button">1x⌄</button>
    </section>
  </main>
</template>

<style scoped>
.china-map-page, .map-host, .vignette { position: fixed; inset: 0; }
.china-map-page {
  --glass-deep:rgba(8,32,56,.62);
  --glass-deep-soft:rgba(10,35,60,.55);
  --glass-border:rgba(100,200,255,.25);
  --ice:#5fd7ff;
  --tech-blue:#1688ff;
  --ambient:rgba(0,150,255,.15);
  --primary-blue:#1688ff;
  --light-blue:#5fd7ff;
  --panel-bg:rgba(10,35,60,.55);
  --text-primary:rgba(255,255,255,.9);
  --text-secondary:rgba(255,255,255,.55);
  overflow: hidden;
  background:
    linear-gradient(rgba(121, 151, 157, .045) 1px, transparent 1px),
    linear-gradient(90deg, rgba(121, 151, 157, .045) 1px, transparent 1px),
    radial-gradient(circle at 50% 42%, #fbfdfd 0%, #e8f0f2 56%, #d7e3e6 100%);
  background-size: 80px 80px, 80px 80px, auto;
  color: #4d5456;
  font-family: "Microsoft YaHei UI", "PingFang SC", "Noto Sans CJK SC", "Source Han Sans SC", system-ui, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;
}
.map-host { background: transparent; }
.command-header {
  position:absolute; z-index:20; left:0; right:0; top:0; height:56px; display:flex; align-items:center; gap:24px; padding:0 28px; box-sizing:border-box;
  border-bottom:1px solid rgba(159,220,250,.34); border-radius:0 0 14px 14px;
  background:linear-gradient(90deg,rgba(242,251,255,.18),rgba(229,245,252,.13),rgba(210,235,248,.08));
  box-shadow:0 3px 10px rgba(5,42,72,.055),inset 0 -1px rgba(104,196,241,.08);
  backdrop-filter:blur(6px) saturate(.96) brightness(1.02); color:#12304f;
}
.command-header::before { content:""; position:absolute; z-index:0; inset:0 auto 0 0; width:610px; border-radius:0 0 45% 14px; background:linear-gradient(90deg,rgba(240,250,254,.3) 0%,rgba(232,246,252,.2) 58%,rgba(226,242,250,.08) 82%,transparent 100%); pointer-events:none; }
.command-header > * { position:relative; z-index:1; }
.brand { display:flex; align-items:center; gap:10px; white-space:nowrap; }
.brand i { display:grid; width:27px; height:32px; place-items:center; color:#1687ff; background:rgba(255,255,255,.92); clip-path:polygon(50% 0,92% 15%,84% 75%,50% 100%,16% 75%,8% 15%); font-size:20px; font-style:normal; font-weight:900; filter:drop-shadow(0 4px 7px rgba(25,115,194,.22)); }
.brand strong { color:#0b3155; font-family:"Microsoft YaHei UI","PingFang SC","Noto Sans CJK SC","Source Han Sans SC",system-ui,sans-serif; font-size:18px; font-weight:700; line-height:1; letter-spacing:.07em; text-shadow:0 1px 0 rgba(255,255,255,.7); }
.header-divider { width:1px; height:22px; background:rgba(32,76,108,.22); }
.command-header nav { display:flex; align-self:stretch; gap:10px; }
.command-header nav button { position:relative; min-width:92px; border:0; color:rgba(15,48,72,.8); background:transparent; font-family:inherit; font-size:14px; font-weight:500; line-height:1; letter-spacing:.035em; text-shadow:0 1px 0 rgba(255,255,255,.62); cursor:pointer; }
.command-header nav button.is-active { color:#087fdc; font-weight:600; text-shadow:0 1px 0 rgba(255,255,255,.72); }
.command-header nav button.is-active::after { content:""; position:absolute; left:12px; right:12px; bottom:0; height:2px; background:#2097ff; box-shadow:0 0 9px #39a5ff; }
.account { position:relative; margin-left:auto; }
.avatar { display:grid; width:31px; height:31px; place-items:center; border:1px solid rgba(255,255,255,.68); border-radius:50%; color:#fff; background:linear-gradient(145deg,#57afff,#187ce3); box-shadow:0 4px 12px rgba(20,115,205,.24); cursor:pointer; }
.avatar span { transform:translateY(-1px); font-size:13px; }
.account-menu { position:absolute; right:0; top:39px; width:105px; padding:5px; border:1px solid rgba(255,255,255,.4); border-radius:8px; background:rgba(235,246,252,.92); box-shadow:0 10px 24px rgba(13,49,72,.2); backdrop-filter:blur(16px); }
.account-menu button { width:100%; padding:8px; border:0; border-radius:5px; color:#27475f; background:transparent; text-align:left; cursor:pointer; }
.account-menu button:hover { background:rgba(43,145,234,.1); }
.tool-rail { position:absolute; z-index:16; left:22px; top:104px; display:flex; width:56px; height:156px; flex-direction:column; gap:2px; padding:4px; box-sizing:border-box; overflow:visible; border:1px solid var(--glass-border); border-radius:17px; background:linear-gradient(160deg,var(--glass-deep),rgba(7,27,49,.52)); box-shadow:0 14px 34px rgba(4,24,42,.28),inset 0 1px rgba(255,255,255,.09),0 0 30px var(--ambient); backdrop-filter:blur(20px) saturate(1.15); transition:width .3s cubic-bezier(.2,.78,.2,1),box-shadow .3s ease; }
.tool-rail::before,.tool-rail::after { content:""; position:absolute; left:-2px; width:3px; height:3px; border-radius:50%; background:#8bd7ff; box-shadow:0 0 7px 2px #35aef6; opacity:.7; }.tool-rail::before { top:24px; }.tool-rail::after { bottom:24px; }
.tool-rail.is-expanded { width:220px; box-shadow:0 17px 42px rgba(3,22,40,.34),inset 0 1px rgba(255,255,255,.11),0 0 32px rgba(0,150,255,.16); }
.tool-rail > button { position:relative; display:flex; width:48px; height:48px; flex:none; align-items:center; gap:10px; padding:0; overflow:visible; border:1px solid transparent; border-radius:12px; color:rgba(218,237,248,.68); background:transparent; text-align:left; white-space:nowrap; cursor:pointer; transition:width .3s cubic-bezier(.2,.78,.2,1),background .22s ease,border-color .22s ease,box-shadow .22s ease; }
.tool-rail.is-expanded > button { width:210px; }
.tool-rail > button::after { content:attr(data-label); position:absolute; z-index:3; left:61px; top:50%; padding:8px 11px; transform:translate(-8px,-50%); border:1px solid rgba(101,191,242,.28); border-radius:8px; color:#edf9ff; background:rgba(7,34,57,.88); box-shadow:0 9px 22px rgba(2,20,35,.28),0 0 14px rgba(31,147,229,.12); backdrop-filter:blur(14px); font-size:10px; font-weight:650; letter-spacing:.04em; opacity:0; pointer-events:none; transition:opacity .18s ease,transform .18s ease; }
.tool-rail:not(.is-expanded) > button:hover::after { opacity:1; transform:translate(0,-50%); }
.tool-rail > button:hover { color:#fff; background:rgba(38,129,193,.1); }
.tool-rail > button.is-active { color:#fff; border-color:rgba(95,215,255,.3); background:linear-gradient(110deg,rgba(0,140,255,.24),rgba(31,113,182,.07)); box-shadow:inset 2px 0 var(--ice),inset 0 1px rgba(255,255,255,.08),0 0 16px rgba(22,136,255,.18); }
.mode-icon { display:grid; width:46px; height:46px; flex:none; place-items:center; border-radius:11px; font-style:normal; transition:background .25s ease,filter .25s ease; }
.mode-icon svg { width:26px; height:26px; overflow:visible; fill:none; stroke:currentColor; stroke-width:1.8; stroke-linecap:round; stroke-linejoin:round; filter:drop-shadow(0 0 4px rgba(101,196,246,.22)); }.mode-icon svg .signal { stroke-width:1.2; opacity:.75; }.mode-icon--bolt svg { width:25px; height:27px; fill:currentColor; stroke:none; }.mode-icon--track svg .arrow { stroke-width:2.3; }.mode-icon--track svg circle { fill:currentColor; stroke:none; }
.tool-rail > button.is-active .mode-icon { color:#fff; background:linear-gradient(145deg,rgba(51,169,247,.72),rgba(24,108,190,.54)); box-shadow:0 0 14px rgba(46,161,239,.28),inset 0 1px rgba(255,255,255,.13); }
.mode-copy { display:flex; min-width:0; flex-direction:column; gap:3px; opacity:0; transform:translateX(-10px); pointer-events:none; transition:opacity .25s .03s ease,transform .3s cubic-bezier(.2,.78,.2,1); }
.tool-rail.is-expanded .mode-copy { opacity:1; transform:none; }
.mode-copy strong { color:inherit; font-size:11px; letter-spacing:.04em; }.mode-copy small { color:rgba(190,218,234,.48); font-size:7px; letter-spacing:.02em; }
.heatmap-analysis { position:absolute; z-index:13; left:83px; top:151px; width:190px; padding:11px; box-sizing:border-box; border:1px solid rgba(145,207,244,.24); border-radius:15px; color:#eaf7ff; background:linear-gradient(145deg,rgba(8,34,58,.84),rgba(9,28,50,.7)); box-shadow:0 15px 38px rgba(2,20,36,.34),inset 0 1px rgba(255,255,255,.1),0 0 22px rgba(32,139,231,.1); backdrop-filter:blur(20px) saturate(1.16); transition:left .24s ease; }
.heatmap-analysis.is-shifted { left:253px; }
.heatmap-analysis::before { content:""; position:absolute; left:-8px; top:29px; width:8px; height:1px; background:linear-gradient(90deg,rgba(66,164,234,.08),#55b7ff); box-shadow:0 0 7px #37a6f6; }
.heatmap-analysis > header { display:flex; height:28px; align-items:center; gap:7px; padding:0 3px 7px; border-bottom:1px solid rgba(154,209,239,.13); }
.heatmap-analysis > header i { display:grid; width:22px; height:22px; place-items:center; border-radius:6px; color:#fff; background:linear-gradient(145deg,#48b4ff,#167ee7); box-shadow:0 0 11px rgba(54,166,252,.42); font-style:normal; }
.heatmap-analysis > header strong { font-size:12px; letter-spacing:.08em; }
.heatmap-analysis > header small { margin-left:auto; color:rgba(115,196,247,.54); font-size:6px; letter-spacing:.16em; }
.heatmap-analysis > button { position:relative; display:flex; width:100%; height:48px; align-items:center; gap:8px; margin-top:7px; padding:0 9px; overflow:hidden; border:1px solid transparent; border-radius:9px; color:rgba(218,237,248,.68); background:rgba(255,255,255,.025); text-align:left; cursor:pointer; transition:.25s ease; }
.heatmap-analysis > button > i { display:grid; width:27px; height:27px; flex:none; place-items:center; border-radius:7px; color:#70b7e4; background:rgba(61,139,193,.12); font-size:15px; font-style:normal; }
.heatmap-analysis > button span { display:flex; min-width:0; flex-direction:column; gap:3px; }
.heatmap-analysis > button strong { color:inherit; font-size:11px; }
.heatmap-analysis > button small { overflow:hidden; color:rgba(185,214,231,.48); font-size:7px; text-overflow:ellipsis; white-space:nowrap; }
.heatmap-analysis > button em { width:9px; height:9px; margin-left:auto; flex:none; border:1px solid rgba(138,192,224,.45); border-radius:50%; box-shadow:inset 0 0 0 2px rgba(7,27,45,.86); }
.heatmap-analysis > button.is-active { border-color:rgba(66,165,239,.32); color:#fff; background:linear-gradient(110deg,rgba(32,139,230,.38),rgba(31,94,151,.16)); box-shadow:inset 0 1px rgba(255,255,255,.08),0 0 15px rgba(24,135,224,.13); }
.heatmap-analysis > button.is-active > i { color:#fff; background:linear-gradient(145deg,#4ab9ff,#147ce4); box-shadow:0 0 10px rgba(43,159,245,.4); }
.heatmap-analysis > button.is-active em { border-color:#67c4ff; background:#45adf7; box-shadow:inset 0 0 0 2px #123c5d,0 0 7px #48b5ff; }
.analysis-panel-enter-active,.analysis-panel-leave-active { transition:opacity .24s ease,transform .24s ease; }
.analysis-panel-enter-from,.analysis-panel-leave-to { opacity:0; transform:translateX(-8px) scale(.98); }
.heatmap-legend { position:absolute; z-index:12; right:22px; bottom:251px; width:168px; padding:11px 12px 9px; box-sizing:border-box; border:1px solid rgba(134,200,237,.27); border-radius:11px; color:#e9f7ff; background:linear-gradient(135deg,rgba(7,35,59,.8),rgba(9,28,48,.69)); box-shadow:0 12px 30px rgba(2,19,33,.3),inset 0 1px rgba(255,255,255,.1); backdrop-filter:blur(17px); }
.heatmap-legend header { display:flex; align-items:baseline; justify-content:space-between; margin-bottom:8px; font-size:10px; font-weight:700; letter-spacing:.08em; }
.heatmap-legend header small { color:rgba(201,228,243,.55); font-size:7px; font-weight:500; }
.legend-ramp { height:9px; border-radius:5px; box-shadow:0 0 9px rgba(36,168,231,.25); }
.legend-ramp.is-strength { background:linear-gradient(90deg,#3268d6,#22b9bc,#42d76c,#f5db35,#ff7f25,#eb2f38); }
.legend-ramp.is-density { background:linear-gradient(90deg,#2088b4,#25bd9a,#69d95a,#f6da3c,#ff7c25,#e82938); }
.legend-labels { display:flex; justify-content:space-between; margin-top:5px; color:rgba(221,239,248,.66); font-size:7px; }
.legend-fade-enter-active,.legend-fade-leave-active { transition:opacity .3s ease,transform .3s ease; }
.legend-fade-enter-from,.legend-fade-leave-to { opacity:0; transform:translateY(6px); }
.storm-analysis { position:absolute; z-index:14; right:22px; top:78px; width:300px; padding:12px; box-sizing:border-box; border:1px solid rgba(62,161,224,.32); border-radius:13px; color:#e7f5ff; background:linear-gradient(145deg,rgba(5,31,55,.9),rgba(7,25,46,.8)); box-shadow:0 18px 45px rgba(1,17,31,.38),inset 0 1px rgba(255,255,255,.11),0 0 24px rgba(24,135,223,.11); backdrop-filter:blur(21px) saturate(1.16); }
.storm-analysis > header { display:flex; align-items:center; justify-content:space-between; padding:1px 1px 10px; }
.storm-analysis > header span { display:flex; align-items:center; gap:7px; }
.storm-analysis > header i { display:grid; width:24px; height:24px; place-items:center; border-radius:7px; color:#fff; background:linear-gradient(145deg,#53b9ff,#227edc); box-shadow:0 0 11px rgba(43,155,242,.42); font-style:normal; }
.storm-analysis > header strong { font-size:13px; letter-spacing:.07em; }
.storm-analysis > header em { color:rgba(83,183,246,.58); font-size:6px; font-style:normal; letter-spacing:.13em; }
.storm-analysis > nav { display:grid; grid-template-columns:repeat(3,1fr); margin:0 -5px 10px; padding:3px; border-radius:8px; background:rgba(7,23,40,.42); }
.storm-analysis > nav button { height:29px; border:0; border-radius:6px; color:rgba(205,227,240,.58); background:transparent; font:600 9px inherit; cursor:pointer; }
.storm-analysis > nav button.is-active { color:#fff; background:linear-gradient(110deg,rgba(42,157,240,.78),rgba(35,108,179,.5)); box-shadow:0 0 12px rgba(39,153,237,.25),inset 0 1px rgba(255,255,255,.12); }
.track-mini-map { position:relative; height:118px; overflow:hidden; border:1px solid rgba(117,190,229,.2); border-radius:8px; background:linear-gradient(145deg,rgba(30,73,96,.58),rgba(8,38,62,.76)); box-shadow:inset 0 0 24px rgba(0,0,0,.32); }
.track-mini-map__grid { position:absolute; inset:0; opacity:.18; background-image:linear-gradient(rgba(128,205,241,.26) 1px,transparent 1px),linear-gradient(90deg,rgba(128,205,241,.26) 1px,transparent 1px); background-size:28px 28px; }
.track-mini-map > i { position:absolute; z-index:2; width:3px; height:3px; transform:translate(-50%,-50%); border-radius:50%; background:hsl(calc(48deg - var(--phase) * 270deg) 92% 59%); box-shadow:0 0 5px currentColor; }
.track-mini-map svg { position:absolute; z-index:3; inset:0; width:100%; height:100%; overflow:visible; }
.track-mini-map path { fill:none; stroke:#fff5c2; stroke-width:1.7; filter:drop-shadow(0 0 3px #ff8e3b); }
.track-mini-map path.is-future { stroke:#ba83ff; stroke-dasharray:4 4; }
.track-mini-map > span { position:absolute; z-index:4; bottom:5px; color:rgba(225,241,249,.6); font-size:6px; }
.track-mini-map > span:nth-of-type(1) { left:7px; }.track-mini-map > span:nth-of-type(2) { left:47%; }.track-mini-map > span:nth-of-type(3) { right:7px; }
.storm-analysis__title { display:flex; align-items:baseline; justify-content:space-between; margin-top:11px; padding:0 2px 7px; border-bottom:1px solid rgba(133,195,228,.13); }
.storm-analysis__title strong { font-size:10px; }.storm-analysis__title small { color:rgba(116,186,225,.45); font-size:6px; letter-spacing:.1em; }
.storm-analysis dl { display:grid; grid-template-columns:1fr 1fr; gap:0; margin:0; }
.storm-analysis dl div { display:flex; min-width:0; flex-direction:column; gap:4px; padding:8px 3px 7px; border-bottom:1px solid rgba(125,187,220,.09); }
.storm-analysis dt { color:rgba(190,218,234,.5); font-size:7px; }.storm-analysis dd { margin:0; overflow:hidden; color:#e9f7ff; font-size:9px; font-weight:650; text-overflow:ellipsis; white-space:nowrap; }.storm-analysis dd.is-danger { color:#ff6b71; text-shadow:0 0 7px rgba(255,73,83,.38); }
.storm-analysis footer { display:flex; align-items:center; justify-content:space-between; margin-top:8px; padding:8px 9px; border:1px solid rgba(255,165,76,.18); border-radius:7px; background:linear-gradient(90deg,rgba(244,119,47,.1),rgba(255,65,79,.08)); font-size:8px; }
.storm-analysis footer span { color:rgba(218,231,238,.58); }.storm-analysis footer strong { color:#ffcc80; font-size:10px; }
.track-panel-enter-active,.track-panel-leave-active { transition:opacity .32s ease,transform .32s ease; }.track-panel-enter-from,.track-panel-leave-to { opacity:0; transform:translateX(12px); }
.storm-trend { position:absolute; z-index:13; right:22px; bottom:87px; left:22px; height:119px; padding:9px 13px 7px; box-sizing:border-box; border:1px solid rgba(70,166,228,.28); border-radius:13px; color:#e6f5ff; background:linear-gradient(115deg,rgba(6,35,59,.82),rgba(8,29,51,.68)); box-shadow:0 13px 38px rgba(2,21,37,.33),inset 0 1px rgba(255,255,255,.1); backdrop-filter:blur(18px); }
.storm-trend > header { display:flex; height:18px; align-items:center; justify-content:space-between; }
.storm-trend > header strong { font-size:10px; letter-spacing:.08em; }.storm-trend > header span { display:flex; align-items:center; gap:5px; color:rgba(210,232,244,.58); font-size:7px; }.storm-trend > header i { width:7px; height:7px; margin-left:7px; border-radius:1px; }.storm-trend > header i.outer { background:#2b9bf1; }.storm-trend > header i.inner { background:#ff5662; }
.storm-trend__chart { position:relative; height:81px; margin-left:25px; border-left:1px solid rgba(163,209,234,.16); border-bottom:1px solid rgba(163,209,234,.16); background:repeating-linear-gradient(0deg,rgba(149,202,231,.08) 0 1px,transparent 1px 22px); }
.storm-trend__axis { position:absolute; right:calc(100% + 6px); top:-2px; bottom:-1px; display:flex; flex-direction:column; justify-content:space-between; color:rgba(198,225,239,.45); font-size:6px; }
.storm-trend__bars { position:absolute; inset:3px 3px 0; display:flex; align-items:flex-end; gap:1px; }
.storm-trend__bars > i { position:relative; height:100%; flex:1; opacity:.92; }.storm-trend__bars > i b,.storm-trend__bars > i em { position:absolute; right:0; bottom:0; left:0; border-radius:1px 1px 0 0; }.storm-trend__bars > i b { height:var(--outer); background:linear-gradient(#38adff,#176fc3); box-shadow:0 0 4px rgba(43,156,240,.38); }.storm-trend__bars > i em { height:var(--inner); background:linear-gradient(#ff7977,#e83b4e); }.storm-trend__bars > i.is-future { opacity:.2; filter:saturate(.3); }
.storm-trend__labels { position:absolute; top:calc(100% + 3px); right:0; left:0; display:flex; justify-content:space-between; color:rgba(204,228,240,.52); font-size:6px; }
.trend-panel-enter-active,.trend-panel-leave-active { transition:opacity .3s ease,transform .3s ease; }.trend-panel-enter-from,.trend-panel-leave-to { opacity:0; transform:translateY(8px); }
.timeline-panel { position:absolute; z-index:15; left:50%; bottom:24px; display:flex; width:min(760px,calc(100vw - 180px)); height:56px; align-items:center; gap:8px; padding:0 14px; box-sizing:border-box; transform:translateX(-50%); border:1px solid var(--glass-border); border-radius:17px; color:#fff; background:linear-gradient(110deg,var(--glass-deep-soft),rgba(8,30,54,.5)); box-shadow:0 10px 34px rgba(3,30,53,.32),inset 0 1px rgba(255,255,255,.1),0 0 30px var(--ambient); backdrop-filter:blur(20px) saturate(1.12); }
.date-control { display:flex; flex:none; height:34px; align-items:center; gap:7px; padding:0 9px; border:1px solid rgba(116,203,255,.12); border-radius:8px; background:rgba(8,31,53,.42); box-shadow:inset 0 1px rgba(255,255,255,.05); }
.date-control i { color:#4bb5ff; font-size:17px; font-style:normal; }
.date-control input { width:126px; border:0; outline:0; color:#edf8ff; background:transparent; font:600 11px inherit; color-scheme:dark; }
.timeline-divider { width:1px; height:26px; background:rgba(181,222,246,.18); }
.step-button,.play-button,.speed-button { flex:none; border:0; color:#eafbff; background:rgba(255,255,255,.08); cursor:pointer; }
.step-button { width:29px; height:29px; border-radius:50%; font-size:20px; }
.play-button { width:44px; height:44px; border-radius:50%; background:linear-gradient(145deg,#38a5ff,var(--tech-blue)); box-shadow:0 0 20px rgba(22,136,255,.5),inset 0 1px rgba(255,255,255,.28); font-size:13px; }
.play-button.is-playing { background:linear-gradient(145deg,#56b8ff,#126fd1); }
.time-track { position:relative; height:46px; flex:1; min-width:220px; }
.time-track__line { position:absolute; left:0; right:0; top:20px; height:2px; background:rgba(206,234,250,.35); }
.time-track__line span { display:block; height:100%; background:#48acff; box-shadow:0 0 8px #48acff; transition:width .45s ease; }
.time-track__range { position:absolute; z-index:3; left:-4px; right:-4px; top:8px; width:calc(100% + 8px); height:25px; margin:0; opacity:0; cursor:ew-resize; }
.time-bubble { position:absolute; z-index:4; bottom:35px; padding:3px 7px; transform:translateX(-50%); border-radius:5px; color:#fff; background:#258ff0; box-shadow:0 0 10px rgba(38,146,239,.5); font-size:9px; font-style:normal; pointer-events:none; }
.time-tick { position:absolute; top:15px; width:38px; height:31px; padding:0; transform:translateX(-50%); border:0; color:rgba(255,255,255,.55); background:transparent; cursor:pointer; }
.time-tick i { display:block; width:6px; height:6px; margin:2px auto 8px; border:1px solid rgba(224,243,252,.86); border-radius:50%; background:#dff5ff; box-shadow:0 0 4px rgba(111,195,255,.5); }
.time-tick small { font-size:8px; }
.time-tick.is-active { color:var(--ice); font-weight:700; text-shadow:0 0 8px rgba(95,215,255,.55); }
.time-tick.is-active i { width:8px; height:8px; margin-top:1px; margin-bottom:7px; border-color:#dffaff; background:var(--ice); box-shadow:0 0 9px 2px rgba(95,215,255,.8); }
.speed-button { width:48px; height:31px; border:1px solid rgba(116,203,255,.13); border-radius:15px; background:rgba(8,31,53,.38); font-size:10px; }
.vignette {
  z-index: 3;
  pointer-events: none;
  box-shadow:inset 0 0 100px 14px rgba(8,38,65,.055);
  background:
    radial-gradient(ellipse at 50% 46%,transparent 58%,rgba(20,60,100,.045) 100%);
}
:deep(.maplibregl-ctrl-bottom-right) { z-index: 4; right: 18px; bottom: 18px; }
:deep(.maplibregl-ctrl-top-right) { z-index:11; top:68px; }
.is-track-mode :deep(.maplibregl-ctrl-top-right),.is-track-mode :deep(.south-sea-inset) { opacity:0; pointer-events:none; transform:translateY(6px); }
:deep(.maplibregl-ctrl-group) {
  overflow: hidden;
  border: 1px solid var(--glass-border);
  border-radius: 10px;
  background:var(--glass-deep-soft);
  box-shadow:0 10px 30px rgba(3,25,44,.26),0 0 18px var(--ambient);
  backdrop-filter:blur(18px);
}
:deep(.maplibregl-ctrl-group button) { width:40px; height:40px; border-color:rgba(112,204,255,.13); background-color:transparent; }
:deep(.maplibregl-ctrl-group button:hover) { background-color:rgba(0,140,255,.18); }
:deep(.maplibregl-ctrl-icon) { filter:invert(88%) sepia(23%) saturate(1070%) hue-rotate(167deg) brightness(109%); opacity:.82; }
:deep(.lightning-demo-control) { margin:16px 16px 0 0 !important; }
:deep(.lightning-demo-control__button) { display:flex; align-items:center; gap:7px; height:36px; padding:0 10px; border:1px solid var(--glass-border); border-radius:9px; color:#eaf8ff; background:var(--glass-deep-soft); box-shadow:0 7px 22px rgba(3,25,44,.24),0 0 16px var(--ambient); backdrop-filter:blur(18px); cursor:pointer; }
:deep(.lightning-demo-control__button i) { width:6px; height:6px; border-radius:50%; background:#87979a; transition:.2s ease; }
:deep(.lightning-demo-control__button span) { font-size:11px; font-weight:600; letter-spacing:.06em; }
:deep(.lightning-demo-control__button em) { color:#87979a; font-size:8px; font-style:normal; font-weight:700; letter-spacing:.08em; }
:deep(.lightning-demo-control__button.is-active) { border-color:rgba(95,215,255,.38); color:#fff; background:linear-gradient(120deg,rgba(7,42,70,.75),rgba(8,31,55,.62)); }
:deep(.lightning-demo-control__button.is-active i) { background:#f5ad31; box-shadow:0 0 7px 2px rgba(245,173,49,.48); animation:demo-status 1.5s ease-in-out infinite; }
:deep(.lightning-demo-control__button.is-active em) { color:#c68119; }
@keyframes demo-status { 50% { opacity:.45; box-shadow:0 0 3px 1px rgba(245,173,49,.28); } }
:deep(.mine-overview-control) { margin:9px 16px 0 0 !important; }
:deep(.mine-overview-control__button) { display:flex; align-items:center; gap:7px; height:36px; padding:0 10px; border:1px solid var(--glass-border); border-radius:9px; color:#eaf8ff; background:var(--glass-deep-soft); box-shadow:0 7px 22px rgba(3,25,44,.24),inset 0 1px rgba(255,255,255,.06),0 0 16px var(--ambient); backdrop-filter:blur(18px); cursor:pointer; transition:transform .2s ease,box-shadow .2s ease,filter .2s ease; }
:deep(.mine-overview-control__button:hover) { transform:translateY(-1px); filter:brightness(1.04); box-shadow:0 9px 25px rgba(36,58,63,.17),0 0 13px rgba(83,169,150,.16); }
:deep(.mine-overview-control__button > i) { position:relative; width:13px; height:13px; border:1.5px solid #579f8f; border-radius:3px; box-shadow:0 0 5px rgba(74,157,139,.25); }
:deep(.mine-overview-control__button > i::before), :deep(.mine-overview-control__button > i::after) { content:""; position:absolute; background:#f5faf8; }
:deep(.mine-overview-control__button > i::before) { left:3px; right:3px; top:-2px; bottom:-2px; }
:deep(.mine-overview-control__button > i::after) { top:3px; bottom:3px; left:-2px; right:-2px; }
:deep(.mine-overview-control__button > i b) { position:absolute; z-index:1; inset:4px; border-radius:50%; background:#579f8f; box-shadow:0 0 5px rgba(74,157,139,.5); }
:deep(.mine-overview-control__button span) { font-size:11px; font-weight:650; letter-spacing:.06em; }
:deep(.mine-overview-control__button em) { display:grid; min-width:16px; height:16px; padding:0 3px; place-items:center; border-radius:8px; color:#fff; background:#5c9f91; box-shadow:0 0 7px rgba(74,157,139,.32); font-size:8px; font-style:normal; font-weight:700; }
:deep(.mine-overview-control__button.is-active) { border-color:rgba(215,157,61,.42); color:#4a3a20; background:linear-gradient(120deg,rgba(255,251,237,.97),rgba(246,239,217,.92)); }
:deep(.mine-overview-control__button.is-active > i) { border-color:#ce9440; box-shadow:0 0 6px rgba(206,148,64,.3); }
:deep(.mine-overview-control__button.is-active > i b), :deep(.mine-overview-control__button.is-active em) { background:#ce9440; box-shadow:0 0 7px rgba(206,148,64,.36); }
:deep(.south-sea-inset) {
  position:absolute; z-index:5; right:27px; bottom:104px; width:112px; height:154px; box-sizing:border-box; overflow:hidden;
  border:1px solid rgba(255,224,204,.74); border-radius:5px;
  background:linear-gradient(150deg,rgba(20,38,49,.68),rgba(23,32,48,.5));
  box-shadow:0 8px 24px rgba(4,16,25,.22),inset 0 0 18px rgba(255,226,207,.045);
  backdrop-filter:blur(3px); pointer-events:none; transition:opacity .25s ease,transform .25s ease;
}
:deep(.south-sea-inset::before), :deep(.south-sea-inset::after) { content:""; position:absolute; z-index:2; width:13px; height:13px; pointer-events:none; }
:deep(.south-sea-inset::before) { left:5px; top:5px; border-left:1px solid rgba(255,238,224,.8); border-top:1px solid rgba(255,238,224,.8); }
:deep(.south-sea-inset::after) { right:5px; bottom:5px; border-right:1px solid rgba(255,238,224,.8); border-bottom:1px solid rgba(255,238,224,.8); }
:deep(.south-sea-inset.is-hidden) { opacity:0; transform:translateY(6px); }
:deep(.south-sea-inset__title) { position:absolute; z-index:2; left:7px; top:6px; padding:2px 5px; border-radius:3px; color:#fff3e7; background:rgba(31,42,51,.68); text-shadow:0 1px 3px #000; font-size:9px; font-weight:650; letter-spacing:.14em; }
:deep(.south-sea-inset__map) { position:absolute; inset:0; }
:deep(.south-sea-inset__map .maplibregl-canvas) { outline:none; }
@media (max-width:720px) { :deep(.south-sea-inset) { right:14px; bottom:94px; width:92px; height:126px; } }
:deep(.mine-marker) {
  --risk: #79ad9f;
  --risk-soft: rgba(73,132,119,.24);
  /* This element is the MapLibre Marker itself. It must stay absolutely
     positioned; `relative` introduces a zoom-dependent screen offset. */
  position: absolute;
  width: 1px;
  height: 1px;
  pointer-events: none;
  filter: drop-shadow(0 0 8px var(--risk-soft));
}
:deep(.mine-marker--left .mine-marker__card) { left: auto; right: 22px; }
:deep(.mine-marker--left .mine-marker__link::after) { left: auto; right: 0; transform: scaleX(-1); }
:deep(.mine-marker--below .mine-marker__card) { bottom: auto; top: 48px; }
:deep(.mine-marker--below .mine-marker__link) { bottom: auto; top: 7px; height:calc(41px + var(--card-half-height, 22px)); transform-origin: top; }
:deep(.mine-marker--below .mine-marker__link::after) { top: auto; bottom: 0; }
:deep(.mine-marker--collapsed .mine-marker__card), :deep(.mine-marker--collapsed .mine-marker__link) { display: none; }
:deep(.mine-marker--attention),:deep(.mine-marker--warning) { --risk:#ffcc33; --risk-soft:rgba(255,204,51,.45); }
:deep(.mine-marker--danger) { --risk:#ff4560; --risk-soft:rgba(255,69,96,.5); }
:deep(.mine-marker--normal) { --risk:#35d07f; --risk-soft:rgba(53,208,127,.35); }
:deep(.mine-marker__beacon) { position: absolute; left: 0; top: 0; z-index: 0; }
:deep(.mine-marker__beacon i), :deep(.mine-marker__beacon b) {
  position: absolute; left: 0; top: 0; transform: translate(-50%,-50%);
}
:deep(.mine-marker__beacon i:first-child) {
  width:18px; height:18px; box-sizing:border-box; border:2px solid color-mix(in srgb,var(--risk) 78%,white); border-radius:50%;
  background:color-mix(in srgb,var(--risk) 16%,transparent); box-shadow:0 0 5px var(--risk-soft);
  animation:mine-solid-wave 2.4s calc(var(--enter-delay) + .1s) cubic-bezier(.22,.68,.3,1) infinite;
}
:deep(.mine-marker__beacon i:nth-child(2)) {
  width:14px; height:14px; box-sizing:border-box; border:1.5px solid color-mix(in srgb,var(--risk) 70%,white); border-radius:50%;
  background:color-mix(in srgb,var(--risk) 12%,transparent);
  animation:mine-solid-wave 2.4s calc(var(--enter-delay) + .72s) cubic-bezier(.22,.68,.3,1) infinite;
}
:deep(.mine-marker__beacon b) {
  width:8px; height:8px; box-sizing:border-box; border-radius:50%; background:#fff; border:2px solid var(--risk);
  box-shadow:0 0 5px 2px var(--risk),0 0 11px 4px var(--risk-soft);
  animation:mine-core-glow 2.6s ease-in-out infinite;
}
:deep(.mine-marker__link) {
  position: absolute; left: -1px; bottom: 7px; z-index: 1; width: 1px; height:calc(37px + var(--card-half-height, 22px)); transform-origin: bottom;
  background: linear-gradient(to top, color-mix(in srgb,var(--risk) 84%,white), rgba(255,255,255,.72));
  box-shadow: 0 0 4px var(--risk-soft); animation: mine-link-in .42s calc(var(--enter-delay) + .18s) cubic-bezier(.2,.8,.2,1) both;
}
:deep(.mine-marker__link::after) { content:""; position:absolute; left:0; top:0; width:24px; height:1px; background:linear-gradient(90deg,color-mix(in srgb,var(--risk) 88%,white),transparent); box-shadow:0 0 4px var(--risk-soft); }
:deep(.mine-marker__card) {
  position: absolute; left: 20px; bottom: 44px; z-index: 3; width: 150px; box-sizing:border-box; padding: 7px 8px 6px 10px;
  pointer-events: auto; cursor: pointer;
  color: #fff; border: 1px solid color-mix(in srgb, var(--risk) 52%, rgba(255,255,255,.42)); border-left:2px solid var(--risk); border-radius: 6px;
  background: linear-gradient(112deg, color-mix(in srgb, var(--risk) 16%, rgba(13,22,31,.96)), rgba(10,18,28,.94));
  box-shadow: inset 0 1px rgba(255,255,255,.1), 0 0 0 1px rgba(0,0,0,.24), 0 7px 20px rgba(0,0,0,.3), 0 0 11px color-mix(in srgb,var(--risk-soft) 65%,transparent);
  backdrop-filter: blur(10px) saturate(.9); overflow: hidden;
  animation: mine-card-in .55s calc(var(--enter-delay) + .58s) cubic-bezier(.18,.86,.24,1) both, mine-card-float 4.6s calc(var(--enter-delay) + 1.5s) ease-in-out infinite alternate;
}
:deep(.mine-marker--normal .mine-marker__card) { width:132px; padding:6px 7px 6px 9px; background:linear-gradient(112deg,rgba(25,57,54,.91),rgba(10,25,29,.92)); }
:deep(.mine-marker--normal .mine-marker__meta) { display:none; }
:deep(.mine-marker__card:hover) { filter:brightness(1.1); border-color:#fff; box-shadow:inset 0 1px rgba(255,255,255,.22),0 0 0 1px rgba(0,0,0,.28),0 10px 28px rgba(0,0,0,.38),0 0 24px var(--risk-soft); }
:deep(.mine-marker__card:focus-visible) { outline:2px solid rgba(255,255,255,.92); outline-offset:3px; }
:deep(.mine-marker--detail-open .mine-marker__card) { pointer-events:none; animation:mine-card-dismiss .18s cubic-bezier(.4,0,1,1) both; }
:deep(.mine-marker--detail-open .mine-marker__link) { animation:mine-link-dismiss .16s .06s cubic-bezier(.4,0,1,1) both; }
:deep(.mine-marker--returning .mine-marker__link) { animation:mine-link-in .2s cubic-bezier(.16,.84,.22,1) both; }
:deep(.mine-marker--returning .mine-marker__card) { animation:mine-card-return .34s .14s cubic-bezier(.16,.88,.22,1) both; }
:deep(.mine-marker--restored .mine-marker__link) { opacity:1; transform:scaleY(1); animation:none; }
:deep(.mine-marker--restored .mine-marker__card) { opacity:1; clip-path:inset(0); transform:none; animation:mine-card-float 4.6s ease-in-out infinite alternate; }
:deep(.mine-marker--occluded .mine-marker__card), :deep(.mine-marker--occluded .mine-marker__link) { pointer-events:none; animation:mine-card-occlude .16s ease both; }
:deep(.mine-marker__card::before) { content:""; position:absolute; inset:-40% auto -40% -45%; width:25%; transform:skewX(-18deg); background:linear-gradient(90deg,transparent,rgba(255,255,255,.12),transparent); animation:mine-scan 5.2s 1.4s ease-in-out infinite; }
:deep(.mine-marker__header) { position:relative; display:flex; align-items:center; gap:8px; justify-content:space-between; white-space:nowrap; }
:deep(.mine-marker__header strong) { overflow:hidden; font-size:11px; letter-spacing:.02em; text-overflow:ellipsis; text-shadow:0 1px 4px #000; }
:deep(.mine-marker__header span) { flex:none; padding:2px 5px; border-radius:3px; color:#fff; font-size:8px; font-weight:700; background:color-mix(in srgb,var(--risk) 86%,#1b2530); box-shadow:0 0 6px color-mix(in srgb,var(--risk-soft) 65%,transparent); }
:deep(.mine-marker__meta) { position:relative; display:flex; align-items:baseline; justify-content:space-between; gap:7px; margin-top:5px; color:rgba(225,233,239,.66); font-size:8px; letter-spacing:.015em; white-space:nowrap; animation:mine-text-in .4s calc(var(--enter-delay) + 1s) ease both; }
:deep(.mine-marker__meta b) { color:color-mix(in srgb,var(--risk) 70%,white); font-size:9px; font-weight:650; letter-spacing:.01em; }
@keyframes mine-solid-wave { 0% { opacity:.82; transform:translate(-50%,-50%) scale(.7); } 72% { opacity:.34; } 100% { opacity:0; transform:translate(-50%,-50%) scale(1.42); } }
@keyframes mine-core-glow { 0%,100% { filter:brightness(.88); box-shadow:0 0 4px 1px var(--risk),0 0 8px 3px var(--risk-soft); } 50% { filter:brightness(1.2); box-shadow:0 0 7px 2px var(--risk),0 0 14px 5px var(--risk-soft); } }
@keyframes mine-link-in { from { transform:scaleY(0); opacity:0; } to { transform:scaleY(1); opacity:1; } }
@keyframes mine-card-in { from { opacity:0; clip-path:inset(0 100% 0 0); transform:translateX(-12px); } to { opacity:1; clip-path:inset(0); transform:none; } }
@keyframes mine-card-dismiss { from { opacity:1; clip-path:inset(0); transform:none; } to { opacity:0; clip-path:inset(0 100% 0 0); transform:translateX(-8px); } }
@keyframes mine-card-return { from { opacity:0; clip-path:inset(0 100% 0 0); transform:translateX(-8px); } to { opacity:1; clip-path:inset(0); transform:none; } }
@keyframes mine-card-occlude { to { opacity:0; } }
@keyframes mine-link-dismiss { from { opacity:1; transform:scaleY(1); } to { opacity:0; transform:scaleY(0); } }
@keyframes mine-text-in { from { opacity:0; transform:translateY(4px); } to { opacity:1; transform:none; } }
@keyframes mine-scan { 0%,35% { left:-45%; opacity:0; } 48% { opacity:1; } 70%,100% { left:125%; opacity:0; } }
@keyframes mine-card-float { from { translate:0 0; filter:brightness(.98); } to { translate:0 -2px; filter:brightness(1.06); } }
:deep(.mine-detail-popup) { z-index:10000 !important; }
:deep(.mine-detail-popup::before) { content:""; position:absolute; left:-72px; top:50%; width:2px; height:48px; transform-origin:bottom; background:linear-gradient(rgba(255,255,255,.92),var(--detail,#61d2bc)); box-shadow:0 0 7px var(--detail,#61d2bc); animation:detail-link-v .17s cubic-bezier(.16,.84,.22,1) both; }
:deep(.mine-detail-popup::after) { content:""; position:absolute; left:-72px; top:50%; width:72px; height:2px; transform-origin:left; background:linear-gradient(90deg,rgba(255,255,255,.92),var(--detail,#61d2bc)); box-shadow:0 0 7px var(--detail,#61d2bc); animation:detail-link-h .2s .14s cubic-bezier(.16,.84,.22,1) both; }
:deep(.mine-detail-popup .maplibregl-popup-content) { padding:0; overflow:hidden; border:1px solid color-mix(in srgb,var(--detail,#40a9ff) 62%,white); border-radius:9px; color:#edf7ff; background:linear-gradient(135deg,rgba(8,29,46,.99),rgba(8,17,29,.985)); box-shadow:0 14px 38px rgba(0,0,0,.44),0 0 22px color-mix(in srgb,var(--detail,#40a9ff) 24%,transparent),inset 0 1px rgba(255,255,255,.12); backdrop-filter:blur(18px); animation:detail-panel-in .38s .3s cubic-bezier(.16,.88,.22,1) both; }
:deep(.mine-detail-popup .maplibregl-popup-content::after) { content:""; position:absolute; inset:-50% auto -50% -35%; width:28%; transform:skewX(-18deg); background:linear-gradient(90deg,transparent,rgba(255,255,255,.16),transparent); animation:detail-scan 4.6s 1.5s ease-in-out infinite; pointer-events:none; }
:deep(.mine-detail-popup .maplibregl-popup-tip) { display:none; }
:deep(.mine-detail-popup .maplibregl-popup-close-button) { z-index:2; width:28px; height:28px; color:rgba(255,255,255,.72); font-size:20px; }
:deep(.lightning-detail-popup) { z-index:10020!important; }
:deep(.lightning-detail-popup .maplibregl-popup-content) { margin:0; padding:0; overflow:visible; border:1px solid rgba(83,195,250,.48); border-radius:12px; color:#edf8ff; background:linear-gradient(145deg,rgba(6,35,59,.97),rgba(5,20,37,.96)); box-shadow:0 18px 46px rgba(0,0,0,.44),0 0 28px rgba(35,163,237,.2),inset 0 1px rgba(255,255,255,.12); backdrop-filter:blur(20px); animation:lightning-card-in .34s .18s cubic-bezier(.16,.88,.22,1) both; }
:deep(.lightning-detail-popup .maplibregl-popup-content::before),:deep(.lightning-detail-popup .maplibregl-popup-content::after) { display:none; }
:deep(.lightning-detail-popup .maplibregl-popup-tip) { display:none; }
:deep(.lightning-detail-popup .maplibregl-popup-close-button) { z-index:2; width:25px; height:25px; color:rgba(255,255,255,.68); font-size:18px; }
:deep(.lightning-detail) { width:350px; padding:13px; box-sizing:border-box; }
:deep(.lightning-detail > header) { display:flex; align-items:center; gap:9px; padding:0 25px 10px 0; border-bottom:1px solid rgba(95,198,248,.15); }
:deep(.lightning-detail > header > i) { display:grid; width:36px; height:36px; flex:none; place-items:center; border:1px solid rgba(255,211,89,.72); border-radius:50%; color:#fff; background:radial-gradient(circle,rgba(255,194,42,.28),rgba(255,148,31,.07)); box-shadow:0 0 16px rgba(255,184,42,.38); font-size:22px; font-style:normal; }
:deep(.lightning-detail > header > span) { display:flex; min-width:0; flex-direction:column; gap:3px; }.lightning-detail-popup :deep(.lightning-detail > header strong) { font-size:13px; letter-spacing:.05em; }.lightning-detail-popup :deep(.lightning-detail > header small) { color:rgba(188,221,238,.55); font-size:7px; letter-spacing:.05em; }
:deep(.lightning-detail > header > em) { margin-left:auto; padding:5px 8px; border-radius:5px; color:#fff; font-size:8px; font-style:normal; font-weight:700; white-space:nowrap; }.lightning-detail-popup :deep(.lightning-detail > header > em.is-danger) { background:#f44755; box-shadow:0 0 12px rgba(255,62,76,.4); }.lightning-detail-popup :deep(.lightning-detail > header > em.is-warning) { background:#d99826; box-shadow:0 0 11px rgba(255,190,61,.3); }.lightning-detail-popup :deep(.lightning-detail > header > em.is-safe) { background:#2aa98e; box-shadow:0 0 11px rgba(54,213,177,.28); }
:deep(.lightning-detail__overview) { display:grid; grid-template-columns:132px 1fr; gap:12px; padding:11px 0; border-bottom:1px solid rgba(95,198,248,.13); }
:deep(.lightning-gauge) { position:relative; display:flex; height:116px; flex-direction:column; align-items:center; justify-content:center; overflow:hidden; border:1px solid rgba(64,168,225,.22); border-radius:9px; background:rgba(13,66,101,.2); }
:deep(.lightning-gauge::before) { content:""; position:absolute; width:84px; height:84px; border-radius:50%; background:conic-gradient(var(--gauge-color) var(--gauge),rgba(79,145,181,.14) 0); box-shadow:0 0 18px color-mix(in srgb,var(--gauge-color) 38%,transparent); }
:deep(.lightning-gauge::after) { content:""; position:absolute; width:70px; height:70px; border-radius:50%; background:#08243a; box-shadow:inset 0 0 17px rgba(0,0,0,.42); }
:deep(.lightning-gauge i),:deep(.lightning-gauge b),:deep(.lightning-gauge em),:deep(.lightning-gauge small) { position:relative; z-index:1; }
:deep(.lightning-gauge i) { color:var(--gauge-color); font-size:13px; font-style:normal; }.lightning-detail-popup :deep(.lightning-gauge b) { font-size:25px; line-height:24px; }.lightning-detail-popup :deep(.lightning-gauge em) { color:#9dd8f3; font-size:9px; font-style:normal; }.lightning-detail-popup :deep(.lightning-gauge small) { margin-top:16px; color:rgba(203,231,244,.65); font-size:8px; }
:deep(.lightning-detail__overview dl) { display:flex; margin:0; flex-direction:column; justify-content:center; }.lightning-detail-popup :deep(.lightning-detail__overview dl div) { display:flex; align-items:center; justify-content:space-between; padding:7px 1px; border-bottom:1px solid rgba(103,182,222,.09); }.lightning-detail-popup :deep(.lightning-detail__overview dt) { color:rgba(188,218,233,.55); font-size:8px; }.lightning-detail-popup :deep(.lightning-detail__overview dd) { margin:0; color:#f2fbff; font-size:8.5px; font-weight:600; }
:deep(.lightning-detail__location),:deep(.lightning-detail__impact) { padding:10px 1px 0; border-bottom:1px solid rgba(95,198,248,.13); }.lightning-detail-popup :deep(.lightning-detail__location header),.lightning-detail-popup :deep(.lightning-detail__impact header) { display:flex; align-items:center; justify-content:space-between; }.lightning-detail-popup :deep(.lightning-detail__location header strong),.lightning-detail-popup :deep(.lightning-detail__impact header strong) { color:#eaf9ff; font-size:9px; }.lightning-detail-popup :deep(.lightning-detail__location button) { padding:5px 8px; border:1px solid rgba(75,190,247,.32); border-radius:5px; color:#bfeaff; background:rgba(25,121,178,.18); font:7px inherit; cursor:pointer; }.lightning-detail-popup :deep(.lightning-detail__location button:hover) { background:rgba(25,142,216,.3); }.lightning-detail-popup :deep(.lightning-detail__location p) { margin:7px 0 10px; color:#70cff6; font-size:9px; }
:deep(.lightning-detail__impact > header small) { color:rgba(173,212,232,.45); font-size:7px; }.lightning-detail-popup :deep(.lightning-detail__impact > div) { display:grid; grid-template-columns:1.5fr 1fr; gap:8px; padding:8px 0; }.lightning-detail-popup :deep(.lightning-detail__impact > div span) { display:flex; min-width:0; flex-direction:column; gap:4px; padding:7px 8px; border:1px solid rgba(80,177,227,.13); border-radius:6px; background:rgba(30,102,143,.12); }.lightning-detail-popup :deep(.lightning-detail__impact > div small) { color:rgba(181,215,231,.5); font-size:7px; }.lightning-detail-popup :deep(.lightning-detail__impact > div b) { overflow:hidden; color:#fff; font-size:10px; text-overflow:ellipsis; white-space:nowrap; }.lightning-detail-popup :deep(.lightning-detail__impact > div span:last-child b) { color:#ffd35f; }
:deep(.lightning-detail__impact footer) { display:flex; align-items:center; gap:6px; padding:0 0 9px; color:rgba(151,207,232,.55); font-size:7px; }.lightning-detail-popup :deep(.lightning-detail__impact footer i) { width:6px; height:6px; border-radius:50%; background:#4dd7ff; box-shadow:0 0 7px #4dd7ff; }.lightning-detail-popup :deep(.lightning-detail__impact footer em) { font-style:normal; }
/* Command-centre event card: keep the information rhythm wide and horizontal. */
:deep(.lightning-detail) { width:380px; padding:12px 13px 11px; }
:deep(.lightning-detail > header) { min-height:46px; padding-bottom:12px; }
:deep(.lightning-detail > header > i) { width:39px; height:39px; font-size:23px; }
.lightning-detail-popup :deep(.lightning-detail > header strong) { font-size:14px; }
.lightning-detail-popup :deep(.lightning-detail > header small) { font-size:8px; }
:deep(.lightning-detail > header > em) { padding:6px 12px; font-size:10px; }
:deep(.lightning-detail__overview) { grid-template-columns:144px 1fr; gap:13px; padding:10px 0; }
:deep(.lightning-gauge) { height:122px; }
:deep(.lightning-gauge::before) { width:92px; height:92px; }
:deep(.lightning-gauge::after) { width:76px; height:76px; }
.lightning-detail-popup :deep(.lightning-gauge b) { font-size:32px; line-height:30px; }
.lightning-detail-popup :deep(.lightning-gauge em) { font-size:11px; }
.lightning-detail-popup :deep(.lightning-gauge small) { margin-top:14px; font-size:8px; }
.lightning-detail-popup :deep(.lightning-detail__overview dl div) { min-height:24px; padding:5px 2px; }
.lightning-detail-popup :deep(.lightning-detail__overview dt) { font-size:10px; }
.lightning-detail-popup :deep(.lightning-detail__overview dd) { display:flex; align-items:flex-end; flex-direction:column; gap:2px; font-size:10px; }
.lightning-detail-popup :deep(.lightning-detail__overview dd small) { color:rgba(183,218,236,.5); font-size:7px; }
:deep(.lightning-detail__location),:deep(.lightning-detail__impact),:deep(.lightning-detail__stats) { padding:9px 2px 0; border-bottom:1px solid rgba(95,198,248,.16); }
.lightning-detail-popup :deep(.lightning-detail__location header strong),.lightning-detail-popup :deep(.lightning-detail__impact header strong),.lightning-detail-popup :deep(.lightning-detail__stats header strong) { font-size:11px; }
.lightning-detail-popup :deep(.lightning-detail__location p) { margin:8px 0 12px; font-size:11px; font-weight:650; }
:deep(.lightning-detail__impact) { cursor:pointer; transition:background .2s ease; }.lightning-detail-popup :deep(.lightning-detail__impact:hover) { background:rgba(37,132,185,.08); }
:deep(.lightning-detail__impact-body) { display:grid!important; grid-template-columns:1fr 160px!important; gap:9px!important; padding:7px 0 6px!important; }
.lightning-detail-popup :deep(.lightning-detail__impact-body > span) { display:flex; flex-direction:column; gap:5px; padding:7px 2px; }
.lightning-detail-popup :deep(.lightning-detail__impact-body > span small) { color:rgba(178,215,233,.52); font-size:8px; }
.lightning-detail-popup :deep(.lightning-detail__impact-body > span b) { overflow:hidden; color:#fff; font-size:11px; text-overflow:ellipsis; white-space:nowrap; }
.lightning-detail-popup :deep(.lightning-detail__impact-body > span strong) { color:#ffd45c; font-size:15px; }
:deep(.lightning-detail__impact-body figure) { position:relative; display:grid; height:66px; margin:0; grid-template-columns:34px 1fr 34px; grid-template-rows:1fr 16px; align-items:center; overflow:hidden; border:1px solid rgba(67,171,225,.2); border-radius:7px; background:radial-gradient(circle at 50%,rgba(28,119,170,.22),rgba(7,37,61,.5)),repeating-radial-gradient(circle at 50%,transparent 0 12px,rgba(80,183,232,.1) 13px 14px); }
:deep(.lightning-detail__impact-body figure::before) { content:""; position:absolute; left:36px; right:36px; top:31px; border-top:1px dashed rgba(107,224,255,.72); box-shadow:0 0 6px rgba(74,210,250,.35); }
.lightning-detail-popup :deep(.lightning-detail__impact-body figure i),.lightning-detail-popup :deep(.lightning-detail__impact-body figure b) { z-index:1; display:grid; width:25px; height:25px; margin:auto; place-items:center; border-radius:50%; color:#fff; font-style:normal; }
.lightning-detail-popup :deep(.lightning-detail__impact-body figure i) { background:#ef3f50; box-shadow:0 0 12px rgba(255,56,73,.55); }.lightning-detail-popup :deep(.lightning-detail__impact-body figure b) { background:#13bfd5; box-shadow:0 0 12px rgba(32,211,231,.48); }
.lightning-detail-popup :deep(.lightning-detail__impact-body figure em) { z-index:1; justify-self:center; padding:2px 5px; border-radius:4px; color:#dff8ff; background:#0b304d; font-size:8px; font-style:normal; }
.lightning-detail-popup :deep(.lightning-detail__impact-body figure small) { z-index:1; overflow:hidden; padding:0 3px; color:rgba(210,235,246,.62); font-size:6px; text-align:center; text-overflow:ellipsis; white-space:nowrap; }.lightning-detail-popup :deep(.lightning-detail__impact-body figure small:last-child) { grid-column:3; }
:deep(.lightning-detail__stats) { border-bottom:0; }
:deep(.lightning-detail__stats > header) { display:flex; align-items:baseline; justify-content:space-between; }.lightning-detail-popup :deep(.lightning-detail__stats > header small) { color:rgba(166,207,228,.48); font-size:7px; }
:deep(.lightning-detail__stats > div) { display:grid; grid-template-columns:repeat(4,1fr); gap:8px; padding-top:9px; }
.lightning-detail-popup :deep(.lightning-detail__stats > div span) { display:grid; min-width:0; height:46px; grid-template-columns:auto auto; align-content:center; justify-content:center; column-gap:3px; border:1px solid rgba(67,171,225,.14); border-radius:6px; background:linear-gradient(145deg,rgba(25,91,131,.2),rgba(9,42,67,.34)); text-align:center; }
.lightning-detail-popup :deep(.lightning-detail__stats > div b) { color:#f5fcff; font-size:17px; }.lightning-detail-popup :deep(.lightning-detail__stats > div em) { align-self:end; padding-bottom:2px; color:#a9daef; font-size:7px; font-style:normal; }.lightning-detail-popup :deep(.lightning-detail__stats > div small) { grid-column:1/-1; color:rgba(169,207,226,.5); font-size:7px; }
@keyframes lightning-line-up { to { transform:scaleY(1); } }
@keyframes lightning-line-across { to { transform:scaleX(1); } }
@keyframes lightning-card-in { from { opacity:0; clip-path:inset(0 100% 0 0); transform:translateX(-8px); } to { opacity:1; clip-path:inset(0); transform:none; } }
:deep(.mine-detail) { --detail:#35d07f; position:relative; min-width:238px; border-left:3px solid var(--detail); }
:deep(.mine-detail--attention),:deep(.mine-detail--warning) { --detail:#ffcc33; }
:deep(.mine-detail--danger) { --detail:#ff4560; }
:deep(.mine-detail__eyebrow) { display:flex; align-items:center; gap:7px; padding:8px 32px 0 11px; color:rgba(214,236,248,.7); font-size:8.5px; letter-spacing:.1em; text-transform:uppercase; animation:detail-item-in .27s .48s both; }
:deep(.mine-detail__eyebrow i) { width:6px; height:6px; border-radius:50%; background:var(--detail); box-shadow:0 0 8px var(--detail); animation:detail-live 1.5s ease-in-out infinite; }
:deep(.mine-detail__eyebrow em) { margin-left:auto; color:var(--detail); font-style:normal; font-weight:700; }
:deep(.mine-detail header) { display:flex; align-items:center; justify-content:space-between; gap:16px; padding:7px 32px 9px 11px; border-bottom:1px solid color-mix(in srgb,var(--detail) 32%,transparent); background:linear-gradient(100deg,color-mix(in srgb,var(--detail) 18%,transparent),transparent); animation:detail-item-in .3s .53s both; }
:deep(.mine-detail header strong) { font-size:15px; letter-spacing:.04em; }
:deep(.mine-detail header span) { padding:3px 7px; border-radius:4px; color:#fff; font-size:10px; font-weight:700; background:var(--detail); box-shadow:0 0 12px color-mix(in srgb,var(--detail) 48%,transparent); }
:deep(.mine-detail__scene) { position:relative; margin:7px 7px 1px; overflow:hidden; border:1px solid color-mix(in srgb,var(--detail) 38%,rgba(255,255,255,.14)); border-radius:6px; background:#07131d; box-shadow:inset 0 0 22px rgba(0,0,0,.5),0 0 16px color-mix(in srgb,var(--detail) 12%,transparent); animation:detail-scene-in .46s .58s cubic-bezier(.16,.88,.22,1) both; }
:deep(.mine-detail__scene::before) { content:""; position:absolute; z-index:1; inset:0; pointer-events:none; background:linear-gradient(180deg,rgba(5,17,27,.08) 48%,rgba(5,15,24,.84)),linear-gradient(90deg,color-mix(in srgb,var(--detail) 16%,transparent),transparent 42%); }
:deep(.mine-detail__scene::after) { content:""; position:absolute; z-index:2; left:0; right:0; top:-2px; height:2px; pointer-events:none; background:linear-gradient(90deg,transparent,var(--detail),transparent); box-shadow:0 0 8px var(--detail); opacity:.66; animation:detail-scene-scan 4.2s 1.2s ease-in-out infinite; }
:deep(.mine-detail__scene img) { display:block; width:100%; height:128px; object-fit:cover; filter:saturate(.88) contrast(1.06) brightness(.88); transform:scale(1.015); transition:transform .8s ease,filter .5s ease; }
:deep(.mine-detail__scene:hover img) { transform:scale(1.045); filter:saturate(1) contrast(1.08) brightness(.96); }
:deep(.mine-detail__scene figcaption) { position:absolute; z-index:3; left:8px; right:8px; bottom:7px; display:flex; align-items:center; justify-content:space-between; gap:8px; color:rgba(240,248,252,.82); font-size:9px; letter-spacing:.04em; }
:deep(.mine-detail__scene figcaption em) { padding:2px 6px; border:1px solid color-mix(in srgb,var(--detail) 58%,white); border-radius:3px; color:#fff; background:color-mix(in srgb,var(--detail) 58%,rgba(6,18,28,.72)); box-shadow:0 0 9px color-mix(in srgb,var(--detail) 28%,transparent); font-style:normal; font-weight:700; }
:deep(.mine-detail__scene-action) { position:relative; display:flex; align-items:center; justify-content:center; gap:9px; width:calc(100% - 14px); height:31px; margin:6px 7px 7px; overflow:hidden; border:1px solid color-mix(in srgb,var(--detail) 64%,white); border-radius:5px; color:#fff; background:linear-gradient(110deg,color-mix(in srgb,var(--detail) 78%,#142638),color-mix(in srgb,var(--detail) 48%,#091724)); box-shadow:inset 0 1px rgba(255,255,255,.18),0 0 14px color-mix(in srgb,var(--detail) 20%,transparent); font-size:10.5px; font-weight:700; letter-spacing:.08em; cursor:pointer; animation:detail-item-in .35s .69s both; }
:deep(.mine-detail__scene-action::before) { content:""; position:absolute; inset:0; transform:translateX(-105%); background:linear-gradient(90deg,transparent,rgba(255,255,255,.2),transparent); transition:transform .48s ease; }
:deep(.mine-detail__scene-action:hover::before) { transform:translateX(105%); }
:deep(.mine-detail__scene-action:hover) { filter:brightness(1.1); box-shadow:inset 0 1px rgba(255,255,255,.22),0 0 19px color-mix(in srgb,var(--detail) 34%,transparent); }
:deep(.mine-detail__scene-action i) { font-size:13px; font-style:normal; transition:transform .2s ease; }
:deep(.mine-detail__scene-action:hover i) { transform:translate(2px,-2px); }
:deep(.mine-detail > div:not(.mine-detail__eyebrow)) { display:grid; grid-template-columns:1fr 1fr; gap:4px; padding:6px; animation:detail-item-in .34s .61s both; }
:deep(.mine-detail > div:not(.mine-detail__eyebrow) > div) { display:flex; flex-direction:column; gap:3px; min-width:0; padding:6px; border:1px solid rgba(255,255,255,.045); border-radius:5px; background:rgba(255,255,255,.028); }
:deep(.mine-detail > div:not(.mine-detail__eyebrow) > div:hover) { border-color:color-mix(in srgb,var(--detail) 25%,transparent); background:rgba(255,255,255,.05); }
:deep(.mine-detail small) { color:rgba(222,237,246,.68); font-size:9px; }
:deep(.mine-detail b) { overflow:hidden; color:#f4fbff; font-size:11.5px; font-weight:500; text-overflow:ellipsis; white-space:nowrap; }
:deep(.mine-detail footer) { display:flex; align-items:center; gap:8px; padding:7px 14px 9px; border-top:1px solid rgba(255,255,255,.05); color:rgba(214,236,248,.45); font-size:9px; letter-spacing:.05em; animation:detail-item-in .3s .69s both; }
:deep(.mine-detail footer i) { width:3px; height:3px; border-radius:50%; background:var(--detail); box-shadow:0 0 5px var(--detail); }
@keyframes detail-link-v { from { opacity:0; transform:scaleY(0); } to { opacity:1; transform:scaleY(1); } }
@keyframes detail-link-h { from { opacity:0; transform:scaleX(0); } to { opacity:1; transform:scaleX(1); } }
@keyframes detail-panel-in { from { opacity:0; clip-path:inset(100% 0 0); transform:translateY(12px) scale(.98); } to { opacity:1; clip-path:inset(0); transform:none; } }
@keyframes detail-item-in { from { opacity:0; transform:translateY(5px); } to { opacity:1; transform:none; } }
@keyframes detail-scene-in { from { opacity:0; clip-path:inset(0 100% 0 0); transform:translateY(5px); } to { opacity:1; clip-path:inset(0); transform:none; } }
@keyframes detail-scene-scan { 0%,18% { top:-2px; opacity:0; } 28% { opacity:.68; } 72% { opacity:.42; } 84%,100% { top:100%; opacity:0; } }
@keyframes detail-live { 50% { opacity:.35; box-shadow:0 0 3px var(--detail); } }
@keyframes detail-scan { 0%,35% { left:-35%; opacity:0; } 50% { opacity:1; } 70%,100% { left:125%; opacity:0; } }
/* Shared command-centre colour tokens. Geometry and interaction stay intact. */
.tool-rail,.heatmap-analysis,.heatmap-legend,.storm-analysis,.storm-trend,.timeline-panel {
  border-color:var(--glass-border);
  color:var(--text-primary);
  background:var(--panel-bg);
  box-shadow:0 0 30px var(--ambient),inset 0 1px rgba(255,255,255,.08);
  backdrop-filter:blur(20px);
}
:deep(.maplibregl-ctrl-group),:deep(.lightning-demo-control__button),:deep(.mine-overview-control__button) {
  border-color:var(--glass-border);
  color:var(--text-primary);
  background:var(--panel-bg);
  box-shadow:0 0 30px var(--ambient),inset 0 1px rgba(255,255,255,.07);
  backdrop-filter:blur(20px);
}
:deep(.lightning-detail-popup .maplibregl-popup-content),:deep(.mine-detail-popup .maplibregl-popup-content) {
  border-color:var(--glass-border);
  background:rgba(10,35,60,.72);
  box-shadow:0 0 30px var(--ambient),0 18px 42px rgba(0,0,0,.34),inset 0 1px rgba(255,255,255,.08);
  backdrop-filter:blur(20px);
}
.mode-copy small,.heatmap-analysis small,.heatmap-legend small,.storm-analysis dt,.storm-analysis small,.timeline-panel small { color:var(--text-secondary); }
.play-button { background:var(--primary-blue); box-shadow:0 0 20px rgba(22,136,255,.5); }
.time-tick { color:var(--text-secondary); }.time-tick.is-active { color:var(--light-blue); }
@media (max-width: 640px) {
  :deep(.maplibregl-ctrl-bottom-right) { right: 8px; bottom: 8px; }
  .vignette { box-shadow: inset 0 0 70px 18px rgba(101, 126, 132, .14); }
}
</style>
