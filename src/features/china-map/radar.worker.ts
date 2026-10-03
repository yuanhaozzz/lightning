type RadarBand = { dbz: number; coordinates: [number, number][] }

const BOUNDS = { west: 73, east: 135, south: 18, north: 54 }
const POINT_COUNT = 200_000
let dataset: RadarBand[] | undefined
let datasetTimelineIndex = -1
let randomSeed = 0x5f3759df

function seededRandom() {
  randomSeed = (Math.imul(randomSeed, 1664525) + 1013904223) >>> 0
  return randomSeed / 4294967296
}

function randomNormal() {
  const u = Math.max(seededRandom(), 1e-7)
  const v = seededRandom()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

function createDataset(timelineIndex: number): RadarBand[] {
  randomSeed = 0x5f3759df
  const bands = Array.from({ length: 71 }, (_, dbz) => ({ dbz, coordinates: [] as [number, number][] }))
  const cells: Array<[number, number, number, number, number, number]> = []
  const addBand = (startLng: number, endLng: number, baseLat: number, count: number, peak: number, phase: number) => {
    for (let index = 0; index < count; index += 1) {
      const progress = index / Math.max(1, count - 1)
      const lng = startLng + (endLng - startLng) * progress
      const lat = baseLat + Math.sin(progress * Math.PI * 2.3 + phase) * 0.75 + Math.sin(progress * 11 + phase) * 0.24
      const radiusLng = 0.75 + ((index * 37) % 9) / 10
      const radiusLat = 0.42 + ((index * 19) % 7) / 16
      const cellPeak = peak - 10 + ((index * 23) % 17)
      cells.push([lng, lat, radiusLng, radiusLat, cellPeak, -0.22 + Math.sin(index * 1.7) * 0.32])
    }
  }
  // Echo layout follows the supplied reference frame.
  addBand(108.0, 112.8, 40.7, 9, 37, 0.5)   // Hohhot / central Inner Mongolia
  addBand(113.3, 117.4, 39.8, 8, 33, 1.7)   // northern Hebei / Beijing
  addBand(105.1, 106.45, 38.65, 8, 58, 1.15) // 银川北部 / 拜寺口强对流
  addBand(106.36, 107.05, 36.18, 6, 36, 2.35) // 固原东侧临近雷暴
  addBand(120.0, 124.0, 39.0, 7, 27, 2.4)   // Liaodong fragmented echoes
  addBand(103.2, 109.5, 35.2, 10, 22, 0.9)  // Gansu / Shaanxi weak streaks
  addBand(106.0, 112.8, 31.6, 13, 42, 2.1)  // Chongqing to western Hubei
  addBand(111.2, 122.1, 31.2, 23, 57, 0.2)  // Anhui / Jiangsu main rain shield
  addBand(111.0, 119.2, 27.5, 17, 48, 2.8)  // southern convective fragments
  // Convective cores are asymmetric clusters, never one large radial kernel.
  const addCoreCluster = (lng: number, lat: number, peak: number, phase: number) => {
    for (let index = 0; index < 7; index += 1) {
      const angle = phase + index * 1.83
      const distance = 0.14 + (index % 3) * 0.16
      cells.push([
        lng + Math.cos(angle) * distance,
        lat + Math.sin(angle) * distance * 0.7,
        0.22 + (index % 4) * 0.07,
        0.15 + ((index * 3) % 4) * 0.055,
        peak - (index % 3) * 4,
        angle * 0.35,
      ])
    }
  }
  addCoreCluster(108.6, 31.3, 55, 0.3)
  addCoreCluster(115.5, 31.0, 63, 1.4)
  addCoreCluster(118.1, 31.1, 68, 2.1)
  addCoreCluster(120.0, 31.0, 62, 0.8)
  addCoreCluster(116.96, 32.66, 64, 1.15) // 淮南矿区危险样本
  addCoreCluster(105.86, 38.70, 68, 1.05) // 拜寺口双塔雷暴中心样本
  cells.push([106.72, 36.11, 0.14, 0.09, 60, 0.25]) // 固原东侧紧凑强回波核心（距场馆约32km）
  addCoreCluster(112.9, 27.7, 61, 2.7)
  addCoreCluster(116.4, 27.2, 66, 1.9)
  cells.push([117.22, 34.18, 0.82, 0.52, 29, 0.12]) // 徐州矿区关注样本

  const hash = (x: number, y: number) => {
    const value = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123
    return value - Math.floor(value)
  }
  const valueNoise = (x: number, y: number) => {
    const x0 = Math.floor(x)
    const y0 = Math.floor(y)
    const tx = x - x0
    const ty = y - y0
    const sx = tx * tx * (3 - 2 * tx)
    const sy = ty * ty * (3 - 2 * ty)
    const top = hash(x0, y0) * (1 - sx) + hash(x0 + 1, y0) * sx
    const bottom = hash(x0, y0 + 1) * (1 - sx) + hash(x0 + 1, y0 + 1) * sx
    return top * (1 - sy) + bottom * sy
  }
  const fractalNoise = (x: number, y: number) =>
    valueNoise(x, y) * 0.55 + valueNoise(x * 2.07 + 13, y * 2.07 - 7) * 0.3 + valueNoise(x * 4.13 - 9, y * 4.13 + 17) * 0.15

  const reflectivityAt = (lng: number, lat: number) => {
    const warpX = (fractalNoise(lng * 0.33, lat * 0.33) - 0.5) * 1.25
    const warpY = (fractalNoise(lng * 0.31 + 40, lat * 0.31 - 20) - 0.5) * 0.82
    const warpedLng = lng + warpX
    const warpedLat = lat + warpY
    let strongest = 0
    let combined = 0
    for (const [centerLng, centerLat, radiusLng, radiusLat, peak, tilt] of cells) {
      const dx = warpedLng - centerLng
      const dy = warpedLat - centerLat
      const rotatedX = dx * Math.cos(tilt) - dy * Math.sin(tilt)
      const rotatedY = dx * Math.sin(tilt) + dy * Math.cos(tilt)
      const distance = Math.sqrt((rotatedX * rotatedX) / (radiusLng * radiusLng) + (rotatedY * rotatedY) / (radiusLat * radiusLat))
      const localStructure = fractalNoise(
        warpedLng * 1.24 + centerLng * 0.17,
        warpedLat * 1.24 - centerLat * 0.13,
      )
      // Compact support gives every echo a real edge. Spatial noise changes
      // that edge locally, producing lobes and gaps instead of Gaussian ovals.
      const irregularDistance = distance * (0.58 + localStructure * 0.92)
      if (irregularDistance >= 1.18) continue
      const cellValue = peak * Math.pow(1 - irregularDistance / 1.18, 0.72)
      strongest = Math.max(strongest, cellValue)
      if (cellValue > 4) combined += cellValue * 0.12
    }
    const structure = fractalNoise(lng * 0.72, lat * 0.72)
    const edgeDetail = fractalNoise(lng * 1.85 + 80, lat * 1.85 - 35)
    let value = Math.max(strongest, Math.min(strongest * 1.12, strongest * 0.82 + combined))
    value *= 0.52 + structure * 0.62
    // Noise-dependent cutoff produces fingers, bays and detached weak echoes.
    if (value < 6 + (1 - edgeDetail) * 8) return 0
    return Math.min(68, value)
  }

  let generated = 0
  while (generated < POINT_COUNT) {
    const cell = cells[Math.floor(seededRandom() * cells.length)]!
    const angle = seededRandom() * Math.PI * 2
    const radius = Math.sqrt(seededRandom()) * 0.88
    const lng = cell[0] + Math.cos(angle) * cell[2] * radius
    const lat = cell[1] + Math.sin(angle) * cell[3] * radius
    if (lng < BOUNDS.west || lng > BOUNDS.east || lat < BOUNDS.south || lat > BOUNDS.north) continue
    const structure = fractalNoise(lng * 1.24 + cell[0] * 0.17, lat * 1.24 - cell[1] * 0.13)
    const edge = fractalNoise(lng * 1.85 + 80, lat * 1.85 - 35)
    const irregularRadius = radius * (0.58 + structure * 0.92)
    if (irregularRadius >= 1.18) continue
    const value = cell[4] * Math.pow(1 - irregularRadius / 1.18, 0.72) * (0.72 + edge * 0.38)
    if (value < 6 + (1 - edge) * 8) continue
    const dbz = Math.max(5, Math.min(70, Math.round(value)))
    bands[dbz]!.coordinates.push([lng, lat])
    generated += 1
  }
  // Deterministic observed core for the demo site. The risk engine and the
  // rendered raster consume the same samples, so a danger state can never sit
  // outside the visible red echo area.
  for (let y = -24; y <= 24; y += 1) {
    for (let x = -30; x <= 30; x += 1) {
      const nx = x / 30
      const ny = y / 24
      const edge = Math.sqrt(nx * nx + ny * ny)
      const irregular = edge * (.82 + fractalNoise(x * .17 + 40, y * .17 - 20) * .32)
      if (irregular > 1) continue
      // A compact 15–20 km convective core remains legible in the national
      // raster while fully covering the monitored boundary.
      const lng = 105.86 + x * .004
      const lat = 38.70 + y * .00375
      const dbz = Math.max(50, Math.min(58, Math.round(59 - irregular * 8)))
      bands[dbz]!.coordinates.push([lng, lat])
    }
  }
  const driftStep = (timelineIndex - 180) / 30
  const driftLng = driftStep * .34
  const driftLat = driftStep * .08
  if (driftStep !== 0) {
    for (const band of bands) {
      for (const coordinate of band.coordinates) {
        coordinate[0] += driftLng
        coordinate[1] += driftLat
      }
    }
  }
  return bands.filter((band) => band.coordinates.length)
}

const stops: Array<[number, [number, number, number]]> = [
  [8, [92, 82, 168]], [15, [68, 105, 191]], [22, [27, 168, 173]],
  [30, [13, 202, 111]], [40, [94, 226, 66]], [50, [248, 218, 48]],
  [54, [255, 139, 31]], [58, [239, 48, 43]], [64, [204, 26, 83]], [70, [183, 32, 158]],
]

function colorFor(dbz: number): [number, number, number, number] {
  if (dbz < 8) return [0, 0, 0, 0]
  let lower = stops[0]!
  let upper = stops[stops.length - 1]!
  for (let index = 1; index < stops.length; index += 1) {
    if (dbz <= stops[index]![0]) { lower = stops[index - 1]!; upper = stops[index]!; break }
  }
  const ratio = Math.max(0, Math.min(1, (dbz - lower[0]) / (upper[0] - lower[0])))
  const channel = (position: number) => Math.round(lower[1][position]! + (upper[1][position]! - lower[1][position]!) * ratio)
  return [channel(0), channel(1), channel(2), Math.round(108 + Math.min(1, (dbz - 8) / 52) * 118)]
}

function pointInPolygon(point: [number, number], ring: number[][]) {
  let inside = false
  for (let current = 0, previous = ring.length - 1; current < ring.length; previous = current++) {
    const a = ring[current]
    const b = ring[previous]
    if (!a || !b) continue
    const intersects = ((a[1]! > point[1]) !== (b[1]! > point[1])) &&
      point[0] < ((b[0]! - a[0]!) * (point[1] - a[1]!)) / (b[1]! - a[1]!) + a[0]!
    if (intersects) inside = !inside
  }
  return inside
}

function distanceKm(a: [number, number], b: [number, number]) {
  const radians = (value: number) => value * Math.PI / 180
  const lat1 = radians(a[1])
  const lat2 = radians(b[1])
  const deltaLat = lat2 - lat1
  const deltaLng = radians(b[0] - a[0])
  const value = Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2
  return 6371 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value))
}

function render(width: number, height: number, view: typeof BOUNDS, mines: Array<{ id: string; boundary: { coordinates: number[][][] } }>, timelineIndex: number, requestId: number) {
  if (!dataset || datasetTimelineIndex !== timelineIndex) {
    datasetTimelineIndex = timelineIndex
    dataset = createDataset(timelineIndex)
  }
  let field = new Float32Array(width * height)
  const mercatorY = (lat: number) => {
    const radians = Math.max(-85.051129, Math.min(85.051129, lat)) * Math.PI / 180
    return (1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) / 2
  }
  const northY = mercatorY(view.north)
  const southY = mercatorY(view.south)
  for (const band of dataset) {
    for (const [lng, lat] of band.coordinates) {
      if (lng < view.west || lng > view.east || lat < view.south || lat > view.north) continue
      const x = Math.max(0, Math.min(width - 1, Math.round(((lng - view.west) / (view.east - view.west)) * (width - 1))))
      // CanvasSource is warped in Web Mercator space. Its raster rows must use
      // the same projection or echoes drift away from their lng/lat at zoom.
      const y = Math.max(0, Math.min(height - 1, Math.round(((mercatorY(lat) - northY) / (southY - northY)) * (height - 1))))
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const px = x + dx
          const py = y + dy
          if (px < 0 || px >= width || py < 0 || py >= height) continue
          const offset = py * width + px
          field[offset] = Math.max(field[offset]!, band.dbz - (Math.abs(dx) + Math.abs(dy)) * 0.8)
        }
      }
    }
  }

  // Fill only missing cells from measured neighbours. Existing dBZ samples are
  // never blurred or changed, keeping the reflectivity range meaningful.
  for (let pass = 0; pass < 2; pass += 1) {
    const next = field.slice()
    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const offset = y * width + x
        if (field[offset]! > 0) continue
        let sum = 0
        let weight = 0
        for (const [dx, dy, factor] of [[-1, 0, 1], [1, 0, 1], [0, -1, 1], [0, 1, 1], [-1, -1, .7], [1, -1, .7], [-1, 1, .7], [1, 1, .7]] as const) {
          const value = field[(y + dy) * width + x + dx]!
          if (value > 0) { sum += value * factor; weight += factor }
        }
        if (weight > 0) next[offset] = sum / weight
      }
    }
    field = next
  }

  const pixels = new Uint8ClampedArray(width * height * 4)
  for (let index = 0; index < field.length; index += 1) {
    const [red, green, blue, alpha] = colorFor(field[index]!)
    const offset = index * 4
    pixels[offset] = red; pixels[offset + 1] = green; pixels[offset + 2] = blue; pixels[offset + 3] = alpha
  }
  postMessage({ width, height, pixels, requestId }, { transfer: [pixels.buffer] })
  setTimeout(() => {
    const values = mines.map((mine) => {
      const ring = mine.boundary.coordinates[0] ?? []
      const center = ring.length
        ? [ring.reduce((sum, point) => sum + point[0]!, 0) / ring.length, ring.reduce((sum, point) => sum + point[1]!, 0) / ring.length] as [number, number]
        : [104, 35] as [number, number]
      let maximum = 0
      let nearestSevereKm = Number.POSITIVE_INFINITY
      let nearestSevereDbz = 0
      for (const band of dataset!) {
        if (band.dbz > maximum && band.coordinates.some((coordinate) => pointInPolygon(coordinate, ring))) maximum = band.dbz
        if (band.dbz < 50) continue
        for (const coordinate of band.coordinates) {
          const distance = distanceKm(center, coordinate)
          if (distance < nearestSevereKm) {
            nearestSevereKm = distance
            nearestSevereDbz = band.dbz
          }
        }
      }
      const risk = maximum >= 50
        ? 'danger'
        : maximum >= 40
          ? 'warning'
          : (maximum >= 20 || nearestSevereKm <= 40)
            ? 'attention'
            : 'normal'
      const nearby = maximum < 50 && nearestSevereKm <= 40
      const reportedDbz = nearby ? nearestSevereDbz : maximum
      const reportedDistance = risk === 'danger' ? 0 : nearby ? Math.round(nearestSevereKm) : risk === 'normal' ? 120 : 0
      return { id: mine.id, dbz: reportedDbz, risk, distanceKm: reportedDistance }
    })
    postMessage({ type: 'mine-risks', values, requestId })
  }, 0)
}

self.onmessage = (event: MessageEvent<{ width: number; height: number; bounds: typeof BOUNDS; mines: Array<{ id: string; boundary: { coordinates: number[][][] } }>; timelineIndex?: number; requestId?: number }>) =>
  render(event.data.width, event.data.height, event.data.bounds, event.data.mines, event.data.timelineIndex ?? 3, event.data.requestId ?? 0)
