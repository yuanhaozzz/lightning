/**
 * 全域水利系统大屏 —— 专题数据与地理要素。
 *
 * 行政区边界来自 public/china.geojson（重庆市），河网为按真实走向手工整理的
 * 示意折线，用于在没有外部瓦片服务时也能完整呈现水系结构。
 */

export type LngLat = [number, number]

export interface StatCard {
  label: string
  value: number
  decimals?: number
  unit: string
  icon: 'river' | 'reservoir' | 'station' | 'alert' | 'level' | 'online' | 'dispatch'
  tone: 'cyan' | 'amber' | 'green'
}

export interface ChartSpec {
  title: string
  subtitle: string
  kind: 'line' | 'ramp'
  points: number[]
  yMax: number
  yTicks: number[]
  xLabels: string[]
  accent: string
  unit: string
}

export interface TabSpec {
  key: string
  name: string
  glyph: string
  overview: string
  scene: 'rain' | 'water' | 'project' | 'emergency'
  stats: StatCard[]
  charts: [ChartSpec, ChartSpec]
}

export interface Station {
  name: string
  coord: LngLat
  kind: 'hydro' | 'reservoir' | 'gauge'
  level: 'normal' | 'watch' | 'alarm'
  /** 标签相对图钉的位置，用于错开相邻测站的文字 */
  side?: 'top' | 'bottom'
  badge?: string
}

/* ------------------------------------------------------------------ 河网 ---- */

/** 长江干流：江津入境 → 主城 → 涪陵 → 万州 → 奉节 → 巫山出境。 */
const yangtze: LngLat[] = [
  [105.86, 28.82], [105.98, 28.96], [106.12, 29.12], [106.26, 29.29], [106.38, 29.42],
  [106.48, 29.51], [106.56, 29.57], [106.66, 29.60], [106.78, 29.62], [106.92, 29.64],
  [107.06, 29.66], [107.22, 29.68], [107.39, 29.71], [107.56, 29.79], [107.72, 29.88],
  [107.88, 30.00], [108.02, 30.14], [108.14, 30.29], [108.26, 30.46], [108.35, 30.64],
  [108.41, 30.81], [108.55, 30.87], [108.70, 30.93], [108.90, 30.96], [109.10, 30.99],
  [109.30, 31.01], [109.46, 31.03], [109.64, 31.05], [109.80, 31.06], [109.92, 31.08],
]

/** 嘉陵江：合川汇涪江、渠江后南流，于朝天门入长江。 */
const jialing: LngLat[] = [
  [105.78, 30.42], [105.96, 30.32], [106.12, 30.22], [106.27, 30.06], [106.33, 29.94],
  [106.39, 29.83], [106.46, 29.73], [106.52, 29.65], [106.56, 29.58],
]

/** 渠江：自东北向西南入合川。 */
const qujiang: LngLat[] = [
  [106.92, 31.24], [106.84, 31.06], [106.72, 30.86], [106.58, 30.66], [106.44, 30.44],
  [106.33, 30.24], [106.27, 30.06],
]

/** 涪江：自西北入合川。 */
const fujiang: LngLat[] = [
  [105.52, 30.72], [105.68, 30.58], [105.84, 30.44], [106.00, 30.30], [106.14, 30.18],
  [106.27, 30.06],
]

/** 乌江：自黔东南向西北，于涪陵入长江。 */
const wujiang: LngLat[] = [
  [108.72, 28.52], [108.58, 28.72], [108.44, 28.92], [108.32, 29.10], [108.22, 29.26],
  [108.10, 29.38], [107.98, 29.48], [107.84, 29.56], [107.68, 29.63], [107.52, 29.68],
  [107.39, 29.71],
]

/** 綦江：自南向北于江津入长江。 */
const qijiang: LngLat[] = [
  [106.66, 28.56], [106.62, 28.74], [106.58, 28.92], [106.52, 29.08], [106.44, 29.20],
  [106.34, 29.26], [106.26, 29.29],
]

/** 大宁河：自北向南于巫山入长江。 */
const daning: LngLat[] = [
  [109.72, 31.62], [109.78, 31.44], [109.84, 31.26], [109.88, 31.16], [109.90, 31.08],
]

/** 阿蓬江（乌江支流）：黔江一带。 */
const apeng: LngLat[] = [
  [108.94, 29.30], [108.86, 29.42], [108.78, 29.53], [108.68, 29.62], [108.56, 29.70],
  [108.44, 29.74],
]

/** 龙溪河：长寿湖出流，于涪陵入长江。 */
const longxi: LngLat[] = [
  [107.42, 30.10], [107.32, 30.02], [107.20, 29.93], [107.08, 29.86], [106.98, 29.80],
  [106.90, 29.74],
]

/** 小江：开州 → 云阳入长江。 */
const xiaojiang: LngLat[] = [
  [108.24, 31.36], [108.32, 31.20], [108.40, 31.04], [108.50, 30.92], [108.60, 30.84],
]

/** 郁江：彭水入乌江。 */
const yujiang: LngLat[] = [
  [108.46, 29.06], [108.36, 29.14], [108.26, 29.22], [108.17, 29.29],
]

/** 御临河：自北向南于渝北入长江。 */
const yulin: LngLat[] = [
  [106.95, 30.34], [106.88, 30.16], [106.82, 29.98], [106.82, 29.82], [106.86, 29.66],
]

/** 龙河：石柱向西北于丰都入长江。 */
const longhe: LngLat[] = [
  [108.36, 30.04], [108.20, 29.99], [108.04, 29.95], [107.90, 29.91], [107.76, 29.88],
]

/** 梅溪河：大巴山南麓入长江。 */
const meixi: LngLat[] = [
  [108.62, 31.46], [108.60, 31.26], [108.56, 31.08], [108.52, 30.94],
]

/** 汤溪河：云阳境内入长江。 */
const tangxi: LngLat[] = [
  [108.94, 31.42], [108.98, 31.24], [109.01, 31.09],
]

/** 磨刀溪：石柱向东北入长江。 */
const modaoxi: LngLat[] = [
  [108.64, 30.54], [108.56, 30.66], [108.49, 30.77],
]

/** 濑溪河：荣昌一带入沱江—长江水系。 */
const laixi: LngLat[] = [
  [105.56, 29.54], [105.70, 29.45], [105.85, 29.38], [106.02, 29.33], [106.18, 29.30],
]

/** 大洪河：长寿东北部入长江。 */
const dahong: LngLat[] = [
  [107.36, 30.32], [107.25, 30.21], [107.15, 30.09], [107.07, 29.99],
]

/** 任河：城口北部入汉江流域。 */
const renhe: LngLat[] = [
  [108.34, 32.04], [108.46, 31.86], [108.54, 31.64], [108.60, 31.44],
]

/** 酉水：渝东南出境入沅江。 */
const youshui: LngLat[] = [
  [109.12, 28.56], [109.03, 28.76], [108.94, 28.95], [108.86, 29.12], [108.78, 29.28],
]

interface RiverSpec {
  name: string
  level: 1 | 2
  coords: LngLat[]
}

export const rivers: RiverSpec[] = [
  { name: '长江', level: 1, coords: yangtze },
  { name: '嘉陵江', level: 1, coords: jialing },
  { name: '乌江', level: 1, coords: wujiang },
  { name: '渠江', level: 2, coords: qujiang },
  { name: '涪江', level: 2, coords: fujiang },
  { name: '綦江', level: 2, coords: qijiang },
  { name: '大宁河', level: 2, coords: daning },
  { name: '阿蓬江', level: 2, coords: apeng },
  { name: '龙溪河', level: 2, coords: longxi },
  { name: '小江', level: 2, coords: xiaojiang },
  { name: '郁江', level: 2, coords: yujiang },
  { name: '御临河', level: 2, coords: yulin },
  { name: '龙河', level: 2, coords: longhe },
  { name: '梅溪河', level: 2, coords: meixi },
  { name: '汤溪河', level: 2, coords: tangxi },
  { name: '磨刀溪', level: 2, coords: modaoxi },
  { name: '濑溪河', level: 2, coords: laixi },
  { name: '大洪河', level: 2, coords: dahong },
  { name: '任河', level: 2, coords: renhe },
  { name: '酉水', level: 2, coords: youshui },
]

/* --------------------------------------------------------------- 重点线路 ---- */

/** 重点巡检线路：沿长江左岸自江津至奉节，略作偏移以贴合参考图的双线效果。 */
export const patrolRoute: LngLat[] = yangtze
  .slice(3, 27)
  .map(([lng, lat]) => [lng + 0.035, lat + 0.055] as LngLat)

/* ----------------------------------------------------------------- 水库 ---- */

/**
 * 三峡库区回水段：沿长江干流生成的带状水面。
 * 参考图的“大湖面”即库区蓄水后的江面展宽，这里用折线缓冲面近似。
 */
export function bufferLine(coords: LngLat[], halfWidth: number, taper = true): LngLat[] {
  const left: LngLat[] = []
  const right: LngLat[] = []
  for (let index = 0; index < coords.length; index += 1) {
    const previous = coords[Math.max(0, index - 1)]!
    const next = coords[Math.min(coords.length - 1, index + 1)]!
    const dx = next[0] - previous[0]
    const dy = next[1] - previous[1]
    const length = Math.hypot(dx, dy) || 1
    const nx = -dy / length
    const ny = dx / length
    const ratio = taper ? 0.42 + 0.58 * Math.sin((index / (coords.length - 1)) * Math.PI) : 1
    const width = halfWidth * ratio
    left.push([coords[index]![0] + nx * width, coords[index]![1] + ny * width])
    right.push([coords[index]![0] - nx * width, coords[index]![1] - ny * width])
  }
  return [...left, ...right.reverse(), left[0]!]
}

/** 长寿湖：龙溪河上的人工湖，沿河道呈狭长形。 */
export const changshouLake: LngLat[] = [
  [107.46, 30.05], [107.40, 30.13], [107.31, 30.15], [107.23, 30.10], [107.16, 30.02],
  [107.09, 29.94], [107.01, 29.87], [106.95, 29.80], [107.03, 29.76], [107.10, 29.82],
  [107.17, 29.89], [107.25, 29.95], [107.32, 29.99], [107.40, 30.01], [107.46, 30.05],
]

/* --------------------------------------------------------------- 监测站点 ---- */

/**
 * 测站按水系节点选取，标签上下交错，避免相邻站点文字互相压盖。
 * 数量控制在 9 个：既能表达流域监测密度，又不会让地图文字过密。
 */
export const stations: Station[] = [
  { name: '嘉陵江·合川站', coord: [106.27, 30.06], kind: 'hydro', level: 'alarm', side: 'top', badge: '01' },
  { name: '长寿湖水库', coord: [107.24, 30.00], kind: 'reservoir', level: 'normal', side: 'top' },
  { name: '长江·江津站', coord: [106.26, 29.29], kind: 'hydro', level: 'watch', side: 'bottom' },
  { name: '乌江·涪陵站', coord: [107.39, 29.71], kind: 'hydro', level: 'alarm', side: 'bottom' },
  { name: '乌江·武隆站', coord: [107.76, 29.33], kind: 'hydro', level: 'watch', side: 'bottom' },
  { name: '阿蓬江·黔江站', coord: [108.77, 29.53], kind: 'hydro', level: 'normal', side: 'bottom' },
  { name: '长江·万州站', coord: [108.41, 30.81], kind: 'hydro', level: 'alarm', side: 'top', badge: '02' },
  { name: '长江·奉节站', coord: [109.46, 31.03], kind: 'hydro', level: 'watch', side: 'bottom' },
  { name: '东岭雨量站', coord: [109.05, 30.42], kind: 'gauge', level: 'normal', side: 'top' },
]

export const levelMeta: Record<Station['level'], { label: string; color: string }> = {
  normal: { label: '正常', color: '#3fe0ff' },
  watch: { label: '关注', color: '#ffd75e' },
  alarm: { label: '超警', color: '#ff6b4a' },
}

/* ----------------------------------------------------------------- 专题页 ---- */

const dayLabels = ['1日', '5日', '10日', '15日', '20日', '25日', '30日']

export const tabs: TabSpec[] = [
  {
    key: 'rain',
    name: '雨情监测',
    glyph: '☂',
    overview: '水利态势总览',
    scene: 'rain',
    stats: [
      { label: '河流总长', value: 1286, unit: 'km', icon: 'river', tone: 'cyan' },
      { label: '水库容量', value: 3.72, decimals: 2, unit: '亿 m³', icon: 'reservoir', tone: 'cyan' },
      { label: '监测站点', value: 348, unit: '个', icon: 'station', tone: 'cyan' },
      { label: '预警事件', value: 12, unit: '起', icon: 'alert', tone: 'amber' },
    ],
    charts: [
      {
        title: '雨情监测',
        subtitle: '近 30 日累计降雨量',
        kind: 'line',
        points: [34, 72, 128, 205, 138, 96, 232],
        yMax: 300,
        yTicks: [0, 100, 200, 300],
        xLabels: dayLabels,
        accent: '#35d8ff',
        unit: 'mm',
      },
      {
        title: '降水监测',
        subtitle: '流域面雨量分布',
        kind: 'ramp',
        points: [8, 14, 26, 44, 72, 104, 142, 178, 196, 182, 148, 112, 84, 62, 46, 34, 26, 20, 15, 11, 8, 6, 5, 4, 3, 3, 2, 2, 1, 1],
        yMax: 200,
        yTicks: [0, 50, 100, 150, 200],
        xLabels: dayLabels,
        accent: '#8ef2c0',
        unit: 'mm',
      },
    ],
  },
  {
    key: 'water',
    name: '水情预警',
    glyph: '≈',
    overview: '水情态势总览',
    scene: 'water',
    stats: [
      { label: '超警河段', value: 6, unit: '处', icon: 'level', tone: 'amber' },
      { label: '超保河段', value: 2, unit: '处', icon: 'alert', tone: 'amber' },
      { label: '平均水位', value: 173.6, decimals: 1, unit: 'm', icon: 'river', tone: 'cyan' },
      { label: '蓄水总量', value: 41.8, decimals: 1, unit: '亿 m³', icon: 'reservoir', tone: 'cyan' },
    ],
    charts: [
      {
        title: '水位过程线',
        subtitle: '寸滩站 · 24 小时',
        kind: 'line',
        points: [152, 158, 166, 175, 184, 189, 186, 178, 170, 163, 158, 155, 159, 167],
        yMax: 200,
        yTicks: [0, 50, 100, 150, 200],
        xLabels: ['0时', '4时', '8时', '12时', '16时', '20时', '24时'],
        accent: '#5ad1ff',
        unit: 'm',
      },
      {
        title: '超警分布',
        subtitle: '分区超警站点数',
        kind: 'ramp',
        points: [4, 9, 18, 32, 56, 88, 126, 164, 188, 172, 140, 106, 78, 56, 40, 29, 21, 15, 11, 8, 6, 4, 3, 3, 2, 2, 1, 1, 1, 1],
        yMax: 200,
        yTicks: [0, 50, 100, 150, 200],
        xLabels: dayLabels,
        accent: '#ffcf6b',
        unit: '站',
      },
    ],
  },
  {
    key: 'project',
    name: '工程状态',
    glyph: '▤',
    overview: '工程态势总览',
    scene: 'project',
    stats: [
      { label: '水库工程', value: 3072, unit: '座', icon: 'reservoir', tone: 'cyan' },
      { label: '设备在线率', value: 98.6, decimals: 1, unit: '%', icon: 'online', tone: 'green' },
      { label: '巡检完成率', value: 92.4, decimals: 1, unit: '%', icon: 'station', tone: 'green' },
      { label: '待修工程', value: 17, unit: '处', icon: 'alert', tone: 'amber' },
    ],
    charts: [
      {
        title: '巡检完成率',
        subtitle: '近 30 日重点工程巡检完成率',
        kind: 'line',
        points: [64, 71, 78, 85, 90, 93, 95, 92, 88, 84, 87, 91, 94, 96],
        yMax: 100,
        yTicks: [0, 25, 50, 75, 100],
        xLabels: ['1日', '5日', '10日', '15日', '20日', '25日', '30日'],
        accent: '#7ef0b8',
        unit: '%',
      },
      {
        title: '库容曲线',
        subtitle: '重点水库蓄水率',
        kind: 'ramp',
        points: [10, 18, 30, 48, 74, 106, 140, 170, 184, 176, 152, 122, 96, 74, 56, 42, 32, 24, 18, 14, 10, 8, 6, 5, 4, 3, 3, 2, 2, 1],
        yMax: 200,
        yTicks: [0, 50, 100, 150, 200],
        xLabels: dayLabels,
        accent: '#6fe3ff',
        unit: '%',
      },
    ],
  },
  {
    key: 'emergency',
    name: '应急处置',
    glyph: '⚠',
    overview: '险情处置总览',
    scene: 'emergency',
    stats: [
      { label: '待处置事件', value: 12, unit: '起', icon: 'alert', tone: 'amber' },
      { label: '已处置事件', value: 146, unit: '起', icon: 'dispatch', tone: 'green' },
      { label: '平均响应', value: 8.4, decimals: 1, unit: 'min', icon: 'station', tone: 'cyan' },
      { label: '在岗人员', value: 1284, unit: '人', icon: 'online', tone: 'cyan' },
    ],
    charts: [
      {
        title: '响应时效',
        subtitle: '近 30 日平均响应时长',
        kind: 'line',
        points: [42, 36, 31, 26, 29, 22, 19, 15, 18, 14, 12, 15, 11, 9],
        yMax: 50,
        yTicks: [0, 10, 20, 30, 40, 50],
        xLabels: dayLabels,
        accent: '#ffb057',
        unit: 'min',
      },
      {
        title: '物资调度',
        subtitle: '抢险物资出库量',
        kind: 'ramp',
        points: [2, 5, 11, 22, 40, 66, 98, 132, 158, 146, 120, 94, 72, 55, 41, 31, 23, 17, 13, 10, 8, 6, 5, 4, 3, 2, 2, 2, 1, 1],
        yMax: 200,
        yTicks: [0, 50, 100, 150, 200],
        xLabels: dayLabels,
        accent: '#a99bff',
        unit: '件',
      },
    ],
  },
]
