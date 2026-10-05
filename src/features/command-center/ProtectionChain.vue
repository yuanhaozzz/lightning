<script setup lang="ts">
import { computed } from 'vue'
import { devices, RISK_META, siteById, WINDOW_SECONDS, WINDOW_START } from './data'
import type { Strike } from './data'

/* =========================================================================
   防护闭环链路 / PROTECTION CHAIN
   -------------------------------------------------------------------------
   一个雷击事件在数字孪生里应该有的完整生命周期，而不是"一个光点"：

     ①  闪电定位实测回击      ← 实测 (ADTD)
     ②  雷电流幅值反演        ← 反演
     ③  受威胁资产匹配        ← 计算 (几何 + 资产台账)
     ④  防护装置动作          ← 实测 (防雷物联网终端)
     ⑤  工单闭环 / 损伤判定   ← 业务流程

   把这条链显式画出来，系统才从"看板"变成"可追溯的孪生体"：
   客户能指着任意一次雷击问"我的保护动作了吗、几毫秒起效、谁去闭环",
   系统能逐步回答。这是央企安全生产审计真正要看的东西。
   ========================================================================= */

const props = defineProps<{ strike: Strike }>()

const site = computed(() => siteById.get(props.strike.siteId))
const siteDevices = computed(() => devices.filter((device) => device.siteId === props.strike.siteId))
const acted = computed(() => siteDevices.value.filter((device) => device.state === 'action'))
const spdCount = computed(() => Math.max(2, Math.min(6, Math.round(props.strike.current / 22))))

const clock = (offsetMs: number) => {
  const date = new Date(props.strike.at + offsetMs)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

type Step = {
  id: string
  title: string
  /** measured = 实测 / derived = 反演计算 / predicted = 模型预测 / workflow = 业务流程 */
  kind: 'measured' | 'derived' | 'predicted' | 'workflow'
  time: string
  /** 该环节的耗时，用于展示系统响应速度 */
  cost: string
  detail: string
  ok: boolean
}

const steps = computed<Step[]>(() => {
  const strike = props.strike
  const target = site.value
  const latency = strike.responseMs || 0
  return [
    {
      id: 'detect',
      title: '闪电定位回击捕获',
      kind: 'measured',
      time: clock(0),
      cost: '0.0 s',
      detail: `${strike.type} · ${strike.polarity === 'positive' ? '正极性' : '负极性'} · 峰值 ${strike.current} kA`,
      ok: true,
    },
    {
      id: 'invert',
      title: '雷电流幅值反演',
      kind: 'derived',
      time: clock(420),
      cost: '0.4 s',
      detail: `多站时差定位 → 幅值反演 ${strike.current} kA（置信区间 ±8%）`,
      ok: true,
    },
    {
      id: 'match',
      title: '资产匹配与距离判定',
      kind: 'derived',
      time: clock(1200),
      cost: '1.2 s',
      detail: target
        ? `最近台账资产 ${target.name}（${target.kind}·${target.owner}）· 距最近接地体 ${strike.distanceKm} km${
            strike.distanceKm > 15 ? '，已在保护范围之外' : '，在保护范围内'
          }`
        : '未匹配到台账内资产，仅作气象记录',
      ok: Boolean(target) && strike.distanceKm <= 15,
    },
    {
      id: 'respond',
      title: '防护装置动作',
      kind: 'measured',
      time: clock(1200 + latency),
      cost: latency ? `${latency} ms` : '—',
      detail: strike.intercepted
        ? `${spdCount.value} 组 SPD 同步泄流，残压合格，${acted.value.length} 台终端上报动作`
        : '保护范围内无 SPD 动作记录，由工频接地体承担泄流',
      ok: strike.intercepted,
    },
    {
      id: 'close',
      title: '损伤判定与工单闭环',
      kind: 'workflow',
      time: clock(2800),
      cost: '1.6 s',
      detail: strike.intercepted
        ? '自动生成巡视工单，派单至属地运维班组，等待现场复核'
        : '触发二级告警，已升级至值班负责人，需人工确认设备状态',
      ok: strike.intercepted,
    },
  ]
})

const kindLabel: Record<Step['kind'], string> = {
  measured: '实测',
  derived: '反演',
  predicted: '预测',
  workflow: '流程',
}

/** 该事件在推演窗口里的位置，给链路加一个时间坐标系 */
const windowOffset = computed(() => {
  const seconds = Math.round((props.strike.at - WINDOW_START) / 1000)
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return `窗口内 T+${hours}h${String(minutes).padStart(2, '0')}m / 共 ${WINDOW_SECONDS / 3600}h`
})

const riskColor = computed(() => (site.value ? RISK_META[site.value.risk].color : '#8fd4ff'))
</script>

<template>
  <section class="chain" :style="{ '--chain-risk': riskColor }">
    <header class="chain__head">
      <div>
        <strong>防护闭环链路</strong>
        <small>PROTECTION CLOSURE · 从回击捕获到工单闭环</small>
      </div>
      <span class="chain__window">{{ windowOffset }}</span>
    </header>

    <ol class="chain__list">
      <li v-for="(step, index) in steps" :key="step.id" :class="[`is-${step.kind}`, { 'is-bad': !step.ok }]">
        <span class="chain__rail" aria-hidden="true">
          <i></i>
        </span>
        <div class="chain__body">
          <div class="chain__top">
            <b class="chain__index cc-num">{{ String(index + 1).padStart(2, '0') }}</b>
            <strong>{{ step.title }}</strong>
            <em class="chain__kind">{{ kindLabel[step.kind] }}</em>
            <span class="chain__time cc-num">{{ step.time }}</span>
            <span class="chain__cost cc-num">{{ step.cost }}</span>
          </div>
          <p>{{ step.detail }}</p>
        </div>
      </li>
    </ol>

    <footer class="chain__foot">
      <span>
        全链路总耗时
        <b class="cc-num">{{ ((2800 + (strike.responseMs || 0)) / 1000).toFixed(1) }} s</b>
      </span>
      <span class="chain__legend">
        <i class="is-measured"></i>实测
        <i class="is-derived"></i>反演
        <i class="is-workflow"></i>流程
      </span>
    </footer>
  </section>
</template>

<style scoped>
.chain {
  padding: 16px 18px 12px;
  border: 1px solid var(--glass-line);
  border-radius: var(--radius);
  background: rgba(8, 16, 30, 0.44);
}

.chain__head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  margin-bottom: 14px;
}

.chain__head strong {
  display: block;
  font-size: 12.5px;
  font-weight: 600;
  letter-spacing: 0.1em;
}

.chain__head small {
  color: var(--t4);
  font-size: 9.5px;
  letter-spacing: 0.16em;
}

.chain__window {
  color: var(--t4);
  font-family: var(--din);
  font-size: 10px;
  letter-spacing: 0.08em;
}

.chain__list {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  list-style: none;
}

.chain__list li {
  position: relative;
  display: grid;
  grid-template-columns: 26px 1fr;
  gap: 12px;
  padding-bottom: 12px;
}

.chain__rail {
  position: relative;
  display: flex;
  justify-content: center;
}

/* 贯穿的细轨：把五个环节串成一条可追溯的链路 */
.chain__rail::before {
  content: '';
  position: absolute;
  top: 14px;
  bottom: -12px;
  width: 1px;
  background: linear-gradient(180deg, rgba(150, 198, 240, 0.24), rgba(150, 198, 240, 0.06));
}

.chain__list li:last-child .chain__rail::before {
  display: none;
}

.chain__rail i {
  position: relative;
  z-index: 1;
  width: 9px;
  height: 9px;
  margin-top: 4px;
  border: 1.5px solid rgba(200, 228, 248, 0.7);
  border-radius: 50%;
  background: #0a1729;
}

.is-measured .chain__rail i {
  border-color: #7fe6ff;
  background: #23c8ff;
  box-shadow: 0 0 10px rgba(35, 200, 255, 0.7);
}

.is-derived .chain__rail i {
  border-color: #8ff0d8;
  background: rgba(53, 214, 164, 0.5);
}

.is-workflow .chain__rail i {
  border-color: rgba(200, 228, 248, 0.6);
  background: rgba(200, 228, 248, 0.22);
}

.is-bad .chain__rail i {
  border-color: #ff5d6e;
  background: #ff3b52;
  box-shadow: 0 0 12px rgba(255, 59, 82, 0.7);
  animation: cc-breathe 2.2s ease-in-out infinite;
}

.chain__body {
  min-width: 0;
}

.chain__top {
  display: flex;
  align-items: center;
  gap: 9px;
}

.chain__index {
  color: var(--t4);
  font-size: 10px;
  letter-spacing: 0.08em;
}

.chain__top strong {
  font-size: 12.5px;
  font-weight: 600;
}

.chain__kind {
  padding: 1px 6px;
  border: 1px solid var(--glass-line);
  border-radius: 999px;
  color: var(--t3);
  font-size: 9px;
  font-style: normal;
  letter-spacing: 0.06em;
}

.is-measured .chain__kind {
  border-color: rgba(35, 200, 255, 0.34);
  color: #9fe4ff;
}

.is-derived .chain__kind {
  border-color: rgba(53, 214, 164, 0.3);
  color: #8ff0d8;
}

.chain__time {
  margin-left: auto;
  color: var(--t3);
  font-size: 11px;
}

.chain__cost {
  min-width: 52px;
  padding: 2px 7px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.05);
  color: #eaf8ff;
  font-size: 10.5px;
  text-align: right;
}

.chain__body p {
  margin: 6px 0 0;
  color: var(--t3);
  font-size: 11px;
  line-height: 1.5;
}

.is-bad .chain__body p {
  color: rgba(255, 150, 162, 0.82);
}

.chain__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 4px;
  padding-top: 11px;
  border-top: 1px solid rgba(150, 198, 240, 0.08);
  color: var(--t3);
  font-size: 11px;
}

.chain__foot b {
  margin-left: 6px;
  color: #eaf8ff;
  font-size: 15px;
  font-weight: 400;
}

.chain__legend {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--t4);
  font-size: 10px;
}

.chain__legend i {
  width: 7px;
  height: 7px;
  margin-left: 8px;
  border-radius: 50%;
}

.chain__legend i.is-measured {
  background: #23c8ff;
}

.chain__legend i.is-derived {
  background: rgba(53, 214, 164, 0.6);
}

.chain__legend i.is-workflow {
  background: rgba(200, 228, 248, 0.3);
}
</style>
