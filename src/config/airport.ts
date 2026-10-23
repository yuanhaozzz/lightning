export type AirportView = 'overview' | 'aircraft' | 'bridge' | 'service'
// All positions are metres, +Y up, +Z aircraft nose; native GLB Y-up, unit scale.
export const airportConfig = {
  assetVersion: '0.2.0',
  assets: [
    { id: 'apron', label: '机坪与地面标线' },
    { id: 'terminal', label: '航站楼' },
    { id: 'aircraft', label: 'A320neo 飞机' },
    { id: 'bridge', label: '登机桥' },
    { id: 'vehicles', label: '保障车辆与轮组' },
  ].map((asset) => ({ ...asset, position: [0, 0, 0] as [number, number, number], rotationY: 0 })),
  camera: {
    fov: 36,
    near: 0.15,
    far: 1200,
    minDistance: 14,
    maxDistance: 105,
    maxPolarAngle: Math.PI / 2 - 0.075,
    minPolarAngle: 0.15,
    // Bounded orbit target; the camera remains above the apron.
    targetBounds: { min: [-22, 1, -22], max: [22, 12, 30] },
  },
  presets: {
    // Starboard front quarter keeps the port-side passenger bridge behind the aircraft.
    overview: { position: [-48, 20, 39], target: [0, 4.4, 0] },
    aircraft: { position: [-24, 11, 36], target: [-1, 3.8, 7] },
    bridge: { position: [12, 10, 32], target: [8, 4, 14] },
    // Covers the complete tractor/trailer swept route without following the vehicle.
    service: { position: [-60, 35, 38], target: [-15, 1.5, 19] },
  } satisfies Record<AirportView, { position: number[]; target: number[] }>,
  sunlight: { position: [-35, 65, 35], intensity: 2.5, shadowExtent: 65 },
  aircraft: {
    length: 37.57,
    wingspan: 35.8,
    height: 11.76,
    fuselageWidth: 3.95,
    portL1Door: [1.96, 4.325, 13.5],
    doorSill: 3.4,
  },
} as const
