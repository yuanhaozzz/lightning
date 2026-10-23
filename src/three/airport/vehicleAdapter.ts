import * as THREE from 'three'
import { airportAssetBindings as bindings } from '../../config/airportAssetBindings'
import type { TaskSnapshot } from './simulation'

/** Bind only authored semantic nodes; invalid GLBs produce an actionable task error. */
export function bindAirportVehicles(scene: THREE.Object3D) {
  const errors: string[] = []
  const find = (name: string) => {
    const node = scene.getObjectByName(name)
    if (!node) errors.push(`模型缺少节点：${name}，请重新导出 V0.2 资产。`)
    return node
  }
  const tractor = find(bindings.tractorRoot)
  const trailer = find(bindings.trailerRoot)
  const bogie = find(bindings.bogie)
  const tractorHitch = find(bindings.tractorHitch)
  const trailerHitch = find(bindings.trailerHitch)
  const aircraft = find(bindings.aircraftRoot)
  const leftDoor = find(bindings.leftDoor)
  const cargoDoor = find(bindings.cargoDoor)
  const steer = bindings.steer.map(find)
  const wheels = Object.fromEntries(
    Object.entries(bindings.wheels).map(([key, names]) => [key, names.map(find)]),
  ) as Record<keyof TaskSnapshot['wheelDistances'], (THREE.Object3D | undefined)[]>
  scene.updateMatrixWorld(true)
  function checkLocal(node: THREE.Object3D | undefined, expected: readonly number[]) {
    if (node && node.position.distanceTo(new THREE.Vector3().fromArray(expected)) > 0.001)
      errors.push(`节点 ${node.name} 局部位置与米制接口不符，请检查 Blender 轴心。`)
  }
  checkLocal(tractorHitch, bindings.reference.tractorHitchLocal)
  checkLocal(trailerHitch, bindings.reference.trailerHitchLocal)
  checkLocal(bogie, bindings.reference.bogieLocal)
  checkLocal(leftDoor, bindings.reference.leftDoorLocal)
  checkLocal(cargoDoor, bindings.reference.cargoDoorLocal)
  for (const node of [tractor, trailer, aircraft]) {
    if (
      node &&
      node.getWorldScale(new THREE.Vector3()).distanceTo(new THREE.Vector3(1, 1, 1)) > 0.001
    )
      errors.push(`节点 ${node.name} 必须使用单位比例（米），不能通过导入缩放修补。`)
  }
  const anchors = {
    leftDoor: leftDoor?.getWorldPosition(new THREE.Vector3()).toArray(),
    cargoDoor: cargoDoor?.getWorldPosition(new THREE.Vector3()).toArray(),
  }
  if (anchors.cargoDoor && anchors.cargoDoor[0]! >= 0)
    errors.push('右前货舱锚点必须位于飞机自身右侧（世界 −X）。')
  let last: TaskSnapshot | undefined
  const position = (node: THREE.Object3D, pose: { x: number; z: number; heading: number }) => {
    node.position.set(pose.x, 0, pose.z)
    node.rotation.set(0, pose.heading, 0)
  }
  return {
    errors,
    anchors,
    apply(state: TaskSnapshot) {
      if (errors.length || !tractor || !trailer || !bogie) return
      position(tractor, state.tractor)
      position(trailer, state.trailer)
      bogie.rotation.y = state.trailer.bogieHeading - state.trailer.heading
      steer.forEach((node) => {
        if (node) node.rotation.y = state.steering
      })
      for (const [key, nodes] of Object.entries(wheels)) {
        const distance = state.wheelDistances[key as keyof TaskSnapshot['wheelDistances']]
        const radius = key.startsWith('tractor')
          ? bindings.reference.tractorRadius
          : bindings.reference.trailerRadius
        nodes.forEach((node) => {
          if (node) node.rotation.x = distance / radius
        })
      }
      last = state
    },
    inspect() {
      scene.updateMatrixWorld(true)
      const a = tractorHitch?.getWorldPosition(new THREE.Vector3())
      const b = trailerHitch?.getWorldPosition(new THREE.Vector3())
      return {
        errors,
        anchors,
        hitchDistance: a && b ? a.distanceTo(b) : null,
        tractorHitch: a?.toArray(),
        trailerHitch: b?.toArray(),
        nodeCounts: { tractor: tractor ? 1 : 0, trailer: trailer ? 1 : 0 },
        wheelAngles: Object.fromEntries(
          Object.entries(wheels).map(([key, nodes]) => [
            key,
            nodes.map((node) => node?.rotation.x),
          ]),
        ),
        bogieAngle: bogie?.rotation.y,
        state: last,
      }
    },
  }
}
