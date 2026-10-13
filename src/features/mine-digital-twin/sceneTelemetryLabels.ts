import * as THREE from 'three'
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js'
import { ASSETS, type Vec3 } from './layout'
import { MONITORING_DEVICES } from './monitoringDevices'
import { PROTECTION_FACILITIES } from './protectionFacilities'
import type { createFactorySimulation } from './factorySimulation'
import type { DemoSnapshot } from './stormDemo'
import './telemetryLabels.css'

type FactorySnapshot = ReturnType<ReturnType<typeof createFactorySimulation>['snapshot']>
type LabelState = 'running' | 'stopped' | 'normal' | 'warning' | 'fault' | 'unavailable'
type Layer = 'buildings' | 'monitoring' | 'protection'
export interface TelemetryLabelOptions {
  camera: THREE.PerspectiveCamera
  width: number
  height: number
  overview: boolean
  compact: boolean
  layers: { buildings: boolean; monitoring: boolean; protection: boolean; labels: boolean }
  drillActive: boolean
  selectedId: string | null
}
interface Definition {
  id: string
  title: string
  code: string
  icon: string
  layer: Layer
  anchor: Vec3
  offset: [number, number]
  priority: number
  metric: (factory: FactorySnapshot | null, storm: DemoSnapshot) => { label: string; value: string; state: LabelState }
}
const icons = {
  hoist: 'M5 21 9 4h6l4 17M7 16h10M8 10h8M9 4V2h6v2M6 21 17 10M18 21 7 10',
  silo: 'M6 7h12v10l-5 4h-2l-5-4V7Zm0 0 6-5 6 5M8 19v3m8-3v3',
  belt: 'm2 14 16-8 4 4-16 8-4-4Zm4 4v4m12-10v6m-12-5 2 2m3-5 2 2',
  power: 'm13 2-8 12h6l-1 8 9-13h-6V2Z',
  shield: 'm12 2-9 4v6c0 5 9 10 9 10s9-5 9-10V6l-9-4Zm-4 10 3 3 5-6',
  sensor: 'M12 10v12m-4 0h8M8 13a5 5 0 1 1 8 0M5 16a9 9 0 1 1 14 0M12 8v2',
}
const stateNames: Record<LabelState, string> = { running: '运行中', stopped: '已停止', normal: '正常', warning: '预警', fault: '故障', unavailable: '未就绪' }
function assetAnchor(id: string, above = 1): Vec3 {
  const asset = ASSETS.find(item => item.id === id)!
  return [asset.position[0], asset.position[1] + asset.size[1] + above, asset.position[2]]
}
function deviceState(factory: FactorySnapshot | null, id: string): LabelState {
  return factory?.devices.find(item => item.id === id)?.status ?? 'unavailable'
}
function worst(states: LabelState[]): LabelState {
  return states.includes('fault') ? 'fault' : states.includes('warning') ? 'warning' : states.includes('running') ? 'running' : states.every(state => state === 'normal') ? 'normal' : 'stopped'
}
function definitions(): Definition[] {
  const pole = PROTECTION_FACILITIES.find(item => item.id === 'air-terminal-production')!
  const sensor = MONITORING_DEVICES.find(item => item.id === 'storm-warning-01')!
  return [
    { id: 'headframe-01', title: '井架 / 提升系统', code: '01 · PRODUCTION', icon: icons.hoist, layer: 'buildings', anchor: assetAnchor('headframe-01'), offset: [45, -26], priority: 100,
      metric: factory => ({ label: '提升行程', value: factory ? `${factory.hoistStrokeMeters.toFixed(2)} m` : '—', state: deviceState(factory, 'hoist-house-01') }) },
    ...['coal-silo-01', 'coal-silo-02'].map((id, index): Definition => ({ id, title: `煤仓 ${String(index + 1).padStart(2, '0')}`, code: `02 · STORAGE ${index + 1}`, icon: icons.silo, layer: 'buildings', anchor: assetAnchor(id), offset: index ? [40, -84] : [-54, -26], priority: 76 - index,
      metric: factory => ({ label: '模拟料位', value: factory ? `${((factory.stocks.find(stock => stock.id === id)?.level ?? 0) * 100).toFixed(1)} %` : '—', state: deviceState(factory, id) }) })),
    { id: 'transfer-01', title: '煤炭运输系统', code: '02 · TRANSPORT', icon: icons.belt, layer: 'buildings', anchor: assetAnchor('transfer-01'), offset: [-94, -30], priority: 85,
      metric: factory => {
        const belts = factory?.devices.filter(item => ['shaft-transfer', 'transfer-silo-1', 'transfer-silo-2'].includes(item.id)) ?? []
        const device = belts.find(item => item.id === 'shaft-transfer')
        return { label: '设定带速', value: device ? `${device.speed.toFixed(2)} m/s` : '—', state: belts.length ? worst(belts.map(item => item.status)) : 'unavailable' }
      } },
    { id: 'substation-01', title: '电力保障区', code: '03 · POWER', icon: icons.power, layer: 'buildings', anchor: assetAnchor('substation-01', 1.6), offset: [30, -54], priority: 90,
      metric: factory => {
        const devices = factory?.devices.filter(item => item.id.startsWith('power-cabinet-lv-')) ?? []
        return { label: '低压柜运行', value: `${devices.filter(item => item.status === 'running').length} / ${devices.length}`, state: deviceState(factory, 'power-transformer-01') }
      } },
    { id: pole.id, title: '雷电防护设施', code: '06 · PROTECTION', icon: icons.shield, layer: 'protection', anchor: [pole.position[0], pole.position[1] + 10.3, pole.position[2]], offset: [12, -68], priority: 82,
      metric: (_factory, storm) => {
        const protectedIds = new Set(PROTECTION_FACILITIES.map(item => item.id))
        const devices = storm.devices.filter(item => protectedIds.has(item.id))
        return { label: '防护设施正常', value: `${devices.filter(item => item.status === 'normal').length} / ${devices.length}`, state: devices.length ? worst(devices.map(item => item.status)) : 'unavailable' }
      } },
    { id: sensor.id, title: '雷暴预警仪', code: '05 · MONITORING', icon: icons.sensor, layer: 'monitoring', anchor: [sensor.position[0], sensor.position[1] + 3.2, sensor.position[2]], offset: [-24, -40], priority: 80,
      metric: (_factory, storm) => ({ label: '预警演示进度', value: `${Math.round(storm.progress * 100)} %`, state: storm.devices.find(item => item.id === sensor.id)?.status ?? 'unavailable' }) },
  ]
}

/** DOM cards only: no extra render pass, GPU resources, frame loop or simulated state. */
export function createSceneTelemetryLabels(parent: THREE.Group, onLocate: (id: string) => void) {
  const group = new THREE.Group()
  group.name = 'mine-spatial-telemetry'
  parent.add(group)
  const world = new THREE.Vector3(), projected = new THREE.Vector3()
  let disposed = false
  let options: TelemetryLabelOptions | null = null
  const cards = definitions().map(definition => {
    const element = document.createElement('div')
    element.className = 'mine-telemetry-anchor'
    element.dataset.entityId = definition.id
    const marker = document.createElement('span')
    marker.className = 'mine-telemetry-marker'
    const leader = document.createElement('span')
    leader.className = 'mine-telemetry-leader'
    const button = document.createElement('button')
    button.className = 'mine-telemetry-card'
    button.type = 'button'
    // All interpolated content is authored static metadata. Dynamic readings use textContent.
    button.innerHTML = `<span class="mine-telemetry-top"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${definition.icon}"/></svg><strong>${definition.title}</strong><span class="mine-telemetry-arrow" aria-hidden="true">›</span></span><span class="mine-telemetry-reading"><span class="mine-telemetry-key"></span><b></b></span><span class="mine-telemetry-bottom"><span class="mine-telemetry-status"></span><small>演示数据</small></span>`
    button.title = `${definition.title} · ${definition.id} · 点击定位 · 演示数据`
    const onClick = (event: MouseEvent) => { event.stopPropagation(); onLocate(definition.id) }
    const stopPointer = (event: Event) => event.stopPropagation()
    button.addEventListener('click', onClick)
    button.addEventListener('pointerdown', stopPointer)
    button.addEventListener('dblclick', stopPointer)
    element.append(leader, marker, button)
    const object = new CSS2DObject(element)
    object.name = `telemetry-${definition.id}`
    object.position.fromArray(definition.anchor)
    object.raycast = () => {}
    group.add(object)
    return { definition, element, marker, leader, button, object,
      metricKey: button.querySelector<HTMLElement>('.mine-telemetry-key')!,
      metricValue: button.querySelector<HTMLElement>('.mine-telemetry-reading b')!,
      status: button.querySelector<HTMLElement>('.mine-telemetry-status')!,
      onClick, stopPointer, enabled: false, visible: false, x: 0, y: 0, priority: definition.priority,
      measuredWidth: 156, measuredHeight: 76, lastReading: '' }
  })
  function update(factory: FactorySnapshot | null, storm: DemoSnapshot, next: TelemetryLabelOptions) {
    if (disposed) return
    options = next
    group.visible = next.layers.labels && !next.drillActive
    for (const card of cards) {
      const { definition, object } = card
      const reading = definition.metric(factory, storm)
      const key = `${reading.state}|${reading.label}|${reading.value}`
      if (key !== card.lastReading) {
        card.lastReading = key
        card.metricKey.textContent = reading.label
        card.metricValue.textContent = reading.value
        card.status.textContent = stateNames[reading.state]
        card.element.dataset.state = reading.state
        card.button.setAttribute('aria-label', `${definition.title}，${stateNames[reading.state]}，${reading.label} ${reading.value}，演示数据，点击定位`)
      }
      object.getWorldPosition(world)
      projected.copy(world).project(next.camera)
      const distance = next.camera.position.distanceTo(world)
      card.x = (projected.x + 1) * .5 * next.width
      card.y = (1 - projected.y) * .5 * next.height
      const isSelected = next.selectedId === definition.id
      card.priority = definition.priority + (isSelected ? 200 : 0) + (reading.state === 'fault' || reading.state === 'warning' ? 100 : 0)
      card.enabled = group.visible && next.layers[definition.layer] && projected.z > -1 && projected.z < 1 && distance < 650 &&
        (next.overview || isSelected || distance < 190)
      object.visible = card.enabled
      card.element.classList.toggle('is-selected', isSelected)
      if (!card.enabled) { card.element.style.visibility = 'hidden'; card.visible = false }
    }
  }
  function layout() {
    if (disposed || !options || !group.visible) return
    const { width, height, overview, compact } = options
    const inset = overview && !compact ? width >= 1400 ? 346 : width >= 1100 ? 302 : 18 : 18
    const bounds = { left: inset, right: width - inset, top: 100, bottom: height - (overview && !compact ? 155 : 115) }
    const occupied: { left: number; right: number; top: number; bottom: number }[] = []
    // Layout measurements are batched before position writes, and cached for hidden cards.
    for (const card of cards) if (card.enabled) {
      card.measuredWidth = card.button.offsetWidth || card.measuredWidth
      card.measuredHeight = card.button.offsetHeight || card.measuredHeight
    }
    const ordered = [...cards].sort((a, b) => b.priority - a.priority)
    for (const card of ordered) {
      if (!card.enabled) continue
      const [preferredX, preferredY] = card.definition.offset
      const w = card.measuredWidth, h = card.measuredHeight
      const offsets = [[preferredX, preferredY], [preferredX, preferredY - h - 10], [preferredX + w + 12, preferredY], [preferredX - w - 12, preferredY], [0, -26]]
      let placement: number[] | undefined
      for (const offset of offsets) {
        const x = Math.max(bounds.left + w / 2, Math.min(bounds.right - w / 2, card.x + offset[0]!))
        const y = card.y + offset[1]!
        const box = { left: x - w / 2, right: x + w / 2, top: y - h, bottom: y }
        if (Math.abs(x - card.x) > 225 || box.top < bounds.top || box.bottom > bounds.bottom || box.left < bounds.left || box.right > bounds.right) continue
        if (occupied.some(other => box.left < other.right + 10 && box.right > other.left - 10 && box.top < other.bottom + 10 && box.bottom > other.top - 10)) continue
        occupied.push(box)
        placement = [x - card.x, y - card.y]
        break
      }
      card.visible = !!placement
      card.element.style.visibility = placement ? 'visible' : 'hidden'
      if (!placement) continue
      const [x = 0, y = 0] = placement
      card.button.style.left = `${x}px`
      card.button.style.top = `${y}px`
      card.leader.style.width = `${Math.hypot(x, y)}px`
      card.leader.style.transform = `rotate(${Math.atan2(y, x)}rad)`
    }
  }
  return {
    update, layout,
    get diagnostics() { return { cards: cards.length, visible: cards.filter(card => card.visible).length, visibleIds: cards.filter(card => card.visible).map(card => card.definition.id), gpuDrawCalls: 0 } },
    dispose() {
      if (disposed) return
      disposed = true
      for (const card of cards) {
        card.button.removeEventListener('click', card.onClick)
        card.button.removeEventListener('pointerdown', card.stopPointer)
        card.button.removeEventListener('dblclick', card.stopPointer)
        card.object.removeFromParent()
        card.element.remove()
      }
      group.removeFromParent()
    },
  }
}
