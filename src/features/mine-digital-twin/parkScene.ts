import * as THREE from 'three'
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js'
import type { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { ASSETS, CONVEYORS, GROUNDING_RESERVES, PRODUCTION_DETAILS, ROADS, SITE, ZONES, isBuilding } from './layout'
import type { SiteAsset, Vec3 } from './layout'
import { surfaceTexture, applyGroundUV } from './surfaceMaterials'
import { buildSiteEnvironment } from './siteEnvironment'
import { TRANSPORT_MODELS, TRANSPORT_CONVEYORS } from './transportModels'
import { POWER_MODELS, POWER_ROOM_PARTS, POWER_RESERVES } from './powerModels'
import { createPowerInteraction } from './powerInteraction'
import { createMonitoring } from './monitoringScene'
import { MONITORING_DEVICES } from './monitoringDevices'
import { createProtection } from './protectionScene'
import { PROTECTION_FACILITIES } from './protectionFacilities'
import { placeHeadframe } from './headframeModel'

export interface ParkLabel {
  element: HTMLDivElement
  priority: number
}

export function buildPark(scene: THREE.Scene) {
  const root = new THREE.Group()
  root.name = 'mine-site-layout'
  scene.add(root)
  const power = createPowerInteraction(root)
  const powerReserveLabels: THREE.Object3D[] = []
  const labels: ParkLabel[] = []
  const monitoring = createMonitoring(root, labels)
  const protection = createProtection(root)
  const assetGroups = new Map<string, THREE.Group>()
  const conveyorPlaceholders = new THREE.Group()
  conveyorPlaceholders.name = 'coal-conveyor-placeholders'
  root.add(conveyorPlaceholders)
  const concreteTexture = surfaceTexture('concrete')
  const asphaltTexture = surfaceTexture('asphalt')
  const concrete = new THREE.MeshStandardMaterial({ color: '#b7bcb5', map: concreteTexture,
    bumpMap: concreteTexture, bumpScale: .018, roughness: .94 })
  const materials = {
    ground: concrete,
    road: new THREE.MeshStandardMaterial({ color: '#777e7b', map: asphaltTexture,
      bumpMap: asphaltTexture, bumpScale: .008, roughness: .97 }),
    walkway: new THREE.MeshStandardMaterial({ color: '#a6afa2', map: concreteTexture, roughness: .94 }),
    roof: new THREE.MeshStandardMaterial({ color: '#b9c2bc', roughness: 0.77, metalness: .12 }),
    production: new THREE.MeshStandardMaterial({ color: '#b8c9d0', roughness: 0.8 }),
    transport: new THREE.MeshStandardMaterial({ color: '#829aa9', roughness: 0.8 }),
    power: new THREE.MeshStandardMaterial({ color: '#beb39e', roughness: 0.85 }),
    management: new THREE.MeshStandardMaterial({ color: '#bec9b8', roughness: 0.85 }),
    reserve: new THREE.MeshStandardMaterial({ color: '#4b8c80', roughness: 0.85 }),
    protection: new THREE.MeshStandardMaterial({ color: '#b18c51', roughness: 0.85 }),
    belt: new THREE.MeshStandardMaterial({ color: '#426d87', roughness: 0.65, metalness: 0.2 }),
    support: new THREE.MeshStandardMaterial({ color: '#6f8089', roughness: 0.7, metalness: 0.25 }),
  }

  function block(
    parent: THREE.Object3D,
    name: string,
    dimensions: Vec3,
    position: Vec3,
    material: THREE.Material,
    casts = true,
  ) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...dimensions), material)
    mesh.name = name
    mesh.position.set(...position)
    mesh.castShadow = casts
    mesh.receiveShadow = true
    parent.add(mesh)
    return mesh
  }

  function label(
    name: string,
    position: Vec3,
    kind: 'zone' | 'building' | 'reserve' | 'key',
    priority: number,
  ) {
    const element = document.createElement('div')
    element.className = `mine-label mine-label--${kind}`
    element.textContent = name
    const object = new CSS2DObject(element)
    object.position.set(...position)
    root.add(object)
    labels.push({ element, priority })
  }

  // Source shaft lies below the source foundation datum. Keep the opening in
  // the site slab instead of covering the detailed existing shaft with terrain.
  const groundShape = new THREE.Shape()
  groundShape.moveTo(-SITE.width / 2, -SITE.depth / 2)
  groundShape.lineTo(SITE.width / 2, -SITE.depth / 2)
  groundShape.lineTo(SITE.width / 2, SITE.depth / 2)
  groundShape.lineTo(-SITE.width / 2, SITE.depth / 2)
  groundShape.closePath()
  const frame = ASSETS.find((asset) => asset.type === 'headframe')!
  const opening = frame.groundOpening!
  const [shaftX, shaftZ] = opening.center
  const [halfX, halfZ] = opening.size.map((size) => size / 2) as [number, number]
  const hole = new THREE.Path()
  hole.moveTo(shaftX - halfX, -shaftZ - halfZ)
  hole.lineTo(shaftX - halfX, -shaftZ + halfZ)
  hole.lineTo(shaftX + halfX, -shaftZ + halfZ)
  hole.lineTo(shaftX + halfX, -shaftZ - halfZ)
  hole.closePath()
  groundShape.holes.push(hole)
  const ground = new THREE.Mesh(
    new THREE.ExtrudeGeometry(groundShape, { depth: 0.35, bevelEnabled: false }),
    materials.ground,
  )
  ground.rotation.x = -Math.PI / 2
  ground.name = 'mine-site-ground'
  ground.position.y = -0.35
  ground.receiveShadow = true
  root.add(ground)
  applyGroundUV(ground)

  for (const zone of ZONES) {
    const surface = new THREE.Mesh<THREE.BufferGeometry>(
      new THREE.PlaneGeometry(...zone.size),
      new THREE.MeshStandardMaterial({ color: new THREE.Color(zone.color).lerp(new THREE.Color('#9fa99e'),.48),
        map: concreteTexture, bumpMap: concreteTexture, bumpScale: .018, roughness: .95 }),
    )
    surface.name = zone.id
    surface.rotation.x = -Math.PI / 2
    surface.position.set(zone.center[0], 0.014, zone.center[1])
    surface.receiveShadow = true
    // The production patch also has the shaft cutout.
    if (zone.id === 'production') {
      surface.geometry.dispose()
      const zoneShape = new THREE.Shape()
      const [w, d] = zone.size
      zoneShape.moveTo(-w / 2, -d / 2)
      zoneShape.lineTo(w / 2, -d / 2)
      zoneShape.lineTo(w / 2, d / 2)
      zoneShape.lineTo(-w / 2, d / 2)
      zoneShape.closePath()
      const localHole = new THREE.Path()
      const x = shaftX - zone.center[0]
      const z = -(shaftZ - zone.center[1])
      localHole.moveTo(x - halfX, z - halfZ)
      localHole.lineTo(x - halfX, z + halfZ)
      localHole.lineTo(x + halfX, z + halfZ)
      localHole.lineTo(x + halfX, z - halfZ)
      localHole.closePath()
      zoneShape.holes.push(localHole)
      surface.geometry = new THREE.ShapeGeometry(zoneShape)
    }
    root.add(surface)
    applyGroundUV(surface)
    label(zone.id === 'protection' ? zone.name.replace('预留', '示意') : zone.name, zone.labelPosition, 'zone', 1)
  }

  for (const road of ROADS) {
    const dx = road.to[0] - road.from[0]
    const dz = road.to[1] - road.from[1]
    const length = Math.hypot(dx, dz)
    const mesh = block(
      root,
      road.id,
      [road.width, 0.06, length],
      [(road.from[0] + road.to[0]) / 2, 0.05, (road.from[1] + road.to[1]) / 2],
      road.kind === 'walkway' ? materials.walkway : materials.road,
      false,
    )
    mesh.rotation.y = Math.atan2(dx, dz)
  }
  // Merge road meshes into a union surface, so intersections have no z-fighting.
  // Rectangular axes share the same elevation; stencil-free polygon union is
  // generated as a cell mesh below rather than stacking coplanar rectangles.
  mergeRoadSurfaces(root)
  for (const name of ['connected-road-surface','connected-walkway-surface']) {
    const surface = root.getObjectByName(name) as THREE.Mesh<THREE.BufferGeometry>
    if (surface) applyGroundUV(surface, name.includes('walkway') ? 4 : 2)
  }
  buildSiteEnvironment(root, concrete)

  for (const asset of ASSETS) {
    // The old rooftop SPD massing marker is replaced by a real indoor mounting
    // reserve carrying the same ID. All other reserve assets remain unchanged.
    if (asset.id === 'spd-distribution' || MONITORING_DEVICES.some(device => device.id === asset.id) ||
      PROTECTION_FACILITIES.some(facility => facility.id === asset.id)) continue
    const group = new THREE.Group()
    group.name = asset.id
    group.position.set(...asset.position)
    group.rotation.set(...(asset.rotation.map(THREE.MathUtils.degToRad) as Vec3))
    group.userData.asset = asset
    root.add(group)
    assetGroups.set(asset.id, group)
    const [width, height, depth] = asset.size
    if (isBuilding(asset)) {
      const mat =
        materials[asset.zone as 'production' | 'transport' | 'power' | 'management'] ??
        materials.production
      if (asset.type === 'headframe') {
        // Preserve the current detailed GLB, without a competing giant box.
        label(asset.name, [asset.position[0], 25.2, asset.position[2]], 'key', 0)
      } else if (asset.type === 'coal-silo') {
        const mesh = new THREE.Mesh(
          new THREE.CylinderGeometry(width / 2, width / 2, height, 24),
          mat,
        )
        mesh.position.y = height / 2
        mesh.castShadow = true
        mesh.receiveShadow = true
        group.add(mesh)
      } else {
        block(group, 'placeholder', asset.size, [0, height / 2, 0], mat)
        block(
          group,
          'placeholder-roof',
          [width + 0.25, 0.18, depth + 0.25],
          [0, height + 0.09, 0],
          materials.roof,
        )
      }
      if (asset.type !== 'headframe')
        label(asset.name, [asset.position[0], height + 1.2, asset.position[2]], 'building', 3)
    } else {
      const mat =
        asset.type === 'entrance'
          ? materials.roof
          : asset.type === 'lightning-location-reserve' || asset.type === 'storm-warning-reserve'
            ? materials.reserve
            : materials.protection
      block(group, 'reserved-footprint', asset.size, [0, height / 2, 0], mat, false)
      label(
        asset.type === 'spd-reserve' ? 'SPD 预留' : asset.name,
        [asset.position[0], asset.position[1] + 1.2, asset.position[2]],
        asset.type === 'entrance' ? 'key' : 'reserve',
        asset.type === 'entrance' ? 0 : 4,
      )
    }
  }

  for (const conveyor of CONVEYORS) {
    const a = new THREE.Vector3(...conveyor.from)
    const b = new THREE.Vector3(...conveyor.to)
    const direction = b.clone().sub(a)
    const belt = block(
      conveyorPlaceholders,
      conveyor.id,
      [conveyor.width, 0.65, direction.length()],
      a.clone().add(b).multiplyScalar(0.5).toArray() as Vec3,
      materials.belt,
    )
    belt.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction.normalize())
    for (const t of conveyor.supports) {
      const center = a.clone().lerp(b, t)
      block(
        conveyorPlaceholders,
        `${conveyor.id}-support-${t}`,
        [0.4, center.y - 0.32, 0.4],
        [center.x, (center.y - 0.32) / 2, center.z],
        materials.support,
      )
    }
  }

  for (const corridor of GROUNDING_RESERVES) {
    const points = corridor.points.map(([x, z]) => new THREE.Vector3(x, 0.1, z))
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineDashedMaterial({ color: '#967a50', dashSize: 1.1, gapSize: 0.7 }),
    )
    line.computeLineDistances()
    line.name = corridor.id
    root.add(line)
  }

  return {
    root,
    power,
    monitoring,
    protection,
    setPowerRoofVisible(visible: boolean) {
      power.setRoofVisible(visible)
      protection.setRoofVisible(visible)
      powerReserveLabels.forEach(object => { object.visible = !visible && object.parent !== null })
    },
    labels: labels.sort((a, b) => a.priority - b.priority),
    bounds: new THREE.Box3(new THREE.Vector3(-76, -1, -59), new THREE.Vector3(76, 26, 59)),
    overviewPoints: [
      ...[-76, 76].flatMap((x) => [-59, 59].map((z) => new THREE.Vector3(x, 0, z))),
      ...ASSETS.filter(isBuilding).flatMap((asset) =>
        [-1, 1].flatMap((sx) =>
          [-1, 1].flatMap((sz) =>
            [0, 1].map(
              (sy) =>
                new THREE.Vector3(
                  asset.position[0] + (sx * asset.size[0]) / 2,
                  asset.position[1] + sy * asset.size[1],
                  asset.position[2] + (sz * asset.size[2]) / 2,
                ),
            ),
          ),
        ),
      ),
    ],
    async loadModels(
      loader: GLTFLoader,
      isDisposed: () => boolean,
      disposeObject: (object: THREE.Object3D) => void,
    ) {
      let loaded = 0
      const resourceAssets = ASSETS.map((asset) => ({ ...asset, ...TRANSPORT_MODELS[asset.id], ...POWER_MODELS[asset.id] }))
      for (const asset of resourceAssets.filter((item) => item.modelPath)) {
        const gltf = await loader.loadAsync(`${import.meta.env.BASE_URL}${asset.modelPath}`)
        if (isDisposed()) {
          disposeObject(gltf.scene)
          return loaded
        }
        const bounds = new THREE.Box3().setFromObject(gltf.scene, true)
        if (bounds.isEmpty()) throw new Error(`${asset.name}模型为空`)
        const size = bounds.getSize(new THREE.Vector3())
        const center = bounds.getCenter(new THREE.Vector3())
        const factor =
          asset.modelScale ??
          Math.min(...asset.size.map((length, i) => length / size.getComponent(i)))
        if (asset.type === 'headframe') {
          placeHeadframe(gltf.scene)
        } else {
          gltf.scene.scale.setScalar(factor)
          if (!asset.preserveModelOrigin)
            gltf.scene.position.set(
              -center.x * factor,
              -(asset.modelGroundY ?? bounds.min.y) * factor,
              -center.z * factor,
            )
        }
        gltf.scene.traverse((object) => {
          if (object instanceof THREE.Mesh) {
            object.castShadow = true
            object.receiveShadow = true
          }
        })
        const group = assetGroups.get(asset.id)!
        for (const child of [...group.children]) {
          group.remove(child)
          // Block materials are shared by other placeholders in the park.
          child.traverse((object) => {
            if (object instanceof THREE.Mesh) object.geometry.dispose()
          })
        }
        group.add(gltf.scene)
        if (asset.zone === 'power') power.register(gltf.scene)
        loaded++
        console.info(
          '[mine-digital-twin] model loaded',
          JSON.stringify({
            id: asset.id,
            path: asset.modelPath,
            uniformScale: factor,
            sourceSize: size.toArray(),
          }),
        )
      }
      const detail = await loader.loadAsync(`${import.meta.env.BASE_URL}${PRODUCTION_DETAILS.modelPath}`)
      if (isDisposed()) {
        disposeObject(detail.scene)
        return loaded
      }
      if (new THREE.Box3().setFromObject(detail.scene, true).isEmpty())
        throw new Error('生产区连接模型为空')
      detail.scene.name = PRODUCTION_DETAILS.id
      detail.scene.position.set(...PRODUCTION_DETAILS.position)
      detail.scene.rotation.set(...(PRODUCTION_DETAILS.rotation.map(THREE.MathUtils.degToRad) as Vec3))
      detail.scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.castShadow = true
          object.receiveShadow = true
        }
      })
      root.add(detail.scene)
      console.info('[mine-digital-twin] model loaded', JSON.stringify({
        id: PRODUCTION_DETAILS.id, path: PRODUCTION_DETAILS.modelPath, uniformScale: 1,
        anchor: 'world origin',
      }))
      loaded++
      const transport = await loader.loadAsync(`${import.meta.env.BASE_URL}${TRANSPORT_CONVEYORS.modelPath}`)
      if (isDisposed()) {
        disposeObject(transport.scene)
        return loaded
      }
      if (new THREE.Box3().setFromObject(transport.scene, true).isEmpty())
        throw new Error('煤炭输送模型为空')
      transport.scene.name = TRANSPORT_CONVEYORS.id
      transport.scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.castShadow = true
          object.receiveShadow = true
        }
      })
      root.remove(conveyorPlaceholders)
      // Shared placeholder materials stay alive until the park is disposed.
      conveyorPlaceholders.traverse((object) => {
        if (object instanceof THREE.Mesh) object.geometry.dispose()
      })
      root.add(transport.scene)
      // All transport placeholders have now been replaced; their private
      // materials are no longer reachable by the normal scene disposal pass.
      materials.transport.dispose()
      materials.belt.dispose()
      materials.support.dispose()
      console.info('[mine-digital-twin] model loaded', JSON.stringify({
        id: TRANSPORT_CONVEYORS.id, path: TRANSPORT_CONVEYORS.modelPath,
        uniformScale: 1, anchor: 'world origin', replacedConveyors: CONVEYORS.length,
      }))
      loaded++
      // Separate roof and equipment share the fixed distribution-room anchor.
      const room = assetGroups.get('distribution-01')!
      for (const part of POWER_ROOM_PARTS) {
        const gltf = await loader.loadAsync(`${import.meta.env.BASE_URL}${part.modelPath}`)
        if (isDisposed()) { disposeObject(gltf.scene); return loaded }
        if (new THREE.Box3().setFromObject(gltf.scene, true).isEmpty()) throw new Error(`${part.id} 模型为空`)
        gltf.scene.traverse(object => {
          if (object instanceof THREE.Mesh) { object.castShadow = true; object.receiveShadow = true }
        })
        room.add(gltf.scene)
        power.register(gltf.scene)
        console.info('[mine-digital-twin] model loaded', JSON.stringify({id:part.id,path:part.modelPath,uniformScale:1}))
        loaded++
      }
      for (const reserve of POWER_RESERVES) {
        const element = document.createElement('div')
        element.className = 'mine-label mine-label--reserve'
        element.textContent = reserve.name
        element.dataset.entityId = reserve.id
        const object = new CSS2DObject(element)
        object.name = `${reserve.id}-label`
        object.position.set(reserve.position[0], reserve.position[1] + .35, reserve.position[2])
        room.add(object)
        labels.push({element,priority:4})
        if (reserve.kind === 'spd-reserve') { object.visible = false; powerReserveLabels.push(object) }
      }
      labels.sort((a,b) => a.priority-b.priority)
      materials.power.dispose()
      console.info('[mine-digital-twin] power interaction ready',JSON.stringify({selectableEntities:power.count}))
      loaded += await monitoring.load(loader, isDisposed, disposeObject)
      loaded += await protection.load(loader, isDisposed, disposeObject)
      labels.sort((a,b) => a.priority-b.priority)
      return loaded
    },
  }
}

function mergeRoadSurfaces(root: THREE.Group) {
  // Partition at every road edge; emit each occupied cell once. This creates
  // connected intersections without coplanar overlap or duplicate markings.
  const rectangles = ROADS.map((road) => {
    const horizontal = road.from[1] === road.to[1]
    return {
      id: road.id,
      kind: road.kind,
      xmin: horizontal ? Math.min(road.from[0], road.to[0]) : road.from[0] - road.width / 2,
      xmax: horizontal ? Math.max(road.from[0], road.to[0]) : road.from[0] + road.width / 2,
      zmin: horizontal ? road.from[1] - road.width / 2 : Math.min(road.from[1], road.to[1]),
      zmax: horizontal ? road.from[1] + road.width / 2 : Math.max(road.from[1], road.to[1]),
    }
  })
  const xs = [...new Set(rectangles.flatMap((r) => [r.xmin, r.xmax]))].sort((a, b) => a - b)
  const zs = [...new Set(rectangles.flatMap((r) => [r.zmin, r.zmax]))].sort((a, b) => a - b)
  for (const kind of ['road', 'walkway']) {
    const vertices: number[] = []
    for (let x = 0; x < xs.length - 1; x++)
      for (let z = 0; z < zs.length - 1; z++) {
        const xa = xs[x]!,
          xb = xs[x + 1]!,
          za = zs[z]!,
          zb = zs[z + 1]!
        const mx = (xa + xb) / 2,
          mz = (za + zb) / 2
        const matches = rectangles.filter(
          (r) => mx > r.xmin && mx < r.xmax && mz > r.zmin && mz < r.zmax,
        )
        if (!matches.length) continue
        const cellKind = matches.some((r) => r.kind !== 'walkway') ? 'road' : 'walkway'
        if (cellKind !== kind) continue
        vertices.push(
          xa,
          0.08,
          za,
          xa,
          0.08,
          zb,
          xb,
          0.08,
          zb,
          xa,
          0.08,
          za,
          xb,
          0.08,
          zb,
          xb,
          0.08,
          za,
        )
      }
    const first = root.getObjectByName(
      kind === 'road' ? 'main-spine' : 'monitor-access',
    ) as THREE.Mesh
    if (!first) continue
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
    geometry.computeVertexNormals()
    const mesh = new THREE.Mesh(geometry, first.material)
    mesh.name = `connected-${kind}-surface`
    mesh.receiveShadow = true
    root.add(mesh)
  }
  for (const road of ROADS) {
    const mesh = root.getObjectByName(road.id) as THREE.Mesh
    root.remove(mesh)
    mesh.geometry.dispose()
  }
}
