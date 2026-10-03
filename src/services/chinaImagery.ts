import * as Cesium from 'cesium'

export interface ChinaGeometry {
  features: Array<{ geometry: { type: string; coordinates: number[][][][] } }>
}

// Color grading only. The supplied polygons, not image colors, define China's extent.
// Blue-pixel protection preserves water color; it is not a land/sea boundary dataset.
export function focusChina(provider: Cesium.ImageryProvider, data: ChinaGeometry) {
  const mercator = provider.tilingScheme instanceof Cesium.WebMercatorTilingScheme
  const projectY = (latitude: number) => mercator
    ? Math.log(Math.tan(Math.PI / 4 + Math.max(-85.051128, Math.min(85.051128, latitude)) * Math.PI / 360))
    : latitude * Math.PI / 180
  const polygons = data.features.filter(f => f.geometry.type === 'MultiPolygon').flatMap(f =>
    f.geometry.coordinates.map(polygon => {
      const rings = polygon.map(ring => ring.map(([lon, lat]) => [lon! * Math.PI / 180, projectY(lat!)]))
      const points = rings.flat()
      return { rings, west: Math.min(...points.map(p => p[0]!)), east: Math.max(...points.map(p => p[0]!)),
        south: Math.min(...points.map(p => p[1]!)), north: Math.max(...points.map(p => p[1]!)) }
    }))
  const requestImage = provider.requestImage.bind(provider)
  provider.requestImage = (x, y, level, request) => {
    const pending = requestImage(x, y, level, request)
    if (!pending) return undefined // Preserve Cesium request throttling.
    return pending.then(image => {
      const width = provider.tileWidth, height = provider.tileHeight
      const output = Object.assign(document.createElement('canvas'), { width, height })
      const context = output.getContext('2d', { willReadFrequently: true })!
      context.drawImage(image as CanvasImageSource, 0, 0, width, height)
      const rectangle = provider.tilingScheme.tileXYToRectangle(x, y, level)
      const north = projectY(Cesium.Math.toDegrees(rectangle.north))
      const south = projectY(Cesium.Math.toDegrees(rectangle.south))
      const mask = Object.assign(document.createElement('canvas'), { width, height })
      const m = mask.getContext('2d', { willReadFrequently: true })!
      m.fillStyle = '#fff'
      for (const polygon of polygons) {
        if (polygon.east < rectangle.west || polygon.west > rectangle.east || polygon.north < south || polygon.south > north) continue
        m.beginPath()
        for (const ring of polygon.rings) {
          ring.forEach(([lon, lat], index) => {
            const px = (lon! - rectangle.west) / rectangle.width * width
            const py = (north - lat!) / (north - south) * height
            if (index === 0) m.moveTo(px, py)
            else m.lineTo(px, py)
          })
          m.closePath()
        }
        m.fill('evenodd')
      }
      const pixels = context.getImageData(0, 0, width, height)
      const coverage = m.getImageData(0, 0, width, height).data
      const a = pixels.data
      for (let i = 0; i < a.length; i += 4) {
        const r = a[i]!, g = a[i + 1]!, b = a[i + 2]!
        const inside = coverage[i + 3]! / 255
        const luminance = r * .2126 + g * .7152 + b * .0722
        // Smooth blue protection avoids a visible threshold along coastal water.
        const water = Math.max(0, Math.min(1, (b - r - 4) / 24)) * Math.max(0, Math.min(1, (b - g + 3) / 16))
        const outside = (1 - inside) * (1 - water)
        for (let c = 0; c < 3; c++) {
          const original = a[i + c]!
          const vivid = (luminance + (original - luminance) * 1.13 - 128) * 1.04 + 133
          const muted = (luminance + (original - luminance) * .24) * .57 + [100, 107, 110][c]!
          const sea = original * .84 + [15, 87, 139][c]! * .32
          a[i + c] = (vivid * (1 - outside) + muted * outside) * (1 - water) + sea * water
        }
      }
      context.putImageData(pixels, 0, 0)
      return output
    })
  }
  return provider
}
