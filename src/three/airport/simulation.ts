import {
  airportTaskConfig,
  type AirportTaskConfig,
  type Point2,
  type Pose2,
  type RouteSegment,
} from '../../config/airportTask'

export type TaskPhase = 'idle' | 'to_service' | 'servicing' | 'returning' | 'completed'
export type TaskRunState = 'stopped' | 'running' | 'paused' | 'error'
export interface TaskSnapshot {
  taskId: string
  vehicleId: string
  phase: TaskPhase
  runState: TaskRunState
  elapsed: number
  phaseElapsed: number
  distance: number
  progress: number | null
  tractor: Pose2
  trailer: Pose2 & { bogieHeading: number }
  speed: number
  steering: number
  wheelDistances: {
    tractorRear: number
    tractorFront: number
    trailerRear: number
    trailerFront: number
  }
  events: { time: number; message: string }[]
  error: string | null
}
export interface RoutePose extends Pose2 {
  curvature: number
}
export interface Footprint {
  part: string
  polygon: Point2[]
}
export interface ValidationReport {
  ok: boolean
  errors: string[]
  steps: number
  duration: number
  routeDistance: number
  minClearance: number
  minObstacleClearance: number
  minTrainClearance: number
  clearanceMargin: number
  minimumTurnRadius: number
  maxArticulation: number
  maxArticulationDegrees: number
  maxTractorTrailerAngle: number
  hitchErrors: { drawbarMax: number; wheelbaseMax: number; max: number }
  maxSpeed: number
  maxLateralAcceleration: number
  collisions: {
    elapsed: number
    phase: TaskPhase
    part: string
    obstacle: string
    clearance: number
  }[]
}
export interface ActionResult {
  ok: boolean
  error?: string
}
export const SIMULATION_STEP = 1 / 120
const EPS = 1e-9
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
export const angleDifference = (a: number, b: number) =>
  Math.atan2(Math.sin(a - b), Math.cos(a - b))
const length = (a: Point2, b: Point2) => Math.hypot(a.x - b.x, a.z - b.z)
const forward = (heading: number): Point2 => ({ x: Math.sin(heading), z: Math.cos(heading) })
const offset = (p: Point2, heading: number, distance: number): Point2 => ({
  x: p.x + Math.sin(heading) * distance,
  z: p.z + Math.cos(heading) * distance,
})
const segmentLength = (s: RouteSegment) =>
  s.type === 'line' ? length(s.from, s.to) : Math.abs(s.sweep) * s.radius
export const routeLength = (route: RouteSegment[]): number =>
  route.reduce((sum, s) => sum + segmentLength(s), 0)

function segmentPose(segment: RouteSegment, distance: number): RoutePose {
  const size = segmentLength(segment)
  const t = size > 0 ? clamp(distance / size, 0, 1) : 0
  if (segment.type === 'line') {
    return {
      x: segment.from.x + (segment.to.x - segment.from.x) * t,
      z: segment.from.z + (segment.to.z - segment.from.z) * t,
      heading: Math.atan2(segment.to.x - segment.from.x, segment.to.z - segment.from.z),
      curvature: 0,
    }
  }
  const angle = segment.startAngle + segment.sweep * t
  const direction = Math.sign(segment.sweep)
  return {
    x: segment.center.x + segment.radius * Math.sin(angle),
    z: segment.center.z + segment.radius * Math.cos(angle),
    heading: angle + (direction * Math.PI) / 2,
    curvature: direction / segment.radius,
  }
}

/** Exact line/circular-arc parameterisation; no spline overshoot. */
export function sampleRoute(route: RouteSegment[], distance: number): RoutePose {
  if (!route.length) return { x: 0, z: 0, heading: 0, curvature: 0 }
  let left = Math.max(0, distance)
  for (let i = 0; i < route.length; i++) {
    const segment = route[i]!
    const size = segmentLength(segment)
    if (left < size - EPS || i === route.length - 1) return segmentPose(segment, left)
    left -= size
  }
  return segmentPose(route[route.length - 1]!, segmentLength(route[route.length - 1]!))
}

/** Geometry is rebuilt from the hitch and two yaw states, preserving both rods
 * exactly. Trailer yaw is integrated from no-side-slip axle velocities by RK4.
 * The tractor follows the prescribed C1 path; steering is rate-limited display
 * kinematics at curvature discontinuities, not a tyre-force dynamics model. */
class TaskEngine {
  state: TaskSnapshot
  legDistance = 0
  accumulator = 0
  constructor(readonly config: AirportTaskConfig) {
    this.state = this.initialState()
  }
  private initialState(): TaskSnapshot {
    const { parking, geometry } = this.config
    const hitch = offset(parking, parking.heading, geometry.tractor.rearHitchZ)
    const bogie = offset(hitch, parking.heading, -geometry.trailer.drawbarLength)
    const rear = offset(bogie, parking.heading, -geometry.trailer.wheelbase)
    return {
      taskId: this.config.taskId,
      vehicleId: this.config.vehicleId,
      phase: 'idle',
      runState: 'stopped',
      elapsed: 0,
      phaseElapsed: 0,
      distance: 0,
      progress: null,
      tractor: { ...parking },
      trailer: { ...rear, heading: parking.heading, bogieHeading: parking.heading },
      speed: 0,
      steering: 0,
      wheelDistances: { tractorRear: 0, tractorFront: 0, trailerRear: 0, trailerFront: 0 },
      events: [],
      error: null,
    }
  }
  event(message: string) {
    this.state.events.push({ time: this.state.elapsed, message })
  }
  fail(error: string): ActionResult {
    if (this.state.runState !== 'error') this.event(`任务停止：${error}`)
    this.state.runState = 'error'
    this.state.error = error
    this.state.speed = 0
    return { ok: false, error }
  }
  startUnchecked(): ActionResult {
    if (this.state.phase !== 'idle') return { ok: false, error: '请先复位任务后再开始' }
    this.state.runState = 'running'
    this.state.phase = 'to_service'
    this.state.progress = 0
    this.state.error = null
    this.event(`${this.config.taskId} 开始，前往服务区`)
    return { ok: true }
  }
  pause(reason = '用户暂停'): ActionResult {
    if (this.state.runState !== 'running') return { ok: false, error: '当前任务未运行' }
    this.state.runState = 'paused'
    this.event(reason)
    return { ok: true }
  }
  resume(): ActionResult {
    if (this.state.runState !== 'paused') return { ok: false, error: '当前任务未暂停' }
    this.state.runState = 'running'
    this.event('任务继续')
    return { ok: true }
  }
  reset(): ActionResult {
    this.state = this.initialState()
    this.legDistance = 0
    this.accumulator = 0
    return { ok: true }
  }
  snapshot(): TaskSnapshot {
    return {
      ...this.state,
      tractor: { ...this.state.tractor },
      trailer: { ...this.state.trailer },
      wheelDistances: { ...this.state.wheelDistances },
      events: this.state.events.map((event) => ({ ...event })),
    }
  }
  update(dt: number) {
    if (this.state.runState !== 'running') return
    if (!Number.isFinite(dt) || dt < 0) {
      this.fail('仿真时间步无效')
      return
    }
    // No frame-time clipping: every supplied second is accounted for. The app
    // owns visibility/pause policy and supplies simulation time explicitly.
    this.accumulator += dt
    while (this.accumulator + EPS >= SIMULATION_STEP && this.state.runState === 'running') {
      this.tick(SIMULATION_STEP)
      this.accumulator = Math.max(0, this.accumulator - SIMULATION_STEP)
    }
  }
  private speedLimit(route: RouteSegment[], distance: number): number {
    const m = this.config.motion
    let limit = Math.min(
      m.maxSpeed,
      Math.sqrt(Math.max(0, 2 * m.deceleration * (routeLength(route) - distance))),
    )
    let start = 0
    for (const segment of route) {
      const end = start + segmentLength(segment)
      if (end >= distance - EPS && segment.type === 'arc') {
        const turnSpeed = Math.sqrt(m.lateralAcceleration * segment.radius)
        // Reserve one complete fastest substep so the speed is already within
        // the lateral limit when a line/arc boundary is crossed mid-step.
        const approach = Math.max(0, start - distance - m.maxSpeed * SIMULATION_STEP)
        limit = Math.min(limit, Math.sqrt(turnSpeed * turnSpeed + 2 * m.deceleration * approach))
      }
      start = end
    }
    return limit
  }
  private moveTrailer(oldTractor: Pose2, newTractor: Pose2, dt: number) {
    const g = this.config.geometry
    const oldHitch = offset(oldTractor, oldTractor.heading, g.tractor.rearHitchZ)
    const hitch = offset(newTractor, newTractor.heading, g.tractor.rearHitchZ)
    const velocity = { x: (hitch.x - oldHitch.x) / dt, z: (hitch.z - oldHitch.z) / dt }
    const trailer = this.state.trailer
    const oldRear = { x: trailer.x, z: trailer.z }
    const oldFront = offset(oldRear, trailer.heading, g.trailer.wheelbase)
    const rates = (bogieYaw: number, bodyYaw: number) => {
      const longitudinal = velocity.x * Math.sin(bogieYaw) + velocity.z * Math.cos(bogieYaw)
      return [
        (velocity.x * Math.cos(bogieYaw) - velocity.z * Math.sin(bogieYaw)) /
          g.trailer.drawbarLength,
        (longitudinal * Math.sin(bogieYaw - bodyYaw)) / g.trailer.wheelbase,
      ] as const
    }
    const phi = trailer.bogieHeading,
      psi = trailer.heading
    const a = rates(phi, psi)
    const b = rates(phi + (a[0] * dt) / 2, psi + (a[1] * dt) / 2)
    const c = rates(phi + (b[0] * dt) / 2, psi + (b[1] * dt) / 2)
    const d = rates(phi + c[0] * dt, psi + c[1] * dt)
    trailer.bogieHeading += (dt * (a[0] + 2 * b[0] + 2 * c[0] + d[0])) / 6
    trailer.heading += (dt * (a[1] + 2 * b[1] + 2 * c[1] + d[1])) / 6
    const front = offset(hitch, trailer.bogieHeading, -g.trailer.drawbarLength)
    const rear = offset(front, trailer.heading, -g.trailer.wheelbase)
    trailer.x = rear.x
    trailer.z = rear.z
    this.state.wheelDistances.trailerRear += length(oldRear, rear)
    this.state.wheelDistances.trailerFront += length(oldFront, front)
  }
  private arrived(target: Pose2): boolean {
    const m = this.config.motion,
      s = this.state
    return (
      length(s.tractor, target) <= m.positionTolerance &&
      Math.abs(angleDifference(s.tractor.heading, target.heading)) <= m.angleTolerance &&
      s.speed <= m.speedTolerance
    )
  }
  tick(dt: number) {
    const s = this.state,
      m = this.config.motion
    s.elapsed += dt
    s.phaseElapsed += dt
    if (s.phase === 'servicing') {
      s.progress = clamp(s.phaseElapsed / m.serviceSeconds, 0, 1)
      if (s.phaseElapsed + EPS >= m.serviceSeconds) {
        s.phase = 'returning'
        s.phaseElapsed = 0
        s.progress = 0
        this.legDistance = 0
        this.event('模拟交接计时完成，开始返回')
      }
      return
    }
    if (s.phase !== 'to_service' && s.phase !== 'returning') return
    const route = s.phase === 'to_service' ? this.config.route.outbound : this.config.route.inbound
    const remaining = Math.max(0, routeLength(route) - this.legDistance)
    const oldSpeed = s.speed
    const allowed = this.speedLimit(route, this.legDistance)
    let nextSpeed = clamp(
      allowed,
      Math.max(0, oldSpeed - m.deceleration * dt),
      oldSpeed + m.acceleration * dt,
    )
    let travel = ((oldSpeed + nextSpeed) * dt) / 2
    // In the final braking interval integrate a finite stop. This avoids the
    // sqrt(distance) controller converging forever or forcing a heading snap.
    if (oldSpeed > 0 && remaining <= (oldSpeed * oldSpeed) / (2 * m.deceleration) + oldSpeed * dt) {
      const stopTime = (2 * remaining) / oldSpeed
      if (stopTime <= dt + EPS) {
        travel = remaining
        nextSpeed = 0
      } else {
        const braking = (oldSpeed * oldSpeed) / (2 * remaining)
        nextSpeed = Math.max(0, oldSpeed - braking * dt)
        travel = ((oldSpeed + nextSpeed) * dt) / 2
      }
    }
    if (travel >= remaining) {
      travel = remaining
      nextSpeed = 0
    }
    const previous = { ...s.tractor }
    const previousFront = offset(previous, previous.heading, this.config.geometry.tractor.wheelbase)
    this.legDistance += travel
    s.distance += travel
    s.speed = nextSpeed
    const pose = sampleRoute(route, this.legDistance)
    // Preserve an unwrapped heading so crossings at +/-PI remain continuous.
    s.tractor = {
      x: pose.x,
      z: pose.z,
      heading: previous.heading + angleDifference(pose.heading, previous.heading),
    }
    this.moveTrailer(previous, s.tractor, dt)
    const targetSteering = Math.atan(this.config.geometry.tractor.wheelbase * pose.curvature)
    s.steering += clamp(
      targetSteering - s.steering,
      -m.maxSteeringRate * dt,
      m.maxSteeringRate * dt,
    )
    s.wheelDistances.tractorRear += travel
    s.wheelDistances.tractorFront += length(
      previousFront,
      offset(s.tractor, s.tractor.heading, this.config.geometry.tractor.wheelbase),
    )
    s.progress = clamp(this.legDistance / routeLength(route), 0, 1)
    const target = s.phase === 'to_service' ? this.config.service : this.config.parking
    if (remaining - travel <= m.positionTolerance && this.arrived(target)) {
      s.speed = 0
      s.phaseElapsed = 0
      if (s.phase === 'to_service') {
        s.phase = 'servicing'
        s.progress = 0
        this.event('抵达交接点并停稳，开始模拟交接')
      } else {
        s.phase = 'completed'
        s.runState = 'stopped'
        s.progress = null
        this.event('已返回待命点并停稳，任务完成')
      }
    }
  }
}

function rectangle(pose: Pose2, x0: number, x1: number, z0: number, z1: number): Point2[] {
  const sin = Math.sin(pose.heading),
    cos = Math.cos(pose.heading)
  return [
    [x0, z0],
    [x1, z0],
    [x1, z1],
    [x0, z1],
  ].map(([x, z]) => ({ x: pose.x + x! * cos + z! * sin, z: pose.z - x! * sin + z! * cos }))
}

export function vehicleFootprints(snapshot: TaskSnapshot, config = airportTaskConfig): Footprint[] {
  const g = config.geometry,
    body = snapshot.trailer
  const front = offset(body, body.heading, g.trailer.wheelbase)
  const bogie: Pose2 = { ...front, heading: body.bogieHeading }
  const wheelHalf = g.trailer.wheelWidth / 2,
    track = g.trailer.track / 2
  return [
    {
      part: 'tractor-body',
      polygon: rectangle(
        snapshot.tractor,
        -g.tractor.width / 2,
        g.tractor.width / 2,
        g.tractor.bodyRearZ,
        g.tractor.bodyFrontZ,
      ),
    },
    {
      part: 'trailer-body',
      polygon: rectangle(
        body,
        -g.trailer.width / 2,
        g.trailer.width / 2,
        g.trailer.bodyRearZ,
        g.trailer.bodyFrontZ,
      ),
    },
    {
      part: 'drawbar',
      polygon: rectangle(
        bogie,
        -g.trailer.drawbarWidth / 2,
        g.trailer.drawbarWidth / 2,
        0,
        g.trailer.drawbarLength,
      ),
    },
    {
      part: 'front-bogie-left-wheel',
      polygon: rectangle(
        bogie,
        -track - wheelHalf,
        -track + wheelHalf,
        -g.trailer.wheelRadius,
        g.trailer.wheelRadius,
      ),
    },
    {
      part: 'front-bogie-right-wheel',
      polygon: rectangle(
        bogie,
        track - wheelHalf,
        track + wheelHalf,
        -g.trailer.wheelRadius,
        g.trailer.wheelRadius,
      ),
    },
  ]
}

export function hitchConstraintErrors(snapshot: TaskSnapshot, config = airportTaskConfig) {
  const g = config.geometry
  const hitch = offset(snapshot.tractor, snapshot.tractor.heading, g.tractor.rearHitchZ)
  const front = offset(snapshot.trailer, snapshot.trailer.heading, g.trailer.wheelbase)
  const drawbarEnd = offset(front, snapshot.trailer.bogieHeading, g.trailer.drawbarLength)
  return {
    drawbar: length(hitch, drawbarEnd),
    wheelbase: Math.abs(length(front, snapshot.trailer) - g.trailer.wheelbase),
  }
}

function cross(a: Point2, b: Point2, c: Point2) {
  return (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x)
}
export function convexHull(points: Point2[]): Point2[] {
  const sorted = points
    .map((p) => ({ ...p }))
    .sort((a, b) => a.x - b.x || a.z - b.z)
    .filter((p, i, a) => !i || length(p, a[i - 1]!) > 1e-10)
  if (sorted.length < 3) return sorted
  const lower: Point2[] = [],
    upper: Point2[] = []
  for (const point of sorted) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2]!, lower[lower.length - 1]!, point) <= 0
    )
      lower.pop()
    lower.push(point)
  }
  for (const point of [...sorted].reverse()) {
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2]!, upper[upper.length - 1]!, point) <= 0
    )
      upper.pop()
    upper.push(point)
  }
  lower.pop()
  upper.pop()
  return [...lower, ...upper]
}

/** SAT separates convex footprints; a negative result is penetration depth. */
function penetration(a: Point2[], b: Point2[]): number | null {
  let depth = Infinity
  for (const polygon of [a, b])
    for (let i = 0; i < polygon.length; i++) {
      const p = polygon[i]!,
        q = polygon[(i + 1) % polygon.length]!
      const axis = { x: q.z - p.z, z: p.x - q.x },
        norm = Math.hypot(axis.x, axis.z)
      if (norm < EPS) continue
      axis.x /= norm
      axis.z /= norm
      let amin = Infinity,
        amax = -Infinity,
        bmin = Infinity,
        bmax = -Infinity
      for (const v of a) {
        const d = v.x * axis.x + v.z * axis.z
        amin = Math.min(amin, d)
        amax = Math.max(amax, d)
      }
      for (const v of b) {
        const d = v.x * axis.x + v.z * axis.z
        bmin = Math.min(bmin, d)
        bmax = Math.max(bmax, d)
      }
      const overlap = Math.min(amax, bmax) - Math.max(amin, bmin)
      if (overlap < 0) return null
      depth = Math.min(depth, overlap)
    }
  return -depth
}
function pointSegmentDistance(p: Point2, a: Point2, b: Point2) {
  const dx = b.x - a.x,
    dz = b.z - a.z,
    l2 = dx * dx + dz * dz
  const t = l2 ? clamp(((p.x - a.x) * dx + (p.z - a.z) * dz) / l2, 0, 1) : 0
  return Math.hypot(p.x - a.x - t * dx, p.z - a.z - t * dz)
}
export function polygonClearance(a: Point2[], b: Point2[]): number {
  const overlap = penetration(a, b)
  if (overlap !== null) return overlap
  let result = Infinity
  for (let i = 0; i < a.length; i++)
    for (let j = 0; j < b.length; j++) {
      const p = a[i]!,
        q = a[(i + 1) % a.length]!,
        r = b[j]!,
        s = b[(j + 1) % b.length]!
      result = Math.min(
        result,
        pointSegmentDistance(p, r, s),
        pointSegmentDistance(q, r, s),
        pointSegmentDistance(r, p, q),
        pointSegmentDistance(s, p, q),
      )
    }
  return result
}

function configurationErrors(config: AirportTaskConfig): string[] {
  const errors: string[] = []
  const finitePoint = (p: Point2) => Number.isFinite(p.x) && Number.isFinite(p.z)
  for (const [name, vehicle] of Object.entries(config.geometry)) {
    for (const field of ['width', 'wheelbase', 'wheelRadius', 'track'] as const)
      if (!Number.isFinite(vehicle[field]) || vehicle[field] <= 0)
        errors.push(`${name}.${field} 必须为正数`)
    if (
      !Number.isFinite(vehicle.bodyRearZ) ||
      !Number.isFinite(vehicle.bodyFrontZ) ||
      vehicle.bodyRearZ >= vehicle.bodyFrontZ
    )
      errors.push(`${name} 车身包围尺寸无效`)
  }
  if (
    !(config.geometry.trailer.drawbarLength > 0) ||
    !Number.isFinite(config.geometry.trailer.drawbarLength)
  )
    errors.push('拖杆长度无效')
  for (const field of ['drawbarWidth', 'wheelWidth'] as const)
    if (!(config.geometry.trailer[field] > 0) || !Number.isFinite(config.geometry.trailer[field]))
      errors.push(`拖车 ${field} 无效`)
  if (
    !Number.isFinite(config.geometry.tractor.rearHitchZ) ||
    config.geometry.tractor.rearHitchZ > 0
  )
    errors.push('牵引销必须位于牵引车后轴之后')
  for (const [name, value] of Object.entries(config.motion))
    if (!Number.isFinite(value) || value <= 0) errors.push(`motion.${name} 必须为有限正数`)
  if (!(config.validation.clearanceMargin >= 0) || !(config.validation.sweepPadding >= 0))
    errors.push('校验安全余量无效')
  for (const [name, anchor] of [
    ['parking', config.parking],
    ['service', config.service],
  ] as const)
    if (!finitePoint(anchor) || !Number.isFinite(anchor.heading)) errors.push(`${name} 锚点无效`)
  for (const [name, route] of Object.entries(config.route)) {
    if (!route.length) {
      errors.push(`${name} 路线为空`)
      continue
    }
    for (let i = 0; i < route.length; i++) {
      const segment = route[i]!
      if (segment.type === 'line') {
        if (
          !finitePoint(segment.from) ||
          !finitePoint(segment.to) ||
          !(segmentLength(segment) > EPS)
        )
          errors.push(`${name} 第${i + 1}段直线无效`)
      } else if (
        !finitePoint(segment.center) ||
        !Number.isFinite(segment.radius) ||
        !Number.isFinite(segment.startAngle) ||
        !Number.isFinite(segment.sweep) ||
        Math.abs(segment.sweep) < EPS ||
        segment.radius < config.motion.minTurnRadius
      )
        errors.push(`${name} 第${i + 1}段圆弧无效或半径不足`)
      if (i > 0) {
        const previous = route[i - 1]!,
          a = segmentPose(previous, segmentLength(previous)),
          b = segmentPose(segment, 0)
        if (length(a, b) > 0.0001 || Math.abs(angleDifference(a.heading, b.heading)) > 0.0001)
          errors.push(`${name} 第${i + 1}段位置或切线不连续`)
      }
    }
  }
  if (!errors.length) {
    for (const [route, start, end] of [
      [config.route.outbound, config.parking, config.service],
      [config.route.inbound, config.service, config.parking],
    ] as const) {
      const first = sampleRoute(route, 0),
        last = sampleRoute(route, routeLength(route))
      if (
        length(first, start) > config.motion.positionTolerance ||
        length(last, end) > config.motion.positionTolerance ||
        Math.abs(angleDifference(first.heading, start.heading)) > config.motion.angleTolerance ||
        Math.abs(angleDifference(last.heading, end.heading)) > config.motion.angleTolerance
      )
        errors.push('路线端点与待命点/服务点的坐标或朝向不匹配')
    }
  }
  if (!config.obstacles.length) errors.push('缺少场景障碍包围数据')
  for (const obstacle of config.obstacles)
    if (obstacle.polygon.some((p) => !finitePoint(p)) || convexHull(obstacle.polygon).length < 3)
      errors.push(`${obstacle.id} 障碍轮廓无效`)
  return [...new Set(errors)]
}

const validationCache = new Map<string, ValidationReport>()
const cloneReport = (report: ValidationReport): ValidationReport => ({
  ...report,
  errors: [...report.errors],
  hitchErrors: { ...report.hitchErrors },
  collisions: report.collisions.map((c) => ({ ...c })),
})

/** Simulate the entire articulated train over both legs and the dwell, at
 * 120 Hz. For every interval, SAT checks the convex hull of consecutive body,
 * drawbar and steering-wheel footprints. A 1 mm padding covers the substep
 * rotational sagitta; the separate configured clearance margin is enforced.
 * Reports never infer safety from route/control points alone. */
export function validateAirportTask(
  config: AirportTaskConfig = airportTaskConfig,
): ValidationReport {
  const key = JSON.stringify(config)
  const cached = validationCache.get(key)
  if (cached) return cloneReport(cached)
  const errors = configurationErrors(config)
  const arcRadii = [...config.route.outbound, ...config.route.inbound]
    .filter((s) => s.type === 'arc')
    .map((s) => s.radius)
  const report: ValidationReport = {
    ok: false,
    errors,
    steps: 0,
    duration: 0,
    routeDistance: routeLength(config.route.outbound) + routeLength(config.route.inbound),
    minClearance: Infinity,
    minObstacleClearance: Infinity,
    minTrainClearance: Infinity,
    clearanceMargin: config.validation.clearanceMargin,
    minimumTurnRadius: arcRadii.length ? Math.min(...arcRadii) : Infinity,
    maxArticulation: 0,
    maxArticulationDegrees: 0,
    maxTractorTrailerAngle: 0,
    hitchErrors: { drawbarMax: 0, wheelbaseMax: 0, max: 0 },
    maxSpeed: 0,
    maxLateralAcceleration: 0,
    collisions: [],
  }
  if (!errors.length) {
    const engine = new TaskEngine(config),
      obstacles = config.obstacles.map((o) => ({ ...o, polygon: convexHull(o.polygon) }))
    let previous = vehicleFootprints(engine.state, config)
    const seenCollisions = new Set<string>()
    engine.startUnchecked()
    const maxSteps = Math.ceil(
      ((report.routeDistance / config.motion.maxSpeed) * 20 + config.motion.serviceSeconds + 120) /
        SIMULATION_STEP,
    )
    while (
      engine.state.phase !== 'completed' &&
      engine.state.runState !== 'error' &&
      report.steps < maxSteps
    ) {
      engine.tick(SIMULATION_STEP)
      report.steps++
      const state = engine.state,
        current = vehicleFootprints(state, config)
      const sweptParts = current.map((part, i) =>
        convexHull([...previous[i]!.polygon, ...part.polygon]),
      )
      for (let i = 0; i < current.length; i++) {
        const part = current[i]!,
          swept = sweptParts[i]!
        for (const obstacle of obstacles) {
          const clearance =
            polygonClearance(swept, obstacle.polygon) - config.validation.sweepPadding
          report.minClearance = Math.min(report.minClearance, clearance)
          report.minObstacleClearance = Math.min(report.minObstacleClearance, clearance)
          if (clearance < config.validation.clearanceMargin) {
            const id = `${part.part}:${obstacle.id}`
            if (!seenCollisions.has(id)) {
              seenCollisions.add(id)
              report.collisions.push({
                elapsed: state.elapsed,
                phase: state.phase,
                part: part.part,
                obstacle: obstacle.id,
                clearance,
              })
            }
          }
        }
      }
      // Connected drawbar/bogie parts are intentionally allowed to meet; the
      // tractor and cart bodies themselves must never intersect during a turn.
      const trainClearance =
        polygonClearance(sweptParts[0]!, sweptParts[1]!) - config.validation.sweepPadding
      report.minTrainClearance = Math.min(report.minTrainClearance, trainClearance)
      report.minClearance = Math.min(report.minClearance, trainClearance)
      if (trainClearance < config.validation.clearanceMargin && !seenCollisions.has('self-body')) {
        seenCollisions.add('self-body')
        report.collisions.push({
          elapsed: state.elapsed,
          phase: state.phase,
          part: 'tractor-body',
          obstacle: 'trailer-body',
          clearance: trainClearance,
        })
      }
      previous = current
      const hitch = hitchConstraintErrors(state, config)
      report.hitchErrors.drawbarMax = Math.max(report.hitchErrors.drawbarMax, hitch.drawbar)
      report.hitchErrors.wheelbaseMax = Math.max(report.hitchErrors.wheelbaseMax, hitch.wheelbase)
      report.maxArticulation = Math.max(
        report.maxArticulation,
        Math.abs(angleDifference(state.tractor.heading, state.trailer.bogieHeading)),
        Math.abs(angleDifference(state.trailer.bogieHeading, state.trailer.heading)),
      )
      report.maxTractorTrailerAngle = Math.max(
        report.maxTractorTrailerAngle,
        Math.abs(angleDifference(state.tractor.heading, state.trailer.heading)),
      )
      report.maxSpeed = Math.max(report.maxSpeed, state.speed)
      const route =
        state.phase === 'returning' || state.phase === 'completed'
          ? config.route.inbound
          : config.route.outbound
      report.maxLateralAcceleration = Math.max(
        report.maxLateralAcceleration,
        state.speed ** 2 * Math.abs(sampleRoute(route, engine.legDistance).curvature),
      )
    }
    report.duration = engine.state.elapsed
    report.hitchErrors.max = Math.max(
      report.hitchErrors.drawbarMax,
      report.hitchErrors.wheelbaseMax,
    )
    report.maxArticulationDegrees = (report.maxArticulation * 180) / Math.PI
    if (engine.state.phase !== 'completed') errors.push('完整轨迹预演未能完成，禁止开始任务')
    if (report.collisions.length)
      errors.push(
        `完整扫掠未通过：${report.collisions[0]!.part} 与 ${report.collisions[0]!.obstacle} 间距不足`,
      )
    if (report.maxArticulation > config.motion.maxArticulation) errors.push('拖车铰接角超出允许值')
    if (report.hitchErrors.max > 0.0001) errors.push('牵引连接约束误差超限')
    if (report.maxLateralAcceleration > config.motion.lateralAcceleration + 0.001)
      errors.push('弯道速度超过侧向加速度限制')
  }
  report.ok = errors.length === 0
  if (validationCache.size >= 16) validationCache.delete(validationCache.keys().next().value!)
  validationCache.set(key, cloneReport(report))
  return cloneReport(report)
}

export function createAirportSimulation(
  config: AirportTaskConfig = airportTaskConfig,
  validationErrors: string[] = [],
) {
  // Isolate a running task from accidental external configuration mutation.
  const owned = JSON.parse(JSON.stringify(config)) as AirportTaskConfig
  const engine = new TaskEngine(owned)
  let report: ValidationReport | null = null
  return {
    start(): ActionResult {
      if (engine.state.phase !== 'idle' || engine.state.runState === 'running')
        return { ok: false, error: '请先复位任务后再开始' }
      if (validationErrors.length) return engine.fail(validationErrors.join('；'))
      report = validateAirportTask(owned)
      if (!report.ok) return engine.fail(report.errors.join('；'))
      return engine.startUnchecked()
    },
    pause: (reason?: string) => engine.pause(reason),
    resume: () => engine.resume(),
    reset: () => engine.reset(),
    update: (dtSeconds: number) => engine.update(dtSeconds),
    getSnapshot: () => engine.snapshot(),
    getValidationReport: () => (report ? cloneReport(report) : null),
  }
}
