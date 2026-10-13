<script setup lang="ts">
import { DEMO_STATUS_NAMES } from './stormDemoData'
import type { DemoSnapshot } from './stormDemo'
defineProps<{ state: DemoSnapshot; ready: boolean }>()
defineEmits<{ command: [command: 'start' | 'pause' | 'resume' | 'replay' | 'exit']; close: [] }>()
const clock = (timestamp: string) => new Date(timestamp).toLocaleTimeString('zh-CN', { hour12: false })
</script>

<template>
  <section class="demo-controls" aria-label="雷暴预警模拟演示" @keydown.stop>
    <header><strong>雷暴预警演示</strong><span>演示数据</span>
      <button class="close" aria-label="收起演示控制" @click="$emit('close')">×</button></header>
    <div class="stage" role="status">
      <b>{{ state.stageNumber }}/2 · {{ state.phaseName }}</b>
      <span>{{ state.playback === 'idle' ? '待开始' : state.playback === 'paused' ? '已暂停' : state.playback === 'finished' ? '本小步完成' : '播放中' }}</span>
    </div>
    <progress aria-label="演示进度" :value="state.elapsedMs" :max="state.durationMs"></progress>
    <small>{{ Math.floor(state.elapsedMs / 1000) }} / {{ state.durationMs / 1000 }} 秒 · 正常 → 模拟预警</small>
    <p v-if="state.pauseReason === 'page-hidden'" class="note">页面切到后台后已暂停，请手动继续。</p>
    <ul aria-label="模拟监测设备状态">
      <li v-for="device in state.devices.filter(device => device.type === 'storm-warning' || device.type === 'lightning-locator')" :key="device.id">
        <div><span>{{ device.name }}</span><b :class="device.status">{{ DEMO_STATUS_NAMES[device.status] }}</b></div>
        <code>{{ device.id }}</code>
        <small v-if="device.warningAt">模拟预警时间 {{ clock(device.warningAt) }}</small>
      </li>
    </ul>
    <div class="actions">
      <button v-if="state.playback === 'idle' || state.playback === 'finished'" :disabled="!ready" @click="$emit('command', 'start')">开始演示</button>
      <button v-else-if="state.playback === 'playing'" @click="$emit('command', 'pause')">暂停</button>
      <button v-else @click="$emit('command', 'resume')">继续</button>
      <button :disabled="!ready || state.playback === 'idle'" @click="$emit('command', 'replay')">重新播放</button>
      <button :disabled="state.playback === 'idle'" @click="$emit('command', 'exit')">退出演示</button>
    </div>
    <details v-if="state.events.length" class="records">
      <summary>本页演示记录（{{ state.events.length }}）</summary>
      <ol><li v-for="event in [...state.events].reverse().slice(0, 6)" :key="event.id">
        <time>{{ clock(event.simulatedAt) }}</time> {{ event.description }} <small>演示数据 · {{ event.runId }}</small>
      </li></ol>
    </details>
    <p class="note">云团、云内闪光及琥珀色脉冲均为演示效果，空间高度与云影不代表实际风险范围。本阶段无降雨、镜头巡航或防护联动。</p>
  </section>
</template>

<style scoped>
.demo-controls { position: absolute; z-index: 3; top: 98px; right: 20px; width: 286px; max-width: calc(100vw - 56px); max-height: calc(100vh - 300px); overflow: auto; box-sizing: border-box; padding: 15px; background: #f8fbf5ed; backdrop-filter: blur(14px); border: 1px solid #ffffffc9; border-radius: 12px; box-shadow: 0 5px 22px #304e5010; font-size: 12px; color: #344f55; }
header { display: flex; align-items: center; gap: 8px; }
header span { color: #657d75; font-size: 10px; border: 1px solid #cddbd4; padding: 2px 4px; border-radius: 4px; }
button { color: inherit; border: 1px solid #d0dcd6; border-radius: 6px; background: #eef4ef; cursor: pointer; padding: 7px 9px; font-size: 11px; }
button:hover { background: #dfeae4; }
button:focus-visible { outline: 2px solid #6e9998; outline-offset: 2px; }
button:disabled { opacity: .4; cursor: default; }
.close { margin-left: auto; border: none; background: transparent; font-size: 18px; padding: 0 4px; }
.stage { display: flex; justify-content: space-between; align-items: center; margin-top: 16px; }
.stage span { font-size: 10px; color: #637970; }
progress { display: block; width: 100%; height: 6px; margin: 10px 0 6px; accent-color: #71958a; }
small { display: block; font-size: 10px; color: #6b8177; }
ul { list-style: none; margin: 12px 0; padding: 0; display: grid; gap: 10px; }
li div { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
li b { font-size: 10px; font-weight: 500; padding: 3px 7px; border-radius: 4px; }
.normal { color: #357b5b; background: #e0efe5; }
.warning { color: #a26417; background: #faead1; }
.fault { color: #ac4c41; background: #f3ddd9; }
code { font-size: 10px; color: #6d8179; }
.actions { display: flex; gap: 6px; }
.records { font-size: 10px; margin-top: 12px; }
summary { cursor: pointer; }
ol { padding-left: 15px; max-height: 100px; overflow: auto; }
ol li { margin: 8px 0; line-height: 1.4; }
.note { font-size: 10px; line-height: 1.6; color: #718278; margin: 12px 0 0; }
@media (max-width: 500px) { .demo-controls { top: 100px; right: 18px; max-height: calc(100vh - 340px); } }
</style>
