<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef, type Component } from 'vue'

withDefaults(defineProps<{ active?: boolean; progress?: number; explorable?: boolean }>(), {
  active: false,
  progress: 0,
  explorable: false,
})
const emit = defineEmits<{ ready: []; unsupported: [] }>()
const scene = shallowRef<Component>()
const failed = ref(false)
let disposed = false
let paintFrame = 0

onMounted(() => {
  // Leave a paint opportunity for copy and controls, including on a warm cache.
  paintFrame = requestAnimationFrame(() => {
    paintFrame = requestAnimationFrame(() => {
      void import('./ProcessorScene.vue')
        .then((module) => {
          if (!disposed) scene.value = module.default
        })
        .catch(() => {
          if (!disposed) {
            failed.value = true
            emit('unsupported')
          }
        })
    })
  })
})
onBeforeUnmount(() => {
  disposed = true
  cancelAnimationFrame(paintFrame)
})
</script>

<template>
  <component
    v-if="scene"
    :is="scene"
    :active="active"
    :progress="progress"
    :explorable="explorable"
    @ready="emit('ready')"
    @unsupported="emit('unsupported')"
  />
  <div
    v-else
    class="processor-placeholder"
    :aria-busy="!failed"
    role="img"
    aria-label="AMD Ryzen 处理器"
  >
    <div class="placeholder-board" aria-hidden="true">
      <div class="placeholder-chip">
        <span>AMD</span><strong>RYZEN</strong><small>9000 SERIES</small>
      </div>
    </div>
    <p v-if="failed">三维视图暂不可用，您仍可继续浏览产品。</p>
  </div>
</template>

<style scoped>
.processor-placeholder {
  height: 100%;
  min-height: 280px;
  width: 100%;
  position: relative;
  display: grid;
  place-items: center;
  perspective: 900px;
}
.placeholder-board {
  width: 63%;
  max-width: 490px;
  aspect-ratio: 1;
  display: grid;
  place-items: center;
  transform: rotateX(42deg) rotateZ(-24deg);
  background:
    repeating-linear-gradient(0deg, transparent 0 20px, #d7632920 21px 22px),
    repeating-linear-gradient(90deg, #1a2021 0 20px, #d7632930 21px 22px);
  border: 1px solid #655d52;
  box-shadow:
    9px 14px 0 #111719,
    0 0 65px #ff601c19;
}
.placeholder-chip {
  width: 68%;
  height: 68%;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  background: linear-gradient(135deg, #d2d3d2, #9fabae 48%, #dedfda);
  border: 3px solid #b6beb7;
  box-shadow:
    7px 8px 0 #535c56,
    10px 12px 0 #1f2b26;
  color: #343c3c;
}
.placeholder-chip > span {
  font:
    700 clamp(13px, 2vw, 24px) 'Barlow',
    sans-serif;
}
.placeholder-chip > strong {
  font:
    600 clamp(26px, 4vw, 55px) 'Barlow Condensed',
    sans-serif;
  letter-spacing: 4px;
}
.placeholder-chip > small {
  font:
    11px 'Barlow',
    sans-serif;
  letter-spacing: 2px;
}
.processor-placeholder > p {
  position: absolute;
  bottom: 25px;
  left: 15%;
  right: 15%;
  text-align: center;
  color: #9b9184;
  font-size: 12px;
}
</style>
