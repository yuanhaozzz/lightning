import {
  bearingTo,
  destination,
  distanceKm,
  MINES,
  warningLevel,
  type LngLat,
  type Mine,
} from './weather'
import {
  DEMO_MINE,
  DEMO_STORMS,
  PRIMARY_STORM,
  demoPosition,
  demoReading,
  type DemoStorm,
} from './commandDemo'

export type MineFilter = 'priority' | 'all'
export type AnalysisSelection =
  { kind: 'overview' } | { kind: 'storm'; id: string } | { kind: 'mine'; id: string }
export const PRIORITY_MINE_IDS = new Set(['shendong', 'huaibei', 'liupanshui'])
export const FORECAST_MINUTES = 180
export const ANALYSIS_SECONDS = 3.2
export const HISTORY_SLICES = [{ minutes: 60 }, { minutes: 40 }, { minutes: 20 }] as const
// One scene clock drives every reveal; changing targets cancels the previous sequence.
export const ANALYSIS_STEPS = [
  [0, '锁定雷暴目标'],
  [0.4, '回溯历史航迹'],
  [1.08, '计算当前运动矢量'],
  [1.35, '推演未来轨迹'],
  [1.85, '沿预测走廊扫描'],
  [2.15, '锁定受影响资产'],
  [2.38, '展开资产防御纵深'],
  [2.7, '建立威胁关系'],
  [3.2, '雷暴分析完成'],
] as const
export const ASSET_ANALYSIS_STEPS = [
  [0, '锁定煤矿资产'],
  [0.25, '展开防御纵深'],
  [0.65, '扫描雷暴航迹'],
  [1.15, '比对预测路径'],
  [1.9, '锁定最高风险目标'],
  [2.7, '建立威胁关系'],
  [3.2, '资产防御分析完成'],
] as const
export function analysisFrame(kind: AnalysisSelection['kind'], seconds: number) {
  const ramp = (a: number, b: number) => {
    if (kind === 'overview') return 1
    const t = Math.max(0, Math.min(1, (seconds - a) / (b - a)))
    return t * t * (3 - 2 * t)
  }
  const asset = kind === 'mine'
  return {
    lock: asset ? ramp(1.9, 2.2) : ramp(0.08, 0.38),
    history: asset ? ramp(0.7, 1.1) : ramp(0.4, 1.08),
    nodes: HISTORY_SLICES.map((_, i) =>
      asset ? ramp(0.7 + i * 0.1, 0.9 + i * 0.1) : ramp(0.4 + i * 0.22, 0.62 + i * 0.22),
    ),
    vector: asset ? ramp(1.15, 1.35) : ramp(1.08, 1.35),
    forecast: ramp(1.35, 1.65),
    corridor: ramp(1.55, 1.85),
    scan: kind !== 'overview' && seconds >= 1.85 && seconds < 2.15 ? (seconds - 1.85) / 0.3 : -1,
    asset: asset ? ramp(0, 0.24) : ramp(2.15, 2.38),
    rings: [0, 1, 2, 3].map((i) =>
      asset ? ramp(0.25 + i * 0.07, 0.43 + i * 0.07) : ramp(2.38 + i * 0.045, 2.53 + i * 0.045),
    ),
    link: ramp(2.7, 3.0),
    particles: ramp(1.4, 1.8),
    result: kind === 'overview' || seconds >= ANALYSIS_SECONDS,
  }
}
export const formatEta = (minutes: number | null) =>
  minutes === null
    ? '—'
    : `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`

/** Derive the current tangent and speed from the last observed history segment. */
export function stormForecast(storm: DemoStorm, minute: number) {
  const history = HISTORY_SLICES.map((slice) => ({
    ...slice,
    center: demoPosition(storm, minute - slice.minutes),
  }))
  const center = demoPosition(storm, minute)
  const previous = history[history.length - 1]!
  const speed = (distanceKm(previous.center, center) / previous.minutes) * 60
  const bearing = speed < 1e-8 ? storm.bearing : (bearingTo(center, previous.center) + 180) % 360
  return {
    history,
    center,
    speed,
    bearing,
    position: (ahead: number) => destination(center, bearing, (speed * ahead) / 60),
  }
}
export const movementDirection = (bearing: number) =>
  ['北', '东北', '东', '东南', '南', '西南', '西', '西北'][
    Math.round((((bearing % 360) + 360) % 360) / 45) % 8
  ]!

export interface StormMineRelation {
  storm: DemoStorm
  mine: Mine
  distance: number
  edge: LngLat
  eta: number | null
  impactMinutes: number | null
  approaching: boolean
  threatening: boolean
  level: ReturnType<typeof warningLevel>
}
export interface CommandAnalysis {
  kind: AnalysisSelection['kind']
  mine: Mine | null
  storm: DemoStorm | null
  relation: StormMineRelation | null
  threats: StormMineRelation[]
}
export function stormMineDistance(storm: DemoStorm, mine: Mine, minute: number) {
  const center = demoPosition(storm, minute)
  const centerDistance = distanceKm(center, mine.center)
  const distance = Math.max(0, centerDistance - storm.radius)
  const edge =
    distance === 0 ? mine.center : destination(center, bearingTo(center, mine.center), storm.radius)
  return { distance, centerDistance, edge }
}
/** ETA is the first intersection of the moving circular footprint and the asset, not distance / speed. */
export function predictedImpact(storm: DemoStorm, mine: Mine, minute: number): number | null {
  const forecast = stormForecast(storm, minute)
  const clearance = (t: number) => distanceKm(forecast.position(t), mine.center) - storm.radius
  if (clearance(0) <= 0) return 0
  if (storm.speed <= 0) return null
  // The short great-circle forecast has a single closest approach. Continuous search also
  // catches a narrow/tangential crossing between discrete one-minute samples.
  let left = 0,
    right = FORECAST_MINUTES
  for (let i = 0; i < 48; i++) {
    const a = left + (right - left) / 3,
      b = right - (right - left) / 3
    if (clearance(a) < clearance(b)) right = b
    else left = a
  }
  const closest = (left + right) / 2
  const hit = clearance(FORECAST_MINUTES) < clearance(closest) ? FORECAST_MINUTES : closest
  if (clearance(hit) > 1e-7) return null
  let lo = 0,
    hi = hit
  for (let i = 0; i < 40; i++) {
    const middle = (lo + hi) / 2
    if (clearance(middle) <= 1e-7) hi = middle
    else lo = middle
  }
  return hi
}
export function predictedArrival(storm: DemoStorm, mine: Mine, minute: number): number | null {
  const impact = predictedImpact(storm, mine, minute)
  return impact === null ? null : Math.max(0, Math.ceil(impact - 1e-7))
}
export function analyzeRelation(storm: DemoStorm, mine: Mine, minute: number): StormMineRelation {
  const { distance, edge } = stormMineDistance(storm, mine, minute)
  const approaching = stormMineDistance(storm, mine, minute + 1).distance < distance - 0.01
  const impactMinutes = predictedImpact(storm, mine, minute)
  const eta = impactMinutes === null ? null : Math.max(0, Math.ceil(impactMinutes - 1e-7))
  return {
    storm,
    mine,
    distance,
    edge,
    eta,
    impactMinutes,
    approaching,
    threatening: impactMinutes !== null,
    level: warningLevel(distance),
  }
}
export function threatenedMinesForStorm(storm: DemoStorm, minute: number, mines = MINES) {
  return mines
    .map((mine) => analyzeRelation(storm, mine, minute))
    .filter((relation) => relation.threatening)
    .sort(
      (a, b) =>
        a.impactMinutes! - b.impactMinutes! ||
        a.distance - b.distance ||
        a.mine.id.localeCompare(b.mine.id),
    )
}
export function threateningStormsForMine(mine: Mine, minute: number, storms = DEMO_STORMS) {
  return storms
    .map((s) => analyzeRelation(s, mine, minute))
    .filter((relation) => relation.threatening)
    .sort(
      (a, b) =>
        a.impactMinutes! - b.impactMinutes! ||
        (a.level.level || 5) - (b.level.level || 5) ||
        b.storm.dbz - a.storm.dbz ||
        a.distance - b.distance ||
        a.storm.id.localeCompare(b.storm.id),
    )
}
export function resolveAnalysis(selection: AnalysisSelection, minute: number): CommandAnalysis {
  if (selection.kind === 'storm') {
    const storm = DEMO_STORMS.find((s) => s.id === selection.id) ?? PRIMARY_STORM
    const threats = threatenedMinesForStorm(storm, minute)
    return {
      kind: 'storm',
      mine: threats[0]?.mine ?? null,
      storm,
      relation: threats[0] ?? null,
      threats,
    }
  }
  if (selection.kind === 'mine') {
    const mine = MINES.find((m) => m.id === selection.id) ?? DEMO_MINE
    const threats = threateningStormsForMine(mine, minute)
    return {
      kind: 'mine',
      mine,
      storm: threats[0]?.storm ?? null,
      relation: threats[0] ?? null,
      threats,
    }
  }
  // Preserve the requested opening scene; explicit analysis always switches to calculated observations.
  const preset = demoReading(PRIMARY_STORM, minute)
  const relation = {
    ...analyzeRelation(PRIMARY_STORM, DEMO_MINE, minute),
    ...preset,
    level: warningLevel(preset.distance),
    threatening: true,
  }
  return { kind: 'overview', mine: DEMO_MINE, storm: PRIMARY_STORM, relation, threats: [] }
}
export const mineVisible = (mine: Mine, filter: MineFilter, activeId?: string) =>
  filter === 'all' || PRIORITY_MINE_IDS.has(mine.id) || mine.id === activeId
