<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as THREE from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'

const props = withDefaults(
  defineProps<{ active?: boolean; progress?: number; explorable?: boolean }>(),
  { active: false, progress: 0, explorable: false },
)
const emit = defineEmits<{ ready: []; unsupported: [] }>()
const host = ref<HTMLDivElement>()
const supported = ref(true)
let refresh: (() => void) | undefined
let dispose: (() => void) | undefined

watch(
  () => [props.active, props.progress, props.explorable],
  () => refresh?.(),
)

onMounted(() => {
  const element = host.value
  if (!element) return

  let renderer: THREE.WebGLRenderer
  try {
    renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'low-power',
    })
  } catch {
    supported.value = false
    emit('unsupported')
    return
  }

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 60)
  const rig = new THREE.Group()
  const board = new THREE.Group()
  const socketAssembly = new THREE.Group()
  const chip = new THREE.Group()
  const cap = new THREE.Group()
  const textures = new Set<THREE.Texture>()
  const materials = new Set<THREE.Material>()
  const geometries = new Set<THREE.BufferGeometry>()
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
  let reducedMotion = motion.matches
  let isVisible = true
  let frame = 0
  let elapsed = 0
  let previousTime = 0
  let disposed = false
  let lostContext = false
  let rotationX = 0
  let rotationY = 0
  let pointerX = 0
  let pointerY = 0
  let intensity = props.active ? 1 : 0
  let storyProgress = props.explorable ? THREE.MathUtils.clamp(props.progress, 0, 1) : 0
  let cameraDistance = 12.1
  let width = 1
  let height = 1

  const trackGeometry = <T extends THREE.BufferGeometry>(geometry: T) => {
    geometries.add(geometry)
    return geometry
  }
  const trackMaterial = <T extends THREE.Material>(material: T) => {
    materials.add(material)
    return material
  }
  const trackTexture = <T extends THREE.Texture>(texture: T) => {
    textures.add(texture)
    return texture
  }
  let seed = 1847
  const random = () => {
    seed = (seed * 16807) % 2147483647
    return (seed - 1) / 2147483646
  }
  const canvasTexture = (size: number, paint: (context: CanvasRenderingContext2D) => void) => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = size
    const context = canvas.getContext('2d')
    if (context) paint(context)
    const texture = trackTexture(new THREE.CanvasTexture(canvas))
    texture.colorSpace = THREE.SRGBColorSpace
    texture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8)
    return texture
  }

  renderer.setClearColor(0x000000, 0)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.08
  renderer.domElement.className = 'processor-canvas'
  renderer.domElement.setAttribute('aria-hidden', 'true')
  element.appendChild(renderer.domElement)

  const room = new RoomEnvironment()
  const generator = new THREE.PMREMGenerator(renderer)
  const environment = generator.fromScene(room, 0.04)
  scene.environment = environment.texture
  scene.environmentIntensity = 0.85
  room.dispose()
  generator.dispose()

  scene.add(rig)
  rig.add(board, socketAssembly, chip)
  chip.add(cap)
  const ambient = new THREE.HemisphereLight(0xdbe9ff, 0x291408, 1.15)
  const key = new THREE.DirectionalLight(0xfff2e3, 3.7)
  key.position.set(-4, 6, 2)
  const rim = new THREE.DirectionalLight(0xe4edff, 3.6)
  rim.position.set(5, 4, -6)
  const fill = new THREE.DirectionalLight(0xbecfe2, 0.8)
  fill.position.set(1, 2, 7)
  const warm = new THREE.PointLight(0xff4d13, 20, 9, 2)
  warm.position.set(0, 0.7, 2.9)
  scene.add(ambient, key, rim, fill, warm)

  // A shared, linear-data grain map gives the nickel a fine milled finish.
  // It is generated once, with no per-frame texture work or shadow pass.
  const grainMap = canvasTexture(512, (context) => {
    const grain = context.createImageData(512, 512)
    for (let y = 0; y < 512; y++) {
      const stroke = (random() - 0.5) * 11
      for (let x = 0; x < 512; x++) {
        const value = 180 + stroke + (random() - 0.5) * 40
        const index = (y * 512 + x) * 4
        grain.data[index] = grain.data[index + 1] = grain.data[index + 2] = value
        grain.data[index + 3] = 255
      }
    }
    context.putImageData(grain, 0, 0)
  })
  grainMap.colorSpace = THREE.NoColorSpace

  const metalMap = canvasTexture(1024, (context) => {
    const gradient = context.createLinearGradient(0, 0, 1024, 900)
    gradient.addColorStop(0, '#c5c8cb')
    gradient.addColorStop(0.3, '#a8adb2')
    gradient.addColorStop(0.48, '#d8dbdc')
    gradient.addColorStop(0.56, '#e0e1e2')
    gradient.addColorStop(0.7, '#b8bcc0')
    gradient.addColorStop(1, '#9a9fa5')
    context.fillStyle = gradient
    context.fillRect(0, 0, 1024, 1024)
    for (let i = 0; i < 4500; i++) {
      context.fillStyle =
        random() > 0.5
          ? `rgba(255,255,255,${random() * 0.035})`
          : `rgba(18,23,27,${random() * 0.045})`
      context.fillRect(random() * 1024, random() * 1024, 100 + random() * 600, 0.6)
    }
    context.fillStyle = '#3c3e40'
    context.font = '700 54px Arial, sans-serif'
    context.textAlign = 'left'
    context.fillText('AMD', 159, 223)
    // AMD's stepped corner mark, engraved alongside the wordmark.
    context.fillRect(292, 183, 34, 8)
    context.fillRect(318, 183, 8, 34)
    context.fillRect(292, 201, 8, 16)
    context.fillRect(292, 209, 16, 8)
    context.save()
    context.translate(512, 488)
    context.rotate(-0.22)
    context.beginPath()
    context.arc(0, 0, 207, 0.1, Math.PI * 1.93)
    context.strokeStyle = '#bf602c'
    context.lineWidth = 29
    context.stroke()
    context.restore()
    context.textAlign = 'center'
    context.font = '500 145px Arial, sans-serif'
    context.fillStyle = '#303437'
    context.fillText('RYZEN', 512, 538)
    context.font = '500 37px Arial, sans-serif'
    context.fillStyle = '#3c4043'
    context.fillText('9  9 9 5 0 X', 512, 767)
    context.font = '17px monospace'
    context.fillStyle = '#717478'
    context.fillText('AMD RYZEN™ DESKTOP PROCESSOR', 512, 821)
    context.fillText('RYZEN 9000 SERIES · SOCKET AM5', 512, 849)
    // Small etched registration marker and a stylized machine-readable serial.
    context.fillStyle = '#62666a'
    context.fillRect(169, 776, 7, 7)
    for (let y = 0; y < 9; y++) {
      for (let x = 0; x < 9; x++) {
        if (random() > 0.48) context.fillRect(775 + x * 5, 188 + y * 5, 4, 4)
      }
    }
  })

  const boardMap = canvasTexture(1024, (context) => {
    context.fillStyle = '#11171c'
    context.fillRect(0, 0, 1024, 1024)
    context.strokeStyle = '#242b2f'
    context.lineWidth = 1.5
    for (let side = 0; side < 4; side++) {
      context.save()
      context.translate(512, 512)
      context.rotate((side * Math.PI) / 2)
      for (let i = 0; i < 32; i++) {
        const offset = -340 + i * 22
        const end = 365 + random() * 130
        context.beginPath()
        context.moveTo(offset * 0.72, 260)
        context.lineTo(offset * 0.72, 290 + (i % 4) * 15)
        context.lineTo(offset, 330 + (i % 4) * 15)
        context.lineTo(offset, end)
        context.stroke()
        context.beginPath()
        context.arc(offset, end, 3, 0, Math.PI * 2)
        context.stroke()
      }
      context.restore()
    }
    context.strokeStyle = '#454b4c'
    context.lineWidth = 2
    context.strokeRect(24, 24, 976, 976)
    context.strokeStyle = '#282f32'
    context.strokeRect(34, 34, 956, 956)
    context.fillStyle = '#7f8588'
    context.font = '12px monospace'
    context.fillText('AM5 / REV. 05', 78, 943)
    context.fillText('ZEN 5 ARCHITECTURE', 703, 81)
    context.fillStyle = '#394244'
    for (let i = 0; i < 160; i++) {
      const x = random() * 1024
      const y = random() * 1024
      if (x > 200 && x < 824 && y > 200 && y < 824) continue
      context.fillRect(x, y, 2, 2)
    }
  })

  const substrateMap = canvasTexture(512, (context) => {
    context.fillStyle = '#173b34'
    context.fillRect(0, 0, 512, 512)
    context.lineWidth = 1
    for (let side = 0; side < 4; side++) {
      context.save()
      context.translate(256, 256)
      context.rotate((side * Math.PI) / 2)
      for (let i = 0; i < 31; i++) {
        const x = -210 + i * 14
        context.strokeStyle = i % 4 === 0 ? '#9c7740' : '#42604d'
        context.beginPath()
        context.moveTo(x, 235)
        context.lineTo(x, 186 - (i % 3) * 8)
        context.lineTo(x * 0.7, 151 - (i % 3) * 8)
        context.lineTo(x * 0.7, 64)
        context.stroke()
        context.fillStyle = '#b3a064'
        context.fillRect(x - 2, 232, 4, 7)
      }
      context.restore()
    }
    context.strokeStyle = '#94a88a'
    context.strokeRect(13, 13, 486, 486)
    context.fillStyle = '#c4b16b'
    context.beginPath()
    context.moveTo(24, 25)
    context.lineTo(41, 25)
    context.lineTo(24, 42)
    context.fill()
  })

  // Abstract floorplans: these circuit tiles illustrate chiplets, not a die photograph.
  const makeDieMap = (io = false) =>
    canvasTexture(512, (context) => {
      const gradient = context.createLinearGradient(0, 0, 512, 512)
      gradient.addColorStop(0, io ? '#45546a' : '#446075')
      gradient.addColorStop(0.42, io ? '#273345' : '#2d3e4c')
      gradient.addColorStop(0.7, io ? '#68738a' : '#897653')
      gradient.addColorStop(1, '#233d49')
      context.fillStyle = gradient
      context.fillRect(0, 0, 512, 512)
      const columns = io ? 4 : 2
      const rows = 4
      const cellWidth = 448 / columns
      const cellHeight = 448 / rows
      for (let row = 0; row < rows; row++) {
        for (let column = 0; column < columns; column++) {
          const x = 32 + column * cellWidth
          const y = 32 + row * cellHeight
          context.fillStyle = (row + column) % 2 ? '#687984' : '#465b6b'
          context.fillRect(x + 5, y + 5, cellWidth - 10, cellHeight - 10)
          context.strokeStyle = '#bca572'
          context.lineWidth = 2
          context.strokeRect(x + 5, y + 5, cellWidth - 10, cellHeight - 10)
          context.strokeStyle = '#96a7ac'
          context.lineWidth = 0.7
          for (let line = 13; line < cellHeight - 10; line += 6) {
            context.beginPath()
            context.moveTo(x + 12, y + line)
            context.lineTo(x + cellWidth - 13, y + line)
            context.stroke()
          }
          context.fillStyle = '#273d4b'
          for (let block = 0; block < 6; block++) {
            context.fillRect(x + 13 + block * ((cellWidth - 30) / 6), y + 13, 6, cellHeight - 27)
          }
        }
      }
      context.strokeStyle = '#d6b16b'
      context.lineWidth = 3
      context.strokeRect(18, 18, 476, 476)
      context.fillStyle = '#c6c8b1'
      for (let i = 0; i < 64; i++) {
        const position = 32 + i * 7
        context.fillRect(position, 7, 3, 6)
        context.fillRect(position, 499, 3, 6)
        context.fillRect(7, position, 6, 3)
        context.fillRect(499, position, 6, 3)
      }
    })
  const computeMap = makeDieMap()
  const ioMap = makeDieMap(true)
  const contactMap = canvasTexture(128, (context) => {
    const gradient = context.createRadialGradient(64, 64, 25, 64, 64, 64)
    gradient.addColorStop(0, 'rgba(0,0,0,0.9)')
    gradient.addColorStop(0.62, 'rgba(0,0,0,0.7)')
    gradient.addColorStop(1, 'rgba(0,0,0,0)')
    context.fillStyle = gradient
    context.fillRect(0, 0, 128, 128)
  })

  const glowMap = canvasTexture(128, (context) => {
    const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64)
    gradient.addColorStop(0, 'rgba(255,157,61,1)')
    gradient.addColorStop(0.16, 'rgba(255,105,27,0.65)')
    gradient.addColorStop(0.45, 'rgba(255,64,8,0.18)')
    gradient.addColorStop(1, 'rgba(255,45,0,0)')
    context.fillStyle = gradient
    context.fillRect(0, 0, 128, 128)
  })
  const traceMap = canvasTexture(64, (context) => {
    const gradient = context.createLinearGradient(0, 0, 64, 0)
    gradient.addColorStop(0, 'rgba(255,70,10,0)')
    gradient.addColorStop(0.35, 'rgba(255,89,17,0.14)')
    gradient.addColorStop(0.48, 'rgba(255,119,37,0.8)')
    gradient.addColorStop(0.5, 'rgba(255,193,109,1)')
    gradient.addColorStop(0.52, 'rgba(255,119,37,0.8)')
    gradient.addColorStop(0.65, 'rgba(255,89,17,0.14)')
    gradient.addColorStop(1, 'rgba(255,70,10,0)')
    context.fillStyle = gradient
    context.fillRect(0, 0, 64, 64)
  })

  const darkMaterial = trackMaterial(
    new THREE.MeshStandardMaterial({ color: 0x10151a, metalness: 0.68, roughness: 0.38 }),
  )
  const edgeMaterial = trackMaterial(
    new THREE.MeshStandardMaterial({ color: 0x4a5156, metalness: 0.92, roughness: 0.3 }),
  )
  const substrateMaterial = trackMaterial(
    new THREE.MeshStandardMaterial({ map: substrateMap, metalness: 0.4, roughness: 0.57 }),
  )
  const goldMaterial = trackMaterial(
    new THREE.MeshStandardMaterial({ color: 0xb89a5a, metalness: 0.9, roughness: 0.3 }),
  )
  const silverMaterial = trackMaterial(
    new THREE.MeshStandardMaterial({
      color: 0x9da4ac,
      metalness: 0.96,
      roughness: 0.33,
      roughnessMap: grainMap,
      bumpMap: grainMap,
      bumpScale: 0.008,
    }),
  )
  const capEdgeMaterial = trackMaterial(silverMaterial.clone())
  capEdgeMaterial.transparent = true
  const plateMaterial = trackMaterial(
    new THREE.MeshStandardMaterial({
      map: metalMap,
      metalness: 0.92,
      roughness: 0.5,
      roughnessMap: grainMap,
      bumpMap: grainMap,
      bumpScale: 0.011,
      transparent: true,
    }),
  )
  const boardMaterial = trackMaterial(
    new THREE.MeshStandardMaterial({ map: boardMap, metalness: 0.6, roughness: 0.48 }),
  )
  const chipComponents = trackMaterial(
    new THREE.MeshStandardMaterial({ color: 0x090c0f, metalness: 0.5, roughness: 0.31 }),
  )
  const orangeMaterial = trackMaterial(
    new THREE.MeshBasicMaterial({ color: 0xff5f19, toneMapped: false, transparent: true }),
  )

  const box = (
    x: number,
    y: number,
    z: number,
    material: THREE.Material | THREE.Material[],
    parent = board,
  ) => {
    const mesh = new THREE.Mesh(trackGeometry(new THREE.BoxGeometry(x, y, z)), material)
    parent.add(mesh)
    return mesh
  }
  const clippedSquare = (size: number, cut: number) => {
    const half = size / 2
    const shape = new THREE.Shape()
    shape.moveTo(-half + cut, -half)
    shape.lineTo(half - cut, -half)
    shape.lineTo(half, -half + cut)
    shape.lineTo(half, half - cut)
    shape.lineTo(half - cut, half)
    shape.lineTo(-half + cut, half)
    shape.lineTo(-half, half - cut)
    shape.lineTo(-half, -half + cut)
    shape.closePath()
    return shape
  }
  const slab = (
    shape: THREE.Shape,
    depth: number,
    material: THREE.Material | THREE.Material[],
    parent = board,
    bevel = 0.035,
  ) => {
    const geometry = trackGeometry(
      new THREE.ExtrudeGeometry(shape, {
        depth,
        bevelEnabled: true,
        bevelSegments: 2,
        steps: 1,
        bevelSize: bevel,
        bevelThickness: bevel,
      }),
    )
    geometry.computeBoundingBox()
    const bounds = geometry.boundingBox
    const uv = geometry.getAttribute('uv')
    const position = geometry.getAttribute('position')
    if (bounds) {
      for (let i = 0; i < uv.count; i++) {
        uv.setXY(
          i,
          (position.getX(i) - bounds.min.x) / (bounds.max.x - bounds.min.x),
          (position.getY(i) - bounds.min.y) / (bounds.max.y - bounds.min.y),
        )
      }
    }
    const mesh = new THREE.Mesh(geometry, material)
    mesh.rotation.x = -Math.PI / 2
    parent.add(mesh)
    return mesh
  }

  // A stepped board and the thin copper laminate visible along its edges.
  slab(clippedSquare(6.1, 0.2), 0.09, darkMaterial).position.y = -0.24
  slab(clippedSquare(5.98, 0.2), 0.025, edgeMaterial).position.y = -0.12
  slab(clippedSquare(6, 0.2), 0.055, [boardMaterial, darkMaterial]).position.y = -0.075
  const socket = slab(clippedSquare(4.37, 0.12), 0.15, darkMaterial, socketAssembly)
  socket.position.y = 0.035
  const socketRim = slab(clippedSquare(4.23, 0.1), 0.07, edgeMaterial, socketAssembly)
  socketRim.position.y = 0.17
  const inset = slab(clippedSquare(4.12, 0.08), 0.055, chipComponents, socketAssembly)
  inset.position.y = 0.23

  // Thin light lines sit below the CPU, giving the physical stack a warm rim.
  for (let side = 0; side < 4; side++) {
    const light = box(4.18, 0.018, 0.018, orangeMaterial, socketAssembly)
    light.position.set(0, 0.265, side % 2 ? 0 : (side === 0 ? 1 : -1) * 2.17)
    if (side % 2) {
      light.rotation.y = Math.PI / 2
      light.position.x = side === 1 ? 2.17 : -2.17
    }
  }

  slab(clippedSquare(3.93, 0.085), 0.105, [substrateMaterial, darkMaterial], chip).position.y = 0.32
  slab(clippedSquare(3.75, 0.07), 0.025, substrateMaterial, chip, 0.015).position.y = 0.44

  const contactMaterial = trackMaterial(
    new THREE.MeshBasicMaterial({
      map: contactMap,
      transparent: true,
      opacity: 0.65,
      depthWrite: false,
      toneMapped: false,
    }),
  )
  const contactGeometry = trackGeometry(new THREE.PlaneGeometry(1, 1))
  const contactShadow = (
    x: number,
    z: number,
    y: number,
    parent: THREE.Group,
    material = contactMaterial,
  ) => {
    const shadow = new THREE.Mesh(contactGeometry, material)
    shadow.rotation.x = -Math.PI / 2
    shadow.scale.set(x, z, 1)
    shadow.position.y = y
    parent.add(shadow)
    return shadow
  }
  contactShadow(5.7, 5.7, 0.018, board)
  contactShadow(4.9, 4.9, 0.29, socketAssembly)
  const capShadowMaterial = trackMaterial(contactMaterial.clone())
  contactShadow(4.4, 4.4, 0.477, chip, capShadowMaterial)

  const computeMaterial = trackMaterial(
    new THREE.MeshPhysicalMaterial({
      map: computeMap,
      metalness: 0.78,
      roughness: 0.24,
      clearcoat: 0.42,
      clearcoatRoughness: 0.25,
      emissive: 0xff8538,
      emissiveMap: computeMap,
      emissiveIntensity: 0.08,
    }),
  )
  const ioMaterial = trackMaterial(computeMaterial.clone())
  ioMaterial.map = ioMap
  ioMaterial.emissiveMap = ioMap
  ioMaterial.emissive.set(0x667cba)
  const dies = new THREE.Group()
  chip.add(dies)
  const makeDie = (x: number, z: number, w: number, d: number, material: THREE.Material) => {
    const shadow = contactShadow(w * 1.42, d * 1.42, 0.485, chip)
    shadow.position.set(x, 0.485, z)
    const rim = box(w + 0.055, 0.027, d + 0.055, goldMaterial, dies)
    rim.position.set(x, 0.498, z)
    const die = box(
      w,
      0.075,
      d,
      [edgeMaterial, edgeMaterial, material, chipComponents, edgeMaterial, edgeMaterial],
      dies,
    )
    die.position.set(x, 0.545, z)
  }
  makeDie(-0.72, -0.72, 1.13, 0.97, computeMaterial)
  makeDie(0.72, -0.72, 1.13, 0.97, computeMaterial)
  makeDie(0, 0.62, 2.47, 1.15, ioMaterial)

  // Short gold interconnects and exposed passive components complete the package.
  const packagePassiveGeometry = trackGeometry(new THREE.BoxGeometry(0.055, 0.032, 0.1))
  const packagePassives = new THREE.InstancedMesh(packagePassiveGeometry, goldMaterial, 40)
  const packageTransform = new THREE.Object3D()
  for (let side = 0; side < 4; side++) {
    for (let i = 0; i < 10; i++) {
      const offset = -1.42 + i * 0.31
      packageTransform.position.set(
        side % 2 ? (side === 1 ? 1.65 : -1.65) : offset,
        0.495,
        side % 2 ? offset : side === 0 ? 1.65 : -1.65,
      )
      packageTransform.rotation.y = side % 2 ? Math.PI / 2 : 0
      packageTransform.updateMatrix()
      packagePassives.setMatrixAt(side * 10 + i, packageTransform.matrix)
    }
  }
  chip.add(packagePassives)

  const guidePositions = new Float32Array(4 * 2 * 3)
  const guideGeometry = trackGeometry(new THREE.BufferGeometry())
  guideGeometry.setAttribute('position', new THREE.BufferAttribute(guidePositions, 3))
  const guideMaterial = trackMaterial(
    new THREE.LineDashedMaterial({
      color: 0xbec3c5,
      dashSize: 0.06,
      gapSize: 0.04,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    }),
  )
  const guides = new THREE.LineSegments(guideGeometry, guideMaterial)
  const guideDistances = new Float32Array(8)
  guideGeometry.setAttribute('lineDistance', new THREE.BufferAttribute(guideDistances, 1))
  rig.add(guides)

  // The heatspreader's inset corners reveal the green substrate beneath it.
  const spreader = new THREE.Shape()
  const half = 1.77
  const outer = 1.93
  const points: [number, number][] = [
    [-1.26, -outer],
    [-0.68, -outer],
    [-0.68, -half],
    [0.68, -half],
    [0.68, -outer],
    [1.26, -outer],
    [1.26, -half],
    [half, -half],
    [half, -1.26],
    [outer, -1.26],
    [outer, -0.68],
    [half, -0.68],
    [half, 0.68],
    [outer, 0.68],
    [outer, 1.26],
    [half, 1.26],
    [half, half],
    [1.26, half],
    [1.26, outer],
    [0.68, outer],
    [0.68, half],
    [-0.68, half],
    [-0.68, outer],
    [-1.26, outer],
    [-1.26, half],
    [-half, half],
    [-half, 1.26],
    [-outer, 1.26],
    [-outer, 0.68],
    [-half, 0.68],
    [-half, -0.68],
    [-outer, -0.68],
    [-outer, -1.26],
    [-half, -1.26],
    [-half, -half],
    [-1.26, -half],
  ]
  points.forEach(([x, y], index) => (index === 0 ? spreader.moveTo(x, y) : spreader.lineTo(x, y)))
  spreader.closePath()
  slab(spreader, 0.24, [plateMaterial, capEdgeMaterial], cap, 0.045).position.y = 0.5

  // Gold contact pads, surface-mounted capacitors and machined socket fasteners.
  const padGeometry = trackGeometry(new THREE.BoxGeometry(0.06, 0.02, 0.13))
  const pads = new THREE.InstancedMesh(padGeometry, goldMaterial, 76)
  const transform = new THREE.Object3D()
  for (let side = 0; side < 4; side++) {
    for (let i = 0; i < 19; i++) {
      const offset = -1.66 + i * 0.184
      transform.position.set(
        side % 2 ? (side === 1 ? 1.91 : -1.91) : offset,
        0.48,
        side % 2 ? offset : side === 0 ? 1.91 : -1.91,
      )
      transform.rotation.y = side % 2 ? Math.PI / 2 : 0
      transform.updateMatrix()
      pads.setMatrixAt(side * 19 + i, transform.matrix)
    }
  }
  chip.add(pads)

  const capacitorGeometry = trackGeometry(new THREE.BoxGeometry(0.12, 0.07, 0.21))
  const capacitors = new THREE.InstancedMesh(capacitorGeometry, silverMaterial, 48)
  const coreGeometry = trackGeometry(new THREE.BoxGeometry(0.125, 0.074, 0.12))
  const capacitorCores = new THREE.InstancedMesh(coreGeometry, chipComponents, 48)
  for (let side = 0; side < 4; side++) {
    for (let i = 0; i < 12; i++) {
      const offset = -1.5 + i * 0.27
      transform.position.set(
        side % 2 ? (side === 1 ? 2.45 : -2.45) : offset,
        0.065,
        side % 2 ? offset : side === 0 ? 2.45 : -2.45,
      )
      transform.rotation.y = side % 2 ? Math.PI / 2 : 0
      transform.updateMatrix()
      capacitors.setMatrixAt(side * 12 + i, transform.matrix)
      capacitorCores.setMatrixAt(side * 12 + i, transform.matrix)
    }
  }
  board.add(capacitors, capacitorCores)
  const screwGeometry = trackGeometry(new THREE.CylinderGeometry(0.11, 0.11, 0.035, 16))
  const screwSlotMaterial = trackMaterial(new THREE.MeshBasicMaterial({ color: 0x151a1d }))
  for (const x of [-2.76, 2.76]) {
    for (const z of [-2.76, 2.76]) {
      const screw = new THREE.Mesh(screwGeometry, silverMaterial)
      screw.position.set(x, 0.035, z)
      board.add(screw)
      const slot = box(0.12, 0.006, 0.025, screwSlotMaterial)
      slot.position.set(x, 0.056, z)
      slot.rotation.y = Math.PI / 4
    }
  }

  // One batched mesh keeps all glowing, diagonal circuit runs inexpensive.
  const tracePositions: number[] = []
  const traceUvs: number[] = []
  const corePositions: number[] = []
  const routes: THREE.Vector3[][] = []
  const routeLengths: number[] = []
  const addSegment = (a: THREE.Vector3, b: THREE.Vector3) => {
    const direction = new THREE.Vector3().subVectors(b, a).normalize()
    const normal = new THREE.Vector3(-direction.z, 0, direction.x).multiplyScalar(0.055)
    const vertices = [
      a.clone().add(normal),
      a.clone().sub(normal),
      b.clone().add(normal),
      b.clone().add(normal),
      a.clone().sub(normal),
      b.clone().sub(normal),
    ]
    vertices.forEach((vertex) => tracePositions.push(vertex.x, vertex.y, vertex.z))
    traceUvs.push(0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1)
    corePositions.push(a.x, a.y + 0.002, a.z, b.x, b.y + 0.002, b.z)
  }
  for (let side = 0; side < 4; side++) {
    const angle = (side * Math.PI) / 2
    for (let i = 0; i < 13; i++) {
      const start = -1.92 + i * 0.32
      const shift = (i - 6) * 0.028
      const route = [
        new THREE.Vector3(start, 0.03, 2.16),
        new THREE.Vector3(start, 0.03, 2.27 + (i % 3) * 0.06),
        new THREE.Vector3(start + shift, 0.03, 2.64 + (i % 2) * 0.06),
        new THREE.Vector3(start + shift, 0.03, 2.93),
      ].map((point) => point.applyAxisAngle(new THREE.Vector3(0, 1, 0), angle))
      let length = 0
      for (let j = 1; j < route.length; j++) {
        const a = route[j - 1]!
        const b = route[j]!
        addSegment(a, b)
        length += a.distanceTo(b)
      }
      routes.push(route)
      routeLengths.push(length)
    }
  }
  const tracesGeometry = trackGeometry(new THREE.BufferGeometry())
  tracesGeometry.setAttribute('position', new THREE.Float32BufferAttribute(tracePositions, 3))
  tracesGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(traceUvs, 2))
  const traceMaterial = trackMaterial(
    new THREE.MeshBasicMaterial({
      map: traceMap,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
    }),
  )
  board.add(new THREE.Mesh(tracesGeometry, traceMaterial))
  const coreTraceGeometry = trackGeometry(new THREE.BufferGeometry())
  coreTraceGeometry.setAttribute('position', new THREE.Float32BufferAttribute(corePositions, 3))
  const coreTraceMaterial = trackMaterial(
    new THREE.LineBasicMaterial({
      color: 0xff8037,
      transparent: true,
      opacity: 0.58,
      toneMapped: false,
    }),
  )
  board.add(new THREE.LineSegments(coreTraceGeometry, coreTraceMaterial))

  const haloMaterial = trackMaterial(
    new THREE.MeshBasicMaterial({
      map: glowMap,
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    }),
  )
  const halo = new THREE.Mesh(trackGeometry(new THREE.PlaneGeometry(10, 10)), haloMaterial)
  halo.rotation.x = -Math.PI / 2
  halo.position.y = -0.29
  rig.add(halo)

  const pulseCount = 22
  const pulsePositions = new Float32Array(pulseCount * 3)
  const pulseGeometry = trackGeometry(new THREE.BufferGeometry())
  pulseGeometry.setAttribute('position', new THREE.BufferAttribute(pulsePositions, 3))
  const pulseMaterial = trackMaterial(
    new THREE.PointsMaterial({
      color: 0xffbd6e,
      map: glowMap,
      size: 0.18,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    }),
  )
  rig.add(new THREE.Points(pulseGeometry, pulseMaterial))

  const moteCount = 46
  const motePositions = new Float32Array(moteCount * 3)
  const moteOrigins = new Float32Array(moteCount * 3)
  for (let i = 0; i < moteCount; i++) {
    moteOrigins[i * 3] = (random() - 0.5) * 8
    moteOrigins[i * 3 + 1] = random() * 3.3 - 0.6
    moteOrigins[i * 3 + 2] = (random() - 0.5) * 7
  }
  const moteGeometry = trackGeometry(new THREE.BufferGeometry())
  moteGeometry.setAttribute('position', new THREE.BufferAttribute(motePositions, 3))
  const moteMaterial = trackMaterial(
    new THREE.PointsMaterial({
      color: 0xff8c42,
      map: glowMap,
      size: 0.065,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    }),
  )
  rig.add(new THREE.Points(moteGeometry, moteMaterial))

  const assembledView = new THREE.Vector3(0.43, 0.61, 0.67).normalize()
  const openedView = new THREE.Vector3(0.34, 0.76, 0.59).normalize()
  const viewTarget = new THREE.Vector3()
  const pulsePoint = new THREE.Vector3()
  const updateScene = (delta: number) => {
    const easing = reducedMotion ? 1 : 1 - Math.exp(-delta * 4)
    const pointerEasing = reducedMotion ? 1 : 1 - Math.exp(-delta * 7)
    const targetProgress = props.explorable ? THREE.MathUtils.clamp(props.progress, 0, 1) : 0
    storyProgress +=
      (targetProgress - storyProgress) * (reducedMotion ? 1 : 1 - Math.exp(-delta * 8))
    const separation = THREE.MathUtils.smoothstep(storyProgress, 0.08, 0.6)
    const lift = THREE.MathUtils.smoothstep(storyProgress, 0.1, 0.47)
    const slide = THREE.MathUtils.smoothstep(storyProgress, 0.28, 0.8)
    const reveal = THREE.MathUtils.smoothstep(storyProgress, 0.2, 0.86)
    const focus = THREE.MathUtils.smoothstep(storyProgress, 0.64, 1)
    intensity += ((props.active ? 1 : 0) - intensity) * easing
    // The hero should visibly follow the pointer; keep the exploded diagram steady.
    rotationX += (pointerY * (props.explorable ? 0.055 : 0.24) - rotationX) * pointerEasing
    rotationY += (pointerX * (props.explorable ? 0.11 : 0.48) - rotationY) * pointerEasing
    rig.rotation.set(reducedMotion ? 0 : rotationX, -0.12 + (reducedMotion ? 0 : rotationY), -0.015)
    rig.position.y = reducedMotion || props.explorable ? 0 : Math.sin(elapsed * 0.6) * 0.04
    chip.position.y = separation * 0.32
    socketAssembly.position.y = separation * 0.11
    cap.position.set(-2.85 * slide, 1.55 * lift, -0.95 * slide)
    cap.rotation.set(0, -0.15 * slide, 0.16 * slide)
    plateMaterial.opacity = capEdgeMaterial.opacity = 1 - reveal * 0.76
    plateMaterial.depthWrite = capEdgeMaterial.depthWrite = reveal < 0.03
    capShadowMaterial.opacity = 0.65 * (1 - lift)
    dies.position.y = focus * 0.07
    computeMaterial.emissiveIntensity = 0.08 + focus * 0.22
    ioMaterial.emissiveIntensity = 0.08 + reveal * 0.08
    orangeMaterial.opacity = 1 - reveal * 0.55
    traceMaterial.opacity = (0.48 + intensity * 0.35) * (1 - reveal * 0.64)
    coreTraceMaterial.opacity = (0.43 + intensity * 0.4) * (1 - reveal * 0.52)
    haloMaterial.opacity = (0.19 + intensity * 0.16) * (1 - reveal * 0.35)
    warm.intensity = (17 + intensity * 12) * (1 - reveal * 0.45)
    pulseMaterial.opacity = (reducedMotion ? 0.3 : 0.62 + intensity * 0.35) * (1 - reveal * 0.75)
    moteMaterial.opacity = props.explorable ? 0 : 0.42

    // Change framing with the assembly so the lifted cap remains in view on phones.
    viewTarget.set(-0.3 * slide, 0.15 + 0.4 * lift, -0.12 * slide)
    camera.position
      .lerpVectors(assembledView, openedView, reveal)
      .normalize()
      .multiplyScalar(cameraDistance * (1 + 0.07 * lift))
      .add(viewTarget)
    camera.lookAt(viewTarget)

    guideMaterial.opacity = 0.23 * separation
    guides.visible = separation > 0.005
    for (let i = 0; i < 4; i++) {
      const x = i % 2 ? 1.7 : -1.7
      const z = i < 2 ? 1.7 : -1.7
      const lower = 0.28 + socketAssembly.position.y
      const upper = 0.32 + chip.position.y
      const offset = i * 6
      guidePositions[offset] = guidePositions[offset + 3] = x
      guidePositions[offset + 2] = guidePositions[offset + 5] = z
      guidePositions[offset + 1] = lower
      guidePositions[offset + 4] = upper
      guideDistances[i * 2 + 1] = upper - lower
    }
    guideGeometry.getAttribute('position').needsUpdate = true
    guideGeometry.getAttribute('lineDistance').needsUpdate = true

    for (let i = 0; i < pulseCount; i++) {
      const routeIndex = (i * 7) % routes.length
      const route = routes[routeIndex]!
      let distance =
        ((elapsed * (0.15 + intensity * 0.18) + i * 0.327) % 1) * routeLengths[routeIndex]!
      pulsePoint.copy(route[route.length - 1]!)
      for (let j = 1; j < route.length; j++) {
        const a = route[j - 1]!
        const b = route[j]!
        const length = a.distanceTo(b)
        if (distance <= length) {
          pulsePoint.copy(a).lerp(b, distance / length)
          break
        }
        distance -= length
      }
      pulsePositions[i * 3] = pulsePoint.x
      pulsePositions[i * 3 + 1] = pulsePoint.y + 0.025
      pulsePositions[i * 3 + 2] = pulsePoint.z
    }
    pulseGeometry.getAttribute('position').needsUpdate = true
    for (let i = 0; i < moteCount; i++) {
      motePositions[i * 3] = moteOrigins[i * 3]! + Math.sin(elapsed * 0.15 + i) * 0.05
      motePositions[i * 3 + 1] = ((moteOrigins[i * 3 + 1]! + elapsed * 0.045 + 0.6) % 3.9) - 0.6
      motePositions[i * 3 + 2] = moteOrigins[i * 3 + 2]!
    }
    moteGeometry.getAttribute('position').needsUpdate = true
  }

  const canRender = () =>
    !disposed && !lostContext && isVisible && !document.hidden && width > 0 && height > 0
  const renderFrame = (time: number) => {
    frame = 0
    if (!canRender()) return
    const delta = previousTime ? Math.min((time - previousTime) / 1000, 0.05) : 1 / 60
    previousTime = time
    if (!reducedMotion) elapsed += delta
    updateScene(delta)
    renderer.render(scene, camera)
    if (!reducedMotion) frame = requestAnimationFrame(renderFrame)
  }
  const resume = () => {
    if (!canRender()) {
      cancelAnimationFrame(frame)
      frame = 0
      previousTime = 0
      return
    }
    if (!frame) frame = requestAnimationFrame(renderFrame)
  }
  refresh = resume

  const resize = () => {
    const bounds = element.getBoundingClientRect()
    width = bounds.width
    height = bounds.height
    if (width <= 0 || height <= 0) return
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, width < 600 ? 1.3 : 1.6))
    renderer.setSize(width, height)
    camera.aspect = width / height
    cameraDistance = Math.max(props.explorable ? 14.4 : 12.1, 9 / camera.aspect)
    camera.updateProjectionMatrix()
    resume()
  }
  const pointerMove = (event: PointerEvent) => {
    if (reducedMotion || event.pointerType === 'touch') return
    const bounds = element.getBoundingClientRect()
    const sensitivity = props.explorable ? 1 : 1.4
    pointerX = THREE.MathUtils.clamp(
      (((event.clientX - bounds.left) / bounds.width) * 2 - 1) * sensitivity,
      -1,
      1,
    )
    pointerY = THREE.MathUtils.clamp(
      (((event.clientY - bounds.top) / bounds.height) * 2 - 1) * sensitivity,
      -1,
      1,
    )
  }
  const pointerLeave = () => {
    pointerX = 0
    pointerY = 0
  }
  const motionChange = (event: MediaQueryListEvent) => {
    reducedMotion = event.matches
    pointerLeave()
    resume()
  }
  const contextLost = (event: Event) => {
    event.preventDefault()
    lostContext = true
    supported.value = false
    resume()
    emit('unsupported')
  }
  const contextRestored = () => {
    lostContext = false
    supported.value = true
    resize()
    emit('ready')
  }
  const resizeObserver = new ResizeObserver(resize)
  resizeObserver.observe(element)
  const intersectionObserver = new IntersectionObserver(
    ([entry]) => {
      isVisible = entry?.isIntersecting ?? true
      resume()
    },
    { rootMargin: '60px' },
  )
  intersectionObserver.observe(element)
  element.addEventListener('pointermove', pointerMove, { passive: true })
  element.addEventListener('pointerleave', pointerLeave, { passive: true })
  document.addEventListener('visibilitychange', resume)
  motion.addEventListener('change', motionChange)
  renderer.domElement.addEventListener('webglcontextlost', contextLost)
  renderer.domElement.addEventListener('webglcontextrestored', contextRestored)

  resize()
  updateScene(1)
  renderer.render(scene, camera)
  emit('ready')

  dispose = () => {
    disposed = true
    cancelAnimationFrame(frame)
    resizeObserver.disconnect()
    intersectionObserver.disconnect()
    element.removeEventListener('pointermove', pointerMove)
    element.removeEventListener('pointerleave', pointerLeave)
    document.removeEventListener('visibilitychange', resume)
    motion.removeEventListener('change', motionChange)
    renderer.domElement.removeEventListener('webglcontextlost', contextLost)
    renderer.domElement.removeEventListener('webglcontextrestored', contextRestored)
    scene.environment = null
    environment.dispose()
    textures.forEach((texture) => texture.dispose())
    materials.forEach((material) => material.dispose())
    geometries.forEach((geometry) => geometry.dispose())
    pads.dispose()
    packagePassives.dispose()
    capacitors.dispose()
    capacitorCores.dispose()
    scene.clear()
    renderer.dispose()
    renderer.domElement.remove()
  }
})

onBeforeUnmount(() => {
  refresh = undefined
  dispose?.()
})
</script>

<template>
  <div
    ref="host"
    class="processor-scene"
    role="img"
    :aria-label="
      props.explorable
        ? 'Conceptual processor exploded view: silver heatspreader, two compute chiplets, I/O die, substrate and socket. Schematic, not to scale.'
        : 'Interactive 3D AMD Ryzen 9 9950X processor, machined silver on a motherboard with glowing orange circuits'
    "
  >
    <div v-if="!supported" class="processor-fallback" aria-hidden="true">
      <div class="fallback-board">
        <div class="fallback-chip">
          <span>AMD</span><strong>RYZEN</strong><small>9 9950X</small>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.processor-scene {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 280px;
  isolation: isolate;
}
.processor-scene :deep(.processor-canvas) {
  display: block;
  width: 100%;
  height: 100%;
}
.processor-fallback {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  perspective: 900px;
}
.fallback-board {
  display: grid;
  place-items: center;
  width: 62%;
  max-width: 470px;
  aspect-ratio: 1;
  transform: rotateX(43deg) rotateZ(-25deg);
  background:
    repeating-linear-gradient(0deg, transparent 0 19px, #ff601d35 20px 21px),
    repeating-linear-gradient(90deg, #11171b 0 19px, #ff601d35 20px 21px);
  border: 2px solid #3d4144;
  box-shadow:
    14px 17px 0 #0c0d0e,
    0 0 75px #ff651926;
}
.fallback-chip {
  display: flex;
  flex-direction: column;
  justify-content: space-around;
  width: 68%;
  height: 68%;
  padding: 9%;
  border: 2px solid #e3e6e7;
  background: linear-gradient(135deg, #ced0d2, #a4a7a9 42%, #e8e9e9 72%, #9c9fa2);
  box-shadow:
    8px 8px 0 #5b6062,
    15px 16px 0 #101b1a,
    0 0 34px #ff641c77;
  color: #282a2b;
}
.fallback-chip span {
  font:
    700 clamp(13px, 2vw, 25px) Arial,
    sans-serif;
}
.fallback-chip strong {
  font:
    500 clamp(30px, 4vw, 58px) Arial,
    sans-serif;
  text-align: center;
  letter-spacing: -2px;
}
.fallback-chip small {
  font:
    500 clamp(10px, 1.2vw, 17px) Arial,
    sans-serif;
  text-align: center;
  letter-spacing: 3px;
}
</style>
