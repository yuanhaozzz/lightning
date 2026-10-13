import parameters from '../../../scripts/blender/protection.parameters.json'
import type { Vec3 } from './layout'

export type ProtectionType = 'air-terminal' | 'air-belt' | 'down-conductor' | 'spd' | 'ground-monitor' | 'earth-section'
export interface ProtectionFacility {
  id: string
  name: string
  type: ProtectionType
  position: Vec3
  rotation: Vec3
  modelPath: string
  schematic: boolean
  buildingId?: string
  cabinetId?: string
  connectedTo?: string
}
export const PROTECTION_FACILITIES = parameters.facilities as ProtectionFacility[]
export const CABINET_INSPECTION = parameters.cabinetInspection
export const GROUND_WINDOW = parameters.groundWindow as { center: [number, number]; size: [number, number] }
