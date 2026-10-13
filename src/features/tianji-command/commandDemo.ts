import { destination, MINES, type LngLat, type WeatherMode } from './weather'

/** Presentation-only scenario. Distance/ETA are independent mock observations, not a forecast. */
export type StormTrackStatus = 'detect' | 'identify' | 'track' | 'lock' | 'threat'
export type CommandLayer = 'energy' | 'strikes' | 'tracks' | 'corridor' | 'assets' | 'rings'
export type CommandScope = 'theater' | 'national'
export const DEMO_NOW = 60
export const DEMO_END = 180
export const DEMO_MINE = MINES[0]!
export const MODES: { id: WeatherMode; name: string; subtitle: string }[] = [
  { id: 'live', name: '实时态势', subtitle: '发现 · 识别 · 持续跟踪' },
  { id: 'heat', name: '能量场分析', subtitle: '能量聚合 · 活跃区域识别' },
  { id: 'track', name: '轨迹推演', subtitle: '历史回溯 · 未来路径推演' },
  { id: 'warning', name: '威胁预警', subtitle: '防御纵深 · 资产威胁研判' },
]
export const LAYERS: { id: CommandLayer; name: string; icon: string }[] = [
  { id: 'energy', name: '雷暴能量体', icon: 'radar' },
  { id: 'strikes', name: '雷击事件', icon: 'bolt' },
  { id: 'tracks', name: '移动航迹', icon: 'arrow' },
  { id: 'corridor', name: '预测走廊', icon: 'target' },
  { id: 'assets', name: '重点资产', icon: 'building' },
  { id: 'rings', name: '防御纵深', icon: 'shield' },
]
export const BUILD_PHASES = [
  { at: 0, status: 'detect', title: '建立数字战场', detail: '地理基准与监测网格就绪' },
  { at: 0.8, status: 'detect', title: '扫描雷电活动', detail: '检索当前监测时窗' },
  { at: 1.5, status: 'detect', title: '发现雷暴目标', detail: '能量聚合 · 4 个活动目标' },
  { at: 2.3, status: 'identify', title: '识别雷暴目标', detail: '目标编号与强度特征已建立' },
  { at: 3, status: 'track', title: '建立移动航迹', detail: '回溯历史位置 · 推演移动方向' },
  { at: 3.8, status: 'lock', title: '锁定重点资产', detail: 'T06 → 神东矿区' },
  { at: 4.5, status: 'threat', title: '建立威胁关系', detail: '预测走廊与防御纵深匹配' },
  { at: 5.3, status: 'threat', title: '态势构建完成', detail: '持续跟踪中 · 重点关注 T06' },
] as const satisfies readonly {
  at: number
  status: StormTrackStatus
  title: string
  detail: string
}[]

export interface DemoStorm {
  id: string
  center: LngLat
  radius: number
  bearing: number
  speed: number
  dbz: number
  distance: number
  eta: number
  phase: number
  primary: boolean
}
export const DEMO_STORMS: DemoStorm[] = [
  {
    id: 'T01',
    center: [100.5, 39.4],
    radius: 110,
    bearing: 70,
    speed: 36,
    dbz: 46,
    distance: 320,
    eta: 52,
    phase: 0.4,
    primary: false,
  },
  {
    id: 'T03',
    center: [104.2, 31.5],
    radius: 115,
    bearing: 48,
    speed: 31,
    dbz: 49,
    distance: 290,
    eta: 68,
    phase: 1.7,
    primary: false,
  },
  {
    id: 'T05',
    center: [115.8, 35.1],
    radius: 105,
    bearing: 132,
    speed: 38,
    dbz: 53,
    distance: 117,
    eta: 31,
    phase: 3.1,
    primary: false,
  },
  {
    id: 'T06',
    center: destination(DEMO_MINE.center, 225, 258),
    radius: 180,
    bearing: 45,
    speed: 42,
    dbz: 62,
    distance: 78,
    eta: 18,
    phase: 4.6,
    primary: true,
  },
]
export const PRIMARY_STORM = DEMO_STORMS.find((storm) => storm.primary)!
export const demoPosition = (storm: DemoStorm, minute: number): LngLat =>
  destination(storm.center, storm.bearing, ((minute - DEMO_NOW) * storm.speed) / 60)
export function demoReading(storm: DemoStorm, minute: number) {
  const elapsed = minute - DEMO_NOW
  return {
    distance: Math.max(0, Math.round(storm.distance - (elapsed * storm.speed) / 60)),
    eta: Math.max(0, Math.round(storm.eta - elapsed)),
  }
}
export function demoClock(minute: number, seconds = false) {
  const totalSeconds = Math.round((13 * 60 + 32 + minute) * 60)
  const hh = String(Math.floor(totalSeconds / 3600)).padStart(2, '0')
  const mm = String(Math.floor(totalSeconds / 60) % 60).padStart(2, '0')
  return `${hh}:${mm}${seconds ? `:${String(totalSeconds % 60).padStart(2, '0')}` : ''}`
}
export const demoPhase = (elapsed: number) => {
  let index = 0
  BUILD_PHASES.forEach((phase, i) => {
    if (elapsed >= phase.at) index = i
  })
  return index
}

// Deterministic event stream. One batched GPU point cloud, independent of Vue's render tree.
export const DEMO_EVENTS = Array.from({ length: 560 }, (_, index) => {
  const storm = DEMO_STORMS[index % DEMO_STORMS.length]!
  const minute = (index * 37.17) % DEMO_END
  const angle = index * 137.508
  const radius = storm.radius * 0.68 * Math.sqrt(((index * 17) % 101) / 101)
  return {
    minute,
    position: destination(demoPosition(storm, minute), angle, radius),
    stormId: storm.id,
  }
})
