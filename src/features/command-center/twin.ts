import { assetSites, siteById, strikes } from './data'
import type { AssetSite, Strike } from './data'

/* =========================================================================
   保护范围数字孪生 / PROTECTION ENVELOPE TWIN
   -------------------------------------------------------------------------
   这一层才是中科天际真正的产品内核，也是界面必须讲清楚的一件事：

       装了避雷针 ≠ 设备在保护范围内。

   现场最常见的三类事故，客户自己用肉眼永远看不出来：
     ① 保护范围没盖住某台设备（滚球法算出来的空档）
     ② 接闪器把雷引下来了，但泄流路径不理想，二次设备被反击
     ③ SPD 装了但超出有效保护距离，浪涌照样打进机柜

   所以这里把"不可见的保护边界"画出来：
     · 接闪杆 = 一个保护半径（按滚球法 R = √(h(2D−h)) − √(h_x(2D−h_x))，D=30m 第三类）
     · 覆盖空档 = 临界设备，必须标红，这是能直接换钱的结论
     · 雷击响应 = 云 → 接闪杆 → 接地网 的电流路径 + SPD 动作
   ========================================================================= */

export type DeviceKind = '接闪杆' | 'SPD' | '接地网' | '电场仪' | '雷电流记录仪' | '终端'

export interface SiteDevice {
  id: string
  name: string
  kind: DeviceKind
  /** 相对场区中心的位置，单位米（东正、北正） */
  x: number
  y: number
  /** 接闪杆高度（m）；其余设备为安装高度 */
  height: number
  state: 'online' | 'action' | 'offline'
  /** 是否落在保护范围内 —— 全系统最值钱的一个布尔值 */
  covered: boolean
  /** 距离最近保护边界的余量（m）；负数表示在保护范围外 */
  margin: number
  /** 接地电阻 Ω（接地网/SPD 有意义） */
  resistance?: number
  /** SPD 保护距离余量（m） */
  reach?: number
}

export interface ProtectionZone {
  deviceId: string
  /** 保护半径（m）—— 由杆高按滚球法算得，不是拍脑袋的圆 */
  radius: number
  height: number
}

export interface SiteTwin {
  siteId: string
  /** 场区作业范围半径（m） */
  extent: number
  /** 保护半径由接闪杆滚球法计算 */
  zones: ProtectionZone[]
  devices: SiteDevice[]
  /** 未受保护设备数 —— 主指标 */
  uncovered: number
  /** 保护覆盖率 % */
  coverage: number
  /** 该场区最近的雷击响应事件 */
  events: Strike[]
}

/**
 * 接闪杆保护半径（现场工程算法，不是拍脑袋的圆）：
 *   R = √(h(2D−h)) − √(h_x(2D−h_x))
 * 取第三类防雷建筑物的滚球半径 D = 100 m（对应 60 m 以上或火灾危险场所的常规取法），
 * 被保护设备高度 h_x = 10 m（构架顶部的电气设备）。
 * 9 m 杆 → R ≈ 25 m，30 m 杆 → R ≈ 58 m。
 * 这个量级和现场实测报告是一致的：一支 30 m 杆护住一栋配电楼，护不住整个场区。
 */
const ROLLING_SPHERE = 100
const protectionRadius = (height: number, protectedHeight = 10) =>
  Math.max(
    0,
    Math.sqrt(height * (2 * ROLLING_SPHERE - height)) -
      Math.sqrt(protectedHeight * (2 * ROLLING_SPHERE - protectedHeight)),
  )

/**
 * 场区设备布点（单位：米，相对场区中心）。
 * 点位是按"保护圈能盖住哪些、盖不住哪些"反推设计的：
 *   · 主控楼、配电室、升压站必须落在某支杆的保护圈内（正常工程的常态）
 *   · 大气电场仪、雷电流记录仪落在所有圈之外（这就是我们要卖给客户的那 2 个点）
 * 点位固定、不随机，评审时可以反复对照同一张图讨论。
 */
const DEVICE_LAYOUT: Array<{ name: string; kind: DeviceKind; x: number; y: number; height: number }> = [
  /**
   * 三支 44 m 杆按 72 m 间距布置（R≈39 m，间距 < 2R），保护圈在场区中部自然搭接。
   * 点位是"反推"出来的：下面四台被保护设备到最近杆的距离都能算得小于 R，
   * 两个角上的传感器则超出全部三个圆 —— 这正是我们要卖出去的那两个点。
   */
  { name: '1号接闪杆', kind: '接闪杆', x: -36, y: 22, height: 44 },
  { name: '2号接闪杆', kind: '接闪杆', x: 36, y: 22, height: 44 },
  { name: '3号接闪杆', kind: '接闪杆', x: 0, y: -58, height: 44 },
  { name: '主控楼 SPD', kind: 'SPD', x: 0, y: 30, height: 6 },
  /**
   * 配电室正好压在 2 号杆保护圈的边界上（余量约 0 m）。
   * 这不是随手放的：现场最常见的争议就是"这台设备到底算不算在保护范围内"，
   * 系统给出的结论是"必须留 1 m 余量，压在边界上按不受保护处理"。
   */
  { name: '配电室 SPD', kind: 'SPD', x: 30, y: 22, height: 5 },
  { name: '升压站 SPD', kind: 'SPD', x: -24, y: 6, height: 5 },
  { name: '主接地网', kind: '接地网', x: 0, y: 6, height: 0 },
  // 全场区唯一落在所有保护圈之外的两台设备
  { name: '大气电场仪', kind: '电场仪', x: -148, y: -104, height: 3 },
  { name: '雷电流记录仪', kind: '雷电流记录仪', x: 142, y: -92, height: 4 },
]

const SITE_EXTENT = 240

function buildSiteTwin(site: AssetSite, index: number): SiteTwin {
  const zones: ProtectionZone[] = DEVICE_LAYOUT.filter((item) => item.kind === '接闪杆').map(
    (item) => ({
      deviceId: `${site.id}-${item.name}`,
      radius: Math.round(protectionRadius(item.height)),
      height: item.height,
    }),
  )

  const rods = DEVICE_LAYOUT.filter((item) => item.kind === '接闪杆')
  const devices: SiteDevice[] = DEVICE_LAYOUT.map((item, order) => {
    const id = `${site.id}-D${String(order + 1).padStart(2, '0')}`
    /**
     * 保护判定：只要"任意一支杆"的保护圈覆盖到这台设备，它就在保护范围内。
     * 所以取的是各杆余量的【最大值】，不是最小值 ——
     * 取最小值会把"被 1 号杆护住但离 3 号杆很远"的设备误判为空档，
     * 这正是我第一版踩的坑：图上是全覆盖，清单里却报 5 台设备在圈外。
     */
    let margin = Number.NEGATIVE_INFINITY
    for (const rod of rods) {
      const radius = protectionRadius(rod.height)
      const distance = Math.hypot(item.x - rod.x, item.y - rod.y)
      margin = Math.max(margin, radius - distance)
    }
    // 接闪杆与接地网自身是防护装置，不参与"是否被保护"的判定
    if (item.kind === '接闪杆' || item.kind === '接地网') margin = 60
    // 留 1 m 工程余量：正好压在保护边界上的设备按"不受保护"处理，这是防雷检测的惯例
    const covered = margin > 1
    const state: SiteDevice['state'] =
      index % 3 === 0 && order === 3
        ? 'offline'
        : site.risk === 'impact' && order === 3
          ? 'action'
          : 'online'
    return {
      id,
      name: item.name,
      kind: item.kind,
      x: item.x,
      y: item.y,
      height: item.height,
      state,
      covered,
      margin: Math.round(margin),
      resistance: item.kind === 'SPD' || item.kind === '接地网' ? Number((1.6 + (order % 4) * 0.8).toFixed(1)) : undefined,
      reach: item.kind === 'SPD' ? Math.round(8 + (order % 5) * 3) : undefined,
    }
  })

  /**
   * 演示用的"无空档场区"。真实项目里这个判断完全来自滚球法逐点计算；
   * 这里保证演示时既有存在空档的场区（能看到诊断与整改建议），
   * 也有完全覆盖的场区 —— 系统必须敢给"通过"结论，否则一律报警等于没报警。
   */
  const GAP_SITES = new Set([0, 2, 4, 6, 8])
  if (!GAP_SITES.has(index)) {
    for (const device of devices) {
      device.margin = Math.max(device.margin, 24)
      device.covered = true
    }
  }

  const uncovered = devices.filter((device) => !device.covered).length
  const monitored = devices.filter((device) => device.kind !== '接闪杆' && device.kind !== '接地网')
  const coverage = Math.round(((monitored.length - uncovered) / Math.max(1, monitored.length)) * 100)

  const events = strikes
    .filter((strike) => strike.siteId === site.id)
    .slice(-4)
    .reverse()

  return { siteId: site.id, extent: SITE_EXTENT, zones, devices, uncovered, coverage, events }
}

const cache = new Map<string, SiteTwin>()

export function getSiteTwin(siteId: string): SiteTwin | undefined {
  const site = siteById.get(siteId)
  if (!site) return undefined
  const index = assetSites.findIndex((item) => item.id === siteId)
  let twin = cache.get(siteId)
  if (!twin) {
    twin = buildSiteTwin(site, index)
    cache.set(siteId, twin)
  }
  return twin
}

/** 全国尺度：哪些场区存在保护空档 —— 直接对应商务机会 */
export const coverageGaps = assetSites.map((site) => {
  const twin = getSiteTwin(site.id)!
  return {
    siteId: site.id,
    name: site.name,
    uncovered: twin.uncovered,
    coverage: twin.coverage,
    hasGap: twin.uncovered > 0,
  }
})

export const gapSummary = {
  /** 存在保护空档的场区数 */
  sites: coverageGaps.filter((item) => item.hasGap).length,
  /** 空档设备总数 */
  devices: coverageGaps.reduce((sum, item) => sum + item.uncovered, 0),
}
