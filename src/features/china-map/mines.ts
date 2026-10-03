import * as maplibregl from 'maplibre-gl'
import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl'
import lightningCenterImage from '../../assets/images/lightning-1.png'
import lightningNearbyImage from '../../assets/images/lightning-2.png'

export type MineRisk = 'normal' | 'attention' | 'warning' | 'danger'
export type MineArea = {
  id: string
  name: string
  tenant: string
  center: [number, number]
  boundary: { type: 'Polygon'; coordinates: number[][][] }
}

function operationalBoundary(center: [number, number], radiusLng: number, radiusLat: number, phase: number): MineArea['boundary'] {
  const coordinates = Array.from({ length: 18 }, (_, index) => {
    const angle = index / 18 * Math.PI * 2
    const variation = 1 + Math.sin(index * 2.17 + phase) * .13 + Math.cos(index * 3.31 - phase) * .07
    return [
      center[0] + Math.cos(angle) * radiusLng * variation,
      center[1] + Math.sin(angle) * radiusLat * variation,
    ]
  })
  coordinates.push([...coordinates[0]!] as number[])
  return { type:'Polygon', coordinates:[coordinates] }
}

export const MINE_AREAS: MineArea[] = [
  {
    id: '001', name: '拜寺口双塔', tenant: '银川雷电监测中心', center: [105.86, 38.70],
    boundary: { type: 'Polygon', coordinates: [[
      [105.829,38.704],[105.834,38.718],[105.846,38.729],[105.861,38.732],[105.876,38.727],
      [105.889,38.716],[105.895,38.701],[105.891,38.687],[105.881,38.677],[105.866,38.671],
      [105.852,38.674],[105.845,38.681],[105.833,38.684],[105.826,38.694],[105.829,38.704],
    ]] },
  },
  {
    id: '002', name: '固原博物馆', tenant: '固原雷电监测中心', center: [106.285, 36.015],
    boundary: { type: 'Polygon', coordinates: [[
      [106.266,36.021],[106.269,36.032],[106.278,36.040],[106.291,36.041],[106.302,36.036],
      [106.309,36.027],[106.307,36.017],[106.312,36.008],[106.305,35.999],[106.295,35.994],
      [106.283,35.996],[106.274,35.992],[106.266,36.000],[106.262,36.011],[106.266,36.021],
    ]] },
  },
  { id:'003', name:'神东矿区', tenant:'国家能源集团', center:[110.20,39.28], boundary:operationalBoundary([110.20,39.28],.23,.14,.35) },
  { id:'004', name:'准东矿区', tenant:'新疆能源集团', center:[89.08,44.78], boundary:operationalBoundary([89.08,44.78],.30,.17,1.2) },
  { id:'005', name:'霍林河矿区', tenant:'内蒙古能源集团', center:[119.65,45.53], boundary:operationalBoundary([119.65,45.53],.22,.14,2.15) },
  { id:'006', name:'淮北矿区', tenant:'淮北矿业集团', center:[116.78,33.93], boundary:operationalBoundary([116.78,33.93],.18,.12,2.8) },
  { id:'007', name:'六盘水矿区', tenant:'贵州能源集团', center:[104.83,26.58], boundary:operationalBoundary([104.83,26.58],.19,.13,3.65) },
  { id:'008', name:'攀西矿区', tenant:'四川资源集团', center:[101.72,26.57], boundary:operationalBoundary([101.72,26.57],.17,.12,4.4) },
]

type RiskValue = { id: string; dbz: number; risk: MineRisk; distanceKm?: number }
const SOURCE = 'mine-areas'
const layers = ['mine-fill', 'mine-outline', 'mine-danger-glow', 'mine-leaders', 'mine-risk-labels', 'mine-detail-labels', 'mine-risk-pulse', 'mine-risk-core']

function riskDetail(state: RiskValue) {
  if (state.risk === 'danger') return `雷暴已覆盖 · 最大回波 dBZ ${Math.round(state.dbz)}`
  if (state.risk === 'warning') return `预计影响 · 距矿区边界 ${state.distanceKm ?? 18} km`
  if (state.risk === 'attention') return `雷暴临近 · 距强回波核心 ${state.distanceKm ?? 32} km`
  return `监测正常 · 最近回波 ${state.distanceKm ?? 120} km`
}

function collection(risks: Map<string, RiskValue>, selectedId = '', showAll = false) {
  const features: any[] = []
  for (const mine of MINE_AREAS) {
    const state = risks.get(mine.id) ?? { id: mine.id, dbz: 0, risk: 'normal' as const }
    if (!showAll && state.risk === 'normal') continue
    const properties = { id: mine.id, name: mine.name, tenant: mine.tenant, risk: state.risk, dbz: Math.round(state.dbz), kind: 'area', selected: mine.id === selectedId }
    const riskText: Record<MineRisk, string> = { normal: '正常', attention: '临近', warning: '预警', danger: '危险' }
    const direction = mine.center[0] > 116 ? -1 : 1
    const labelAnchor: [number, number] = [mine.center[0] + direction * .85, mine.center[1] + .72]
    const elbow: [number, number] = [mine.center[0] + direction * .25, mine.center[1] + .42]
    features.push({ type: 'Feature', properties, geometry: mine.boundary })
    features.push({ type: 'Feature', properties: { ...properties, kind: 'center' }, geometry: { type: 'Point', coordinates: mine.center } })
    features.push({ type: 'Feature', properties: { ...properties, kind: 'label', label: `${mine.name}  ${riskText[state.risk]}\n${riskDetail(state)}` }, geometry: { type: 'Point', coordinates: labelAnchor } })
    features.push({ type: 'Feature', properties: { ...properties, kind: 'leader' }, geometry: { type: 'LineString', coordinates: [mine.center, elbow, labelAnchor] } })
  }
  return { type: 'FeatureCollection' as const, features }
}

export function addMineLayers(map: MapLibreMap) {
  const risks = new Map<string, RiskValue>()
  let selectedId = ''
  let showAll = false
  let detailPopup: maplibregl.Popup | undefined
  let detailToken = 0
  const markers = new Map<string, maplibregl.Marker[]>()
  const markerElements = new Map<string, { root: HTMLElement; mine: MineArea; risk: MineRisk }>()
  let openMineDetail: (id: string) => void = () => undefined
  const syncDetailCard = () => {
    markerElements.forEach(({ root }, id) => {
      const isOpen = id === selectedId
      const wasOpen = root.classList.contains('mine-marker--detail-open')
      root.classList.toggle('mine-marker--detail-open', isOpen)
      if (isOpen) root.classList.remove('mine-marker--returning', 'mine-marker--restored')
      else if (wasOpen) {
        root.classList.add('mine-marker--returning')
        window.setTimeout(() => {
          if (root.classList.contains('mine-marker--detail-open')) return
          root.classList.remove('mine-marker--returning')
          root.classList.add('mine-marker--restored')
        }, 460)
      }
    })
  }
  map.addSource(SOURCE, { type: 'geojson', data: collection(risks, selectedId, showAll) })
  map.addLayer({ id: layers[0]!, type: 'fill', source: SOURCE, filter: ['==',['get','kind'],'area'], paint: {
    'fill-color': ['match',['get','risk'],'attention','#FFCC33','warning','#FFCC33','danger','#FF4560','#35D07F'],
    'fill-opacity': ['match',['get','risk'],'attention',.2,'warning',.25,'danger',.35,.19],
  } })
  map.addLayer({ id: 'mine-normal-separator', type: 'line', source: SOURCE, filter: ['all',['==',['get','kind'],'area'],['==',['get','risk'],'normal']], paint: { 'line-color':'#153F3A','line-width':['interpolate',['linear'],['zoom'],3,2.6,8,4.6],'line-blur':1.2,'line-opacity':.46 } })
  map.addLayer({ id: 'mine-normal-halo', type: 'line', source: SOURCE, filter: ['all',['==',['get','kind'],'area'],['==',['get','risk'],'normal']], paint: { 'line-color':'#76AE9F','line-width':['interpolate',['linear'],['zoom'],3,3,8,6],'line-blur':3.5,'line-opacity':.3 } })
  map.addLayer({ id: 'mine-normal-node-glow', type: 'circle', source: SOURCE, filter: ['all',['==',['get','kind'],'center'],['==',['get','risk'],'normal']], paint: { 'circle-color':'#6EAD9D','circle-radius':['interpolate',['linear'],['zoom'],3,4.5,8,8],'circle-blur':.65,'circle-opacity':.15 } })
  map.addLayer({ id: 'mine-normal-node', type: 'circle', source: SOURCE, filter: ['all',['==',['get','kind'],'center'],['==',['get','risk'],'normal']], paint: { 'circle-color':'#DDEEE8','circle-radius':['interpolate',['linear'],['zoom'],3,1.5,8,2.6],'circle-stroke-color':'#679F91','circle-stroke-width':1.25,'circle-opacity':.88 } })
  map.addLayer({ id:'mine-overview-names', type:'symbol', source:SOURCE, filter:['all',['==',['get','kind'],'center'],['==',['get','risk'],'normal']], layout:{ visibility:'none','text-field':['get','name'],'text-size':['interpolate',['linear'],['zoom'],2.5,10,5,12,9,14],'text-offset':[0,1.25],'text-anchor':'top','text-letter-spacing':.08,'text-padding':5,'text-allow-overlap':false,'text-optional':true }, paint:{ 'text-color':'#23483F','text-halo-color':'rgba(244,252,249,.96)','text-halo-width':1.7,'text-halo-blur':.35,'text-opacity':.96 } })
  map.addLayer({ id: layers[1]!, type: 'line', source: SOURCE, filter: ['==',['get','kind'],'area'], paint: {
    'line-color': ['match',['get','risk'],'attention','#FFCC33','warning','#FFCC33','danger','#FF4560','#35D07F'],
    'line-width': ['interpolate',['linear'],['zoom'],3,1.35,8,2.4], 'line-opacity': ['match',['get','risk'],'normal',.74,.96],
  } })
  const selectedFilter = ['all',['==',['get','kind'],'area'],['==',['get','selected'],true]] as any
  map.addLayer({ id: 'mine-selected-fill', type: 'fill', source: SOURCE, filter: selectedFilter, paint: { 'fill-color':['match',['get','risk'],'attention','#FFCC33','warning','#FFCC33','danger','#FF4560','#35D07F'],'fill-opacity':['match',['get','risk'],'normal',.18,.13] } })
  map.addLayer({ id: 'mine-selected-outline', type: 'line', source: SOURCE, filter: selectedFilter, paint: { 'line-color':['match',['get','risk'],'attention','#FFD666','warning','#FFB05C','danger','#FF6673','#83E3CE'],'line-width':['interpolate',['linear'],['zoom'],3,6,8,10],'line-blur':4,'line-opacity':.62 } })
  map.addLayer({ id: 'mine-selected-core', type: 'line', source: SOURCE, filter: selectedFilter, paint: { 'line-color':['match',['get','risk'],'attention','#FFF1B8','warning','#FFE7BA','danger','#FFF1F0','#ECFFF9'],'line-width':['interpolate',['linear'],['zoom'],3,1.5,8,2.6],'line-opacity':1 } })
  map.addLayer({ id: layers[2]!, type: 'line', source: SOURCE, filter: ['all',['==',['get','kind'],'area'],['==',['get','risk'],'danger']], paint: { 'line-color':'#FF4560','line-width':5,'line-blur':3,'line-opacity':.45 } })
  const demoVisible = ['any',['!=',['get','risk'],'normal'],['==',['get','id'],'001']] as any
  map.addLayer({ id: 'mine-leader-casing', type: 'line', source: SOURCE, filter: ['all',['==',['get','kind'],'leader'],demoVisible], layout: { visibility: 'none' }, paint: { 'line-color':'rgba(15,23,32,.88)','line-width':4.2,'line-opacity':.88 } })
  map.addLayer({ id: layers[3]!, type: 'line', source: SOURCE, filter: ['all',['==',['get','kind'],'leader'],demoVisible], layout: { visibility: 'none' }, paint: { 'line-color':['match',['get','risk'],'attention','#FFD666','warning','#FF9C3D','danger','#FF4D5E','#69B1FF'],'line-width':1.8,'line-opacity':1 } })
  map.addLayer({ id: layers[6]!, type: 'circle', source: SOURCE, filter: ['all',['==',['get','kind'],'center'],demoVisible], layout: { visibility: 'none' }, paint: { 'circle-color':'transparent','circle-radius':12 } })
  map.addLayer({ id: layers[7]!, type: 'circle', source: SOURCE, filter: ['all',['==',['get','kind'],'center'],demoVisible], paint: { 'circle-color':['match',['get','risk'],'attention','#FFCC33','warning','#FFCC33','danger','#FF4560','#35D07F'],'circle-stroke-color':'#ffffff','circle-stroke-width':2.5,'circle-radius':5.5,'circle-opacity':1 } })
  map.addLayer({ id: layers[4]!, type: 'symbol', source: SOURCE, filter: ['all',['==',['get','kind'],'label'],['!=',['get','risk'],'normal']], layout: { visibility: 'none', 'text-field':['get','label'] }, paint: { 'text-color':'#fff' } })
  map.addLayer({ id: layers[5]!, type: 'symbol', source: SOURCE, filter: ['==',['get','kind'],'label'], layout: { visibility: 'none', 'text-field':['get','label'] }, paint: { 'text-color':'#fff' } })

  const renderMarkers = () => {
    markerElements.clear()
    const visibleIds = new Set<string>()
    const severity: Record<MineRisk, number> = { danger: 4, warning: 3, attention: 2, normal: 1 }
    const visible = MINE_AREAS.map((mine) => ({ mine, state: risks.get(mine.id) ?? { id: mine.id, dbz: 0, risk: 'normal' as const, distanceKm: 120 } }))
      .filter(({ mine, state }) => showAll || state.risk !== 'normal' || mine.id === '001')
      .sort((a, b) => severity[b.state.risk] - severity[a.state.risk])
    const levels = [...new Set(visible.map(({ state }) => severity[state.risk]))].sort((a, b) => b - a)
    for (const { mine, state } of visible) {
      visibleIds.add(mine.id)
      markers.get(mine.id)?.forEach((marker) => marker.remove())
      const root = document.createElement('div')
      root.className = `mine-marker mine-marker--card-layer mine-marker--${state.risk}`
      root.style.setProperty('--enter-delay', `${levels.indexOf(severity[state.risk]) * 0.68}s`)
      root.style.zIndex = '100'
      const beaconRoot = document.createElement('div')
      beaconRoot.className = `mine-marker mine-marker--beacon-layer mine-marker--${state.risk}`
      beaconRoot.style.setProperty('--enter-delay', `${levels.indexOf(severity[state.risk]) * 0.68}s`)
      beaconRoot.style.zIndex = '10'
      const beacon = document.createElement('div')
      beacon.className = 'mine-marker__beacon'
      beacon.innerHTML = '<i></i><i></i><b></b>'
      const link = document.createElement('div')
      link.className = 'mine-marker__link'
      const card = document.createElement('div')
      card.className = 'mine-marker__card'
      card.tabIndex = 0
      card.setAttribute('role', 'button')
      card.setAttribute('aria-label', `查看${mine.name}详情`)
      card.addEventListener('click', (event) => {
        event.stopPropagation()
        openMineDetail(mine.id)
      })
      card.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        event.stopPropagation()
        openMineDetail(mine.id)
      })
      const header = document.createElement('div')
      header.className = 'mine-marker__header'
      const title = document.createElement('strong')
      title.textContent = mine.name
      const badge = document.createElement('span')
      badge.textContent = ({ normal: '正常', attention: '临近', warning: '预警', danger: '危险' } as const)[state.risk]
      header.append(title, badge)
      const meta = document.createElement('div')
      meta.className = 'mine-marker__meta'
      const metaLabel = document.createElement('span')
      const metaValue = document.createElement('b')
      if (state.risk === 'danger') {
        metaLabel.textContent = '雷暴覆盖'
        metaValue.textContent = `${Math.round(state.dbz)} dBZ`
      } else if (state.risk === 'warning') {
        metaLabel.textContent = '预计影响'
        metaValue.textContent = `${state.distanceKm ?? 18} km`
      } else if (state.risk === 'attention') {
        metaLabel.textContent = '距强回波'
        metaValue.textContent = `${state.distanceKm ?? 32} km`
      } else {
        metaLabel.textContent = '最近回波'
        metaValue.textContent = `${state.distanceKm ?? 120} km`
      }
      meta.append(metaLabel, metaValue)
      card.append(header, meta)
      beaconRoot.append(beacon)
      root.append(link, card)
      const beaconMarker = new maplibregl.Marker({ element: beaconRoot, anchor: 'center' }).setLngLat(mine.center).addTo(map)
      const cardMarker = new maplibregl.Marker({ element: root, anchor: 'center' }).setLngLat(mine.center).addTo(map)
      markers.set(mine.id, [beaconMarker, cardMarker])
      markerElements.set(mine.id, { root, mine, risk: state.risk })
    }
    markers.forEach((items, id) => { if (!visibleIds.has(id)) { items.forEach((marker) => marker.remove()); markers.delete(id) } })
    syncDetailCard()
    requestAnimationFrame(layoutMarkers)
  }

  const overlaps = (a: DOMRect, b: DOMRect) => !(a.right + 10 < b.left || a.left - 10 > b.right || a.bottom + 10 < b.top || a.top - 10 > b.bottom)
  const syncCardOcclusion = () => {
    const popupRect = detailPopup?.getElement().getBoundingClientRect()
    markerElements.forEach(({ root }, id) => {
      const card = root.querySelector<HTMLElement>('.mine-marker__card')
      const blocked = Boolean(popupRect && card && id !== selectedId && overlaps(card.getBoundingClientRect(), popupRect))
      root.classList.toggle('mine-marker--occluded', blocked)
    })
  }
  const layoutMarkers = () => {
    const occupied: DOMRect[] = []
    const severity: Record<MineRisk, number> = { danger: 4, warning: 3, attention: 2, normal: 1 }
    const ordered = [...markerElements.values()].sort((a, b) => severity[b.risk] - severity[a.risk])
    const viewport = map.getContainer().getBoundingClientRect()
    for (const item of ordered) {
      const card = item.root.querySelector<HTMLElement>('.mine-marker__card')
      if (!card) continue
      // Cards have different heights (compact normal vs. two-line risk card).
      // Feed the measured height back to CSS so the leader elbow always lands
      // on the actual vertical centre instead of relying on a guessed length.
      item.root.style.setProperty('--card-half-height', `${card.offsetHeight / 2}px`)
      item.root.classList.remove('mine-marker--left', 'mine-marker--below', 'mine-marker--collapsed')
      const candidates = ['', 'mine-marker--left', 'mine-marker--below', 'mine-marker--left mine-marker--below']
      let placed = false
      for (const candidate of candidates) {
        item.root.classList.remove('mine-marker--left', 'mine-marker--below')
        candidate.split(' ').filter(Boolean).forEach((name) => item.root.classList.add(name))
        const rect = card.getBoundingClientRect()
        const inView = rect.left >= viewport.left + 8 && rect.right <= viewport.right - 8 && rect.top >= viewport.top + 8 && rect.bottom <= viewport.bottom - 8
        if (inView && !occupied.some((other) => overlaps(rect, other))) { occupied.push(rect); placed = true; break }
      }
      if (!placed && item.risk !== 'danger') item.root.classList.add('mine-marker--collapsed')
      else if (!placed) occupied.push(card.getBoundingClientRect())
    }
    syncCardOcclusion()
  }
  map.on('moveend', layoutMarkers)
  map.on('resize', layoutMarkers)

  let frame = 0
  const animate = (time: number) => {
    if (map.getLayer(layers[2]!)) {
      const wave = (Math.sin(time / 520) + 1) / 2
      const ambient = (Math.sin(time / 1180) + 1) / 2
      const focus = (Math.sin(time / 680) + 1) / 2
      map.setPaintProperty(layers[2]!, 'line-opacity', .18 + wave * .38)
      map.setPaintProperty(layers[2]!, 'line-width', 3.5 + wave * 3.5)
      map.setPaintProperty(layers[0]!, 'fill-opacity', ['match',['get','risk'],'attention',.2,'warning',.25,'danger',.24 + wave * .16,.19])
      // 未选中矿区只做缓慢的“在线巡航”，保持存在感但不抢雷达信息。
      map.setPaintProperty('mine-normal-halo', 'line-opacity', .2 + ambient * .16)
      map.setPaintProperty('mine-normal-halo', 'line-width', ['interpolate',['linear'],['zoom'],3,2.8 + ambient * .8,8,5.4 + ambient * 1.2])
      map.setPaintProperty('mine-normal-separator', 'line-opacity', .38 + ambient * .1)
      map.setPaintProperty('mine-normal-node-glow', 'circle-opacity', .09 + ambient * .12)
      map.setPaintProperty('mine-normal-node-glow', 'circle-radius', ['interpolate',['linear'],['zoom'],3,4 + ambient * 1.5,8,7 + ambient * 2.2])
      // 选中态聚焦频率略快，用双层边线形成收拢的能量感，不再使用夸张光圈。
      map.setPaintProperty('mine-selected-outline', 'line-opacity', .48 + focus * .26)
      map.setPaintProperty('mine-selected-outline', 'line-width', ['interpolate',['linear'],['zoom'],3,5.5 + focus * 1.5,8,8 + focus * 2.2])
      map.setPaintProperty('mine-selected-fill', 'fill-opacity', ['match',['get','risk'],'normal',.15 + focus * .07,.1 + focus * .06])
      map.setPaintProperty('mine-selected-core', 'line-opacity', .82 + focus * .18)
    }
    frame = requestAnimationFrame(animate)
  }
  frame = requestAnimationFrame(animate)

  const setCursor = () => { map.getCanvas().style.cursor = 'pointer' }
  const clearCursor = () => { map.getCanvas().style.cursor = '' }
  openMineDetail = (id: string) => {
    const mine = MINE_AREAS.find((item) => item.id === id)
    if (!mine) return
    const token = ++detailToken
    detailPopup?.remove()
    detailPopup = undefined
    selectedId = id
    ;(map.getSource(SOURCE) as GeoJSONSource | undefined)?.setData(collection(risks, selectedId, showAll) as any)
    syncDetailCard()
    // Focus the selected mine at an upper-middle visual anchor. A moderate
    // zoom-in reveals the real polygon while leaving room below for context.
    const mineBounds = new maplibregl.LngLatBounds()
    mine.boundary.coordinates[0]?.forEach((coordinate) => mineBounds.extend(coordinate as [number, number]))
    map.fitBounds(mineBounds, {
      padding:{ top:115, right:115, bottom:150, left:115 },
      maxZoom:8.3,
      duration:820,
      easing:(t) => 1 - Math.pow(1 - t, 3),
      essential:true,
    })
    const state = risks.get(id) ?? { id, dbz: 0, risk: 'normal' as const, distanceKm: 120 }
    const index = MINE_AREAS.findIndex((item) => item.id === id)
    const panel = document.createElement('section')
    panel.className = `mine-detail mine-detail--${state.risk}`
    const status = ({ normal: '正常监测', attention: '雷暴关注', warning: '雷暴预警', danger: '危险影响' } as const)[state.risk]
    const rows: Array<[string, string]> = [
      ['所属租户', mine.tenant], ['矿区面积', `${24 + index * 7} km²`],
      [state.risk === 'attention' ? '邻近强回波' : '区域最大回波', `dBZ ${Math.round(state.dbz)}`], ['监测设备', `${16 + index * 3} 台`],
      ['态势判断', riskDetail(state)], ['数据时间', new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })],
    ]
    const title = document.createElement('header')
    const eyebrow = document.createElement('div')
    eyebrow.className = 'mine-detail__eyebrow'
    eyebrow.innerHTML = '<i></i><span>矿区安全态势</span><em>LIVE</em>'
    const name = document.createElement('strong')
    const badge = document.createElement('span')
    name.textContent = mine.name
    badge.textContent = status
    title.append(name, badge)
    const grid = document.createElement('div')
    rows.forEach(([label, value]) => { const item = document.createElement('div'); const small = document.createElement('small'); const content = document.createElement('b'); small.textContent = label; content.textContent = value; item.append(small, content); grid.append(item) })
    const footer = document.createElement('footer')
    footer.innerHTML = '<span>雷达融合分析</span><i></i><span>实时风险计算</span>'
    const sceneConfig = ({
      '001': { image: lightningCenterImage, label: '雷暴中心', description: '强对流影响场景' },
      '002': { image: lightningNearbyImage, label: '临近雷暴', description: '雷暴逼近场景' },
    } as const)[mine.id as '001' | '002']
    const scene = sceneConfig ? document.createElement('figure') : undefined
    if (scene && sceneConfig) {
      scene.className = 'mine-detail__scene'
      const image = document.createElement('img')
      image.src = sceneConfig.image
      image.alt = `${mine.name}${sceneConfig.label}数字孪生场景预览`
      image.decoding = 'async'
      const caption = document.createElement('figcaption')
      const captionText = document.createElement('span')
      const sceneTag = document.createElement('em')
      captionText.textContent = sceneConfig.description
      sceneTag.textContent = sceneConfig.label
      caption.append(captionText, sceneTag)
      scene.append(image, caption)
    }
    const sceneAction = sceneConfig ? document.createElement('button') : undefined
    if (sceneAction) {
      sceneAction.type = 'button'
      sceneAction.className = 'mine-detail__scene-action'
      sceneAction.innerHTML = '<span>进入三维场景</span><i>↗</i>'
      sceneAction.addEventListener('click', (event) => {
        event.stopPropagation()
        map.getContainer().dispatchEvent(new CustomEvent('mine-enter-3d', { detail: { mineId: mine.id, name: mine.name, risk: state.risk } }))
      })
    }
    panel.append(eyebrow, title)
    if (scene) panel.append(scene)
    if (sceneAction) panel.append(sceneAction)
    panel.append(grid, footer)
    detailPopup = new maplibregl.Popup({ closeButton: true, closeOnClick: true, anchor: 'left', offset: [72, -48], maxWidth: scene ? '340px' : '290px', className: 'mine-detail-popup' }).setLngLat(mine.center).setDOMContent(panel).addTo(map)
    detailPopup.getElement().style.setProperty('--detail', ({ normal:'#35D07F', attention:'#FFCC33', warning:'#FFCC33', danger:'#FF4560' } as const)[state.risk])
    requestAnimationFrame(() => requestAnimationFrame(syncCardOcclusion))
    window.setTimeout(syncCardOcclusion, 760)
    detailPopup.once('close', () => {
      if (token !== detailToken) return
      detailPopup = undefined
      selectedId = ''
      ;(map.getSource(SOURCE) as GeoJSONSource | undefined)?.setData(collection(risks, selectedId, showAll) as any)
      syncDetailCard()
      syncCardOcclusion()
    })
  }
  const onMineClick = (event: any) => openMineDetail(String(event.features?.[0]?.properties?.id ?? ''))
  map.on('mouseenter', layers[0]!, setCursor)
  map.on('mouseleave', layers[0]!, clearCursor)
  map.on('click', layers[0]!, onMineClick)

  const overviewElement = document.createElement('div')
  overviewElement.className = 'maplibregl-ctrl mine-overview-control'
  const overviewButton = document.createElement('button')
  overviewButton.type = 'button'
  overviewButton.className = 'mine-overview-control__button'
  overviewButton.title = '查看全部矿区'
  overviewButton.setAttribute('aria-label', '查看全部矿区')
  overviewButton.innerHTML = '<i><b></b></i><span>全部矿区</span><em>8</em>'
  overviewButton.addEventListener('click', () => {
    detailPopup?.remove()
    showAll = !showAll
    overviewButton.classList.toggle('is-active', showAll)
    overviewButton.querySelector('span')!.textContent = showAll ? '重点矿区' : '全部矿区'
    const problemMines = MINE_AREAS.filter((mine) => (risks.get(mine.id)?.risk ?? 'normal') !== 'normal')
    overviewButton.querySelector('em')!.textContent = showAll ? String(problemMines.length) : String(MINE_AREAS.length)
    ;(map.getSource(SOURCE) as GeoJSONSource | undefined)?.setData(collection(risks, selectedId, showAll) as any)
    // DOM callout cards now carry the name and status. Avoid rendering a
    // second text label beneath them, which made the overview feel crowded.
    map.setLayoutProperty('mine-overview-names', 'visibility', 'none')
    renderMarkers()
    const bounds = new maplibregl.LngLatBounds()
    const visibleMines = showAll ? MINE_AREAS : problemMines
    visibleMines.forEach((mine) => mine.boundary.coordinates[0]?.forEach((coordinate) => bounds.extend(coordinate as [number, number])))
    if (bounds.isEmpty()) return
    map.fitBounds(bounds, {
      padding: { top: 86, right: 92, bottom: 72, left: 92 },
      duration: 920,
      easing: (time) => 1 - Math.pow(1 - time, 3),
      essential: true,
      maxZoom: 5.2,
    })
  })
  overviewElement.append(overviewButton)
  const overviewControl: any = {
    onAdd: () => overviewElement,
    onRemove: () => overviewElement.remove(),
  }
  map.addControl(overviewControl, 'top-right')

  return {
    update(values: RiskValue[]) {
      values.forEach((value) => risks.set(value.id, value))
      ;(map.getSource(SOURCE) as GeoJSONSource | undefined)?.setData(collection(risks, selectedId, showAll) as any)
      renderMarkers()
    },
    dispose() { cancelAnimationFrame(frame); detailToken += 1; detailPopup?.remove(); if (map.hasControl(overviewControl)) map.removeControl(overviewControl); map.off('mouseenter', layers[0]!, setCursor); map.off('mouseleave', layers[0]!, clearCursor); map.off('click', layers[0]!, onMineClick); map.off('moveend', layoutMarkers); map.off('resize', layoutMarkers); markers.forEach((items) => items.forEach((marker) => marker.remove())); markers.clear(); markerElements.clear() },
  }
}
