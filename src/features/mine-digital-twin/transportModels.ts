import type { SiteAsset } from './layout'

// Resource replacement only. layout.ts remains the original placement source.
export const TRANSPORT_MODELS: Record<string, Pick<SiteAsset, 'modelPath' | 'modelScale' | 'preserveModelOrigin'>> = {
  'transfer-01': { modelPath: 'models/mine-transfer-station.glb', modelScale: 1, preserveModelOrigin: true },
  'coal-silo-01': { modelPath: 'models/mine-coal-silo-1.glb', modelScale: 1, preserveModelOrigin: true },
  'coal-silo-02': { modelPath: 'models/mine-coal-silo-2.glb', modelScale: 1, preserveModelOrigin: true },
}

// Detailed conveyors have world-space anchors derived from CONVEYORS.
export const TRANSPORT_CONVEYORS = {
  id: 'coal-transport-conveyors',
  modelPath: 'models/mine-coal-conveyors.glb',
}
