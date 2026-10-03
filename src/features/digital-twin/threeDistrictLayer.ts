import * as THREE from 'three'
import { MercatorCoordinate, type CustomLayerInterface, type Map } from 'maplibre-gl'

type LngLat = [number, number]

export function createThreeDistrictLayer(ring: LngLat[]): CustomLayerInterface {
  const center: LngLat = [
    ring.reduce((sum, point) => sum + point[0], 0) / ring.length,
    ring.reduce((sum, point) => sum + point[1], 0) / ring.length,
  ]
  const origin = MercatorCoordinate.fromLngLat(center, 0)
  const worldScale = origin.meterInMercatorCoordinateUnits()
  const scene = new THREE.Scene()
  const camera = new THREE.Camera()
  let renderer: THREE.WebGLRenderer | undefined

  const localPoints = ring.slice(0, -1).map(([lng, lat]) => {
    const point = MercatorCoordinate.fromLngLat([lng, lat], 0)
    return new THREE.Vector2((point.x - origin.x) / worldScale, (origin.y - point.y) / worldScale)
  })
  const shape = new THREE.Shape(localPoints)
  const depth = 620
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelSegments: 2,
    bevelSize: 28,
    bevelThickness: 34,
    curveSegments: 2,
  })
  geometry.computeVertexNormals()

  const cap = new THREE.MeshPhysicalMaterial({
    color: 0x73c9ce,
    transparent: true,
    opacity: 0.1,
    roughness: 0.72,
    metalness: 0.08,
    clearcoat: 0.22,
    depthWrite: false,
  })
  const side = new THREE.MeshStandardMaterial({
    color: 0x06466d,
    emissive: 0x002b51,
    emissiveIntensity: 0.72,
    roughness: 0.55,
    metalness: 0.38,
  })
  const district = new THREE.Mesh(geometry, [cap, side])
  scene.add(district)

  const boundaryPoints = localPoints.map((point) => new THREE.Vector3(point.x, point.y, depth + 48))
  const boundaryCurve = new THREE.CatmullRomCurve3(boundaryPoints, true, 'centripetal', 0.15)
  const halo = new THREE.Mesh(
    new THREE.TubeGeometry(boundaryCurve, Math.max(180, boundaryPoints.length * 10), 58, 8, true),
    new THREE.MeshBasicMaterial({ color: 0x00bfff, transparent: true, opacity: 0.11, depthWrite: false, blending: THREE.AdditiveBlending }),
  )
  const core = new THREE.Mesh(
    new THREE.TubeGeometry(boundaryCurve, Math.max(180, boundaryPoints.length * 10), 14, 8, true),
    new THREE.MeshBasicMaterial({ color: 0xc8fbff, transparent: true, opacity: 0.96, depthWrite: false }),
  )
  scene.add(halo, core)

  const baseCurve = new THREE.CatmullRomCurve3(
    localPoints.map((point) => new THREE.Vector3(point.x, point.y, 35)), true, 'centripetal', 0.15,
  )
  scene.add(new THREE.Mesh(
    new THREE.TubeGeometry(baseCurve, Math.max(180, boundaryPoints.length * 10), 32, 8, true),
    new THREE.MeshBasicMaterial({ color: 0x007ebd, transparent: true, opacity: 0.34 }),
  ))

  scene.add(new THREE.HemisphereLight(0xa8eaff, 0x00101f, 2.4))
  const keyLight = new THREE.DirectionalLight(0xdffaff, 3.4)
  keyLight.position.set(-9000, -13000, 19000)
  scene.add(keyLight)
  const rimLight = new THREE.DirectionalLight(0x0088ff, 2.1)
  rimLight.position.set(15000, 6000, 5000)
  scene.add(rimLight)

  const transform = new THREE.Matrix4()
    .makeTranslation(origin.x, origin.y, origin.z)
    .scale(new THREE.Vector3(worldScale, -worldScale, worldScale))

  return {
    id: 'three-district-model',
    type: 'custom',
    renderingMode: '3d',
    onAdd(map: Map, gl: WebGL2RenderingContext) {
      renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl, antialias: true })
      renderer.autoClear = false
      renderer.outputColorSpace = THREE.SRGBColorSpace
    },
    render(_gl, options) {
      if (!renderer) return
      camera.projectionMatrix = new THREE.Matrix4()
        .fromArray(options.modelViewProjectionMatrix as unknown as number[])
        .multiply(transform)
      renderer.resetState()
      renderer.render(scene, camera)
    },
    onRemove() {
      geometry.dispose()
      cap.dispose()
      side.dispose()
      halo.geometry.dispose()
      ;(halo.material as THREE.Material).dispose()
      core.geometry.dispose()
      ;(core.material as THREE.Material).dispose()
      renderer?.dispose()
      renderer = undefined
    },
  }
}
