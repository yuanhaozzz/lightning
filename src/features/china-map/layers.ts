import type { LayerSpecification, Map } from 'maplibre-gl'

export const SOURCE = {
  china: 'china-focus',
  detail: 'china-province-detail',
  imagery: 'tianditu-imagery',
} as const
export const LAYER = {
  imagery: 'tianditu-imagery',
  outsideMask: 'china-outside-mask',
  fill: 'china-fill',
  provinceUnderlay: 'china-province-lines-underlay',
  province: 'china-province-lines',
  provinceLabel: 'china-province-labels',
  glowWide: 'china-border-glow-wide',
  glow: 'china-border-glow',
  border: 'china-border-main',
  highlight: 'china-border-highlight',
  accent: 'china-border-accent',
  southGlow: 'china-south-sea-glow',
  south: 'china-south-sea-main',
  southHighlight: 'china-south-sea-highlight',
  southAccent: 'china-south-sea-accent',
  southLabel: 'china-south-sea-label',
} as const

const provinceFilter = ['==', ['get', 'kind'], 'province'] as any
const provinceLabelFilter = ['==', ['get', 'kind'], 'province-label'] as any
const boundaryFilter = ['==', ['get', 'kind'], 'china-outline'] as any
const southSeaFilter = ['==', ['get', 'kind'], 'south-sea'] as any
const southSeaLabelFilter = ['==', ['get', 'kind'], 'south-sea-label'] as any
const outsideMaskFilter = ['==', ['get', 'kind'], 'outside-mask'] as any

export const chinaLayers: LayerSpecification[] = [
  {
    id: LAYER.outsideMask,
    type: 'fill',
    source: SOURCE.china,
    filter: outsideMaskFilter,
    paint: {
      // Cool the countries outside China with a deeper sky-blue veil while
      // retaining enough satellite texture to keep the surrounding geography
      // recognisable. The tint eases back as users zoom in for local detail.
      'fill-color': '#1688c7',
      'fill-opacity': ['interpolate', ['linear'], ['zoom'], 2, 0.26, 6, 0.20, 9, 0.12],
    },
  },
  {
    id: LAYER.fill,
    type: 'fill',
    source: SOURCE.detail,
    filter: provinceFilter,
    paint: {
      'fill-color': '#4a7898',
      'fill-opacity': 0,
      'fill-opacity-transition': { duration: 420, delay: 0 },
    },
  },
  {
    id: LAYER.provinceUnderlay,
    type: 'line',
    source: SOURCE.detail,
    filter: provinceFilter,
    paint: {
      'line-color': '#263438',
      'line-opacity': 0,
      'line-width': ['interpolate', ['linear'], ['zoom'], 2, 0.7, 5, 1.15, 8, 1.45],
      'line-blur': 0.55,
      'line-opacity-transition': { duration: 480, delay: 20 },
    },
  },
  {
    id: LAYER.province,
    type: 'line',
    source: SOURCE.detail,
    filter: provinceFilter,
    paint: {
      'line-color': '#f7efe2',
      'line-opacity': 0,
      'line-width': ['interpolate', ['linear'], ['zoom'], 2, 0.32, 5, 0.58, 8, 0.78],
      'line-opacity-transition': { duration: 480, delay: 40 },
    },
  },
  {
    id: LAYER.provinceLabel,
    type: 'symbol',
    source: SOURCE.detail,
    filter: provinceLabelFilter,
    minzoom: 2.35,
    layout: {
      'text-field': ['get', 'displayName'],
      'text-font': ['Noto Serif CJK SC', 'Source Han Serif SC', 'Microsoft YaHei'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 2.35, 10.5, 4.5, 13, 7, 15],
      'text-letter-spacing': 0.16,
      'text-max-width': 7,
      'text-padding': 10,
      'text-allow-overlap': false,
      'text-ignore-placement': false,
      'text-optional': true,
    },
    paint: {
      'text-color': '#342d26',
      'text-opacity': 0,
      'text-halo-color': 'rgba(255, 252, 242, 0.96)',
      'text-halo-width': 1.5,
      'text-halo-blur': 0.35,
      'text-opacity-transition': { duration: 520, delay: 100 },
    },
  },
  {
    id: LAYER.glowWide,
    type: 'line',
    source: SOURCE.china,
    filter: boundaryFilter,
    paint: {
      'line-color': '#4aa8d8',
      'line-opacity': 0,
      'line-width': ['interpolate', ['linear'], ['zoom'], 2, 7, 6, 9],
      'line-blur': 5,
      'line-opacity-transition': { duration: 600, delay: 0 },
    },
  },
  {
    id: LAYER.glow,
    type: 'line',
    source: SOURCE.china,
    filter: boundaryFilter,
    paint: {
      'line-color': '#4aa8d8',
      'line-opacity': 0,
      'line-width': ['interpolate', ['linear'], ['zoom'], 2, 3.2, 6, 4.2],
      'line-blur': 2.2,
      'line-opacity-transition': { duration: 520, delay: 80 },
    },
  },
  {
    id: LAYER.border,
    type: 'line',
    source: SOURCE.china,
    filter: boundaryFilter,
    paint: {
      'line-color': '#91cae5',
      'line-opacity': 0,
      'line-width': ['interpolate', ['linear'], ['zoom'], 2, 1.05, 6, 1.4],
      'line-blur': 0.2,
      'line-opacity-transition': { duration: 420, delay: 140 },
    },
  },
  {
    id: LAYER.highlight,
    type: 'line',
    source: SOURCE.china,
    filter: boundaryFilter,
    paint: {
      'line-color': '#c8e9f6',
      'line-opacity': 0,
      'line-width': ['interpolate', ['linear'], ['zoom'], 2, 0.38, 6, 0.58],
      'line-blur': 0.15,
      'line-opacity-transition': { duration: 420, delay: 190 },
    },
  },
  {
    id: LAYER.accent,
    type: 'line',
    source: SOURCE.china,
    filter: boundaryFilter,
    paint: {
      'line-color': '#4aa8d8',
      'line-opacity': 0,
      'line-width': ['interpolate', ['linear'], ['zoom'], 2, 0.24, 6, 0.36],
      'line-blur': 0.1,
      'line-opacity-transition': { duration: 420, delay: 210 },
    },
  },
  {
    id: LAYER.southGlow,
    type: 'line',
    source: SOURCE.china,
    filter: southSeaFilter,
    paint: {
      'line-color': '#4aa8d8',
      'line-opacity': 0,
      'line-width': ['interpolate', ['linear'], ['zoom'], 2, 6, 5, 5],
      'line-blur': 3.2,
      'line-opacity-transition': { duration: 520, delay: 60 },
    },
  },
  {
    id: LAYER.south,
    type: 'line',
    source: SOURCE.china,
    filter: southSeaFilter,
    paint: {
      'line-color': '#91cae5',
      'line-opacity': 0,
      'line-width': ['interpolate', ['linear'], ['zoom'], 2, 1.55, 5, 1.25],
      'line-blur': 0.2,
      'line-opacity-transition': { duration: 420, delay: 140 },
    },
  },
  {
    id: LAYER.southHighlight,
    type: 'line',
    source: SOURCE.china,
    filter: southSeaFilter,
    paint: {
      'line-color': '#c8e9f6',
      'line-opacity': 0,
      'line-width': ['interpolate', ['linear'], ['zoom'], 2, 0.72, 5, 0.58],
      'line-blur': 0.65,
      'line-opacity-transition': { duration: 420, delay: 190 },
    },
  },
  {
    id: LAYER.southAccent,
    type: 'line',
    source: SOURCE.china,
    filter: southSeaFilter,
    paint: {
      'line-color': '#4aa8d8',
      'line-opacity': 0,
      'line-width': 0.4,
      'line-opacity-transition': { duration: 420, delay: 210 },
    },
  },
  {
    id: LAYER.southLabel,
    type: 'symbol',
    source: SOURCE.china,
    filter: southSeaLabelFilter,
    maxzoom: 5.8,
    layout: {
      'text-field': ['get', 'displayName'],
      'text-font': ['Noto Serif CJK SC', 'Source Han Serif SC', 'Microsoft YaHei'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 2, 11, 4.8, 13],
      'text-letter-spacing': .18,
      'text-allow-overlap': true,
      'text-ignore-placement': true,
    },
    paint: {
      'text-color': '#f7e8d7',
      'text-opacity': 0,
      'text-halo-color': 'rgba(52,42,36,.92)',
      'text-halo-width': 1.8,
      'text-halo-blur': .45,
      'text-opacity-transition': { duration: 520, delay: 180 },
    },
  },
]

export function addChinaLayers(map: Map) {
  chinaLayers.forEach((layer) => map.addLayer(layer))
}

export function keepChinaLayersOnTop(map: Map) {
  chinaLayers.forEach(({ id }) => map.getLayer(id) && map.moveLayer(id))
}

export function revealSkeleton(map: Map) {
  map.setPaintProperty(LAYER.fill, 'fill-opacity', 0.055)
  map.setPaintProperty(LAYER.provinceUnderlay, 'line-opacity', 0.18)
  map.setPaintProperty(LAYER.province, 'line-opacity', 0.36)
  map.setPaintProperty(LAYER.provinceLabel, 'text-opacity', 0.65)
}

export function revealNationalFocus(map: Map) {
  map.setPaintProperty(LAYER.glowWide, 'line-opacity', 0.14)
  map.setPaintProperty(LAYER.glow, 'line-opacity', 0.25)
  map.setPaintProperty(LAYER.border, 'line-opacity', 0.65)
  map.setPaintProperty(LAYER.highlight, 'line-opacity', 0.46)
  map.setPaintProperty(LAYER.accent, 'line-opacity', 0.3)
  map.setPaintProperty(LAYER.southGlow, 'line-opacity', 0.18)
  map.setPaintProperty(LAYER.south, 'line-opacity', 0.68)
  map.setPaintProperty(LAYER.southHighlight, 'line-opacity', 0.48)
  map.setPaintProperty(LAYER.southAccent, 'line-opacity', 0.34)
  map.setPaintProperty(LAYER.southLabel, 'text-opacity', 0.92)
}
