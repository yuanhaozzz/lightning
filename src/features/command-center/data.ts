import { MINE_AREAS } from '../china-map/mines'

/* =========================================================================
   雷穹指挥舱 · 演示数据层
   真实项目接入时，把 parseLightning / fetchAssets 换成后端接口即可，
   组件只依赖此处导出的类型，不依赖数据来源。
   ========================================================================= */

export type RiskLevel = 'normal' | 'attention' | 'warning' | 'impact'
export type DeviceState = 'online' | 'action' | 'offline'

export interface AssetSite {
  id: string
  /** 站名，如「神东矿区 110kV 变电站」 */
  name: string
  /** 资产类型：煤矿 / 电厂 / 变电站 / 风电场 / 化工厂 */
  kind: string
  /** 所属集团（央国企客户） */
  owner: string
  lon: number
  lat: number
  /** 电压等级，用于右侧索引条快速跳转 */
  voltage: string
  risk: RiskLevel
  /** 被保护设备总数 */
  deviceCount: number
  /** 动作 / 离线数量（红色数字角标用） */
  abnormal: number
  /** 距最近落雷 km */
  nearestKm: number
  /** 预计影响分钟；0 = 正在影响 */
  eta: number
  /** 雷击防护状态文案 */
  shield: string
}

export interface Strike {
  id: string
  lon: number
  lat: number
  /** 相对推演窗口起点的时间偏移（秒） */
  t: number
  /** 绝对时刻（epoch ms），用于事件详情与工单时间线 */
  at: number
  /** 峰值电流 kA */
  current: number
  polarity: 'positive' | 'negative'
  /** 落雷类型：正地闪 / 负地闪 / 云闪 */
  type: string
  /** 最近的受保护资产 */
  siteId: string
  distanceKm: number
  /** 设备联动响应耗时 ms，0 表示未触发保护 */
  responseMs: number
  /** 是否已拦截 */
  intercepted: boolean
}

export interface Alarm {
  id: string
  siteId: string
  title: string
  category: string
  level: 'critical' | 'warn' | 'info'
  ago: string
  detail: string
  handled: boolean
}

export interface DeviceRecord {
  id: string
  siteId: string
  name: string
  type: string
  state: DeviceState
  /** 异常次数，右侧红色角标 */
  faults: number
  /** 接地电阻 Ω */
  resistance: number
  /** 保护动作次数 */
  actions: number
  /** 最近自检 */
  checkedAt: string
  ip: string
}

export interface GridLine {
  name: string
  /** 通道性质：特高压直流 / 500kV 骨干 / 矿区集电 */
  kind: 'uhv' | 'backbone' | 'collect'
  points: [number, number][]
}

export interface Corridor {
  /** 风险走廊多边形（未来 1 小时高概率落雷带） */
  name: string
  eta: string
  points: [number, number][]
}

/* —— 推演时间窗口：最近 6 小时 —— */
export const WINDOW_SECONDS = 6 * 3600

/** 窗口起点（固定为演示当日 08:00） */
export const WINDOW_START = new Date(2026, 8, 27, 8, 0, 0).getTime()
/** 窗口终点（演示当日 14:00，接近"当前时刻"） */
export const WINDOW_END = WINDOW_START + WINDOW_SECONDS * 1000

/**
 * 数据来源台账。
 * 指挥舱里每一条结论都必须可溯源：哪一层是实测、哪一层是反演、哪一层是预测。
 * 把"预测"和"实测"混在一个视觉层级里，是这个行业最容易出的错。
 */
export const DATA_SOURCES = [
  { key: 'lld', label: '闪电定位', value: 'ADTD 地基闪电定位网 · 实测', kind: 'measured' },
  { key: 'radar', label: '雷达回波', value: '区域雷达组合反射率 · 实测', kind: 'measured' },
  { key: 'corridor', label: '风险走廊', value: '雷达外推 60min · 模型预测', kind: 'predicted' },
  { key: 'spd', label: '装置动作', value: '防雷物联网终端 · 实测', kind: 'measured' },
] as const

/* —— 确定性随机：保证每次刷新数据一致，演示可复现 —— */
let seed = 0x5a17_2026
const rnd = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
  return seed / 4294967296
}
const gauss = () => Math.sqrt(-2 * Math.log(Math.max(rnd(), 1e-7))) * Math.cos(2 * Math.PI * rnd())

/* ============================ 资产站点 ============================ */

type SiteSeed = [string, string, string, number, number, string, RiskLevel, number, number, number]

const SITE_SEEDS: SiteSeed[] = [
  ['神东矿区', '煤矿', '国家能源集团', 110.2, 39.28, '110kV', 'impact', 386, 3, 0],
  ['粤东海上风电', '风电场', '华能集团', 116.74, 22.86, '220kV', 'impact', 412, 2, 0],
  ['川南电网枢纽', '变电站', '国家电网', 104.64, 28.77, '500kV', 'warning', 218, 1, 24],
  ['大柳塔煤矿', '煤矿', '国家能源集团', 110.17, 39.28, '35kV', 'warning', 148, 0, 12],
  ['准东煤电基地', '电厂', '国家能源集团', 89.08, 44.78, '±1100kV', 'attention', 264, 1, 96],
  ['鲁北化工园区', '化工厂', '中国石化', 118.17, 37.47, '110kV', 'attention', 96, 0, 46],
  ['滇中能源基地', '变电站', '南方电网', 102.71, 25.05, '500kV', 'attention', 132, 0, 88],
  ['河西新能源基地', '风电场', '华电集团', 100.46, 38.92, '330kV', 'normal', 188, 0, 214],
  ['新疆达坂城风电', '风电场', '国家能源集团', 88.32, 43.36, '220kV', 'normal', 224, 0, 302],
  ['锡盟特高压站', '变电站', '国家电网', 116.09, 43.94, '1000kV', 'normal', 176, 0, 268],
  ['淮北矿区', '煤矿', '淮北矿业', 116.78, 33.93, '35kV', 'normal', 118, 0, 186],
  ['六盘水矿区', '煤矿', '贵州能源集团', 104.83, 26.58, '110kV', 'normal', 142, 1, 240],
  ['攀西矿区', '煤矿', '四川资源集团', 101.72, 26.57, '110kV', 'normal', 106, 0, 286],
  // 两处真实文物保护单位的防雷监测点
  ['拜寺口双塔', '文物古建', '银川雷电监测中心', 105.86, 38.7, '低压', 'warning', 24, 1, 19],
  ['固原博物馆', '文物古建', '固原雷电监测中心', 106.285, 36.015, '低压', 'attention', 18, 0, 62],
]

export const assetSites: AssetSite[] = SITE_SEEDS.map(
  ([name, kind, owner, lon, lat, voltage, risk, deviceCount, abnormal, eta], index) => ({
    id: `S${String(index + 1).padStart(2, '0')}`,
    name,
    kind,
    owner,
    lon,
    lat,
    voltage,
    risk,
    deviceCount,
    abnormal,
    eta,
    nearestKm: Number((risk === 'impact' ? 0.8 + rnd() * 1.6 : 4 + rnd() * 60).toFixed(1)),
    shield:
      risk === 'impact'
        ? '保护动作 · 已拦截'
        : risk === 'warning'
          ? '一级预警 · 待命'
          : risk === 'attention'
            ? '监测加强'
            : '运行正常',
  }),
)

/* ============================ 能源骨架线 ============================ */

export const gridLines: GridLine[] = [
  {
    name: '锡盟—山东 1000kV 特高压',
    kind: 'uhv',
    points: [
      [116.09, 43.94],
      [115.4, 41.6],
      [117.2, 39.1],
      [117.9, 37.4],
      [117.0, 36.6],
    ],
  },
  {
    name: '准东—皖南 ±1100kV',
    kind: 'uhv',
    points: [
      [89.08, 44.78],
      [94.6, 42.4],
      [101.6, 38.6],
      [107.4, 34.6],
      [112.6, 32.4],
      [117.4, 30.9],
    ],
  },
  {
    name: '川南—华东 500kV 通道',
    kind: 'backbone',
    points: [
      [104.64, 28.77],
      [107.2, 28.4],
      [110.4, 28.6],
      [113.6, 28.9],
      [116.7, 29.8],
      [119.4, 31.2],
    ],
  },
  {
    name: '神东—京津冀 500kV 通道',
    kind: 'backbone',
    points: [
      [110.2, 39.28],
      [111.6, 38.4],
      [113.4, 37.6],
      [115.2, 37.9],
      [117.2, 39.2],
    ],
  },
  {
    name: '河西—华中 750kV 通道',
    kind: 'backbone',
    points: [
      [100.46, 38.92],
      [103.4, 37.2],
      [106.2, 35.4],
      [108.9, 33.8],
    ],
  },
  {
    name: '粤东海上风电集电',
    kind: 'collect',
    points: [
      [116.74, 22.86],
      [116.2, 23.3],
      [115.6, 23.6],
      [114.9, 23.4],
    ],
  },
  {
    name: '滇中—黔西 500kV 通道',
    kind: 'collect',
    points: [
      [102.71, 25.05],
      [104.83, 26.58],
      [106.4, 27.2],
    ],
  },
]

/* ============================ 雷击事件 ============================ */

/** 雷暴单体：经纬度中心 + 长宽半径 + 能量系数 */
const STORM_CELLS: Array<[number, number, number, number, number]> = [
  [110.9, 39.6, 1.9, 0.78, 2.3],
  [116.9, 23.1, 1.7, 0.7, 2.6],
  [104.4, 28.4, 1.5, 0.8, 1.9],
  [118.3, 37.4, 1.1, 0.6, 1.3],
  [106.3, 36.0, 0.8, 0.5, 1.1],
  [102.6, 25.1, 1.2, 0.7, 1.4],
]

function nearestSite(lon: number, lat: number) {
  let best = assetSites[0]!
  let bestKm = Number.POSITIVE_INFINITY
  for (const site of assetSites) {
    const dx = (site.lon - lon) * 85
    const dy = (site.lat - lat) * 111
    const km = Math.hypot(dx, dy)
    if (km < bestKm) {
      bestKm = km
      best = site
    }
  }
  return { site: best, km: bestKm }
}

function buildStrikes(): Strike[] {
  seed = 0x5a17_2026
  const list: Strike[] = []
  const total = 420
  for (let index = 0; index < total; index += 1) {
    const picked = rnd()
    const cellIndex =
      picked < 0.24 ? 0 : picked < 0.48 ? 1 : picked < 0.7 ? 2 : picked < 0.84 ? 3 : picked < 0.94 ? 4 : 5
    const cell = STORM_CELLS[cellIndex]!
    /* 雷暴成熟期能量集中在中段，模拟真实的"爆发—衰减"包络 */
    const envelope = Math.sin(((index % 60) / 60) * Math.PI)
    const angle = rnd() * Math.PI * 2
    const radial = Math.pow(rnd(), 0.62)
    const lon = cell[0] + Math.cos(angle) * cell[2] * radial + gauss() * 0.06
    const lat = cell[1] + Math.sin(angle) * cell[3] * radial + gauss() * 0.05
    const positive = rnd() > 0.74
    /**
     * 幅值分布按工程实测取值域：负地闪多数在 10–60 kA，
     * 正地闪常在 100–200 kA，全球实测极值约 ±300 kA。
     * 单体能量系数只作用于中低幅值段，避免随机数把结果推到物理上不存在的量级
     * （客户里的防雷专家一眼就能看出 250 kA 的负地闪是假的）。
     */
    const current = Math.min(
      210,
      Math.round(
        (5 + Math.pow(rnd(), 1.9) * 55 * cell[4] + (positive ? 70 + rnd() * 60 : 0)) *
          (0.7 + envelope * 0.4),
      ),
    )
    const near = nearestSite(lon, lat)
    /**
     * 保护动作判据：雷击落在防雷保护范围（工程上一般按 10–15 km 计）内，
     * 且幅值足以驱动 SPD 动作。这个判据直接决定了"装置动作实况"里
     * 有多少条实测记录，也决定了指挥舱看上去"防护到底有没有在起作用"。
     */
    const intercepted = current >= 20 && near.km <= 15
    const t = Math.round(((index + rnd()) / total) * WINDOW_SECONDS * 0.97)
    list.push({
      id: `STK${String(index + 1).padStart(4, '0')}`,
      lon,
      lat,
      t,
      at: WINDOW_START + t * 1000,
      current,
      polarity: positive ? 'positive' : 'negative',
      type: positive ? '正地闪' : rnd() > 0.78 ? '云闪' : '负地闪',
      siteId: near.site.id,
      distanceKm: Number(near.km.toFixed(1)),
      responseMs: intercepted ? Math.round(1.8 + rnd() * 6.4) : 0,
      intercepted,
    })
  }
  return list.sort((a, b) => a.t - b.t)
}

export const strikes: Strike[] = buildStrikes()

/** 最强落雷：用于巨幕指标与默认聚焦 */
export const peakStrike: Strike = strikes.reduce((a, b) => (b.current > a.current ? b : a), strikes[0]!)

/* ============================ 威胁轨迹 ============================ */

export interface ThreatTrack {
  id: string
  name: string
  /** 云团起步点 → 当前核心点 */
  points: [number, number][]
  /** 移动方向角（度）与速度 km/h */
  direction: number
  speed: number
  /** 目标资产 */
  siteId: string
  etaMinutes: number
  maxDbz: number
}

function track(
  id: string,
  name: string,
  from: [number, number],
  to: [number, number],
  bend: number,
  speed: number,
  direction: number,
  siteId: string,
  etaMinutes: number,
  maxDbz: number,
): ThreatTrack {
  const points: [number, number][] = []
  const steps = 48
  for (let index = 0; index <= steps; index += 1) {
    const p = index / steps
    const lon = from[0] + (to[0] - from[0]) * p + Math.sin(p * Math.PI) * bend * 0.6
    const lat = from[1] + (to[1] - from[1]) * p + Math.sin(p * Math.PI * 0.8) * bend * 0.32
    points.push([lon, lat])
  }
  return { id, name, points, speed, direction, siteId, etaMinutes, maxDbz }
}

export const threatTracks: ThreatTrack[] = [
  track('TK-01', '雷暴单体 A2309', [108.6, 41.1], [110.9, 39.5], 1.1, 42, 138, 'S01', 11, 66),
  track('TK-02', '雷暴单体 B1742', [116.0, 24.6], [117.1, 23.0], -0.8, 34, 152, 'S02', 8, 68),
  track('TK-03', '雷暴单体 C3810', [102.6, 29.6], [104.5, 28.5], 0.7, 28, 126, 'S03', 26, 58),
]

/** 未来 1 小时高风险走廊（沿主轨迹外扩，属于模型预测产品，不是闪电定位实测） */
export const corridors: Corridor[] = [
  {
    name: '未来 1 小时高风险走廊',
    eta: '11 min 后抵达 神东矿区',
    points: [
      [109.4, 40.5],
      [110.0, 40.1],
      [110.6, 39.9],
      [111.3, 39.4],
      [111.6, 38.8],
      [111.0, 38.5],
      [110.2, 38.7],
      [109.5, 39.3],
      [109.1, 39.9],
    ],
  },
]

/**
 * 走廊生成方式：以雷达组合反射率的外推矢量为主轴，叠加闪电密度核，
 * 外扩 1.5 个雷暴单体半径。这里写成注释而不是黑箱，
 * 是因为央企的安全生产部门一定会问"这条红带子是怎么算出来的"。
 */
export const CORRIDOR_METHOD = '雷达外推矢量 + 闪电密度核 · 外扩 1.5R'

/* ============================ 告警与设备 ============================ */

export const alarms: Alarm[] = [
  {
    id: 'A-2401',
    siteId: 'S01',
    title: '神东矿区 110kV 变电站',
    category: '浪涌保护器动作',
    level: 'critical',
    ago: '刚刚',
    detail: '峰值电流 96kA · 距站 1.2km · 3 组 SPD 同步泄流',
    handled: false,
  },
  {
    id: 'A-2402',
    siteId: 'S02',
    title: '粤东海上风电 220kV 升压站',
    category: '接地电阻越限',
    level: 'critical',
    ago: '2 分钟前',
    detail: '接地电阻 4.8Ω（阈值 4.0Ω）· 已触发复测工单',
    handled: false,
  },
  {
    id: 'A-2403',
    siteId: 'S15',
    title: '拜寺口双塔 防雷监测点',
    category: '接闪器动作',
    level: 'warn',
    ago: '19 分钟前',
    detail: '峰值电流 96kA 正地闪 · 文物本体无损伤',
    handled: false,
  },
  {
    id: 'A-2404',
    siteId: 'S03',
    title: '川南电网枢纽 500kV 变电站',
    category: '雷电临近预警',
    level: 'warn',
    ago: '24 分钟前',
    detail: '雷暴距站 11km · 预计 24 分钟进入警戒圈',
    handled: false,
  },
  {
    id: 'A-2405',
    siteId: 'S06',
    title: '鲁北化工园区 110kV 配电',
    category: '设备通讯中断',
    level: 'info',
    ago: '46 分钟前',
    detail: '2 台在线监测终端失联 · 已自动重连 1 台',
    handled: true,
  },
]

export const devices: DeviceRecord[] = assetSites.flatMap((site, siteIndex) => {
  const models: Array<[string, string]> = [
    ['SPD 浪涌保护器', '浪涌保护'],
    ['接地电阻在线监测', '接地监测'],
    ['接闪杆 / 避雷针', '直击雷防护'],
    ['雷电流记录仪', '雷电流采集'],
    ['大气电场仪', '预警感知'],
    ['智能防雷箱', '综合防护'],
  ]
  const count = site.deviceCount > 200 ? 5 : 3
  return Array.from({ length: count }, (_, index) => {
    const [name, type] = models[(siteIndex + index) % models.length]!
    const faultSeed = (site.abnormal + siteIndex + index) % 4
    const state: DeviceState = faultSeed === 0 && site.abnormal > 0 ? 'offline' : site.risk === 'impact' && index === 0 ? 'action' : 'online'
    return {
      id: `${site.id}-D${String(index + 1).padStart(2, '0')}`,
      siteId: site.id,
      name: `${name} #${String(index + 1).padStart(2, '0')}`,
      type,
      state,
      faults: state === 'offline' ? 2 + (index % 3) : state === 'action' ? 1 : 0,
      resistance: Number((1.6 + rnd() * 3.4).toFixed(2)),
      actions: state === 'action' ? 3 + (index % 5) : index % 3,
      checkedAt: `${9 + (index % 12)}:${String((index * 7) % 60).padStart(2, '0')}`,
      ip: `10.${20 + siteIndex}.${index + 1}.${11 + index * 3}`,
    }
  })
})

/* ============================ 派生指标 ============================ */

export const RISK_META: Record<RiskLevel, { label: string; color: string; short: string }> = {
  impact: { label: '正在影响', color: '#ff3b52', short: '影响' },
  warning: { label: '一级预警', color: '#ff9f45', short: '预警' },
  attention: { label: '关注', color: '#ffd76b', short: '关注' },
  normal: { label: '运行正常', color: '#35d6a4', short: '正常' },
}

export const siteById = new Map(assetSites.map((site) => [site.id, site]))

/** 全天累计雷击次数（演示值，与推演窗口内事件量级一致） */
export const dailyStrikeCount = 1286
/** 保护动作成功率 */
export const shieldRate = 99.2
/** 全网在线率 */
export const onlineRate = 98.6

export const voltageIndex = ['全部', '1000kV', '±1100kV', '500kV', '330kV', '220kV', '110kV', '35kV', '低压']

/* =========================================================================
   雷暴临近预警分级 / WARNING LADDER
   -------------------------------------------------------------------------
   客户（矿区/电厂安全生产部门）真正要的只有一句话：
     「雷暴离我多远，现在该干什么。」

   所以预警不按"雷击次数"分，按【雷暴单体到场区边界的距离】分：
     四级 200 km  → 关注，启动气象跟踪
     三级 150 km  → 准备，核查防护装置与户外作业
     二级 100 km  → 预警，限制作业、值班加强
     一级  50 km  → 紧急，启动应急预案、必要时停产撤人
   这套阈值直接对应客户的应急预案文本，界面上的每一句话都要能落到预案里。
   ========================================================================= */

export interface WarningLevel {
  /** 4 / 3 / 2 / 1，数字越小越紧急；0 = 无预警 */
  level: 0 | 1 | 2 | 3 | 4
  label: string
  color: string
  /** 该级别要求的动作，来自客户应急预案 */
  action: string
}

export const WARNING_LADDER: Array<{ distance: number; level: 1 | 2 | 3 | 4 }> = [
  { distance: 200, level: 4 },
  { distance: 150, level: 3 },
  { distance: 100, level: 2 },
  { distance: 50, level: 1 },
]

const WARNING_META: Record<1 | 2 | 3 | 4, { label: string; color: string; action: string }> = {
  4: { label: '四级预警', color: '#4fb2e8', action: '关注气象跟踪，正常作业' },
  3: { label: '三级预警', color: '#ffd76b', action: '核查防护装置，暂停高空作业' },
  2: { label: '二级预警', color: '#ff9f45', action: '限制作业，值班加强，物资到位' },
  1: { label: '一级预警', color: '#ff3b52', action: '启动应急预案，必要时停产撤人' },
}

export function warningFor(distanceKm: number): WarningLevel {
  /**
   * 必须从【最紧的圈】往外判（50 → 200）。
   * WARNING_LADDER 是按 200/150/100/50 排的展示顺序，
   * 直接顺着遍历会让 45 km 先命中 200 那条、误报成四级预警 ——
   * 预警分级的顺序错了，整套系统就废了，这里不能省这一步。
   */
  for (const step of [...WARNING_LADDER].reverse()) {
    if (distanceKm <= step.distance) {
      return { level: step.level, ...WARNING_META[step.level] }
    }
  }
  return { level: 0, label: '无预警', color: '#35d6a4', action: '雷暴在 200 km 外，正常运行' }
}

/* =========================================================================
   雷达回波 / RADAR ECHO
   -------------------------------------------------------------------------
   客户关心的第二件事：「这片雷达云会不会飘到我的矿区」。
   所以每个回波单元带一个移动矢量，界面才能回答"它正朝谁去"。
   ========================================================================= */

export interface RadarCell {
  lon: number
  lat: number
  /** 组合反射率 dBZ */
  dbz: number
  /** 单元半径（km） */
  radius: number
  /** 移动方向（度，气象约定：风的来向）与速度 km/h */
  direction: number
  speed: number
}

/** 雷暴单体：名称、中心、长宽半径（度）、移动方向/速度、峰值 dBZ */
const STORM_CENTERS: Array<[
  string,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
]> = [
  // 位置是按"客户预案的预警级别"反推的：
  //   A2309 逼近神东/大柳塔 → 二级预警（第二道圈内）
  //   B1742 逼近粤东海上风电 → 二级预警
  //   C3810 逼近滇中/六盘水 → 三级预警，攀西 → 四级预警
  //   D0921 在渤海湾活动，全网最远 → 不触发预警
  // 这样一屏之内就能同时看到"谁最急、谁该准备、谁可以正常干活"。
  ['A2309', 110.35, 38.8, 1.7, 0.85, 138, 42, 66],
  ['B1742', 116.38, 22.42, 1.5, 0.75, 152, 34, 68],
  ['C3810', 102.32, 25.52, 1.35, 0.8, 126, 28, 58],
  ['D0921', 121.5, 38.6, 1.0, 0.6, 210, 24, 52],
]

/** 一个雷暴单体内部的回波单元：越靠中心反射率越高，边缘自然衰减 */
export const radarCells: RadarCell[] = STORM_CENTERS.flatMap(
  ([, lon, lat, radiusLon, radiusLat, direction, speed, peak], cluster) =>
    Array.from({ length: 46 }, (_, index) => {
      const angle = (index * 137.5 + cluster * 41) * (Math.PI / 180)
      /**
       * 半径分布刻意做得密（0.12–0.78 而不是 0.18–0.94）：
       * 单元之间必须互相重叠，整片回波才会连成一个团。
       * 铺得太散会变成一颗颗独立的小球，看上去像气泡而不是雷达云。
       */
      const radial = 0.12 + (index % 12) * 0.056
      return {
        lon: lon + Math.cos(angle) * radiusLon * radial,
        lat: lat + Math.sin(angle) * radiusLat * radial,
        dbz: Math.max(15, Math.round(peak - radial * 46 - (index % 4) * 3)),
        // 单元半径给大一些，保证相邻单元互相搭接成连续回波
        radius: 26 + (index % 5) * 9,
        direction,
        speed,
      }
    }),
)

/** 雷暴单体（用于轨迹与临近预警） */
export interface StormCell {
  id: string
  name: string
  lon: number
  lat: number
  direction: number
  speed: number
  /** 峰值反射率 */
  dbz: number
  /** 未来 60 分钟落区（沿移动矢量的外推多边形） */
  forecast: [number, number][]
}

export const stormCells: StormCell[] = STORM_CENTERS.map(
  ([name, lon, lat, , , direction, speed, dbz]) => {
    const rad = (direction * Math.PI) / 180
    const dx = Math.cos(rad)
    const dy = Math.sin(rad)
    // 60 分钟行程对应度数：速度 km/h ÷ 111 得纬度增量
    const reach = speed / 111
    return {
      id: `ST-${name}`,
      name,
      lon,
      lat,
      direction,
      speed,
      dbz,
      forecast: [
        [lon + dx * reach * 0.5 - dy * 0.5, lat + dy * reach * 0.5 + dx * 0.34],
        [lon + dx * reach * 1.1, lat + dy * reach * 1.1],
        [lon + dx * reach * 0.5 + dy * 0.5, lat + dy * reach * 0.5 - dx * 0.34],
      ] as [number, number][],
    }
  },
)

/** 两点间近似地面距离（km） */
export function distanceKm(
  aLon: number,
  aLat: number,
  bLon: number,
  bLat: number,
): number {
  const dx = (aLon - bLon) * 111.32 * Math.cos((((aLat + bLat) / 2) * Math.PI) / 180)
  const dy = (aLat - bLat) * 110.57
  return Math.hypot(dx, dy)
}

/** 每个受保护场区当前面临的最近雷暴与预警等级 */
export interface SiteThreat {
  siteId: string
  /** 最近雷暴单体 */
  stormId: string
  stormName: string
  stormLon: number
  stormLat: number
  stormDbz: number
  stormSpeed: number
  stormDirection: number
  /** 单体边缘到场区边界的距离（km）—— 按客户预案口径，扣除场区自身半径 6km */
  gapKm: number
  warning: WarningLevel
}

export function computeThreats(): SiteThreat[] {
  return assetSites.map((site) => {
    let best: SiteThreat | null = null
    for (const storm of stormCells) {
      const raw = distanceKm(site.lon, site.lat, storm.lon, storm.lat)
      // 客户预案按"雷暴边缘到场区边界"计距离；扣除雷暴半径 10 km
      const gap = Math.max(0, Math.round(raw - 10))
      if (!best || gap < best.gapKm) {
        best = {
          siteId: site.id,
          stormId: storm.id,
          stormName: storm.name,
          stormLon: storm.lon,
          stormLat: storm.lat,
          stormDbz: storm.dbz,
          stormSpeed: storm.speed,
          stormDirection: storm.direction,
          gapKm: gap,
          warning: warningFor(gap),
        }
      }
    }
    return best!
  })
}

/* ============================ 防护闭环指标 ============================ */
/**
 * 指挥舱的主指标不该是"今天打了多少雷"——那是气象台的事。
 * 客户（央企安全生产部门）真正要回答的是三个问题：
 *   1. 现在有没有东西正在被威胁？（实时告警）
 *   2. 我手上多少资产暴露在风险里？（暴露面）
 *   3. 我的防护到底管不管用、多久起作用？（防护有效性）
 */
export const protectionStats = {
  /** 当前处于预警及以上的资产数 */
  exposedAssets: assetSites.filter((site) => site.risk === 'warning' || site.risk === 'impact').length,
  /** 待处置告警 */
  openAlarms: alarms.filter((alarm) => !alarm.handled).length,
  /** 保护装置平均响应时间 ms */
  avgResponseMs: Math.round(
    strikes.filter((strike) => strike.responseMs > 0).reduce((sum, strike) => sum + strike.responseMs, 0) /
      Math.max(1, strikes.filter((strike) => strike.responseMs > 0).length),
  ),
  /** 防护有效率（触发保护且未造成损伤的事件占比） */
  effectiveRate: 99.2,
}

/** 闪电定位站网：每站有效探测半径约 150 km（站网布设的工程常识） */
export const SENSOR_RADIUS_KM = 150

/** 矿区真实边界（复用既有资产数据，保证与地图规范一致） */
export const mineFootprints = MINE_AREAS.map((mine) => ({
  id: mine.id,
  name: mine.name,
  tenant: mine.tenant,
  center: mine.center,
  polygon: mine.boundary.coordinates[0] as [number, number][],
}))

export function formatClock(seconds: number, baseHour = 8) {
  const safe = Math.max(0, Math.round(seconds))
  const hour = baseHour + Math.floor(safe / 3600)
  const minute = Math.floor((safe % 3600) / 60)
  return `${String(hour % 24).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

export function formatSeconds(seconds: number) {
  const safe = Math.max(0, Math.round(seconds))
  const h = Math.floor(safe / 3600)
  const m = Math.floor((safe % 3600) / 60)
  const s = safe % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}
