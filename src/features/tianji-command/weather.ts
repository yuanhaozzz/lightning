/** Fixed presentation scenario. Geometry, observations and forecasts are simulated. */
export type LngLat = [number, number]
export type WeatherMode = 'live' | 'heat' | 'track' | 'warning'
export type MapScope = 'national' | 'mine'
export interface Mine {
  id: string
  name: string
  region: string
  center: LngLat
}
export interface Storm {
  id: string
  name: string
  start: LngLat
  bearing: number
  speed: number
  radius: number
  phase: number
  dbz: number
}
export interface Strike {
  id: string
  position: LngLat
  minute: number
  current: number
  stormId: string
}

export const MINES: Mine[] = [
  { id: 'shendong', name: '神东矿区', region: '内蒙古 · 鄂尔多斯', center: [110.2, 39.28] },
  { id: 'zhundong', name: '准东矿区', region: '新疆 · 昌吉', center: [89.08, 44.78] },
  { id: 'huolinhe', name: '霍林河矿区', region: '内蒙古 · 通辽', center: [119.65, 45.53] },
  { id: 'huaibei', name: '淮北矿区', region: '安徽 · 淮北', center: [116.78, 33.93] },
  { id: 'liupanshui', name: '六盘水矿区', region: '贵州 · 六盘水', center: [104.83, 26.58] },
  { id: 'panxi', name: '攀西矿区', region: '四川 · 攀枝花', center: [101.72, 26.57] },
]

const RAD = Math.PI / 180
const DEG = 180 / Math.PI
export function distanceKm(a: LngLat, b: LngLat): number {
  const dLat = (b[1] - a[1]) * RAD,
    dLon = (b[0] - a[0]) * RAD
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.sin(dLon / 2) ** 2
  return 6371 * 2 * Math.asin(Math.sqrt(Math.min(1, h)))
}
export function bearingTo(a: LngLat, b: LngLat): number {
  const delta = (b[0] - a[0]) * RAD
  return (
    (Math.atan2(
      Math.sin(delta) * Math.cos(b[1] * RAD),
      Math.cos(a[1] * RAD) * Math.sin(b[1] * RAD) -
        Math.sin(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.cos(delta),
    ) *
      DEG +
      360) %
    360
  )
}
export function destination(origin: LngLat, bearing: number, km: number): LngLat {
  const angle = km / 6371,
    b = bearing * RAD,
    lat = origin[1] * RAD,
    lon = origin[0] * RAD
  const lat2 = Math.asin(
    Math.sin(lat) * Math.cos(angle) + Math.cos(lat) * Math.sin(angle) * Math.cos(b),
  )
  return [
    (lon +
      Math.atan2(
        Math.sin(b) * Math.sin(angle) * Math.cos(lat),
        Math.cos(angle) - Math.sin(lat) * Math.sin(lat2),
      )) *
      DEG,
    lat2 * DEG,
  ]
}

const approaching = (
  mine: Mine,
  id: string,
  name: string,
  offset: number,
  heading: number,
  speed: number,
  radius: number,
  phase: number,
): Storm => {
  const start = destination(mine.center, heading, offset)
  return {
    id,
    name,
    start,
    bearing: bearingTo(start, mine.center),
    speed,
    radius,
    phase,
    dbz: 52 + Math.round(phase * 2),
  }
}
export const STORMS: Storm[] = [
  approaching(MINES[0]!, 'T01', '鄂尔多斯西北雷暴', 435, 304, 138, 210, 0.4),
  approaching(MINES[3]!, 'T02', '皖北雷暴', 285, 238, 68, 160, 1.2),
  approaching(MINES[4]!, 'T03', '黔西雷暴', 230, 295, 46, 140, 2.1),
  approaching(MINES[2]!, 'T04', '蒙东雷暴', 415, 325, 82, 180, 1.7),
  approaching(MINES[0]!, 'T05', '鄂尔多斯东北雷暴', 220, 48, 56, 78, 1.1),
  approaching(MINES[0]!, 'T06', '鄂尔多斯东南雷暴', 178, 132, 42, 86, 2.4),
]
export const stormPosition = (storm: Storm, minute: number) =>
  destination(storm.start, storm.bearing, (minute * storm.speed) / 60)
export function stormRadius(storm: Storm, bearing: number): number {
  const a = bearing * RAD
  return (
    storm.radius *
    (0.83 + Math.sin(a * 3 + storm.phase) * 0.1 + Math.cos(a * 5 - storm.phase) * 0.07)
  )
}
export function stormBoundary(storm: Storm, minute: number): LngLat[] {
  const center = stormPosition(storm, minute)
  return Array.from({ length: 181 }, (_, i) =>
    destination(center, i * 2, stormRadius(storm, i * 2)),
  )
}
export const LEVELS = [
  { level: 4, roman: 'IV', name: '四级预警', radius: 200, color: '#73b4ed', range: '150–200 km' },
  { level: 3, roman: 'III', name: '三级预警', radius: 150, color: '#e3d085', range: '100–150 km' },
  { level: 2, roman: 'II', name: '二级预警', radius: 100, color: '#e9a466', range: '50–100 km' },
  { level: 1, roman: 'I', name: '一级预警', radius: 50, color: '#f07b75', range: '≤ 50 km' },
] as const
export function warningLevel(distance: number) {
  return (
    [...LEVELS].reverse().find((level) => distance <= level.radius) ?? {
      level: 0,
      roman: '—',
      name: '常态监测',
      radius: Infinity,
      color: '#9dcfc3',
      range: '> 200 km',
    }
  )
}
export function stormDistance(mine: Mine, storm: Storm, minute: number) {
  let nearest = { storm, edge: mine.center, distance: Infinity }
  const center = stormPosition(storm, minute)
  const centerDistance = distanceKm(center, mine.center)
  const covered = centerDistance <= stormRadius(storm, bearingTo(center, mine.center))
  for (const point of stormBoundary(storm, minute)) {
    const distance = covered ? 0 : distanceKm(point, mine.center)
    if (distance < nearest.distance)
      nearest = { storm, edge: covered ? mine.center : point, distance }
  }
  return { ...nearest, level: warningLevel(nearest.distance) }
}

/** Rank all independent weather cells; selecting a cell must never hide the mine's highest risk. */
export function stormThreats(mine: Mine, minute: number) {
  return STORMS.map((storm) => {
    const current = stormDistance(mine, storm, minute)
    const closing = current.distance - stormDistance(mine, storm, minute + 1).distance
    const bearing = bearingTo(mine.center, stormPosition(storm, minute))
    const direction = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'][
      Math.round(bearing / 45) % 8
    ]!
    return { ...current, closing, direction, approaching: closing > 0.02 }
  }).sort((a, b) => a.distance - b.distance || a.storm.id.localeCompare(b.storm.id))
}
export function nearestStorm(mine: Mine, minute: number) {
  return STORMS.map((storm) => stormDistance(mine, storm, minute)).sort(
    (a, b) => a.distance - b.distance || a.storm.id.localeCompare(b.storm.id),
  )[0]!
}

/** First intersection of the moving echo with the mine centre; null means no arrival in 3 h. */
export function arrivalMinutes(mine: Mine, storm: Storm, minute: number): number | null {
  const covered = (offset: number) => {
    const center = stormPosition(storm, minute + offset)
    return distanceKm(center, mine.center) <= stormRadius(storm, bearingTo(center, mine.center))
  }
  if (covered(0)) return 0
  for (let end = 1; end <= 180; end++) {
    if (!covered(end)) continue
    let lo = end - 1, hi = end
    for (let i = 0; i < 12; i++) {
      const middle = (lo + hi) / 2
      if (covered(middle)) hi = middle
      else lo = middle
    }
    return Math.ceil(hi)
  }
  return null
}
export function distanceReading(km: number) {
  return km < 1 ? { value: Math.round(km * 1000).toString(), unit: 'm' } : { value: km.toFixed(1), unit: 'km' }
}

let seed = 38217
const random = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) | 0
  return (seed >>> 0) / 4294967296
}
export const STRIKES: Strike[] = STORMS.flatMap((storm) =>
  Array.from({ length: 110 }, (_, i) => {
    const minute = Math.round(random() * 90)
    const bearing = random() * 360
    return {
      id: `${storm.id}-${i}`,
      stormId: storm.id,
      minute,
      position: destination(
        stormPosition(storm, minute),
        bearing,
        stormRadius(storm, bearing) * Math.sqrt(random()) * 0.83,
      ),
      current: Math.round((18 + random() * 77) * 10) / 10,
    }
  }),
).sort((a, b) => a.minute - b.minute)
export const visibleStrikes = (minute: number) =>
  STRIKES.filter((strike) => strike.minute <= minute && strike.minute > minute - 30)
export const scenarioTime = (minute: number) =>
  `${String(14 + Math.floor(minute / 60)).padStart(2, '0')}:${String(Math.floor(minute % 60)).padStart(2, '0')}`
