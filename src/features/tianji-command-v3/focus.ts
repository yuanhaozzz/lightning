export type FocusStage = 'overview' | 'flying' | 'radar' | 'ranging' | 'acquiring' | 'locked'
export type FocusKind = 'full' | 'retarget'
export const FOCUS_FLIGHT_SECONDS = 1.7
export const FOCUS_STAGES: Record<FocusStage, { number: string; title: string; detail: string }> = {
  overview: { number: '00', title: '全域监测', detail: '点选矿区，进入雷暴跟踪' },
  flying: { number: '01', title: '定位矿区', detail: '正在进入矿区观察视角' },
  radar: { number: '02', title: '展开雷达', detail: '建立 50 / 100 / 150 / 200 km 距离圈' },
  ranging: { number: '03', title: '测距连线', detail: '测量矿区至回波边缘的最近距离' },
  acquiring: { number: '04', title: '锁定雷暴', detail: '确认目标回波范围与临近趋势' },
  locked: { number: '05', title: '持续跟踪', detail: '回波边缘距离 · 按当前移动路径外推' },
}
export const easeInOut = (t: number) => {
  const x = Math.min(1, Math.max(0, t))
  return x * x * (3 - 2 * x)
}
export function focusProgress(seconds: number, kind: FocusKind = 'full', reducedMotion = false) {
  const t = reducedMotion ? 100 : Math.max(0, seconds) + (kind === 'retarget' ? 2.65 : 0)
  const stage: FocusStage = t < 1.7 ? 'flying' : t < 2.65 ? 'radar' : t < 3.65 ? 'ranging' : t < 4.4 ? 'acquiring' : 'locked'
  return {
    stage,
    flight: easeInOut(t / 1.7),
    radar: easeInOut((t - 1.7) / .95),
    range: easeInOut((t - 2.65) / 1),
    cloud: easeInOut((t - 3.65) / .75),
    result: easeInOut((t - 4.4) / .45),
  }
}
