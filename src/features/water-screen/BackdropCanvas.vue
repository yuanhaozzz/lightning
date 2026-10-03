<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'

const host = ref<HTMLCanvasElement>()
let frame = 0
let observer: IntersectionObserver | undefined

/**
 * 底部粒子波场：一组按透视排布的网格点，用多频正弦叠加成起伏的“数据地貌”。
 * 远景点密、近景点疏，配合连线形成参考图中的网状波面。
 */
function paint(canvas: HTMLCanvasElement, time: number) {
  const context = canvas.getContext('2d')
  if (!context) return
  const ratio = Math.min(window.devicePixelRatio || 1, 2)
  const width = canvas.clientWidth
  const height = canvas.clientHeight
  if (!width || !height) return
  if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
    canvas.width = Math.round(width * ratio)
    canvas.height = Math.round(height * ratio)
  }
  context.setTransform(ratio, 0, 0, ratio, 0, 0)
  context.clearRect(0, 0, width, height)

  const rows = 30
  const horizon = height * 0.58
  const depth = height * 0.46

  for (let row = 0; row < rows; row += 1) {
    const t = row / (rows - 1)
    const spacing = 16 + t * t * 62
    const baseY = horizon + Math.pow(t, 1.22) * depth
    const amplitude = (4 + t * 22) * (0.35 + 0.65 * t)
    const alpha = Math.pow(t, 1.5) * 0.5

    const points: { x: number; y: number }[] = []
    for (let x = -80; x <= width + 80; x += spacing) {
      const wave =
        Math.sin(x * 0.0034 + time * 0.00042 + t * 3.1) * amplitude +
        Math.sin(x * 0.0089 - time * 0.00072 + t * 1.7) * amplitude * 0.42 +
        Math.sin(x * 0.0016 + time * 0.00024 - t * 2.2) * amplitude * 0.7
      points.push({ x, y: baseY + wave })
    }

    context.lineWidth = 0.6
    context.strokeStyle = `rgba(64, 176, 255, ${alpha * 0.42})`
    context.beginPath()
    for (let index = 1; index < points.length; index += 1) {
      const previous = points[index - 1]!
      const current = points[index]!
      if (previous.y > height || previous.y < 0) continue
      context.moveTo(previous.x, previous.y)
      context.lineTo(current.x, current.y)
    }
    context.stroke()

    for (const point of points) {
      if (point.y > height + 4 || point.y < -4) continue
      const crest = Math.max(0, (baseY - point.y) / (amplitude * 2.1))
      const glow = 0.32 + Math.min(0.68, crest)
      const size = 0.7 + t * 1.5
      context.beginPath()
      context.arc(point.x, point.y, size, 0, Math.PI * 2)
      context.fillStyle = `rgba(${120 + crest * 90}, ${218 + crest * 30}, 255, ${alpha * glow})`
      context.fill()
      if (crest > 0.62) {
        context.beginPath()
        context.arc(point.x, point.y, size + 2.4, 0, Math.PI * 2)
        context.fillStyle = `rgba(120, 226, 255, ${alpha * 0.16})`
        context.fill()
      }
    }
  }
}

onMounted(() => {
  const canvas = host.value
  if (!canvas) return
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (reduced) {
    paint(canvas, 0)
    return
  }
  let time = 0
  let visible = true
  const loop = () => {
    time += 16
    if (visible) paint(canvas, time)
    frame = requestAnimationFrame(loop)
  }
  observer = new IntersectionObserver(([entry]) => {
    visible = entry?.isIntersecting ?? true
  })
  observer.observe(canvas)
  frame = requestAnimationFrame(loop)
})

onBeforeUnmount(() => {
  cancelAnimationFrame(frame)
  observer?.disconnect()
})
</script>

<template>
  <canvas ref="host" class="ws-backdrop" aria-hidden="true"></canvas>
</template>

<style scoped>
.ws-backdrop {
  position: fixed;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  mask-image: linear-gradient(180deg, transparent 42%, rgba(0, 0, 0, 0.55) 68%, #000 100%);
  -webkit-mask-image: linear-gradient(180deg, transparent 42%, rgba(0, 0, 0, 0.55) 68%, #000 100%);
}
</style>
