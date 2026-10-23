<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import ProcessorScene from './AsyncProcessorScene.vue'

const chapters = [
  {
    id: 'precision',
    label: '精密封装',
    title: '强大。\n不止于表面。',
    english: 'ENGINEERED. FROM WITHIN.',
    description: '从金属顶盖，到封装基板。每一层精密工程，共同构成桌面计算的强大内核。',
    feature: 'AM5',
    featureLabel: '面向下一套桌面装备',
    progress: 0,
  },
  {
    id: 'layers',
    label: '探索内部',
    title: '层层精密。\n释放潜能。',
    english: 'EVERY LAYER. A PURPOSE.',
    description:
      '向下滚动，让结构逐层展开。看见顶盖下的计算芯片与 I/O 模块，探索处理器内部的协作。',
    feature: '4 nm',
    featureLabel: 'CPU 核心制造工艺',
    progress: 0.52,
  },
  {
    id: 'compute',
    label: '聚焦核心',
    title: '微观之内。\n大有可为。',
    english: 'SMALL SCALE. BIG AMBITIONS.',
    description: '以「Zen 5」架构为核心，让创作、游戏与每一次灵感，拥有全力以赴的起点。',
    feature: 'Zen 5',
    featureLabel: 'AMD 核心架构',
    progress: 1,
  },
]
const root = ref<HTMLElement>()
const stage = ref<HTMLElement>()
const progress = ref(0)
const desktop = ref(false)
const reduced = ref(false)
const sceneMounted = ref(false)
const activeIndex = computed(() => (progress.value < 0.27 ? 0 : progress.value < 0.75 ? 1 : 2))
const chapter = computed(() => chapters[activeIndex.value]!)
const modelProgress = computed(() => (reduced.value ? chapter.value.progress : progress.value))
let observer: IntersectionObserver | undefined
let resizeObserver: ResizeObserver | undefined
let desktopQuery: MediaQueryList | undefined
let motionQuery: MediaQueryList | undefined
let animationFrame = 0
let inRange = false

function measure() {
  animationFrame = 0
  if (!desktop.value || !root.value || !stage.value) return
  const bounds = root.value.getBoundingClientRect()
  const travel = Math.max(1, root.value.offsetHeight - stage.value.offsetHeight)
  progress.value = Math.min(1, Math.max(0, (82 - bounds.top) / travel))
}
function scheduleMeasure() {
  if (inRange && !animationFrame) animationFrame = requestAnimationFrame(measure)
}
function syncMedia() {
  desktop.value = desktopQuery?.matches ?? false
  reduced.value = motionQuery?.matches ?? false
  if (desktop.value) measure()
  else progress.value = chapter.value.progress
}
function selectChapter(index: number) {
  const target = chapters[index]!
  if (desktop.value && root.value && stage.value) {
    const top = root.value.getBoundingClientRect().top + window.scrollY - 82
    const travel = root.value.offsetHeight - stage.value.offsetHeight
    // Native document scrolling: no wheel interception, scroll locks or inertia.
    window.scrollTo({
      top: top + target.progress * travel,
      behavior: reduced.value ? 'instant' : 'smooth',
    })
    // Follow actual scroll progress instead of jumping the model ahead of the page.
    scheduleMeasure()
    return
  }
  progress.value = target.progress
}
function keyNavigation(event: KeyboardEvent) {
  let next = activeIndex.value
  if (event.key === 'ArrowRight') next = (next + 1) % chapters.length
  else if (event.key === 'ArrowLeft') next = (next + chapters.length - 1) % chapters.length
  else if (event.key === 'Home') next = 0
  else if (event.key === 'End') next = chapters.length - 1
  else return
  event.preventDefault()
  selectChapter(next)
  root.value
    ?.querySelector<HTMLButtonElement>(`#anatomy-tab-${chapters[next]!.id}`)
    ?.focus({ preventScroll: true })
}
onMounted(() => {
  desktopQuery = window.matchMedia('(min-width: 901px) and (min-height: 650px)')
  motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
  syncMedia()
  desktopQuery.addEventListener('change', syncMedia)
  motionQuery.addEventListener('change', syncMedia)
  window.addEventListener('scroll', scheduleMeasure, { passive: true })
  window.addEventListener('resize', scheduleMeasure, { passive: true })
  observer = new IntersectionObserver(
    ([entry]) => {
      inRange = entry?.isIntersecting ?? false
      if (inRange) {
        sceneMounted.value = true
        scheduleMeasure()
      }
    },
    { rootMargin: '200px' },
  )
  if (root.value) observer.observe(root.value)
  resizeObserver = new ResizeObserver(scheduleMeasure)
  if (stage.value) resizeObserver.observe(stage.value)
})
onBeforeUnmount(() => {
  cancelAnimationFrame(animationFrame)
  observer?.disconnect()
  resizeObserver?.disconnect()
  window.removeEventListener('scroll', scheduleMeasure)
  window.removeEventListener('resize', scheduleMeasure)
  desktopQuery?.removeEventListener('change', syncMedia)
  motionQuery?.removeEventListener('change', syncMedia)
})
</script>

<template>
  <section
    id="architecture"
    ref="root"
    class="anatomy-story"
    aria-labelledby="anatomy-title"
    :data-chapter="chapter.id"
  >
    <div ref="stage" class="anatomy-stage">
      <div class="anatomy-header">
        <p>01 / INSIDE THE PROCESSOR</p>
        <span>精密工程 · 由外至内</span>
      </div>
      <div class="anatomy-main">
        <div class="anatomy-copy">
          <span class="chapter-number">0{{ activeIndex + 1 }}<i>/ 03</i></span>
          <div
            :id="`anatomy-panel-${chapter.id}`"
            role="tabpanel"
            :aria-labelledby="`anatomy-tab-${chapter.id}`"
          >
            <h2 id="anatomy-title">{{ chapter.title }}</h2>
            <p class="anatomy-english">{{ chapter.english }}</p>
            <p class="anatomy-description">{{ chapter.description }}</p>
            <div class="anatomy-feature">
              <strong>{{ chapter.feature }}</strong
              ><span>{{ chapter.featureLabel }}</span>
            </div>
          </div>
          <a class="anatomy-link" href="#experience">探索更多可能 <span>↗</span></a>
        </div>
        <div class="anatomy-viewer">
          <span class="anatomy-watermark" aria-hidden="true">ZEN 5</span>
          <div class="viewer-corners" aria-hidden="true"></div>
          <ProcessorScene
            v-if="sceneMounted"
            :explorable="true"
            :progress="modelProgress"
            :active="activeIndex > 0"
          />
          <div v-else class="scene-placeholder" aria-hidden="true">
            <span>AMD</span><strong>RYZEN</strong>
          </div>
          <div class="layer-notes" :class="{ visible: activeIndex > 0 }" aria-hidden="true">
            <span><i></i>01 / 金属顶盖</span><span><i></i>02 / 计算核心与 I/O</span
            ><span><i></i>03 / 封装基板</span>
          </div>
          <div class="viewer-caption"><span>RYZEN™ 9 9950X</span><span>ZEN 5 / AM5</span></div>
        </div>
      </div>
      <div class="anatomy-bottom">
        <div
          class="anatomy-tabs"
          role="tablist"
          aria-label="处理器结构章节"
          @keydown="keyNavigation"
        >
          <button
            v-for="(item, index) in chapters"
            :id="`anatomy-tab-${item.id}`"
            :key="item.id"
            role="tab"
            type="button"
            :tabindex="index === activeIndex ? 0 : -1"
            :aria-selected="index === activeIndex"
            :aria-controls="index === activeIndex ? `anatomy-panel-${item.id}` : undefined"
            @click="selectChapter(index)"
          >
            <span>0{{ index + 1 }}</span
            >{{ item.label }}<i>↗</i>
          </button>
        </div>
        <p class="anatomy-hint">
          {{ desktop ? '向下滚动，逐层探索' : '点选章节，探索内部' }} <span>↓</span>
        </p>
      </div>
      <div class="anatomy-progress" aria-hidden="true">
        <span :style="{ transform: `scaleX(${progress})` }"></span>
      </div>
      <p class="anatomy-disclaimer">处理器结构示意，实际产品以官方资料为准。</p>
    </div>
  </section>
</template>

<style scoped>
.anatomy-story {
  position: relative;
  height: calc(100svh - 82px + 700px);
  color: #292c2d;
  background: #deddd8;
  scroll-margin-top: 82px;
}
.anatomy-stage {
  position: sticky;
  top: 82px;
  height: calc(100svh - 82px);
  min-height: 620px;
  padding: 28px 6% 22px;
  display: flex;
  flex-direction: column;
  background: radial-gradient(ellipse at 67% 40%, #f7f6f1 0, #e4e3dd 48%, #d7d5cd 100%);
  overflow: hidden;
}
.anatomy-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid #282b2b26;
  padding-bottom: 20px;
  position: relative;
  z-index: 2;
}
.anatomy-header p {
  font:
    600 12px 'Barlow',
    sans-serif;
  letter-spacing: 2.5px;
  margin: 0;
  color: #9e411f;
}
.anatomy-header > span {
  font-size: 12px;
  color: #575b52;
  letter-spacing: 1px;
}
.anatomy-main {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 0.85fr 1.5fr;
  align-items: center;
}
.anatomy-copy {
  position: relative;
  z-index: 2;
  min-width: 0;
  padding: 24px 0 34px;
}
.chapter-number {
  color: #a74d27;
  font:
    500 20px 'Barlow Condensed',
    sans-serif;
  letter-spacing: 1px;
  display: block;
  margin-bottom: 25px;
}
.chapter-number i {
  color: #6e726e;
  font:
    normal 10px 'Barlow',
    sans-serif;
  margin-left: 10px;
}
.anatomy-copy h2#anatomy-title {
  font-size: clamp(32px, 3.5vw, 56px);
  line-height: 1.28;
  font-weight: 800;
  letter-spacing: -1.5px;
  white-space: pre-line;
  max-width: 360px;
  margin: 0;
  min-height: 2.6em;
}
.anatomy-english {
  color: #795b45;
  font:
    600 12px/1.7 'Barlow Condensed',
    sans-serif;
  letter-spacing: 2px;
  margin: 20px 0 0;
}
.anatomy-description {
  color: #50564e;
  font-size: 15px;
  line-height: 1.85;
  max-width: 340px;
  margin: 22px 0 0;
  min-height: 84px;
}
.anatomy-feature {
  display: flex;
  align-items: center;
  gap: 20px;
  margin-top: 28px;
}
.anatomy-feature strong {
  font:
    500 40px/1 'Barlow Condensed',
    sans-serif;
  white-space: nowrap;
  color: #383b37;
}
.anatomy-feature > span {
  padding-left: 16px;
  border-left: 1px solid #8a8c804d;
  font-size: 12px;
  max-width: 145px;
  color: #50584d;
}
.anatomy-link {
  display: inline-flex;
  align-items: center;
  gap: 35px;
  padding-bottom: 8px;
  margin-top: 28px;
  border-bottom: 1px solid #8a8a7880;
  text-decoration: none;
  color: #45483f;
  font-size: 13px;
  min-height: 36px;
}
.anatomy-link span {
  font-size: 18px;
  color: #ac4c22;
}
.anatomy-viewer {
  height: 100%;
  min-height: 0;
  position: relative;
  isolation: isolate;
}
.anatomy-viewer :deep(.processor-scene) {
  position: absolute;
  inset: 0;
}
.anatomy-watermark {
  position: absolute;
  top: 10%;
  right: -4%;
  color: #40453705;
  -webkit-text-stroke: 1px #454b3913;
  font:
    600 clamp(90px, 13vw, 220px)/1 'Barlow Condensed',
    sans-serif;
  letter-spacing: -4px;
  pointer-events: none;
  z-index: -1;
}
.viewer-corners {
  position: absolute;
  inset: 25px 0 35px;
  background:
    linear-gradient(#6a72524d, #6a72524d) top left/16px 1px no-repeat,
    linear-gradient(#6a72524d, #6a72524d) top left/1px 16px no-repeat,
    linear-gradient(#6a72524d, #6a72524d) bottom right/16px 1px no-repeat,
    linear-gradient(#6a72524d, #6a72524d) bottom right/1px 16px no-repeat;
  pointer-events: none;
}
.viewer-caption {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 12px;
  display: flex;
  justify-content: space-between;
  font:
    11px 'Barlow',
    sans-serif;
  letter-spacing: 1px;
  color: #535c4c;
  pointer-events: none;
}
.scene-placeholder {
  position: absolute;
  inset: 27% 22%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 15px;
  background: linear-gradient(135deg, #c4c5c3, #ebebe5, #a8a9a3);
  box-shadow: 8px 16px 0 #282f27;
  transform: rotate(-15deg);
  color: #444c42;
}
.scene-placeholder strong {
  font:
    500 45px 'Barlow Condensed',
    sans-serif;
  letter-spacing: 4px;
}
.layer-notes {
  position: absolute;
  top: 22%;
  right: -2%;
  bottom: 22%;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  opacity: 0;
  transition: opacity 0.3s;
  pointer-events: none;
}
.layer-notes.visible {
  opacity: 1;
}
.layer-notes > span {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: #51594a;
  letter-spacing: 1px;
  background: #e7e6dfc7;
  padding: 5px 7px;
}
.layer-notes i {
  width: 17px;
  height: 1px;
  background: #b35d32;
  position: relative;
}
.layer-notes i::before {
  content: '';
  position: absolute;
  left: 0;
  top: -2px;
  width: 4px;
  height: 4px;
  background: #b35d32;
}
.anatomy-bottom {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 30px;
  border-top: 1px solid #40453226;
  padding-top: 19px;
  position: relative;
  z-index: 2;
}
.anatomy-tabs {
  display: flex;
  gap: 38px;
}
.anatomy-tabs button {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  background: none;
  border: 0;
  color: #535c4e;
  cursor: pointer;
  font:
    13px 'Microsoft YaHei',
    sans-serif;
  padding: 8px 0;
  min-height: 40px;
}
.anatomy-tabs button > span {
  color: #626a59;
  font:
    12px 'Barlow',
    sans-serif;
}
.anatomy-tabs button i {
  color: #a25531;
  font-size: 15px;
  font-style: normal;
  opacity: 0;
}
.anatomy-tabs button[aria-selected='true'] {
  color: #a3441f;
}
.anatomy-tabs button[aria-selected='true'] i {
  opacity: 1;
}
.anatomy-tabs button:focus-visible,
.anatomy-link:focus-visible {
  outline: 2px solid #ab5128;
  outline-offset: 5px;
}
.anatomy-hint {
  font-size: 12px;
  letter-spacing: 1px;
  color: #586050;
  margin: 0;
}
.anatomy-hint span {
  margin-left: 15px;
  font-size: 18px;
  color: #a34b25;
}
.anatomy-progress {
  height: 2px;
  background: #5b624620;
  margin-top: 14px;
}
.anatomy-progress > span {
  display: block;
  height: 100%;
  background: #b25c33;
  transform-origin: left;
  will-change: transform;
}
.anatomy-disclaimer {
  font-size: 11px;
  margin: 12px 0 0;
  color: #586050;
  letter-spacing: 0.5px;
}
@media (min-width: 901px) and (max-height: 760px) {
  .anatomy-stage {
    min-height: 540px;
    padding-top: 16px;
    padding-bottom: 14px;
  }
  .anatomy-header {
    padding-bottom: 12px;
  }
  .chapter-number {
    margin-bottom: 10px;
  }
  .anatomy-copy {
    padding: 8px 0;
  }
  .anatomy-copy h2#anatomy-title {
    font-size: 30px;
  }
  .anatomy-english {
    margin-top: 8px;
  }
  .anatomy-description {
    margin-top: 10px;
    font-size: 14px;
    min-height: 52px;
  }
  .anatomy-feature,
  .anatomy-link {
    margin-top: 12px;
  }
  .anatomy-link {
    min-height: 34px;
    padding-bottom: 5px;
  }
  .anatomy-feature strong {
    font-size: 32px;
  }
  .anatomy-bottom {
    padding-top: 10px;
  }
  .anatomy-disclaimer {
    margin-top: 6px;
  }
}
@media (max-width: 1100px) {
  .anatomy-tabs {
    gap: 24px;
  }
  .layer-notes {
    right: -5%;
  }
  .anatomy-main {
    grid-template-columns: 0.95fr 1.3fr;
  }
}
@media (max-width: 900px), (max-height: 649px) {
  .anatomy-story {
    height: auto;
    scroll-margin-top: 70px;
  }
  .anatomy-stage {
    position: relative;
    top: auto;
    height: auto;
    min-height: 0;
    padding: 32px 6% 24px;
  }
  .anatomy-main {
    grid-template-columns: 1fr;
  }
  .anatomy-copy {
    padding-top: 32px;
    padding-bottom: 0;
  }
  .chapter-number {
    margin-bottom: 18px;
  }
  .anatomy-copy h2#anatomy-title {
    font-size: 42px;
    min-height: 2.6em;
    max-width: 100%;
  }
  .anatomy-description {
    max-width: 480px;
    min-height: 56px;
  }
  .anatomy-feature {
    margin-top: 22px;
  }
  .anatomy-link {
    position: absolute;
    right: 0;
    bottom: 0;
  }
  .anatomy-viewer {
    height: 490px;
    margin-top: 5px;
  }
  .anatomy-watermark {
    right: 12%;
    top: 8%;
    font-size: 145px;
  }
  .anatomy-hint {
    display: none;
  }
  .anatomy-tabs {
    width: 100%;
    justify-content: space-between;
    gap: 14px;
  }
  .layer-notes {
    right: 0;
  }
}
@media (max-width: 600px) {
  .anatomy-stage {
    padding: 25px 7% 22px;
  }
  .anatomy-header {
    padding-bottom: 15px;
  }
  .anatomy-header p {
    font-size: 10px;
    letter-spacing: 0.8px;
  }
  .anatomy-header > span {
    font-size: 10px;
    letter-spacing: 0;
  }
  .anatomy-copy h2#anatomy-title {
    font-size: 35px;
    max-width: 300px;
  }
  .anatomy-english {
    font-size: 12px;
    margin-top: 12px;
  }
  .anatomy-description {
    font-size: 13px;
    margin-top: 16px;
    max-width: none;
    min-height: 73px;
  }
  .anatomy-feature strong {
    font-size: 32px;
  }
  .anatomy-feature {
    gap: 10px;
  }
  .anatomy-feature > span {
    font-size: 12px;
    padding-left: 10px;
    max-width: 120px;
  }
  .anatomy-link {
    position: static;
    font-size: 13px;
    gap: 12px;
    padding-bottom: 5px;
    margin-top: 16px;
    min-height: 44px;
  }
  .anatomy-viewer {
    height: 370px;
    width: calc(100% + 30px);
    margin-left: -15px;
  }
  .viewer-corners {
    inset: 30px 5px;
  }
  .anatomy-watermark {
    font-size: 110px;
  }
  .viewer-caption {
    font-size: 10px;
    left: 5px;
    right: 5px;
  }
  .layer-notes > span {
    font-size: 11px;
    letter-spacing: 0;
    padding: 4px;
  }
  .layer-notes i {
    width: 10px;
  }
  .anatomy-tabs button {
    font-size: 12px;
    gap: 5px;
    min-height: 44px;
  }
  .anatomy-tabs button > span {
    font-size: 11px;
  }
  .anatomy-tabs button i {
    font-size: 12px;
  }
  .anatomy-disclaimer {
    font-size: 11px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .layer-notes {
    transition: none;
  }
}
</style>
