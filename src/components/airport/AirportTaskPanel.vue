<script setup lang="ts">
import { computed } from 'vue'
import type { TaskSnapshot } from '../../three/airport/simulation'

const props = defineProps<{ task: TaskSnapshot | null; disabled?: boolean }>()
const emit = defineEmits<{ start: []; pause: []; resume: []; reset: [] }>()

const phaseNames: Record<TaskSnapshot['phase'], string> = {
  idle: '待命',
  to_service: '前往交接点',
  servicing: '驻留交接',
  returning: '返回',
  completed: '已完成',
}
const phaseLabel = computed(() => (props.task ? phaseNames[props.task.phase] : '加载中'))
const runLabel = computed(() => {
  if (!props.task) return '加载中'
  if (props.task.runState === 'error') return '异常'
  if (props.task.runState === 'paused') return '已暂停'
  if (props.task.runState === 'running') return '运行中'
  return props.task.phase === 'completed' ? '已完成' : '待命'
})
const mainLabel = computed(() => {
  if (!props.task) return '加载中'
  if (props.task.runState === 'error') return '任务异常'
  if (props.task.runState === 'running') return '暂停'
  if (props.task.runState === 'paused') return '继续'
  return props.task.phase === 'completed' ? '已完成' : '开始作业'
})
const mainDisabled = computed(
  () =>
    !props.task ||
    props.disabled ||
    props.task.runState === 'error' ||
    props.task.phase === 'completed',
)
const progress = computed(() => {
  const task = props.task
  if (!task || task.phase === 'idle' || task.phase === 'completed' || task.progress === null)
    return null
  return Math.round(Math.min(1, Math.max(0, task.progress)) * 100)
})
// Every entry and timestamp comes from the simulation; the UI creates no events.
const recentEvents = computed(() => (props.task ? props.task.events.slice(-3).reverse() : []))

function timeLabel(seconds: number) {
  const whole = Math.floor(Math.max(0, seconds))
  return `${Math.floor(whole / 60)
    .toString()
    .padStart(2, '0')}:${(whole % 60).toString().padStart(2, '0')}`
}

function primaryAction() {
  if (mainDisabled.value || !props.task) return
  if (props.task.runState === 'running') emit('pause')
  else if (props.task.runState === 'paused') emit('resume')
  else if (props.task.phase === 'idle') emit('start')
}
</script>

<template>
  <section class="airport-task-panel" aria-labelledby="airport-task-heading">
    <header class="airport-task-header">
      <h2 id="airport-task-heading">行李车辆作业</h2>
      <span :class="['airport-task-state', task?.runState]">{{ runLabel }}</span>
    </header>
    <div class="airport-task-identity">
      <strong aria-label="任务 BAG-001">BAG-001</strong>
      <span>车辆 <b>BT-01</b></span>
    </div>
    <dl class="airport-task-phase">
      <dt>当前阶段</dt>
      <dd>{{ phaseLabel }}<small v-if="task?.phase === 'servicing'">模拟计时</small></dd>
    </dl>
    <div class="airport-task-measures">
      <div>
        <span>当前阶段进度</span><strong>{{ progress === null ? '—' : `${progress}%` }}</strong>
      </div>
      <div>
        <span>本轮仿真用时</span><strong>{{ task ? timeLabel(task.elapsed) : '—' }}</strong>
      </div>
    </div>
    <div
      class="airport-task-progress"
      :class="{ 'is-inactive': progress === null }"
      role="progressbar"
      aria-label="当前阶段进度"
      :aria-valuenow="progress ?? undefined"
      :aria-valuetext="progress === null ? '不适用' : `${progress}%`"
      :aria-valuemin="0"
      :aria-valuemax="100"
    >
      <span :style="{ width: `${progress ?? 0}%` }" />
    </div>
    <div class="airport-task-actions">
      <button
        type="button"
        class="airport-task-primary"
        :disabled="mainDisabled"
        @click="primaryAction"
      >
        {{ mainLabel }}
      </button>
      <button
        type="button"
        class="airport-task-reset"
        :disabled="disabled || !task"
        title="恢复车辆待命位置，清空任务时间与事件"
        @click="$emit('reset')"
      >
        重置任务
      </button>
    </div>
    <p v-if="task?.error" class="airport-task-error" role="alert">{{ task.error }}</p>
    <p v-else-if="task?.phase === 'completed'" class="airport-task-complete">
      重置任务后可再次开始。
    </p>
    <section class="airport-task-events" aria-labelledby="airport-task-events-heading">
      <h3 id="airport-task-events-heading">最近事件</h3>
      <ol v-if="recentEvents.length">
        <li v-for="(event, index) in recentEvents" :key="`${event.time}-${index}-${event.message}`">
          <time>{{ timeLabel(event.time) }}</time
          ><span :title="event.message">{{ event.message }}</span>
        </li>
      </ol>
      <p v-else class="airport-task-no-events">尚无任务事件</p>
    </section>
    <p class="airport-task-note">V0.2 业务仿真 · 非现场实时数据</p>
  </section>
</template>

<style scoped>
.airport-task-panel {
  width: 280px;
  padding: 18px 20px 15px;
  border: 1px solid rgba(255, 255, 255, 0.75);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.86);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  box-shadow: 0 6px 24px rgba(32, 55, 80, 0.07);
  color: #152b4a;
  max-height: calc(100dvh - 196px);
  overflow-y: auto;
  scrollbar-width: thin;
}
.airport-task-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
}
.airport-task-header h2 {
  margin: 0;
  font-size: 15px;
  font-weight: 650;
  line-height: 1.5;
}
.airport-task-state {
  padding: 2px 7px;
  border-radius: 4px;
  background: #e8edf2;
  color: #687b91;
  font-size: 11px;
  font-weight: 500;
  line-height: 1.6;
}
.airport-task-state.running {
  background: #e8f1ff;
  color: #3478d9;
}
.airport-task-state.paused {
  background: #f6eddf;
  color: #947340;
}
.airport-task-state.error {
  background: #f7e8e5;
  color: #a85143;
}
.airport-task-identity {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-top: 12px;
}
.airport-task-identity > strong {
  font-size: 21px;
  line-height: 1.2;
  letter-spacing: -0.3px;
  font-weight: 700;
}
.airport-task-identity > span {
  color: #7b8898;
  font-size: 12px;
}
.airport-task-identity b {
  margin-left: 4px;
  font-weight: 600;
  color: #52667e;
}
.airport-task-phase {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin: 13px 0 12px;
  padding-top: 12px;
  border-top: 1px solid rgba(35, 65, 99, 0.08);
  font-size: 13px;
  line-height: 1.5;
}
.airport-task-phase dt {
  color: #65758b;
}
.airport-task-phase dd {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  font-weight: 600;
}
.airport-task-phase dd small {
  font-size: 10px;
  font-weight: 400;
  color: #7b8898;
}
.airport-task-measures {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
.airport-task-measures > div {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.airport-task-measures > div:last-child {
  text-align: right;
}
.airport-task-measures span {
  font-size: 11px;
  color: #7b8898;
}
.airport-task-measures strong {
  font-size: 15px;
  font-weight: 600;
  line-height: 1.4;
  font-variant-numeric: tabular-nums;
}
.airport-task-progress {
  height: 3px;
  margin: 10px 0 13px;
  border-radius: 3px;
  background: #e4ebf2;
  overflow: hidden;
}
.airport-task-progress > span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: #6299ee;
  transition: width 0.12s linear;
}
.airport-task-progress.is-inactive {
  opacity: 0.65;
}
.airport-task-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.airport-task-actions button {
  height: 33px;
  padding: 0 10px;
  border-radius: 7px;
  border: 1px solid transparent;
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
}
.airport-task-primary {
  background: #3478f6;
  color: #fff;
}
.airport-task-primary:hover:not(:disabled) {
  background: #286be8;
}
.airport-task-reset {
  background: #edf2f8;
  color: #526980;
}
.airport-task-reset:hover:not(:disabled) {
  background: #e2ebf6;
}
.airport-task-actions button:disabled {
  opacity: 0.48;
  cursor: not-allowed;
}
.airport-task-actions button:focus-visible {
  outline: 2px solid #3478f6;
  outline-offset: 3px;
}
.airport-task-error,
.airport-task-complete {
  margin: 10px 0 0;
  font-size: 12px;
  line-height: 1.6;
}
.airport-task-error {
  color: #a85143;
  overflow-wrap: anywhere;
}
.airport-task-complete {
  color: #65758b;
}
.airport-task-events {
  margin-top: 15px;
  padding-top: 11px;
  border-top: 1px solid rgba(35, 65, 99, 0.08);
}
.airport-task-events h3 {
  margin: 0 0 7px;
  font-size: 11px;
  font-weight: 500;
  color: #7b8898;
}
.airport-task-events ol {
  display: grid;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.airport-task-events li {
  display: grid;
  grid-template-columns: 34px 1fr;
  gap: 8px;
  font-size: 11px;
  line-height: 1.55;
  color: #52667e;
}
.airport-task-events time {
  color: #8a97a6;
  font-variant-numeric: tabular-nums;
}
.airport-task-events li > span {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.airport-task-no-events {
  margin: 0;
  font-size: 12px;
  color: #94a0af;
}
.airport-task-note {
  margin: 12px 0 0;
  padding-top: 11px;
  border-top: 1px solid rgba(35, 65, 99, 0.08);
  color: #7c899a;
  font-size: 11px;
  line-height: 1.5;
  white-space: nowrap;
}
@media (max-width: 1480px) {
  .airport-task-panel {
    width: 266px;
    padding: 15px 17px 13px;
  }
  .airport-task-events {
    margin-top: 12px;
    padding-top: 9px;
  }
  .airport-task-phase {
    margin: 11px 0 10px;
    padding-top: 10px;
  }
  .airport-task-progress {
    margin: 8px 0 11px;
  }
}
@media (max-width: 700px) {
  .airport-task-panel {
    width: 238px;
    padding: 14px;
    max-height: calc(100dvh - 212px);
  }
  .airport-task-note {
    font-size: 10px;
  }
}
</style>
