import * as C from 'cesium'
import { MINES } from './weather'

export type ResourceState = 'unconfigured' | 'waiting' | 'loading' | 'ready' | 'error'
export interface GeographicStatus {
  terrain: ResourceState
  buildings: ResourceState
  terrainMs: number | null
  buildingsMs: number | null
  modelMemoryMb: number | null
}
export const RESOURCE_LABELS: Record<ResourceState, string> = {
  unconfigured: '未接入',
  waiting: '按需待加载',
  loading: '加载中',
  ready: '已加载',
  error: '失败 · 已降级',
}

/** Only explicitly configured sources are requested. No anonymous Ion token or invented tileset. */
export function createGeographicResources(
  viewer: C.Viewer,
  notify: (status: GeographicStatus) => void,
) {
  const terrainUrl = String(import.meta.env.VITE_TIANJI_TERRAIN_URL ?? '').trim()
  const rawModels = String(import.meta.env.VITE_TIANJI_TILESETS ?? '').trim()
  let modelUrls: Record<string, string> = {},
    invalidModels = false
  try {
    const data: unknown = rawModels ? JSON.parse(rawModels) : {}
    if (!data || typeof data !== 'object' || Array.isArray(data))
      throw new Error('Invalid source map')
    for (const [id, value] of Object.entries(data)) {
      if (!MINES.some((mine) => mine.id === id) || typeof value !== 'string' || !value.trim())
        throw new Error('Invalid mine source')
      const url = new URL(value, window.location.href)
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Invalid source protocol')
      modelUrls[id] = url.href
    }
  } catch {
    invalidModels = true
    modelUrls = {}
  }
  const state: GeographicStatus = {
    terrain: terrainUrl ? 'waiting' : 'unconfigured',
    buildings: invalidModels ? 'error' : 'unconfigured',
    terrainMs: null,
    buildingsMs: null,
    modelMemoryMb: null,
  }
  let disposed = false,
    revision = 0,
    selectedId = '',
    active: C.Cesium3DTileset | null = null
  let near = false,
    terrainDeadline = 0,
    modelDeadline = 0
  let terrainStarted = 0,
    terrainAttached = false
  const failed = new Set<string>()
  const removers: (() => void)[] = [],
    modelRemovers: (() => void)[] = []
  const emit = () => {
    if (!disposed) notify({ ...state })
  }
  const releaseModel = () => {
    modelRemovers.splice(0).forEach((remove) => remove())
    clearTimeout(modelDeadline)
    if (active && !viewer.isDestroyed()) viewer.scene.primitives.remove(active)
    active = null
    state.modelMemoryMb = null
  }
  const terrainFailed = () => {
    if (disposed || state.terrain === 'error') return
    clearTimeout(terrainDeadline)
    state.terrain = 'error'
    viewer.terrainProvider = new C.EllipsoidTerrainProvider()
    emit()
    viewer.scene.requestRender()
  }
  async function loadTerrain() {
    state.terrain = 'loading'
    terrainStarted = performance.now()
    emit()
    terrainDeadline = window.setTimeout(terrainFailed, 45000)
    try {
      const url = new URL(terrainUrl, window.location.href)
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Invalid terrain source')
      const provider = await C.CesiumTerrainProvider.fromUrl(url.href, {
        requestVertexNormals: true,
      })
      if (disposed || state.terrain !== 'loading') return
      removers.push(provider.errorEvent.addEventListener(terrainFailed))
      viewer.terrainProvider = provider
      terrainAttached = true
      viewer.scene.requestRender()
    } catch {
      terrainFailed()
    }
  }
  removers.push(
    viewer.scene.globe.tileLoadProgressEvent.addEventListener((pending: number) => {
      if (!disposed && terrainAttached && state.terrain === 'loading' && pending === 0) {
        clearTimeout(terrainDeadline)
        state.terrain = 'ready'
        state.terrainMs = performance.now() - terrainStarted
        emit()
      }
    }),
  )
  async function loadModel(id: string, url: string) {
    const run = ++revision,
      start = performance.now()
    state.buildings = 'loading'
    state.buildingsMs = null
    emit()
    const failure = () => {
      if (disposed || run !== revision) return
      failed.add(id)
      revision++
      releaseModel()
      state.buildings = 'error'
      emit()
      viewer.scene.requestRender()
    }
    modelDeadline = window.setTimeout(failure, 45000)
    try {
      const tileset = await C.Cesium3DTileset.fromUrl(url, {
        maximumScreenSpaceError: 12,
        cacheBytes: 96 * 1048576,
        maximumCacheOverflowBytes: 24 * 1048576,
        dynamicScreenSpaceError: true,
        foveatedScreenSpaceError: true,
      })
      if (disposed || run !== revision) {
        tileset.destroy()
        return
      }
      active = viewer.scene.primitives.add(tileset) as C.Cesium3DTileset
      active.show = near
      modelRemovers.push(
        tileset.initialTilesLoaded.addEventListener(() => {
          if (disposed || run !== revision) return
          clearTimeout(modelDeadline)
          state.buildings = 'ready'
          state.buildingsMs = performance.now() - start
          emit()
        }),
      )
      modelRemovers.push(tileset.tileFailed.addEventListener(failure))
      viewer.scene.requestRender()
    } catch {
      failure()
    }
  }
  emit()
  return {
    update(id: string | undefined, visible: boolean) {
      if (disposed) return
      const height = viewer.camera.positionCartographic.height
      const mine = MINES.find((item) => item.id === id)
      const targetDistance = mine ? C.Cartesian3.distance(viewer.camera.positionWC,
        C.Cartesian3.fromDegrees(...mine.center)) : Infinity
      near = visible && height < 850000 && targetDistance < 1200000
      if (terrainUrl && height < 1600000 && state.terrain === 'waiting') void loadTerrain()
      if ((id ?? '') !== selectedId) {
        selectedId = id ?? ''
        revision++
        releaseModel()
        state.buildings =
          invalidModels || failed.has(selectedId)
            ? 'error'
            : modelUrls[selectedId]
              ? 'waiting'
              : 'unconfigured'
        state.buildingsMs = null
        emit()
      }
      if (near && state.buildings === 'waiting' && modelUrls[selectedId])
        void loadModel(selectedId, modelUrls[selectedId]!)
      if (!near && state.buildings === 'loading') {
        revision++
        releaseModel()
        state.buildings = 'waiting'
        emit()
      }
      if (active) {
        active.show = near
        active.maximumScreenSpaceError = height < 30000 ? 4 : height < 150000 ? 8 : 16
        state.modelMemoryMb = Math.round(active.totalMemoryUsageInBytes / 1048576)
      }
      viewer.scene.globe.maximumScreenSpaceError = height < 200000 ? 1.8 : 3
    },
    snapshot: () => ({ ...state }),
    dispose() {
      disposed = true
      revision++
      clearTimeout(terrainDeadline)
      releaseModel()
      removers.splice(0).forEach((remove) => remove())
    },
  }
}
