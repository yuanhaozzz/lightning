import { createDemoReadings, DEMO_SOURCE, type DemoDeviceIdentity, type DemoDeviceReading } from './stormDemoData'

export type DemoPlayback = 'idle' | 'playing' | 'paused' | 'finished'
export type DemoPhase = 'normal' | 'warning'
export type DemoPauseReason = 'user' | 'page-hidden' | null
export const DEMO_STEPS = [
  { id: 'normal', name: '正常运行', durationMs: 5000 },
  { id: 'warning', name: '模拟预警', durationMs: 40000 },
] as const
export const DEMO_DURATION_MS = DEMO_STEPS.reduce((total, step) => total + step.durationMs, 0)
export interface DemoEvent {
  id: string
  runId: string
  source: typeof DEMO_SOURCE
  kind: 'started' | 'warning' | 'finished' | 'exited' | 'replayed'
  simulatedAt: string
  deviceId: string | null
  description: string
}
export interface DemoSnapshot {
  source: typeof DEMO_SOURCE
  playback: DemoPlayback
  phase: DemoPhase
  phaseName: string
  stageNumber: number
  elapsedMs: number
  durationMs: number
  progress: number
  runId: string | null
  pauseReason: DemoPauseReason
  devices: DemoDeviceReading[]
  events: DemoEvent[]
}

/** Explicit transitions driven by the scene's animation loop; owns no timers or Three.js objects. */
export function createStormDemo(identities: readonly DemoDeviceIdentity[]) {
  let playback: DemoPlayback = 'idle'
  let phase: DemoPhase = 'normal'
  let elapsedMs = 0
  let epoch = 0
  let runNumber = 0
  let runId: string | null = null
  let pauseReason: DemoPauseReason = null
  let devices = createDemoReadings(identities)
  const events: DemoEvent[] = []
  let eventNumber = 0
  let disposed = false
  const timestamp = (offset = elapsedMs) => new Date(epoch + offset).toISOString()
  function record(kind: DemoEvent['kind'], description: string, offset = elapsedMs, deviceId: string | null = null) {
    if (!runId) return
    events.push({ id: `demo-event-${++eventNumber}`, runId, source: DEMO_SOURCE, kind,
      simulatedAt: timestamp(offset), deviceId, description })
    if (events.length > 20) events.shift()
  }
  function begin(now: number) {
    if (disposed || !Number.isFinite(now) || !Number.isFinite(new Date(now).getTime())) return
    epoch = now; elapsedMs = 0; phase = 'normal'; pauseReason = null
    runId = `storm-demo-${++runNumber}`; playback = 'playing'
    devices = createDemoReadings(identities)
    devices.forEach(device => { device.simulatedAt = timestamp() })
    record('started', '开始模拟演示：设备正常运行')
  }
  return {
    // Full precision visual clock; UI snapshots remain throttled to 10 Hz.
    get clock() { return { phase, playback, elapsedMs, runId, durationMs: DEMO_DURATION_MS } },
    get snapshot(): DemoSnapshot {
      return { source: DEMO_SOURCE, playback, phase, phaseName: phase === 'normal' ? '正常运行' : '模拟预警',
        stageNumber: phase === 'normal' ? 1 : 2, elapsedMs, durationMs: DEMO_DURATION_MS,
        progress: elapsedMs / DEMO_DURATION_MS, runId, pauseReason,
        devices: devices.map(device => ({ ...device, monitoringData: { ...device.monitoringData } })),
        events: events.map(event => ({ ...event })), }
    },
    start(now = Date.now()) { if (playback === 'idle' || playback === 'finished') begin(now) },
    pause(reason: Exclude<DemoPauseReason, null> = 'user') {
      if (disposed || playback !== 'playing') return
      playback = 'paused'; pauseReason = reason
    },
    resume() { if (!disposed && playback === 'paused') { playback = 'playing'; pauseReason = null } },
    replay(now = Date.now()) {
      if (disposed) return
      if (playback === 'playing' || playback === 'paused') record('replayed', '重新播放，上轮模拟提前结束')
      begin(now)
    },
    exit() {
      if (disposed) return
      if (playback === 'playing' || playback === 'paused') record('exited', '退出模拟演示，设备恢复正常')
      playback = 'idle'; phase = 'normal'; elapsedMs = 0; runId = null; pauseReason = null
      devices = createDemoReadings(identities)
    },
    /** Return true only on a display tick (10 Hz) or a transition. Large deltas still cross boundaries once. */
    update(deltaMs: number) {
      if (disposed || playback !== 'playing' || !Number.isFinite(deltaMs) || deltaMs <= 0) return false
      const before = Math.floor(elapsedMs / 100)
      elapsedMs = Math.min(DEMO_DURATION_MS, elapsedMs + deltaMs)
      if (phase === 'normal' && elapsedMs >= DEMO_STEPS[0].durationMs) {
        phase = 'warning'
        const warningAt = timestamp(DEMO_STEPS[0].durationMs)
        for (const device of devices) {
          if (device.type !== 'storm-warning') continue
          device.status = 'warning'; device.warningAt = warningAt; device.simulatedAt = warningAt
          record('warning', '雷暴预警仪进入模拟预警；其他设备状态独立，保持正常', DEMO_STEPS[0].durationMs, device.id)
        }
      }
      if (elapsedMs === DEMO_DURATION_MS) {
        playback = 'finished'
        record('finished', '本小步演示完成：保留模拟预警，退出后恢复正常')
      }
      return Math.floor(elapsedMs / 100) !== before
    },
    dispose() { disposed = true; devices = []; events.length = 0 },
  }
}
