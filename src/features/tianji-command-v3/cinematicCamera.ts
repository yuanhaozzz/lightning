import * as C from 'cesium'
import { demoPosition } from './commandDemo'
import type { CommandAnalysis } from './commandAnalysis'
import { destination } from './weather'
import type { DemoState, DemoStatus, SafeInsets } from './sceneTypes'

export const MEASURE_SECONDS = 2.8
const rad = C.Math.toRadians
export const measurementFrame = (progress: number) => {
  const ramp = (from: number, to: number) => {
    const t = C.Math.clamp((progress - from) / (to - from), 0, 1)
    return t * t * (3 - 2 * t)
  }
  return {
    marker: ramp(0, 0.16),
    line: ramp(0.14, 0.65),
    number: ramp(0.2, 0.72),
    direction: ramp(0.65, 0.8),
    speed: ramp(0.75, 0.88),
    eta: ramp(0.88, 1),
  }
}

/** Fit the whole cloud footprint and the mine inside the unoccluded UI rectangle.
 * Range is calculated using the actual perspective frustum, not a fixed zoom level.
 * The small ENU aim offset places the subject in the centre of that safe rectangle.
 */
export function composition(
  viewer: C.Viewer,
  analysis: CommandAnalysis,
  minute: number,
  insets: SafeInsets,
  pitch = -45,
  heading = 16,
) {
  const positions: C.Cartesian3[] = []
  if (analysis.mine) {
    const ground = viewer.scene.globe.getHeight(C.Cartographic.fromDegrees(...analysis.mine.center)) ?? 0
    positions.push(C.Cartesian3.fromDegrees(...analysis.mine.center, ground + 150))
  }
  if (analysis.storm) {
    const center = demoPosition(analysis.storm, minute)
    for (let angle = 0; angle < 360; angle += 15) {
      const point = destination(center, angle, analysis.storm.radius)
      positions.push(C.Cartesian3.fromDegrees(...point, 18000))
    }
  }
  if (!positions.length) return null
  const bounds = C.BoundingSphere.fromPoints(positions)
  bounds.radius = Math.max(bounds.radius, 25000)
  const width = Math.max(1, viewer.canvas.clientWidth)
  const height = Math.max(1, viewer.canvas.clientHeight)
  const frustum = viewer.camera.frustum as C.PerspectiveFrustum
  const vfov = frustum.fovy ?? rad(50)
  const tanV = Math.tan(vfov / 2)
  const tanH = (tanV * width) / height
  const safeW = Math.max(width * 0.28, width - insets.left - insets.right)
  const safeH = Math.max(height * 0.25, height - insets.top - insets.bottom)
  const halfAngle = Math.min(Math.atan((tanH * safeW) / width), Math.atan((tanV * safeH) / height))
  const range = Math.max(70000, (bounds.radius / Math.sin(halfAngle)) * 1.14)
  const dx = (insets.left - insets.right) / width
  const dy = (insets.top - insets.bottom) / height
  const h = rad(heading),
    p = rad(pitch)
  const right = new C.Cartesian3(Math.cos(h), -Math.sin(h), 0)
  const up = new C.Cartesian3(-Math.sin(h) * Math.sin(p), -Math.cos(h) * Math.sin(p), Math.cos(p))
  C.Cartesian3.multiplyByScalar(right, -dx * range * tanH, right)
  C.Cartesian3.multiplyByScalar(up, dy * range * tanV, up)
  const offset = C.Cartesian3.add(right, up, new C.Cartesian3())
  const local = C.Transforms.eastNorthUpToFixedFrame(bounds.center)
  const aim = C.Matrix4.multiplyByPoint(local, offset, new C.Cartesian3())
  return {
    sphere: new C.BoundingSphere(aim, bounds.radius),
    range,
    offset: new C.HeadingPitchRange(h, p, range),
  }
}

export function createCameraDirector(
  viewer: C.Viewer,
  options: {
    context(): { analysis: CommandAnalysis; minute: number }
    insets(): SafeInsets
    reduced(): boolean
    onStatus(value: DemoStatus): void
    onMeasure(progress: number): void
    onScope(value: 'national' | 'theater'): void
    onFlightTime(value: number): void
    onError(message: string): void
  },
) {
  let state: DemoState = 'INITIALIZING'
  let epoch = 0,
    age = 0,
    disposed = false,
    flightStarted = 0,
    flightActive = false
  let flat = false
  let ownsComposition = false, reframeAt = 0
  const update = (next: DemoState, title: string, detail: string, step: number) => {
    state = next
    age = 0
    options.onStatus({ state, title, detail, step })
  }
  const cancel = () => {
    epoch++
    reframeAt = 0
    viewer.camera.cancelFlight()
    flightActive = false
  }
  const context = () => options.context()
  const fitted = (pitch = flat ? -88 : -45, heading = 16) => {
    const { analysis, minute } = context()
    return composition(viewer, analysis, minute, options.insets(), pitch, heading)
  }
  const complete = () => {
    options.onMeasure(1)
    const { analysis } = context()
    update(
      'INTERACTIVE',
      analysis.mine ? `${analysis.mine.name} · 自由交互` : '全国态势 · 自由交互',
      options.reduced()
        ? '已按系统「减少动态效果」设置关闭连续动画'
        : analysis.relation
          ? '云团边界到矿区 · 轨迹首次覆盖时间'
          : '当前无有效威胁关系',
      7,
    )
  }
  const measure = () => {
    if (!context().analysis.relation || options.reduced()) {
      complete()
      return
    }
    options.onMeasure(0)
    update('MEASURING', '动态威胁测距', '定位 → 测距 → 方向与速度 → ETA', 6)
  }
  const fail = () => {
    if (disposed) return
    cancel()
    ownsComposition = false
    options.onMeasure(1)
    update('ERROR', '镜头已安全停止', '可自由拖动地图或重播', 7)
    options.onError('镜头飞行未完成，地图已恢复自由交互。')
  }
  const flyStages = () => {
    const fit = fitted()
    if (!fit) {
      complete()
      return
    }
    ownsComposition = true
    options.onScope('theater')
    if (options.reduced()) {
      viewer.camera.viewBoundingSphere(fit.sphere, fit.offset)
      viewer.camera.lookAtTransform(C.Matrix4.IDENTITY)
      complete()
      return
    }
    const run = ++epoch
    flightStarted = performance.now()
    flightActive = true
    const distance = C.Cartesian3.distance(viewer.camera.positionWC, fit.sphere.center)
    const total = C.Math.clamp(3.5 + Math.log2(1 + distance / 300000), 4, 9)
    const initialRange = Math.max(fit.range, distance)
    const stages = [
      {
        title: '远景 · 建立区域关系',
        pitch: -72,
        heading: 2,
        range: Math.max(fit.range * 1.8, initialRange * 0.48),
        weight: 0.42,
      },
      {
        title: '中景 · 降低观察高度',
        pitch: -58,
        heading: 9,
        range: Math.max(fit.range * 1.3, initialRange * 0.18),
        weight: 0.3,
      },
      {
        title: '近景 · 矿区与雷暴同框',
        pitch: flat ? -88 : -45,
        heading: 16,
        range: fit.range,
        weight: 0.28,
      },
    ]
    const step = (index: number) => {
      if (disposed || run !== epoch) return
      const stage = stages[index]
      if (!stage) {
        flightActive = false
        options.onFlightTime(performance.now() - flightStarted)
        measure()
        return
      }
      const latest = fitted(stage.pitch, stage.heading)
      if (!latest) {
        complete()
        return
      }
      update(
        'FLYING',
        stage.title,
        `${context().analysis.mine?.name ?? '雷暴目标'} · 平滑空间飞行`,
        3 + index,
      )
      try {
        viewer.camera.flyToBoundingSphere(latest.sphere, {
          offset: new C.HeadingPitchRange(
            rad(stage.heading),
            rad(stage.pitch),
            Math.max(stage.range, latest.range),
          ),
          duration: total * stage.weight,
          easingFunction: C.EasingFunction.QUADRATIC_IN_OUT,
          complete: () => step(index + 1),
          cancel: () => {
            if (run === epoch && !disposed) interrupt()
          },
        })
      } catch {
        fail()
      }
    }
    step(0)
  }
  const national = (animate = true, done?: () => void) => {
    ownsComposition = false
    const destination = C.Rectangle.fromDegrees(72, 8, 137, 55)
    const orientation = { heading: 0, pitch: -Math.PI / 2, roll: 0 }
    options.onScope('national')
    if (!animate || options.reduced()) {
      viewer.camera.setView({ destination, orientation })
      done?.()
      return
    }
    const run = epoch
    flightActive = true
    flightStarted = performance.now()
    viewer.camera.flyTo({
      destination,
      orientation,
      duration: 1.7,
      easingFunction: C.EasingFunction.QUADRATIC_IN_OUT,
      complete: () => {
        if (run === epoch && !disposed) {
          flightActive = false
          done?.()
        }
      },
      cancel: () => {
        if (run === epoch && !disposed) interrupt()
      },
    })
  }
  const interrupt = () => {
    if (disposed) return
    ownsComposition = false
    const active =
      ['OVERVIEW', 'TARGET_LOCKED', 'FLYING', 'MEASURING'].includes(state) || flightActive
    cancel()
    if (active) {
      options.onMeasure(1)
      update('INTERRUPTED', '演示已中断 · 自由交互', '拖动旋转 · 滚轮缩放 · 可随时重播', 7)
    }
  }
  return {
    get state() {
      return state
    },
    tick(dt: number) {
      if (disposed) return
      age += dt
      if (ownsComposition && reframeAt && performance.now() >= reframeAt && state === 'INTERACTIVE' && !flightActive) {
        reframeAt = 0
        const fit = fitted()
        if (fit) {
          const run = ++epoch
          flightActive = true
          flightStarted = performance.now()
          update('FLYING', '调整同框构图', '适应窗口与面板变化', 5)
          try {
            viewer.camera.flyToBoundingSphere(fit.sphere, {
              offset: fit.offset, duration: options.reduced() ? 0 : .65,
              easingFunction: C.EasingFunction.QUADRATIC_IN_OUT,
              complete: () => { if (!disposed && run === epoch) { flightActive = false; complete() } },
              cancel: () => { if (!disposed && run === epoch) interrupt() },
            })
          } catch { fail() }
        }
      }
      if (flightActive && performance.now() - flightStarted > 20000) {
        fail()
        return
      }
      if (state === 'OVERVIEW' && age >= 0.9) {
        if (!context().analysis.relation) {
          complete()
          return
        }
        update(
          'TARGET_LOCKED',
          '锁定危险矿区',
          `${context().analysis.mine?.name} · 沿用现有演示风险规则`,
          2,
        )
      } else if (state === 'TARGET_LOCKED' && age >= 0.65) flyStages()
      else if (state === 'MEASURING') {
        options.onMeasure(Math.min(1, age / MEASURE_SECONDS))
        if (age >= MEASURE_SECONDS) complete()
      }
    },
    start(autoplay: boolean) {
      cancel()
      national(false)
      if (autoplay && options.reduced()) {
        flyStages()
        return
      }
      if (!autoplay) {
        complete()
        return
      }
      options.onMeasure(0)
      update('OVERVIEW', '全国雷暴态势', '按既有风险等级、首次影响时间识别目标', 1)
    },
    replay() {
      cancel()
      options.onMeasure(0)
      update('FLYING', '返回全国态势', '准备重新演示', 0)
      national(true, () => update('OVERVIEW', '全国雷暴态势', '按既有风险等级识别危险矿区', 1))
    },
    focus() {
      cancel()
      options.onMeasure(0)
      update('TARGET_LOCKED', '重新锁定分析目标', '取消上一次飞行 · 更新空间构图', 2)
      if (options.reduced()) flyStages()
    },
    overview() {
      cancel()
      complete()
      national()
    },
    setFlat(value: boolean) {
      flat = value
      cancel()
      flyStages()
    },
    interrupt,
    reframe() {
      if (ownsComposition && !disposed) reframeAt = performance.now() + 220
    },
    skip() {
      ownsComposition = false
      cancel()
      complete()
    },
    fail,
    dispose() {
      disposed = true
      cancel()
    },
  }
}
