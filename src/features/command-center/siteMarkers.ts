import type { Map as MapLibreMap } from 'maplibre-gl'
import { assetSites, RISK_META } from './data'
import type { AssetSite } from './data'

/* =========================================================================
   资产锚点 / SITE ANCHORS
   极简原则：地图上不放文字卡片。文字一多，图面立刻变成"后台系统"。
   这里只留三件东西 ——
     · 一个"带电"的发光锚点（微拟物，带脉冲）
     · 一个红色数字角标（只在真异常时出现）
     · 悬停时浏览器原生 tooltip 补出名称
   名称、电压等级、设备清单全部交给右侧/底部面板去说。
   ========================================================================= */

export interface SiteMarkerLayer {
  update: (options: { focusedId?: string; strikeCounts?: Map<string, number> }) => void
  dispose: () => void
}

const escape = (value: string) =>
  value.replace(/[&<>"]/g, (character) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[character] ?? character,
  )

function markup(site: AssetSite, count: number) {
  const meta = RISK_META[site.risk]
  // 角标优先级：装置异常台数 > 窗口内落雷次数
  const badge = site.abnormal > 0 ? site.abnormal : count > 0 ? count : 0
  return `
    <span class="cc-site__beacon" style="--risk:${meta.color}">
      <i></i><i></i><b></b>
    </span>
    ${badge ? `<span class="cc-site__badge">${badge}</span>` : ''}
  `
}

export function createSiteMarkers(
  map: MapLibreMap,
  handlers: {
    onClick?: (id: string) => void
    onHover?: (id: string | null, x: number, y: number) => void
  } = {},
): SiteMarkerLayer {
  const container = document.createElement('div')
  container.className = 'cc-site-layer'
  map.getContainer().append(container)

  const entries = assetSites.map((site) => {
    const element = document.createElement('button')
    element.type = 'button'
    element.className = `cc-site cc-site--${site.risk}`
    element.dataset.site = site.id
    element.title = `${site.name}｜${site.kind}｜${site.voltage}｜${RISK_META[site.risk].label}`
    element.setAttribute('aria-label', `${site.name} ${RISK_META[site.risk].label}`)
    element.style.setProperty('--risk', RISK_META[site.risk].color)
    element.innerHTML = markup(site, 0)
    element.addEventListener('click', (event) => {
      event.stopPropagation()
      handlers.onClick?.(site.id)
    })
    element.addEventListener('mouseenter', (event) => {
      const rect = container.getBoundingClientRect()
      handlers.onHover?.(site.id, event.clientX - rect.left, event.clientY - rect.top)
    })
    element.addEventListener('mouseleave', () => handlers.onHover?.(null, 0, 0))
    container.append(element)
    return { site, element }
  })

  let frame = 0
  const project = () => {
    for (const { site, element } of entries) {
      const point = map.project([site.lon, site.lat])
      element.style.transform = `translate3d(${Math.round(point.x)}px, ${Math.round(point.y)}px, 0)`
    }
    frame = requestAnimationFrame(project)
  }
  frame = requestAnimationFrame(project)

  let lastFocused = ''

  return {
    update: ({ focusedId = '', strikeCounts }) => {
      const counts = strikeCounts
      if (focusedId === lastFocused && !counts) return
      lastFocused = focusedId
      for (const { site, element } of entries) {
        element.classList.toggle('is-focused', site.id === lastFocused)
        element.innerHTML = markup(site, counts?.get(site.id) ?? 0)
      }
    },
    dispose: () => {
      cancelAnimationFrame(frame)
      container.remove()
    },
  }
}
