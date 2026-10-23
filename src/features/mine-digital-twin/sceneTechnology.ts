import * as THREE from 'three'
import bindings from '../../../public/models/mine-factory-animation.bindings.json'
import powerParameters from '../../../scripts/blender/power_area.parameters.json'
import { ASSETS, ZONES } from './layout'
import type { createFactorySimulation } from './factorySimulation'

type FactorySnapshot = ReturnType<ReturnType<typeof createFactorySimulation>['snapshot']>
export interface SceneTechnologyOptions {
  selectedId: string | null
  buildings: boolean
  monitoring: boolean
  protection: boolean
  drillActive: boolean
  overview: boolean
}

const vertexShader = /* glsl */ `
  attribute float channel;
  attribute vec2 trace;
  varying float vChannel;
  varying vec2 vTrace;
  void main(){
    vChannel=channel; vTrace=trace;
    gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);
  }
`

interface RibbonData { position: number[]; trace: number[]; channel: number[] }
const emptyData = (): RibbonData => ({ position: [], trace: [], channel: [] })

function ribbon(data: RibbonData, a: THREE.Vector3, b: THREE.Vector3, side: THREE.Vector3, halfWidth: number, channel: number, distance = 0) {
  const width = side.clone().normalize().multiplyScalar(halfWidth)
  const length = a.distanceTo(b)
  const corners = [a.clone().sub(width), a.clone().add(width), b.clone().add(width), b.clone().sub(width)]
  for (const index of [0, 1, 2, 0, 2, 3]) {
    data.position.push(...corners[index]!.toArray())
    data.trace.push(index < 2 ? distance : distance + length, index === 0 || index === 3 ? -1 : 1)
    data.channel.push(channel)
  }
  return length
}

function geometry(data: RibbonData) {
  const result = new THREE.BufferGeometry()
  result.setAttribute('position', new THREE.Float32BufferAttribute(data.position, 3))
  result.setAttribute('trace', new THREE.Float32BufferAttribute(data.trace, 2))
  result.setAttribute('channel', new THREE.Float32BufferAttribute(data.channel, 1))
  result.computeBoundingSphere()
  return result
}

/** Read-only digital overlays. Mechanical geometry, asset IDs and pick targets are untouched. */
export function createSceneTechnology(parent: THREE.Group) {
  const root = new THREE.Group()
  root.name = 'mine-technology-overlays'
  root.userData.dataSource = '演示数据'
  parent.add(root)
  const ownedGeometry: THREE.BufferGeometry[] = []
  const ownedMaterials: THREE.Material[] = []
  const zoneData = emptyData()
  const cornerData = emptyData()
  const zoneLevels = { value: new Float32Array(6) }
  const selectedZone = { value: -1 }

  ZONES.forEach((zone, index) => {
    const [cx, cz] = zone.center, [w, d] = zone.size
    const corners = [
      new THREE.Vector3(cx - w / 2, .13, cz - d / 2), new THREE.Vector3(cx + w / 2, .13, cz - d / 2),
      new THREE.Vector3(cx + w / 2, .13, cz + d / 2), new THREE.Vector3(cx - w / 2, .13, cz + d / 2),
    ]
    let distance = 0
    for (let edge = 0; edge < 4; edge++) {
      const a = corners[edge]!, b = corners[(edge + 1) % 4]!
      const tangent = b.clone().sub(a).normalize()
      const side = new THREE.Vector3(-tangent.z, 0, tangent.x)
      distance += ribbon(zoneData, a, b, side, .24, index, distance)
      const endLength = Math.min(4.2, a.distanceTo(b) * .18)
      ribbon(cornerData, a, a.clone().addScaledVector(tangent, endLength), side, .30, index)
      ribbon(cornerData, b.clone().addScaledVector(tangent, -endLength), b, side, .30, index)
      // Small vertical registration ticks make the outline read as a spatial overlay.
      ribbon(cornerData, a, a.clone().add(new THREE.Vector3(0, .64, 0)), side, .055, index)
    }
  })

  const zoneMaterial = (corners: boolean) => new THREE.ShaderMaterial({
    uniforms: { uLevels: zoneLevels, uSelected: selectedZone }, vertexShader,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform float uLevels[6];
      uniform float uSelected;
      varying float vChannel;
      varying vec2 vTrace;
      void main(){
        int index=int(vChannel+.5);
        float selected=1.0-step(.25,abs(vChannel-uSelected));
        float edge=1.0-smoothstep(.08,1.0,abs(vTrace.y));
        float core=1.0-smoothstep(.08,.28,abs(vTrace.y));
        float segmentation=${corners ? '1.0' : '.38+.62*(1.0-smoothstep(.75,.86,fract(vTrace.x/3.3)))'};
        float alpha=uLevels[index]*segmentation*(edge*${corners ? '.44' : '.22'}+core*${corners ? '.51' : '.57'})*(1.0+selected*.22);
        gl_FragColor=vec4(mix(vec3(.035,.51,.87),vec3(.32,.89,1.0),core*.85+selected*.15),alpha);
      }
    `,
    transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide,
    toneMapped: false, blending: THREE.NormalBlending,
  })

  function addMesh(data: RibbonData, material: THREE.ShaderMaterial, name: string) {
    const mesh = new THREE.Mesh(geometry(data), material)
    mesh.name = name
    mesh.raycast = () => {}
    mesh.renderOrder = 3
    mesh.castShadow = mesh.receiveShadow = false
    ownedGeometry.push(mesh.geometry); ownedMaterials.push(material)
    root.add(mesh)
    return mesh
  }
  const zoneMesh = addMesh(zoneData, zoneMaterial(false), 'technology-zone-boundaries')
  const cornerMesh = addMesh(cornerData, zoneMaterial(true), 'technology-zone-registration')

  const flowData = emptyData()
  const flowTravel = { value: new Float32Array(4) }
  const flowState = { value: new Float32Array(4) }
  // The reference is the carrying belt's authored arclength. A narrow trace sits on
  // each cover edge; the .54 m normal offset clears its .43 m weather-cover crown.
  for (const [index, conveyor] of bindings.conveyors.entries()) {
    const normal = new THREE.Vector3().fromArray(conveyor.normal)
    const across = new THREE.Vector3().fromArray(conveyor.across)
    for (const side of [-1, 1]) {
      const a = new THREE.Vector3().fromArray(conveyor.start).addScaledVector(normal, .54).addScaledVector(across, side * .64)
      const b = new THREE.Vector3().fromArray(conveyor.end).addScaledVector(normal, .54).addScaledVector(across, side * .64)
      ribbon(flowData, a, b, across, .27, index)
    }
  }

  // Same conductor waypoints as generate_power_area.py: bus_drop,
  // closed_disconnect_blade, switch_to_breaker, breaker_to_transformer.
  // This overlays existing conductors only. No unmodelled underground feeders
  // or arbitrary cross-park connections are represented as real wiring.
  const station = new THREE.Vector3().fromArray(powerParameters.substation.position)
  for (const x of [2.05, 3, 3.95]) {
    const points = [
      [x, powerParameters.substation.busHeight, -4.7], [x, powerParameters.substation.busHeight, -2.5],
      [x, 4.05, -2.72], [x, 3.22, -2.85], [x, 3.22, -1.85],
      [x, 3.52, -1.4], [x, 3.22, -.25], [x, 4.05, .5], [x, 4.42, 1.7],
    ].map(p => new THREE.Vector3().fromArray(p).add(station))
    let distance = 0
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i]!, b = points[i + 1]!
      const direction = b.clone().sub(a).normalize()
      const side = new THREE.Vector3(1, 0, 0)
      const cross = side.clone().cross(direction).normalize()
      ribbon(flowData, a, b, side, .15, 3, distance)
      distance += ribbon(flowData, a, b, cross, .15, 3, distance)
    }
  }

  const flowMaterial = new THREE.ShaderMaterial({
    uniforms: { uTravel: flowTravel, uState: flowState }, vertexShader,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform float uTravel[4];
      uniform float uState[4];
      varying float vChannel;
      varying vec2 vTrace;
      void main(){
        int index=int(vChannel+.5);
        float state=uState[index];
        float running=step(.5,state)*(1.0-step(1.5,state));
        float fault=step(1.5,state);
        float edge=1.0-smoothstep(.05,1.0,abs(vTrace.y));
        float phase=fract((vTrace.x-uTravel[index])/4.8);
        float packet=smoothstep(.36,.52,phase)*(1.0-smoothstep(.53,.70,phase));
        float core=1.0-smoothstep(.03,.22,abs(vTrace.y));
        vec3 color=mix(mix(vec3(.06,.61,.96),vec3(.49,.95,1.0),core),vec3(.98,.38,.18),fault);
        float alpha=edge*(.26+running*.14+fault*.25)+core*.24+running*packet*(.43*edge+.24*core);
        gl_FragColor=vec4(color,alpha);
      }
    `,
    transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide,
    toneMapped: false, blending: THREE.NormalBlending,
  })
  const flowMesh = addMesh(flowData, flowMaterial, 'technology-authored-process-flows')
  flowMesh.userData.sourcePaths = { coal: 'mine-factory-animation.bindings.json', power: 'generate_power_area.py/substation' }

  // Circular silos and rectangular facilities need different ground contours:
  // an ellipse through a rectangular footing's corners gets hidden by the slab.
  // The small Y offsets follow each authored plinth top; depth testing remains on.
  const facilities = [
    { id: 'headframe-01', deviceIds: ['hoist-house-01'], radius: [9.5, 7.5], height: 24.0, groundY: .39, shape: 4 },
    { id: 'coal-silo-01', deviceIds: ['coal-silo-01'], radius: [6.3, 6.3], height: 11.8, groundY: .16, shape: 2 },
    { id: 'coal-silo-02', deviceIds: ['coal-silo-02'], radius: [6.3, 6.3], height: 11.8, groundY: .16, shape: 2 },
    { id: 'substation-01', deviceIds: ['power-transformer-01'], radius: [11.2, 8.4], height: 5.8, groundY: .28, shape: 4 },
    { id: 'distribution-01', deviceIds: Array.from({ length: 6 }, (_, i) => `power-cabinet-lv-${String(i + 1).padStart(2, '0')}`), radius: [10.8, 6.4], height: 5.2, groundY: .38, shape: 4 },
  ]
  const haloData = emptyData(), trackingData = emptyData()
  const facilityState = { value: new Float32Array(5) }, facilityPhase = { value: new Float32Array(5) }
  const facilitySelected = { value: -1 }
  const facilityClocks = new Float64Array(5)
  for (const [index, facility] of facilities.entries()) {
    const asset = ASSETS.find(a => a.id === facility.id)!
    const origin = new THREE.Vector3(...asset.position)
    const [rx, rz] = facility.radius as [number, number]
    for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]] as const) {
      haloData.position.push(origin.x + x * rx * 1.14, facility.groundY, origin.z + z * rz * 1.14)
      haloData.trace.push(x * 1.14, z * 1.14)
      haloData.channel.push(index)
    }
    // Only two narrow tracks per facility. They sit outside the real footprint
    // and have depth testing, so industrial parts retain their material/detail.
    for (const sign of [-1, 1]) {
      const a = origin.clone().add(new THREE.Vector3(sign * rx * .97, facility.groundY, sign * rz * .24))
      const b = a.clone().add(new THREE.Vector3(0, facility.height, 0))
      for (const side of [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1)])
        ribbon(trackingData, a, b, side, .19, index)
      // A restrained cap makes each spatial registration stroke legible without
      // drawing a box or connecting across the building's upper silhouette.
      ribbon(trackingData, b.clone().add(new THREE.Vector3(-.33, 0, 0)), b.clone().add(new THREE.Vector3(.33, 0, 0)), new THREE.Vector3(0, 1, 0), .085, index, facility.height)
    }
  }
  const facilityUniforms = { uState: facilityState, uPhase: facilityPhase, uSelected: facilitySelected, uShape: { value: new Float32Array(facilities.map(f => f.shape)) } }
  const haloMaterial = new THREE.ShaderMaterial({
    uniforms: facilityUniforms, vertexShader,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform float uState[5]; uniform float uPhase[5]; uniform float uSelected; uniform float uShape[5];
      varying float vChannel; varying vec2 vTrace;
      void main(){
        int index=int(vChannel+.5);
        float selected=1.0-step(.25,abs(vChannel-uSelected));
        float fault=step(1.5,uState[index]);
        float exponent=uShape[index];
        float radius=pow(pow(abs(vTrace.x),exponent)+pow(abs(vTrace.y),exponent),1.0/exponent);
        float aa=max(fwidth(radius),.002);
        float angle=atan(vTrace.y,vTrace.x)/6.2831853+.5;
        float outside=1.0-smoothstep(1.045,1.13,radius);
        float core=1.0-smoothstep(.014,.014+aa*1.3,abs(radius-.94));
        float outer=1.0-smoothstep(.005,.005+aa,abs(radius-1.025));
        float inner=1.0-smoothstep(.006,.006+aa,abs(radius-.85));
        float ticks=1.0-smoothstep(.18,.24,fract(angle*48.0));
        float segments=1.0-smoothstep(.70,.77,fract(angle*8.0));
        float glow=exp(-pow((radius-.94)/.085,2.0));
        float arc=1.0-smoothstep(.0,.12,fract(angle-uPhase[index]*.028));
        float alpha=(core*(.72+arc*.26)+outer*segments*.56+inner*ticks*.54+glow*.25)*outside;
        alpha*=1.0+selected*.17;
        vec3 color=mix(mix(vec3(.03,.55,.93),vec3(.37,.91,1.0),core*.84+arc*.12),vec3(.98,.42,.20),fault);
        gl_FragColor=vec4(color,alpha);
      }
    `,
    transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide,
    toneMapped: false, blending: THREE.NormalBlending,
  })
  const haloMesh = addMesh(haloData, haloMaterial, 'technology-facility-plinth-halos')
  const trackingMaterial = new THREE.ShaderMaterial({
    uniforms: facilityUniforms, vertexShader,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform float uState[5]; uniform float uPhase[5]; uniform float uSelected;
      varying float vChannel; varying vec2 vTrace;
      void main(){
        int index=int(vChannel+.5);
        float selected=1.0-step(.25,abs(vChannel-uSelected));
        float running=step(.5,uState[index])*(1.0-step(1.5,uState[index]));
        float fault=step(1.5,uState[index]);
        float edge=1.0-smoothstep(.02,1.0,abs(vTrace.y));
        float core=1.0-smoothstep(.02,.38,abs(vTrace.y));
        float pulse=exp(-pow((fract((vTrace.x-uPhase[index]*1.7)/8.0)-.65)*8.0,2.0));
        float fade=exp(-vTrace.x*.025);
        float alpha=(edge*.18+core*.45+running*pulse*.26)*(1.0+selected*.2)*fade;
        gl_FragColor=vec4(mix(vec3(.18,.82,1.0),vec3(.98,.42,.20),fault),alpha);
      }
    `,
    transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide,
    toneMapped: false, blending: THREE.NormalBlending,
  })
  const trackingMesh = addMesh(trackingData, trackingMaterial, 'technology-facility-tracking-strokes')
  haloMesh.userData.facilityIds = trackingMesh.userData.facilityIds = facilities.map(f => f.id)

  let previousClock = 0, disposed = false, lastOptions = '', lastVisibility = false
  let electricalPhase = 0
  const byId = new Map<string, FactorySnapshot['devices'][number]>()
  const update = (snapshot: FactorySnapshot, options: SceneTechnologyOptions): boolean => {
    if (disposed) return false
    byId.clear()
    for (const device of snapshot.devices) byId.set(device.id, device)
    const optionsKey = [options.selectedId, options.buildings, options.monitoring, options.protection, options.drillActive, options.overview].join('|')
    let changed = optionsKey !== lastOptions
    lastOptions = optionsKey
    root.visible = !options.drillActive
    zoneMesh.visible = cornerMesh.visible = options.overview
    flowMesh.visible = options.buildings
    haloMesh.visible = trackingMesh.visible = options.buildings && options.overview
    const previouslyVisible = lastVisibility
    const visiblyActive = root.visible && (flowMesh.visible || zoneMesh.visible)
    if (visiblyActive !== lastVisibility) changed = true
    lastVisibility = visiblyActive
    let zone = ASSETS.find(a => a.id === options.selectedId)?.zone
    if (options.selectedId?.startsWith('power-')) zone = 'power'
    if (options.selectedId?.startsWith('transfer-silo') || options.selectedId === 'shaft-transfer') zone = 'transport'
    if (options.selectedId?.startsWith('air-') || options.selectedId?.startsWith('ground-') || options.selectedId?.startsWith('spd-')) zone = 'protection'
    selectedZone.value = ZONES.findIndex(z => z.id === zone)
    ZONES.forEach((z, i) => { zoneLevels.value[i] = (z.id === 'monitoring' ? options.monitoring : z.id === 'protection' ? options.protection : options.buildings) ? 1 : 0 })

    const elapsed = snapshot.clock >= previousClock ? snapshot.clock - previousClock : 0
    if (snapshot.clock < previousClock) { electricalPhase = 0; facilityClocks.fill(0) }
    const transformer = byId.get('power-transformer-01')
    if (transformer?.status === 'running') electricalPhase += elapsed * .8
    facilitySelected.value = facilities.findIndex(f => f.id === options.selectedId || f.deviceIds.includes(options.selectedId ?? ''))
    facilities.forEach((facility, index) => {
      const states = facility.deviceIds.map(id => byId.get(id)?.status)
      const state = states.includes('fault') ? 2 : states.includes('running') ? 1 : 0
      if (state === 1) facilityClocks[index] = facilityClocks[index]! + elapsed
      const phase = Math.fround(facilityClocks[index]!)
      if (facilityState.value[index] !== state || facilityPhase.value[index] !== phase) changed = true
      facilityState.value[index] = state
      facilityPhase.value[index] = phase
    })
    previousClock = snapshot.clock
    const devices = [...bindings.conveyors.map(c => byId.get(c.id)), transformer]
    devices.forEach((device, index) => {
      const travel = Math.fround(index === 3 ? electricalPhase : device?.travel ?? 0)
      const state = device?.status === 'running' ? 1 : device?.status === 'fault' ? 2 : 0
      if (flowTravel.value[index] !== travel || flowState.value[index] !== state) changed = true
      flowTravel.value[index] = travel
      flowState.value[index] = state
    })
    return changed && (visiblyActive || previouslyVisible)
  }

  return {
    root, update,
    diagnostics: {
      source: '演示数据', drawCalls: 5, materials: ownedMaterials.length, textures: 0,
      triangles: ownedGeometry.reduce((sum, g) => sum + g.getAttribute('position').count / 3, 0),
      coalPaths: bindings.conveyors.map(c => ({ id: c.id, from: c.from, to: c.to, arclengthMeters: c.length })),
      powerPaths: '现有变电站三相母线—隔离开关—断路器—变压器套管；仅沿已建模导体',
      electricalSpeed: '示意电流方向；不表示实际电流传播速度',
      facilityHalos: facilities.map(f => ({ id: f.id, deviceIds: f.deviceIds, radius: f.radius, groundY: f.groundY, contourExponent: f.shape })),
    },
    dispose() {
      if (disposed) return
      disposed = true
      root.removeFromParent()
      ownedGeometry.forEach(g => g.dispose())
      ownedMaterials.forEach(m => m.dispose())
      root.clear()
    },
  }
}
