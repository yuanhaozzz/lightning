import * as C from 'cesium'
import { DEMO_EVENTS, DEMO_NOW, DEMO_STORMS, demoPosition } from './commandDemo'
import { destination, MINES } from './weather'
import { stormForecast } from './commandAnalysis'

/** Cloud altitude is a display convention for this explicitly simulated scenario. */
export const DISPLAY_CLOUD_HEIGHT = 18000
const world = (p: [number, number], h: number) => C.Cartesian3.fromDegrees(...p, h)
export function createStormEffects(viewer: C.Viewer, initialLowQuality: boolean) {
  const clouds = viewer.scene.primitives.add(
    new C.CloudCollection({ noiseDetail: 16 }),
  ) as C.CloudCollection
  const particles = viewer.scene.primitives.add(
    new C.PointPrimitiveCollection(),
  ) as C.PointPrimitiveCollection
  const bolts = viewer.scene.primitives.add(new C.PolylineCollection()) as C.PolylineCollection
  // Two reusable outlines. Animate their local transform, never rebuild geometry per frame.
  const pulse = (color: C.Color) => {
    const collection = viewer.scene.primitives.add(new C.PolylineCollection()) as C.PolylineCollection
    const material = C.Material.fromType('Color', { color })
    collection.add({ positions: Array.from({ length: 65 }, (_, i) =>
      new C.Cartesian3(Math.cos(i * Math.PI / 32), Math.sin(i * Math.PI / 32), 0)),
      width: 1, material })
    collection.show = false
    return { collection, material, frame: new C.Matrix4(), scale: new C.Cartesian3(1, 1, 1) }
  }
  const scan = pulse(new C.Color(.9, .71, .42, 0))
  const diffusion = pulse(new C.Color(.48, .8, .88, 0))
  let mineId = '', scanAge = 2, scanning = false, assets = true, currentMinute = DEMO_NOW
  const flashes = Array.from({ length: 3 }, () => ({
    age: 2,
    stormId: '',
    line: bolts.add({
      positions: [],
      width: 1.3,
      show: false,
      material: C.Material.fromType('Color', { color: new C.Color(0.68, 0.85, 1, 0.6) }),
    }),
  }))
  let low = initialLowQuality,
    previousMinute: number | null = null,
    slot = 0
  let selected = '',
    energy = true,
    tracks = true,
    strikes = true,
    reduced = false,
    phase = 0
  const cells = DEMO_STORMS.map((storm, stormIndex) => ({
    storm,
    puffs: Array.from({ length: 12 }, (_, index) => {
      const level = Math.floor(index / 4)
      const angle = index * 137.5 + stormIndex * 37
      const offset = index === 0 ? 0 : (0.2 + (index % 4) * 0.12) * storm.radius
      const scale = storm.radius * (level === 2 ? 0.6 : 0.78) * 1000
      return {
        angle,
        offset,
        level,
        index,
        scale,
        cloud: clouds.add({
          position: world(storm.center, DISPLAY_CLOUD_HEIGHT),
          scale: new C.Cartesian2(scale, 10000 + level * 5000),
          maximumSize: new C.Cartesian3(18 + (index % 3) * 3, 10 + level * 2, 12 + (index % 4)),
          slice: 0.4 + level * 0.06,
          brightness: 0.7,
          color: new C.Color(0.56, 0.7, 0.79, 0.68),
        }),
      }
    }),
    flow: Array.from({ length: 3 }, (_, i) => ({
      point: particles.add({
        show: false,
        pixelSize: i === 0 ? 3 : 2,
        color: new C.Color(0.39, 0.74, 0.85, 0.8),
      }),
      path: [] as C.Cartesian3[],
      offset: i / 3,
    })),
  }))
  function setTime(minute: number) {
    currentMinute = minute
    // Pulse only when the shared timeline actually crosses a simulated event, never invent a strike.
    if (
      previousMinute !== null &&
      minute > previousMinute &&
      minute - previousMinute < 1 &&
      strikes &&
      !reduced
    ) {
      const event = DEMO_EVENTS.find(
        (e) => e.stormId === selected && e.minute > previousMinute! && e.minute <= minute,
      )
      if (event) {
        const flash = flashes[slot++ % flashes.length]!
        flash.age = 0
        flash.stormId = event.stormId
        flash.line.positions = Array.from({ length: 8 }, (_, i) => {
          const p = destination(event.position, i % 2 ? 70 : 250, i === 0 || i === 7 ? 0 : 0.7)
          const ground = viewer.scene.globe.getHeight(C.Cartographic.fromDegrees(...p)) ?? 0
          return world(p, Math.max(ground + 100, DISPLAY_CLOUD_HEIGHT * (1 - i / 7)))
        })
      }
    } else if (
      previousMinute !== null &&
      (minute < previousMinute || minute - previousMinute >= 1)
    ) {
      flashes.forEach((flash) => {
        flash.age = 2
        flash.line.show = false
      })
    }
    previousMinute = minute
    for (const cell of cells) {
      const center = demoPosition(cell.storm, minute)
      for (const puff of cell.puffs) {
        const p = destination(center, puff.angle, puff.offset)
        puff.cloud.position = world(p, DISPLAY_CLOUD_HEIGHT - 4500 + puff.level * 4500)
      }
      const forecast = stormForecast(cell.storm, minute)
      const path = Array.from({ length: 49 }, (_, i) =>
        world(
          i < 12 ? demoPosition(cell.storm, minute - 60 + i * 5) : forecast.position((i - 12) * 5),
          5000,
        ),
      )
      for (const flow of cell.flow) flow.path = path
    }
  }
  return {
    setTime,
    setState(next: {
      selected: string
      energy: boolean
      tracks: boolean
      strikes: boolean
      reduced: boolean
      mine?: string
      assets: boolean
      scanning: boolean
    }) {
      if (next.mine !== mineId) {
        mineId = next.mine ?? ''
        const mine = MINES.find((item) => item.id === mineId)
        if (mine) {
          const ground = viewer.scene.globe.getHeight(C.Cartographic.fromDegrees(...mine.center)) ?? 0
          C.Transforms.eastNorthUpToFixedFrame(world(mine.center, ground + 300), undefined, scan.frame)
        }
        scanAge = 2
      }
      if (next.scanning && !scanning) scanAge = 0
      scanning = next.scanning
      assets = next.assets
      if (next.selected !== selected)
        flashes.forEach((flash) => {
          flash.age = 2
          flash.line.show = false
        })
      selected = next.selected
      energy = next.energy
      tracks = next.tracks
      strikes = next.strikes
      reduced = next.reduced
      clouds.show = energy
      particles.show = tracks && !reduced
      bolts.show = strikes && !reduced
      if (!strikes || reduced)
        flashes.forEach((flash) => {
          flash.age = 2
          flash.line.show = false
        })
    },
    setLowQuality(value: boolean) {
      low = value
    },
    tick(dt: number, height: number) {
      if (!reduced) phase += dt
      const distant = height > 2200000
      let changed = false
      scanAge += dt
      const showScan = assets && !!mineId && !reduced && scanAge < 1.8
      changed ||= scan.collection.show !== showScan
      scan.collection.show = showScan
      if (showScan) {
        const progress = scanAge / 1.8
        scan.scale.x = scan.scale.y = 5000 + progress * 20000
        C.Matrix4.multiplyByScale(scan.frame, scan.scale, scan.collection.modelMatrix)
        scan.material.uniforms.color.alpha = Math.sin(progress * Math.PI) * .35
        changed = true
      }
      const storm = DEMO_STORMS.find((item) => item.id === selected)
      const showDiffusion = energy && !!storm && !reduced && !distant
      changed ||= diffusion.collection.show !== showDiffusion
      diffusion.collection.show = showDiffusion
      if (showDiffusion && storm) {
        const progress = (phase % 9) / 9
        C.Transforms.eastNorthUpToFixedFrame(world(demoPosition(storm, currentMinute), 1400), undefined, diffusion.frame)
        diffusion.scale.x = diffusion.scale.y = storm.radius * 1000 * (.82 + .18 * progress)
        C.Matrix4.multiplyByScale(diffusion.frame, diffusion.scale, diffusion.collection.modelMatrix)
        diffusion.material.uniforms.color.alpha = Math.sin(progress * Math.PI) * .13
        changed = true
      }
      for (const cell of cells) {
        const focused = cell.storm.id === selected
        const flash = flashes.some((item) => item.stormId === cell.storm.id && item.age < 0.6)
        for (const puff of cell.puffs) {
          const visible = energy && puff.index < (distant ? 4 : low ? 6 : 12)
          changed ||= puff.cloud.show !== visible
          puff.cloud.show = visible
          if (!visible) continue
          puff.cloud.slice =
            0.4 + puff.level * 0.06 + (reduced ? 0 : Math.sin(phase * 0.16 + puff.index) * 0.035)
          puff.cloud.brightness =
            (focused ? 0.74 : 0.57) +
            (reduced ? 0 : Math.sin(phase * 0.32 + puff.index) * 0.025) +
            (flash ? 0.12 : 0)
          changed ||= !reduced
        }
        for (const flow of cell.flow) {
          flow.point.show = tracks && !reduced && focused && flow.path.length > 1
          if (!flow.point.show) continue
          const t = ((phase * 0.045 + flow.offset) % 1) * (flow.path.length - 1)
          const i = Math.floor(t)
          flow.point.position = C.Cartesian3.lerp(
            flow.path[i]!,
            flow.path[Math.min(i + 1, flow.path.length - 1)]!,
            t - i,
            new C.Cartesian3(),
          )
          changed = true
        }
      }
      for (const flash of flashes) {
        flash.age += dt
        changed ||= flash.line.show !== (strikes && !reduced && flash.age < 0.8)
        flash.line.show = strikes && !reduced && flash.age < 0.8
        if (flash.line.show) {
          // One smooth pulse, no strobe or repeated high-frequency flash.
          flash.line.material.uniforms.color.alpha = Math.sin((flash.age / 0.8) * Math.PI) * 0.6
          changed = true
        }
      }
      return changed
    },
    get count() {
      return cells.reduce((n, cell) => n + cell.puffs.filter((p) => p.cloud.show).length, 0)
    },
    dispose() {
      if (viewer.isDestroyed()) return
      viewer.scene.primitives.remove(clouds)
      viewer.scene.primitives.remove(particles)
      viewer.scene.primitives.remove(bolts)
      viewer.scene.primitives.remove(scan.collection)
      viewer.scene.primitives.remove(diffusion.collection)
    },
  }
}
