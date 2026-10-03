import type { LngLatBoundsLike } from 'maplibre-gl'

export const CHINA_BOUNDS: LngLatBoundsLike = [[72.2, 1.5], [137.5, 55.5]]

export const MAP_COLORS = {
  background: '#dfe9ec',
  fill: '#fff1cf',
  province: '#fffaf0',
  glow: '#ffffff',
  border: '#b43b35',
  highlight: '#d5a24c',
} as const

const token = import.meta.env.VITE_TDT_KEY?.trim() ?? ''

export const TDT_TILES = token
  // Keep one imagery node for a single map session. Mixing t0–t3 can expose
  // different cache generations at high zoom and produce hard rectangular
  // colour seams between neighbouring satellite tiles.
  ? [`https://t0.tianditu.gov.cn/img_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=img&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&tk=${token}`]
  : []

// A cartographic basemap is clearer than satellite imagery inside the tiny
// South China Sea inset: coastlines and islands remain legible at low zoom.
export const TDT_VECTOR_TILES = token
  ? [`https://t0.tianditu.gov.cn/vec_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=vec&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&tk=${token}`]
  : []
