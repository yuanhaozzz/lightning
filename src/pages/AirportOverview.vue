<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import AirportTopbar from '../components/airport/AirportTopbar.vue'
import AirportFlightPanel from '../components/airport/AirportFlightPanel.vue'
import AirportSupportPanel from '../components/airport/AirportSupportPanel.vue'
import AirportTaskPanel from '../components/airport/AirportTaskPanel.vue'
import AirportToolbar from '../components/airport/AirportToolbar.vue'
import { createAirportScene } from '../three/airport/createAirportScene'
import type { AirportView } from '../config/airport'
import type { TaskSnapshot } from '../three/airport/simulation'

const sceneContainer = ref<HTMLDivElement | null>(null)
const mode = ref<'overview' | 'operations'>('overview')
const activeView = ref<AirportView | 'custom'>('overview')
const task = shallowRef<TaskSnapshot | null>(null)
const panelsVisible = ref(true)
const loading = ref(true)
const loadingStep = ref('准备三维场景')
const errorMessage = ref('')

// The renderer and model graph deliberately stay outside Vue's reactive tree.
let airportScene: ReturnType<typeof createAirportScene> | undefined
let disposed = false

function changeView(view: AirportView) {
  airportScene?.setView(view)
}

function resetView() {
  airportScene?.reset()
}

function retryLoad() {
  errorMessage.value = ''
  loading.value = true
  loadingStep.value = '重新加载场景资源'
  if (airportScene) airportScene.retry()
  else initializeScene()
}

function initializeScene() {
  if (!sceneContainer.value || disposed) return
  try {
    airportScene = createAirportScene(sceneContainer.value, {
      calibration: new URLSearchParams(window.location.search).get('calibration') === '1',
      onProgress: (step) => {
        if (!disposed) loadingStep.value = step
      },
      onReady: () => {
        if (disposed) return
        loading.value = false
        errorMessage.value = ''
      },
      onError: (message) => {
        if (disposed) return
        loading.value = false
        errorMessage.value = message
      },
      onPresetChange: (preset) => {
        if (!disposed) activeView.value = preset
      },
      onTaskChange: (snapshot) => {
        if (!disposed) task.value = snapshot
      },
    })
  } catch (error) {
    loading.value = false
    errorMessage.value = error instanceof Error ? error.message : '三维场景暂时无法启动，请重试。'
  }
}

onMounted(initializeScene)
onBeforeUnmount(() => {
  disposed = true
  airportScene?.dispose()
  airportScene = undefined
})
</script>

<template>
  <main class="aerotwin" aria-label="AEROTWIN 机场地面保障 · A21 近机位">
    <div
      ref="sceneContainer"
      class="airport-scene"
      aria-label="A21 近机位三维场景，可用鼠标拖动旋转、滚轮缩放、右键拖动平移"
    />
    <div
      class="airport-interface"
      @pointerdown.stop
      @pointerup.stop
      @click.stop
      @dblclick.stop
      @wheel.stop
      @contextmenu.stop
    >
      <AirportTopbar :mode="mode" @change-mode="mode = $event" />
      <Transition name="airport-panel"
        ><div v-if="panelsVisible" class="airport-panel-position airport-panel-left">
          <AirportFlightPanel /></div
      ></Transition>
      <Transition name="airport-panel"
        ><div v-if="panelsVisible" class="airport-panel-position airport-panel-right">
          <AirportSupportPanel v-if="mode === 'overview'" />
          <AirportTaskPanel
            v-else
            :task="task"
            :disabled="loading || !!errorMessage"
            @start="airportScene?.taskStart()"
            @pause="airportScene?.taskPause()"
            @resume="airportScene?.taskResume()"
            @reset="airportScene?.taskReset()"
          /></div
      ></Transition>
      <AirportToolbar
        :active-view="activeView"
        :panels-visible="panelsVisible"
        :disabled="loading || !!errorMessage"
        @view="changeView"
        @reset="resetView"
        @toggle-panels="panelsVisible = !panelsVisible"
      />
      <div v-if="loading || errorMessage" class="airport-loading-position">
        <section
          class="airport-loading-card"
          :class="{ 'has-error': !!errorMessage }"
          :role="errorMessage ? 'alert' : 'status'"
          aria-live="polite"
        >
          <template v-if="errorMessage"
            ><span class="airport-error-symbol" aria-hidden="true">!</span>
            <h2>场景暂时无法加载</h2>
            <p>{{ errorMessage }}</p>
            <button type="button" class="airport-retry-button" @click="retryLoad">
              重新加载
            </button></template
          >
          <template v-else
            ><span class="airport-loading-spinner" aria-hidden="true" />
            <h2>正在准备 A21 近机位</h2>
            <p>{{ loadingStep }}</p></template
          >
        </section>
      </div>
    </div>
  </main>
</template>

<style scoped>
.aerotwin {
  position: fixed;
  inset: 0;
  z-index: 1;
  width: 100%;
  height: 100%;
  height: 100dvh;
  margin: 0;
  padding: 0;
  overflow: hidden;
  isolation: isolate;
  background: #d1e0e9;
  color: #152b4a;
  font-family:
    Inter,
    -apple-system,
    BlinkMacSystemFont,
    'Segoe UI',
    'Microsoft YaHei',
    'PingFang SC',
    sans-serif;
  font-size: 14px;
  font-weight: 400;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}
.aerotwin :deep(*) {
  box-sizing: border-box;
}
.aerotwin :deep(button) {
  font-family: inherit;
  -webkit-tap-highlight-color: transparent;
}
.airport-scene {
  position: absolute;
  inset: 64px 0 0;
  overflow: hidden;
  touch-action: none;
}
.airport-scene :deep(canvas) {
  display: block;
  width: 100%;
  height: 100%;
  outline: none;
}
.airport-interface {
  position: absolute;
  z-index: 2;
  inset: 0;
  pointer-events: none;
}
.airport-interface > :deep(*) {
  pointer-events: auto;
}
.airport-panel-position {
  position: absolute;
  top: 88px;
}
.airport-panel-left {
  left: 28px;
}
.airport-panel-right {
  right: 28px;
}
.airport-panel-enter-active,
.airport-panel-leave-active {
  transition:
    opacity 0.18s ease,
    transform 0.18s ease;
}
.airport-panel-enter-from,
.airport-panel-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}
.airport-loading-position {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  max-width: calc(100% - 48px);
}
.airport-loading-card {
  width: 340px;
  max-width: 100%;
  padding: 28px 25px;
  border: 1px solid #ffffffb3;
  border-radius: 14px;
  background: #ffffffeb;
  text-align: center;
  backdrop-filter: blur(18px);
  box-shadow: 0 12px 40px #253e5d1a;
}
.airport-loading-card h2 {
  margin: 14px 0 7px;
  font-size: 16px;
  font-weight: 600;
  color: #152b4a;
}
.airport-loading-card p {
  margin: 0;
  color: #65758b;
  font-size: 13px;
  line-height: 1.7;
  overflow-wrap: anywhere;
}
.airport-loading-spinner {
  display: inline-block;
  width: 26px;
  height: 26px;
  border: 2px solid #dfe8f3;
  border-top-color: #3478f6;
  border-radius: 50%;
  animation: airport-loading 1s linear infinite;
}
.airport-error-symbol {
  display: inline-grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border: 1px solid #b9945d;
  border-radius: 50%;
  color: #967441;
  font-size: 19px;
}
.airport-retry-button {
  height: 38px;
  margin: 20px 0 0;
  padding: 0 22px;
  border: 0;
  border-radius: 8px;
  background: #3478f6;
  color: #fff;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
}
.airport-retry-button:hover {
  background: #286be8;
}
.airport-retry-button:focus-visible {
  outline: 2px solid #152b4a;
  outline-offset: 3px;
}
@keyframes airport-loading {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .airport-panel-enter-active,
  .airport-panel-leave-active {
    transition: none;
  }
}
@media (max-width: 700px) {
  .airport-panel-position {
    top: 80px;
  }
  .airport-panel-left {
    left: 14px;
  }
  .airport-panel-right {
    right: 14px;
  }
}
@media (max-width: 480px) {
  .airport-panel-right {
    top: 321px;
  }
  .airport-panel-right :deep(.airport-support-panel) {
    width: 194px;
    padding: 12px 15px;
  }
  .airport-panel-right :deep(.airport-support-details) {
    gap: 8px;
    margin: 10px 0;
  }
  .airport-panel-right :deep(h2) {
    padding-bottom: 9px;
  }
  .airport-panel-right :deep(.airport-support-note) {
    padding-top: 9px;
  }
}
</style>
