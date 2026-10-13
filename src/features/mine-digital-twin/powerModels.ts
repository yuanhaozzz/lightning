import parameters from '../../../scripts/blender/power_area.parameters.json'
import type { SiteAsset, Vec3 } from './layout'

// Resource overlay preserves phase-2 anchors and all other region configuration.
export const POWER_MODELS: Record<string, Pick<SiteAsset, 'modelPath' | 'modelScale' | 'preserveModelOrigin'>> = {
  'substation-01': { modelPath: 'models/mine-substation.glb', modelScale: 1, preserveModelOrigin: true },
  'distribution-01': { modelPath: 'models/mine-distribution-shell.glb', modelScale: 1, preserveModelOrigin: true },
}
export const POWER_ROOM_PARTS = [
  { id: 'distribution-roof', modelPath: 'models/mine-distribution-roof.glb' },
  { id: 'distribution-equipment', modelPath: 'models/mine-distribution-equipment.glb' },
]
export const POWER_RESERVES = parameters.reserves.map(reserve => ({ ...reserve,
  position: reserve.position as Vec3, size: reserve.size as Vec3,
}))
export interface PowerSelection { id: string; name: string; kind: string; parentId?: string }
