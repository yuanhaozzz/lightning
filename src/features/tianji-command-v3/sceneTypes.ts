import type { CommandAnalysis, MineFilter } from './commandAnalysis'
import type { CommandLayer, CommandScope } from './commandDemo'
import type { WeatherMode } from './weather'
import type { GeographicStatus } from './geographicResources'

export type DemoState =
  | 'INITIALIZING'
  | 'OVERVIEW'
  | 'TARGET_LOCKED'
  | 'FLYING'
  | 'MEASURING'
  | 'INTERACTIVE'
  | 'INTERRUPTED'
  | 'ERROR'
export type ViewLevel = 'national' | 'regional' | 'local'
export interface DemoStatus {
  state: DemoState
  title: string
  detail: string
  step: number
}
export interface ScreenAnchor {
  id: string
  x: number
  y: number
  visible: boolean
  bounds?: { x: number; y: number; width: number; height: number }
}
export interface SafeInsets {
  left: number
  right: number
  top: number
  bottom: number
}
export interface SceneTelemetry {
  fps: number
  initMs: number
  interactiveMs: number | null
  flightMs: number | null
  heapMb: number | null
  primitives: number
  cloudPrimitives: number
  heapDeltaMb: number | null
  quality: 'standard' | 'economy'
  geography: GeographicStatus
}
export interface CommandScene {
  start(): void
  interrupt(): void
  skip(): void
  setMode(mode: WeatherMode): void
  setLayer(layer: CommandLayer, visible: boolean): void
  setTime(minute: number): void
  setScope(scope: CommandScope): void
  setAnalysis(analysis: CommandAnalysis, focus?: boolean, restart?: boolean): void
  setMineFilter(filter: MineFilter): void
  setView(flat: boolean): void
  zoom(direction: number): void
  reset(): void
  replay(): void
  reframe(): void
  dispose(): void
}
export interface SceneOptions {
  signal: AbortSignal
  onPhase(phase: number): void
  onAnchors(anchors: ScreenAnchor[]): void
  onAnalysisProgress(progress: number): void
  onStatus(status: DemoStatus): void
  onError(message: string): void
  onPick(kind: 'storm' | 'mine', id: string): void
  onScope(scope: CommandScope): void
  onTelemetry(value: SceneTelemetry): void
  onSource(value: string): void
  onHeading(degrees: number): void
  onViewLevel(level: ViewLevel): void
  onGeography(value: GeographicStatus): void
  getSafeInsets(): SafeInsets
}
