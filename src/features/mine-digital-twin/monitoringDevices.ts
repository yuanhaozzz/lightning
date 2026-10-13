import parameters from '../../../scripts/blender/monitoring.parameters.json'
import type { Vec3 } from './layout'

export type MonitoringType = 'lightning-locator' | 'storm-warning'
export interface MonitoringDevice {
  id: string
  name: string
  type: MonitoringType
  position: Vec3
  rotation: Vec3
  modelPath: string
  status: 'simulated-online'
  schematic: boolean
  monitoringData: { source: string; timestamp: string | null; [key: string]: unknown }
}
// The shared JSON is the deployment source; GLBs remain reusable local assets.
export const MONITORING_DEVICES: MonitoringDevice[] = parameters.devices.map(device => ({ ...device,
  type: device.type as MonitoringType, position: device.position as Vec3, rotation: device.rotation as Vec3,
  status: device.status as MonitoringDevice['status'],
}))
