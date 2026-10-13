import type { DemoPhase, DemoPlayback } from './stormDemo'

export interface CloudClock { phase: DemoPhase; playback: DemoPlayback; elapsedMs: number; runId: string | null; durationMs: number }
// Horizontal extent, base and crown are independent demonstration parameters.
export const CLOUD_PROFILE = { spanX: 310, spanZ: 220, baseY: 32, topY: 104 }
export const CLOUD_SIZE: [number, number, number] = [CLOUD_PROFILE.spanX, CLOUD_PROFILE.topY - CLOUD_PROFILE.baseY, CLOUD_PROFILE.spanZ]
export const CLOUD_FROM: [number, number, number] = [-48, (CLOUD_PROFILE.baseY + CLOUD_PROFILE.topY) / 2, -95]
export const CLOUD_TO: [number, number, number] = [-12, CLOUD_FROM[1], -55]
export const CLOUD_FADE_OUT_MS = 1600
const smooth = (value: number) => { const t = Math.max(0, Math.min(1, value)); return t * t * (3 - 2 * t) }
export function cloudAtTimeline(clock: CloudClock) {
  const warningSeconds = Math.max(0, (clock.elapsedMs - 5000) / 1000)
  const approach = Math.min(1, warningSeconds / Math.max(1, (clock.durationMs - 5000) / 1000))
  return {
    position: CLOUD_FROM.map((value, index) => value + (CLOUD_TO[index]! - value) * approach) as [number, number, number],
    opacity: clock.phase === 'warning' && clock.playback !== 'idle' ? smooth(warningSeconds / 4) : 0,
  }
}

/** Warning motion uses only demo time; the explicit exit transition gets a bounded fade tail. */
export function createCloudMotion() {
  let runId: string | null = null
  let opacity = 0
  let position: [number, number, number] = [...CLOUD_FROM]
  let idle = true
  let fadeFrom = 0
  let fadeElapsed = 0
  return {
    get frame() { return { opacity, position: [...position] as [number, number, number], visible: opacity > .0001 } },
    update(clock: CloudClock, deltaMs: number) {
      const before = `${opacity},${position.join(',')}`
      if (clock.runId !== null) {
        if (clock.runId !== runId) { opacity = 0; position = [...CLOUD_FROM] }
        runId = clock.runId; idle = false; fadeElapsed = 0
        const next = cloudAtTimeline(clock)
        opacity = next.opacity; position = next.position
      } else {
        if (!idle) { idle = true; fadeFrom = opacity; fadeElapsed = 0 }
        if (opacity > 0) {
          fadeElapsed += Number.isFinite(deltaMs) ? Math.max(0, deltaMs) : 0
          opacity = fadeFrom * (1 - smooth(fadeElapsed / CLOUD_FADE_OUT_MS))
          if (fadeElapsed >= CLOUD_FADE_OUT_MS) opacity = 0
        }
        runId = null
      }
      return before !== `${opacity},${position.join(',')}`
    },
  }
}
