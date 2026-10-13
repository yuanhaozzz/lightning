import * as C from 'cesium'
import 'cesium/Build/Cesium/Widgets/widgets.css'
import { DEMO_EVENTS, DEMO_NOW, DEMO_STORMS, demoPosition, type CommandLayer } from './commandDemo'
import { MINES, destination, type LngLat } from './weather'
import { mineVisible, resolveAnalysis, stormForecast, type MineFilter } from './commandAnalysis'
import { createCameraDirector, measurementFrame } from './cinematicCamera'
import type { CommandScene, SceneOptions, ScreenAnchor, ViewLevel } from './sceneTypes'
import { createStormEffects, DISPLAY_CLOUD_HEIGHT } from './stormEffects'
import { createGeographicResources } from './geographicResources'

// Module lifetime: a route remount does not replay the introduction. Explicit replay always works.
let presented = false
const CLOUD_DISPLAY_HEIGHT = DISPLAY_CLOUD_HEIGHT
const cyan = C.Color.fromCssColorString('#7ccbe0')
const amber = C.Color.fromCssColorString('#e6b56c')
const position = (p: LngLat, height = 1200) => C.Cartesian3.fromDegrees(p[0], p[1], height)
const constant = <T>(value: T) => new C.ConstantProperty(value)
type BoundaryFeature = { geometry: { type: string; coordinates: unknown } }

export async function createCommandScene(
  host: HTMLElement,
  options: SceneOptions,
): Promise<CommandScene> {
  const initAt = performance.now()
  options.signal.throwIfAborted()
  const viewer = new C.Viewer(host, {
    baseLayer: false,
    animation: false,
    timeline: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    baseLayerPicker: false,
    navigationHelpButton: false,
    fullscreenButton: false,
    infoBox: false,
    selectionIndicator: false,
    skyBox: false,
    sceneMode: C.SceneMode.SCENE3D,
    requestRenderMode: true,
    maximumRenderTimeChange: Infinity,
    contextOptions: { webgl: { alpha: false, antialias: true } },
  })
  const deviceMemory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory
  let lowQuality =
    (deviceMemory !== undefined && deviceMemory <= 4) || navigator.hardwareConcurrency <= 4
  viewer.useBrowserRecommendedResolution = false
  viewer.resolutionScale = Math.min(1, (lowQuality ? 1 : 1.5) / (window.devicePixelRatio || 1))
  viewer.scene.backgroundColor = C.Color.fromCssColorString('#050e19')
  viewer.scene.globe.baseColor = C.Color.fromCssColorString('#11293b')
  viewer.scene.globe.enableLighting = false
  viewer.scene.globe.maximumScreenSpaceError = 2.5
  viewer.scene.globe.depthTestAgainstTerrain = true
  viewer.scene.fog.density = 0.0001
  if (viewer.scene.skyAtmosphere) viewer.scene.skyAtmosphere.show = false
  viewer.scene.screenSpaceCameraController.enableCollisionDetection = true
  viewer.scene.screenSpaceCameraController.minimumZoomDistance = 1500
  viewer.scene.screenSpaceCameraController.maximumZoomDistance = 16000000
  viewer.scene.screenSpaceCameraController.enableLook = false
  viewer.cesiumWidget.screenSpaceEventHandler.removeInputAction(
    C.ScreenSpaceEventType.LEFT_DOUBLE_CLICK,
  )
  viewer.canvas.setAttribute(
    'aria-label',
    '三维雷暴态势。左键拖动，滚轮缩放，按住右键或 Ctrl 拖动调整俯角。',
  )
  viewer.canvas.tabIndex = 0
  let disposed = false,
    raf = 0,
    started = false,
    last = 0,
    elapsed = 0,
    lastOverlay = 0
  let minute = DEMO_NOW,
    analysis = resolveAnalysis({ kind: 'overview' }, minute)
  let filter: MineFilter = 'priority',
    mode = 'live',
    measureProgress = 1
  let initMs = 0,
    interactiveMs: number | null = null,
    flightMs: number | null = null
  let rendered = 0,
    telemetryAt = performance.now(),
    pulseAt = 0,
    lastHeading = -999
  let effectAge = 0,
    resourceAt = 0,
    slowWindows = 0
  const initialHeap = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory
    ?.usedJSHeapSize
  const effects = createStormEffects(viewer, lowQuality)
  const geography = createGeographicResources(viewer, (value) => {
    options.onGeography(value)
    if (started && value.terrain === 'ready') updateData()
  })
  const reducedMedia = matchMedia('(prefers-reduced-motion: reduce)')
  const layers: Record<CommandLayer, boolean> = {
    energy: true,
    strikes: true,
    tracks: true,
    corridor: true,
    assets: true,
    rings: true,
  }
  const removers: (() => void)[] = []
  const groups: Record<CommandLayer, C.Entity[]> = {
    energy: [],
    strikes: [],
    tracks: [],
    corridor: [],
    assets: [],
    rings: [],
  }
  const add = (layer: CommandLayer, options: C.Entity.ConstructorOptions) => {
    const entity = viewer.entities.add(options)
    groups[layer].push(entity)
    return entity
  }
  const line = (layer: CommandLayer, id: string, color: C.Color, dashed = false, width = 1.3) =>
    add(layer, {
      id,
      polyline: {
        positions: [],
        width,
        arcType: C.ArcType.GEODESIC,
        material: dashed ? new C.PolylineDashMaterialProperty({ color, dashLength: 16 }) : color,
      },
    })

  const clouds = DEMO_STORMS.map((storm) => {
    const p = demoPosition(storm, minute)
    const footprint = add('energy', {
      id: `storm:${storm.id}`,
      position: position(p),
      ellipse: {
        semiMajorAxis: storm.radius * 1000,
        semiMinorAxis: storm.radius * 1000,
        height: 1000,
        material: cyan.withAlpha(0.13),
        outline: true,
        outlineColor: cyan.withAlpha(0.4),
        granularity: 0.035,
      },
    })
    const history = line('tracks', `history:${storm.id}`, cyan.withAlpha(0.48))
    const forecast = line('tracks', `forecast:${storm.id}`, cyan.withAlpha(0.72), true)
    const vector = line('tracks', `vector:${storm.id}`, cyan, false, 8)
    vector.polyline!.material = new C.PolylineArrowMaterialProperty(cyan.withAlpha(0.85))
    const corridor = add('corridor', {
      id: `corridor:${storm.id}`,
      corridor: {
        positions: [],
        width: storm.radius * 2000,
        height: 800,
        material: cyan.withAlpha(0.045),
        cornerType: C.CornerType.ROUNDED,
      },
    })
    return { storm, footprint, history, forecast, vector, corridor }
  })
  const mines = MINES.map((mine) => ({
    mine,
    marker: add('assets', {
      id: `mine:${mine.id}`,
      position: position(mine.center, 1800),
      point: {
        heightReference: C.HeightReference.CLAMP_TO_GROUND,
        pixelSize: 7,
        color: cyan,
        outlineColor: C.Color.fromCssColorString('#09202c'),
        outlineWidth: 2,
        scaleByDistance: new C.NearFarScalar(10000, 1.25, 8000000, 0.7),
      },
    }),
    halo: add('assets', {
      id: `halo:${mine.id}`,
      position: position(mine.center),
      ellipse: {
        semiMajorAxis: 18000,
        semiMinorAxis: 18000,
        height: 0,
        heightReference: C.HeightReference.CLAMP_TO_GROUND,
        material: cyan.withAlpha(0.06),
        outline: true,
        outlineColor: cyan.withAlpha(0.28),
      },
    }),
  }))
  const rings = [50, 100, 150, 200].map((km) => {
    const entity = line('rings', `ring:${km}`, cyan.withAlpha(0.24))
    entity.polyline!.clampToGround = constant(true)
    return { km, entity }
  })
  const strikePoints = viewer.scene.primitives.add(
    new C.PointPrimitiveCollection(),
  ) as C.PointPrimitiveCollection
  const strikeItems = DEMO_EVENTS.map((event) => ({
    event,
    point: strikePoints.add({
      position: position(event.position, 1800),
      pixelSize: 2.5,
      color: new C.Color(0.88, 0.79, 0.56, 0.75),
      show: false,
    }),
  }))
  const pathLines = viewer.scene.primitives.add(new C.PolylineCollection()) as C.PolylineCollection
  const ruler = pathLines.add({
    positions: [],
    width: 2,
    material: C.Material.fromType('PolylineGlow', {
      color: cyan,
      glowPower: 0.12,
      taperPower: 0.8,
    }),
  })
  const endpoints = viewer.scene.primitives.add(
    new C.PointPrimitiveCollection(),
  ) as C.PointPrimitiveCollection
  const startDot = endpoints.add({ pixelSize: 5, color: cyan, show: false })
  const endDot = endpoints.add({ pixelSize: 5, color: cyan, show: false })
  const flowDot = endpoints.add({ pixelSize: 3, color: C.Color.WHITE.withAlpha(0.75), show: false })
  let measurePath: C.Cartesian3[] = []
  let ringTarget = '',
    ringLevel: number | undefined
  let viewLevel: ViewLevel = 'national'

  const director = createCameraDirector(viewer, {
    context: () => ({ analysis, minute }),
    insets: options.getSafeInsets,
    reduced: () => reducedMedia.matches,
    onStatus(value) {
      options.onStatus(value)
      options.onPhase(value.step)
      updateVisibility()
      viewer.scene.requestRender()
    },
    onMeasure(value) {
      measureProgress = value
      options.onAnalysisProgress(value)
      updateMeasurement()
      updateVisibility()
      viewer.scene.requestRender()
    },
    onScope: options.onScope,
    onFlightTime(value) {
      flightMs = value
    },
    onError: options.onError,
  })

  function updateVisibility() {
    const height = viewer.camera.positionCartographic.height
    const nextLevel: ViewLevel = height > 2000000 ? 'national' : height > 90000 ? 'regional' : 'local'
    if (viewLevel !== nextLevel) { viewLevel = nextLevel; options.onViewLevel(viewLevel) }
    const national = viewLevel === 'national'
    const active = analysis.storm?.id
    const revealed = measurementFrame(measureProgress)
    for (const cloud of clouds) {
      const selected = active === cloud.storm.id
      cloud.footprint.show = layers.energy
      cloud.history.show = layers.tracks && (selected || (viewLevel !== 'local' && (!national || mode === 'track')))
      cloud.forecast.show = layers.tracks && (selected || (viewLevel !== 'local' && mode === 'track'))
      cloud.vector.show = layers.tracks && selected && revealed.direction > 0
      cloud.corridor.show = layers.corridor && selected && (mode === 'track' || mode === 'warning')
    }
    for (const item of mines) {
      item.marker.show = layers.assets && mineVisible(item.mine, filter, analysis.mine?.id) &&
        (viewLevel !== 'local' || item.mine.id === analysis.mine?.id || filter === 'all')
      item.halo.show = item.marker.show && item.mine.id === analysis.mine?.id
    }
    for (const { entity } of rings)
      entity.show =
        layers.rings &&
        layers.assets &&
        !!analysis.mine &&
        !!analysis.relation &&
        (!national || mode === 'warning')
    strikePoints.show = layers.strikes
    pathLines.show = endpoints.show =
      layers.corridor && layers.assets && layers.energy && !!analysis.relation
    effects.setState({
      selected: active ?? '',
      mine: analysis.mine?.id,
      assets: layers.assets,
      scanning: director.state === 'TARGET_LOCKED' || director.state === 'MEASURING',
      energy: layers.energy,
      tracks: layers.tracks,
      strikes: layers.strikes,
      reduced: reducedMedia.matches,
    })
  }
  function updateData() {
    for (const item of clouds) {
      const p = demoPosition(item.storm, minute)
      const forecast = stormForecast(item.storm, minute)
      const selected = item.storm.id === analysis.storm?.id
      const color = selected && analysis.relation?.level.level ? amber : cyan
      item.footprint.position = new C.ConstantPositionProperty(position(p))
      const heatColor = C.Color.lerp(
        cyan,
        amber,
        C.Math.clamp((item.storm.dbz - 40) / 25, 0, 1),
        new C.Color(),
      )
      item.footprint.ellipse!.material = new C.ColorMaterialProperty(
        (mode === 'heat' ? heatColor : cyan).withAlpha(
          mode === 'heat' ? 0.22 : selected ? 0.07 : 0.025,
        ),
      )
      item.footprint.ellipse!.outlineColor = constant(color.withAlpha(selected ? 0.66 : 0.24))
      item.history.polyline!.positions = constant(
        Array.from({ length: 25 }, (_, i) =>
          position(demoPosition(item.storm, minute - 60 + i * 2.5), 2400),
        ),
      )
      item.forecast.polyline!.positions = constant(
        Array.from({ length: 37 }, (_, i) => position(forecast.position(i * 5), 2400)),
      )
      item.vector.polyline!.positions = constant([
        position(p, 4500),
        position(forecast.position(45), 4500),
      ])
      item.corridor.corridor!.positions = constant([position(p), position(forecast.position(180))])
    }
    for (const item of mines) {
      const selected = item.mine.id === analysis.mine?.id
      item.marker.point!.color = constant(selected ? amber : cyan.withAlpha(0.68))
      item.marker.point!.pixelSize = constant(selected ? 10 : 6)
    }
    if (
      analysis.mine &&
      (ringTarget !== analysis.mine.id || ringLevel !== analysis.relation?.level.radius)
    ) {
      ringTarget = analysis.mine.id
      ringLevel = analysis.relation?.level.radius
      for (const { km, entity } of rings) {
        entity.polyline!.positions = constant(
          Array.from({ length: 97 }, (_, i) =>
            position(destination(analysis.mine!.center, (i * 360) / 96, km), 1600),
          ),
        )
        entity.polyline!.material = new C.ColorMaterialProperty(
          km === analysis.relation?.level.radius ? amber.withAlpha(0.6) : cyan.withAlpha(0.2),
        )
      }
    }
    for (const { event, point } of strikeItems)
      point.show = event.minute <= minute && event.minute > minute - 30
    // Draw the existing business distance (current boundary to mine), not the future impact path.
    // EllipsoidGeodesic is only the rendering interpolation; it does not silently change the demo's distance model.
    const relation = analysis.relation
    measurePath = []
    if (relation) {
      const edge = C.Cartographic.fromDegrees(...relation.edge)
      const mine = C.Cartographic.fromDegrees(...relation.mine.center)
      if (relation.distance > 0.001) {
        const geodesic = new C.EllipsoidGeodesic(edge, mine)
        measurePath = Array.from({ length: 65 }, (_, i) => {
          const p = geodesic.interpolateUsingFraction(i / 64)
          return C.Cartesian3.fromRadians(
            p.longitude,
            p.latitude,
            Math.max(2600, (viewer.scene.globe.getHeight(p) ?? 0) + 250),
          )
        })
      } else
        measurePath = [position(relation.mine.center, 2600), position(relation.mine.center, 2600)]
      ruler.material.uniforms.color = relation.level.level ? amber : cyan
      startDot.position = measurePath[0]!
      endDot.position = measurePath[measurePath.length - 1]!
      startDot.color = endDot.color = relation.level.level ? amber : cyan
    }
    updateMeasurement()
    updateVisibility()
    effects.setTime(minute)
    viewer.scene.requestRender()
  }
  function updateMeasurement() {
    const reveal = measurementFrame(measureProgress)
    if (measurePath.length < 2 || reveal.line <= 0) ruler.show = false
    else {
      const end = reveal.line * (measurePath.length - 1)
      const index = Math.floor(end)
      const segment = measurePath.slice(0, index + 1)
      if (index < measurePath.length - 1)
        segment.push(
          C.Cartesian3.lerp(
            measurePath[index]!,
            measurePath[index + 1]!,
            end - index,
            new C.Cartesian3(),
          ),
        )
      ruler.positions = segment
      ruler.show = segment.length > 1 && (analysis.relation?.distance ?? 0) > 0.001
    }
    startDot.show = !!measurePath.length && reveal.marker > 0.2
    endDot.show = !!measurePath.length && reveal.line > 0.98
    flowDot.show = !reducedMedia.matches && measureProgress >= 1 && measurePath.length > 2
  }
  function project(id: string, p: C.Cartesian3, occluder: C.Occluder): ScreenAnchor | null {
    if (!occluder.isPointVisible(p)) return null
    const canvas = C.SceneTransforms.worldToWindowCoordinates(viewer.scene, p)
    if (!canvas) return null
    // Near the ground, hide geographic labels whose anchor is behind loaded terrain.
    // This is deliberately not a claim of building-depth occlusion.
    if (id.startsWith('mine:') && viewLevel === 'local') {
      const ray = viewer.camera.getPickRay(canvas)
      const terrain = ray && viewer.scene.globe.pick(ray, viewer.scene)
      if (terrain && C.Cartesian3.distance(viewer.camera.positionWC, terrain) + 200 < C.Cartesian3.distance(viewer.camera.positionWC, p)) return null
    }
    return {
      id,
      x: canvas.x,
      y: canvas.y,
      visible:
        canvas.x > 0 && canvas.y > 0 && canvas.x < host.clientWidth && canvas.y < host.clientHeight,
    }
  }
  function emitAnchors() {
    const occluder = new C.Occluder(
      new C.BoundingSphere(C.Cartesian3.ZERO, C.Ellipsoid.WGS84.minimumRadius),
      viewer.camera.positionWC,
    )
    const anchors: ScreenAnchor[] = []
    const push = (id: string, p: C.Cartesian3) => {
      const anchor = project(id, p, occluder)
      if (anchor) anchors.push(anchor)
      return anchor
    }
    for (const item of mines)
      if (item.marker.show) {
        const ground =
          viewer.scene.globe.getHeight(C.Cartographic.fromDegrees(...item.mine.center)) ?? 0
        push(`mine:${item.mine.id}`, position(item.mine.center, ground + 150))
      }
    for (const { storm } of clouds) {
      const p = demoPosition(storm, minute)
      const anchor = push(storm.id, position(p, CLOUD_DISPLAY_HEIGHT))
      if (!anchor) continue
      const edges = [0, 90, 180, 270]
        .map((angle) =>
          project(
            '',
            position(destination(p, angle, storm.radius), CLOUD_DISPLAY_HEIGHT),
            occluder,
          ),
        )
        .filter((p) => p?.visible) as ScreenAnchor[]
      if (edges.length >= 2) {
        const xs = edges.map((p) => p.x),
          ys = edges.map((p) => p.y)
        anchor.bounds = {
          x: Math.min(...xs),
          y: Math.min(...ys),
          width: Math.max(...xs) - Math.min(...xs),
          height: Math.max(...ys) - Math.min(...ys),
        }
      }
    }
    if (analysis.storm) {
      const forecast = stormForecast(analysis.storm, minute)
      push('forecast-end', position(forecast.position(180), 2400))
      push('vector', position(forecast.position(35), 4500))
    }
    if (measurePath.length)
      for (const [i, ratio] of [0.3, 0.5, 0.7].entries())
        push(`relationship:${i}`, measurePath[Math.round(ratio * (measurePath.length - 1))]!)
    options.onAnchors(anchors)
    const heading = C.Math.toDegrees(viewer.camera.heading)
    if (Math.abs(heading - lastHeading) > 0.2) {
      lastHeading = heading
      options.onHeading(heading)
    }
  }
  const onPointer = () => director.interrupt()
  // Cancel before Cesium handles the same input; its camera controller remains enabled throughout.
  viewer.canvas.addEventListener('pointerdown', onPointer, { passive: true })
  viewer.canvas.addEventListener('wheel', onPointer, { passive: true })
  const onKey = (event: KeyboardEvent) => {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', '+', '-', 'Escape'].includes(event.key))
      director.interrupt()
  }
  viewer.canvas.addEventListener('keydown', onKey)
  const picker = new C.ScreenSpaceEventHandler(viewer.canvas)
  picker.setInputAction((event: C.ScreenSpaceEventHandler.PositionedEvent) => {
    const picked = viewer.scene.pick(event.position)
    const id: unknown = picked?.id?.id
    if (typeof id !== 'string') return
    const [kind, key] = id.split(':')
    if (!key) return
    if (kind === 'mine' || kind === 'halo') options.onPick('mine', key)
    if (kind === 'storm' || kind === 'cloud' || kind === 'core') options.onPick('storm', key)
  }, C.ScreenSpaceEventType.LEFT_CLICK)
  const observer = new ResizeObserver(() => {
    if (!disposed) {
      viewer.resize()
      director.reframe()
      viewer.scene.requestRender()
    }
  })
  observer.observe(host)
  const onMotionChange = () => {
    if (reducedMedia.matches) director.skip()
    viewer.scene.requestRender()
  }
  reducedMedia.addEventListener('change', onMotionChange)
  const onVisibility = () => {
    if (document.hidden) {
      director.interrupt()
      cancelAnimationFrame(raf)
      last = 0
    } else if (started && !disposed) {
      last = 0
      raf = requestAnimationFrame(tick)
      viewer.scene.requestRender()
    }
  }
  document.addEventListener('visibilitychange', onVisibility)
  removers.push(
    viewer.scene.postRender.addEventListener(() => {
      rendered++
    }),
  )
  removers.push(
    viewer.scene.renderError.addEventListener(() => {
      if (!disposed) director.fail()
    }),
  )
  function tick(now: number) {
    if (disposed || document.hidden) return
    const dt = last ? Math.min(0.06, (now - last) / 1000) : 0
    last = now
    elapsed += dt
    effectAge += dt
    try {
      director.tick(dt)
      const animated =
        !reducedMedia.matches && (layers.assets || layers.energy || layers.tracks || layers.strikes)
      if (now - pulseAt > (lowQuality ? 65 : 16)) {
        pulseAt = now
        let changed = effects.tick(effectAge, viewer.camera.positionCartographic.height)
        effectAge = 0
        const halo = mines.find((item) => item.mine.id === analysis.mine?.id)?.halo
        if (animated && layers.assets && halo?.ellipse) {
          const pulse = 0.12 + Math.sin(elapsed * 1.5) * 0.045
          const material = halo.ellipse.material as C.ColorMaterialProperty
          ;(material.color as C.ConstantProperty).setValue(amber.withAlpha(pulse))
          changed = true
        }
        if (pathLines.show && flowDot.show && measurePath.length > 2) {
          const t = ((elapsed * 0.12) % 1) * (measurePath.length - 1)
          const i = Math.floor(t)
          flowDot.position = C.Cartesian3.lerp(
            measurePath[i]!,
            measurePath[Math.min(i + 1, measurePath.length - 1)]!,
            t - i,
            new C.Cartesian3(),
          )
          changed = true
        }
        if (changed) viewer.scene.requestRender()
      }
      if (now - lastOverlay > 120) {
        lastOverlay = now
        updateVisibility()
        emitAnchors()
      }
      if (now - resourceAt >= 700) {
        resourceAt = now
        geography.update(analysis.mine?.id, layers.assets)
      }
      if (now - telemetryAt >= 1000) {
        const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory
        const fps = Math.round((rendered * 1000) / (now - telemetryAt))
        // Only assess a continuously rendering camera flight, never idle on-demand FPS.
        slowWindows = director.state === 'FLYING' && fps < 24 ? slowWindows + 1 : 0
        if (!lowQuality && slowWindows >= 3) {
          lowQuality = true
          effects.setLowQuality(true)
          viewer.resolutionScale = Math.min(1, 1 / (window.devicePixelRatio || 1))
        }
        if (import.meta.env.DEV)
          options.onTelemetry({
            fps,
            initMs,
            interactiveMs,
            flightMs,
            heapMb: memory ? Math.round(memory.usedJSHeapSize / 1048576) : null,
            primitives: viewer.scene.primitives.length,
            cloudPrimitives: effects.count,
            heapDeltaMb:
              memory && initialHeap !== undefined
                ? Math.round((memory.usedJSHeapSize - initialHeap) / 1048576)
                : null,
            quality: lowQuality ? 'economy' : 'standard',
            geography: geography.snapshot(),
          })
        telemetryAt = now
        rendered = 0
      }
    } catch {
      director.fail()
    }
    raf = requestAnimationFrame(tick)
  }
  function dispose() {
    if (disposed) return
    disposed = true
    cancelAnimationFrame(raf)
    director.dispose()
    geography.dispose()
    effects.dispose()
    observer.disconnect()
    picker.destroy()
    viewer.canvas.removeEventListener('pointerdown', onPointer)
    viewer.canvas.removeEventListener('wheel', onPointer)
    viewer.canvas.removeEventListener('keydown', onKey)
    document.removeEventListener('visibilitychange', onVisibility)
    reducedMedia.removeEventListener('change', onMotionChange)
    options.signal.removeEventListener('abort', dispose)
    removers.forEach((remove) => remove())
    if (!viewer.isDestroyed()) viewer.destroy()
  }
  options.signal.addEventListener('abort', dispose, { once: true })
  // Reuse the project's local Natural Earth fallback and optional, already configured Tianditu imagery.
  // No anonymous Ion assets, fabricated terrain, buildings, or extra network services are introduced.
  try {
    await Promise.allSettled([
      (async () => {
        try {
          const provider = await C.TileMapServiceImageryProvider.fromUrl(
            `${import.meta.env.BASE_URL}cesium/Assets/Textures/NaturalEarthII`,
          )
          if (disposed) return
          const layer = viewer.imageryLayers.addImageryProvider(provider)
          layer.brightness = 0.72
          layer.saturation = 0.4
          layer.contrast = 1.15
        } catch {
          if (!disposed) options.onError('本地影像加载失败，已保留地球与行政边界。')
        }
      })(),
      (async () => {
        const response = await fetch(`${import.meta.env.BASE_URL}china.geojson`, {
          signal: options.signal,
        })
        if (!response.ok) throw new Error('行政边界加载失败')
        const data = (await response.json()) as { features: BoundaryFeature[] }
        if (disposed) return
        for (const feature of data.features) {
          const { type, coordinates } = feature.geometry
          const rings: LngLat[][] =
            type === 'MultiPolygon'
              ? (coordinates as LngLat[][][]).map((polygon) => polygon[0]!)
              : type === 'Polygon'
                ? [(coordinates as LngLat[][])[0]!]
                : type === 'MultiLineString'
                  ? (coordinates as LngLat[][])
                  : []
          for (const ring of rings)
            if (ring?.length > 1)
              viewer.entities.add({
                polyline: {
                  positions: ring.map((p) => position(p, 500)),
                  width: 0.8,
                  material: cyan.withAlpha(0.22),
                },
              })
        }
      })().catch(() => {
        if (!disposed) options.onError('行政边界暂不可用，其余场景仍可操作。')
      }),
    ])
    options.signal.throwIfAborted()
    const key = import.meta.env.VITE_TDT_KEY?.trim()
    if (key) {
      const provider = new C.WebMapTileServiceImageryProvider({
        url: `https://t0.tianditu.gov.cn/img_w/wmts?tk=${key}`,
        layer: 'img',
        style: 'default',
        format: 'tiles',
        tileMatrixSetID: 'w',
        tilingScheme: new C.WebMercatorTilingScheme(),
        maximumLevel: 18,
      })
      const layer = viewer.imageryLayers.addImageryProvider(provider)
      layer.brightness = 0.75
      layer.saturation = 0.35
      let reported = false
      removers.push(
        provider.errorEvent.addEventListener(() => {
          if (!disposed && !reported) {
            reported = true
            layer.show = false
            options.onSource('本地影像降级')
            options.onError('天地图影像暂不可用，已回退本地底图。')
            viewer.scene.requestRender()
          }
        }),
      )
    }
    options.onSource(key ? '天地图影像' : '本地低分辨率影像')
    updateData()
    initMs = performance.now() - initAt
  } catch (cause) {
    dispose()
    throw cause
  }

  return {
    start() {
      if (started || disposed) return
      started = true
      // Input handlers are already installed; the introduction can be interrupted immediately.
      interactiveMs = performance.now() - initAt
      director.start(!presented)
      presented = true
      raf = requestAnimationFrame(tick)
    },
    interrupt: director.interrupt,
    skip: director.skip,
    setMode(value) {
      mode = value
      updateData()
    },
    setLayer(layer, visible) {
      layers[layer] = visible
      if (!visible && ['energy', 'assets', 'corridor'].includes(layer)) director.interrupt()
      updateVisibility()
      viewer.scene.requestRender()
    },
    // Vue publishes the matching analysis in the same microtask; rebuild once with that snapshot.
    setTime(value) {
      minute = value
    },
    setAnalysis(value, focus = false, restart = false) {
      analysis = value
      updateData()
      if (started && (focus || restart)) director.focus()
    },
    setScope(value) {
      if (!started) return
      if (value === 'national') director.overview()
      else director.focus()
    },
    setMineFilter(value) {
      filter = value
      updateVisibility()
      viewer.scene.requestRender()
    },
    setView(flat) {
      if (started) director.setFlat(flat)
    },
    zoom(direction) {
      director.interrupt()
      const amount = viewer.camera.positionCartographic.height * 0.22
      if (direction > 0) viewer.camera.zoomIn(amount)
      else viewer.camera.zoomOut(amount)
      viewer.scene.requestRender()
    },
    reset() {
      director.overview()
    },
    replay() {
      director.replay()
    },
    reframe: director.reframe,
    dispose,
  }
}
