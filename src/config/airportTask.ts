/** AEROTWIN v0.2 demonstration geometry, in metres, X/Z ground plane.
 * +Z points towards the aircraft nose; aircraft starboard is -X.
 * Vehicle origins are measured rear axles, not visual bounding-box centres.
 */
export interface Point2 {
  x: number
  z: number
}
export interface Pose2 extends Point2 {
  heading: number
}
export type RouteSegment =
  | { type: 'line'; from: Point2; to: Point2 }
  | { type: 'arc'; center: Point2; radius: number; startAngle: number; sweep: number }
export interface TaskObstacle {
  id: string
  label?: string
  polygon: Point2[]
}
export interface AirportTaskConfig {
  taskId: string
  vehicleId: string
  parking: Pose2
  service: Pose2
  route: { outbound: RouteSegment[]; inbound: RouteSegment[] }
  geometry: {
    tractor: {
      width: number
      bodyRearZ: number
      bodyFrontZ: number
      height: number
      wheelRadius: number
      wheelbase: number
      track: number
      rearHitchZ: number
    }
    trailer: {
      width: number
      bodyRearZ: number
      bodyFrontZ: number
      wheelRadius: number
      wheelbase: number
      track: number
      drawbarLength: number
      drawbarWidth: number
      wheelWidth: number
    }
  }
  motion: {
    maxSpeed: number
    acceleration: number
    deceleration: number
    lateralAcceleration: number
    maxSteeringRate: number
    minTurnRadius: number
    serviceSeconds: number
    positionTolerance: number
    angleTolerance: number
    speedTolerance: number
    maxArticulation: number
  }
  obstacles: TaskObstacle[]
  validation: { clearanceMargin: number; sweepPadding: number }
}

const rect = (x0: number, x1: number, z0: number, z1: number): Point2[] => [
  { x: x0, z: z0 },
  { x: x1, z: z0 },
  { x: x1, z: z1 },
  { x: x0, z: z1 },
]
const wing = (side: number): Point2[] =>
  [
    [1.4, 3.65],
    [4.8, 1.65],
    [7.6, -0.12],
    [11.5, -2.37],
    [15.3, -4.44],
    [17.9, -6.47],
    [17.9, -7.12],
    [15.3, -6.22],
    [11.5, -5.55],
    [7.6, -4.96],
    [1.4, -3.7],
  ].map(([x, z]) => ({ x: x! * side, z: z! }))

export const airportTaskConfig: AirportTaskConfig = {
  taskId: 'BAG-001',
  vehicleId: 'BT-01',
  parking: { x: -28, z: 14, heading: 0 },
  service: { x: -9, z: 8, heading: Math.PI },
  route: {
    outbound: [
      { type: 'line', from: { x: -28, z: 14 }, to: { x: -28, z: 27 } },
      {
        type: 'arc',
        center: { x: -18.5, z: 27 },
        radius: 9.5,
        startAngle: -Math.PI / 2,
        sweep: Math.PI,
      },
      { type: 'line', from: { x: -9, z: 27 }, to: { x: -9, z: 8 } },
    ],
    inbound: [
      {
        type: 'arc',
        center: { x: -15, z: 8 },
        radius: 6,
        startAngle: Math.PI / 2,
        sweep: Math.PI / 2,
      },
      { type: 'line', from: { x: -15, z: 2 }, to: { x: -22, z: 2 } },
      { type: 'arc', center: { x: -22, z: 8 }, radius: 6, startAngle: Math.PI, sweep: Math.PI / 2 },
      { type: 'line', from: { x: -28, z: 8 }, to: { x: -28, z: 14 } },
    ],
  },
  geometry: {
    tractor: {
      width: 1.6,
      bodyRearZ: -0.81,
      bodyFrontZ: 2.335,
      height: 2.39,
      wheelRadius: 0.37,
      wheelbase: 1.83,
      track: 1.34,
      rearHitchZ: -0.62,
    },
    trailer: {
      width: 2.04,
      bodyRearZ: -0.55,
      bodyFrontZ: 2.65,
      wheelRadius: 0.31,
      wheelbase: 2.1,
      track: 1.82,
      drawbarLength: 1.52,
      drawbarWidth: 0.18,
      wheelWidth: 0.22,
    },
  },
  motion: {
    maxSpeed: 3,
    acceleration: 0.8,
    deceleration: 1.1,
    lateralAcceleration: 0.65,
    maxSteeringRate: 1.4,
    minTurnRadius: 6,
    serviceSeconds: 6,
    positionTolerance: 0.08,
    angleTolerance: Math.PI / 90,
    speedTolerance: 0.02,
    maxArticulation: Math.PI * 0.45,
  },
  // These conservative plan-view envelopes are for this authored demonstration,
  // not airport operating clearances. Non-convex outlines use their convex hull.
  obstacles: [
    { id: 'aircraft-fuselage', label: '机身', polygon: rect(-2, 2, -18.8, 18.8) },
    { id: 'port-engine', label: '左发动机', polygon: rect(4.2, 7.1, 0, 5.3) },
    { id: 'starboard-engine', label: '右发动机', polygon: rect(-7.1, -4.2, 0, 5.3) },
    { id: 'port-wing', label: '左机翼', polygon: wing(1) },
    { id: 'starboard-wing', label: '右机翼', polygon: wing(-1) },
    { id: 'port-main-gear', label: '左主起落架', polygon: rect(2.93, 3.91, -2.78, -1.62) },
    { id: 'starboard-main-gear', label: '右主起落架', polygon: rect(-3.91, -2.93, -2.78, -1.62) },
    { id: 'nose-gear', label: '前起落架', polygon: rect(-0.36, 0.36, 12.66, 13.44) },
    { id: 'boarding-bridge', label: '登机桥', polygon: rect(1.3, 24, 11.5, 21.4) },
    { id: 'static-cart-2', label: '静态拖车', polygon: rect(-35.1, -32.9, 15.7, 20.7) },
    { id: 'pushback-tractor', label: '飞机牵引车', polygon: rect(19.4, 22.6, 2.1, 7.9) },
  ],
  validation: { clearanceMargin: 0.05, sweepPadding: 0.001 },
}

export type { TaskSnapshot } from '../three/airport/simulation'
