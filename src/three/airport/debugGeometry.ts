import * as THREE from 'three'
import { airportTaskConfig as config } from '../../config/airportTask'
import {
  convexHull,
  routeLength,
  sampleRoute,
  vehicleFootprints,
  type TaskSnapshot,
} from './simulation'

/** Explicit opt-in developer overlay. Never included in ordinary screenshots. */
export function createTaskDebugGeometry() {
  const group = new THREE.Group()
  group.name = 'AEROTWIN_developer_route_validation'
  const line = (name: string, points: THREE.Vector3[], color: number) => {
    const object = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineBasicMaterial({ color, depthTest: false }),
    )
    object.name = name
    object.renderOrder = 20
    group.add(object)
    return object
  }
  for (const [name, route] of Object.entries(config.route)) {
    const length = routeLength(route)
    const steps = Math.ceil(length / 0.1)
    line(
      name,
      Array.from({ length: steps + 1 }, (_, i) => {
        const p = sampleRoute(route, (length * i) / steps)
        return new THREE.Vector3(p.x, 0.08, p.z)
      }),
      name === 'outbound' ? 0x3478f6 : 0x248c69,
    )
  }
  for (const obstacle of config.obstacles) {
    const hull = convexHull(obstacle.polygon)
    const points = [...hull, hull[0]!]
    line(
      obstacle.id,
      points.map((p) => new THREE.Vector3(p.x, 0.1, p.z)),
      0xc34e4e,
    )
  }
  for (const [name, p] of Object.entries({ parking: config.parking, service: config.service })) {
    const arrow = new THREE.ArrowHelper(
      new THREE.Vector3(Math.sin(p.heading), 0, Math.cos(p.heading)),
      new THREE.Vector3(p.x, 0.18, p.z),
      2,
      0xc48a15,
      0.5,
      0.3,
    )
    arrow.name = `${name}_stop_anchor`
    group.add(arrow)
  }
  const outlines = new Map<string, THREE.Line>()
  return {
    group,
    update(state: TaskSnapshot) {
      for (const footprint of vehicleFootprints(state, config)) {
        const points = [...footprint.polygon, footprint.polygon[0]!]
        let object = outlines.get(footprint.part)
        if (!object) {
          object = line(
            footprint.part,
            points.map((p) => new THREE.Vector3(p.x, 0.15, p.z)),
            0x255bdb,
          )
          outlines.set(footprint.part, object)
        }
        const attr = object.geometry.getAttribute('position') as THREE.BufferAttribute
        points.forEach((p, i) => attr.setXYZ(i, p.x, 0.15, p.z))
        attr.needsUpdate = true
        object.geometry.computeBoundingSphere()
      }
    },
  }
}
