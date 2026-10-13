/** Simulation data only. No measured readings or external API calls. */
export const DEMO_SOURCE = '演示数据' as const
export type DemoDeviceStatus = 'normal' | 'warning' | 'fault'
export const DEMO_STATUS_NAMES: Record<DemoDeviceStatus, string> = {
  normal: '正常', warning: '预警', fault: '异常',
}
export interface DemoDeviceIdentity {
  id: string
  name: string
  type: string
}
export interface DemoDeviceReading extends DemoDeviceIdentity {
  source: typeof DEMO_SOURCE
  status: DemoDeviceStatus
  simulatedAt: string | null
  warningAt: string | null
  monitoringData: {
    lightningEvent: { id: string; position: [number, number, number]; occurredAt: string } | null
    groundResistanceOhm: number | null
  }
}
export function createDemoReadings(identities: readonly DemoDeviceIdentity[]): DemoDeviceReading[] {
  if (new Set(identities.map(device => device.id)).size !== identities.length) {
    throw new Error('模拟设备 ID 重复')
  }
  return identities.map(device => ({
    ...device, source: DEMO_SOURCE, status: 'normal', simulatedAt: null, warningAt: null,
    monitoringData: { lightningEvent: null, groundResistanceOhm: null },
  }))
}
