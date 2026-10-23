<script setup lang="ts">
import { computed, useId } from 'vue'

type ExperienceMode = 'gaming' | 'creation' | 'work'
const props = defineProps<{ mode: ExperienceMode }>()
const uid = useId().replace(/:/g, '')
const gradient = (name: string) => `url(#${uid}-${name})`
const scenes = {
  gaming: {
    index: '01',
    title: 'BEYOND THE HORIZON',
    caption: '沉浸游戏世界',
    description: '游戏场景示意：暮色中的群山与峡谷，一位探索者走向地平线上的光环。',
  },
  creation: {
    index: '02',
    title: 'FROM FORM TO FEELING',
    caption: '让灵感成为作品',
    description:
      '创作场景示意：三维设计视口中，一个由金属切面构成的参数化环形雕塑，下方是材质与灯光的制作时间轴。',
  },
  work: {
    index: '03',
    title: 'IDEAS INTO MOTION',
    caption: '构建你的下一步',
    description:
      '开发场景示意：代码编辑器中的 TypeScript 渲染函数，与输入、计算和输出模块的依赖关系图。',
  },
} as const
const scene = computed(() => scenes[props.mode])

// A small, static, painter-sorted mesh gives the studio illustration real volume
// without adding another WebGL context or a continuously running animation.
const torusFaces = (() => {
  const segments = 40
  const sides = 10
  const project = (u: number, v: number) => {
    const radius = 103 + 33 * Math.cos(v)
    const x = radius * Math.cos(u)
    const y = radius * Math.sin(u)
    const z = 33 * Math.sin(v)
    const a = -0.72
    const b = -0.4
    const tiltedY = y * Math.cos(a) - z * Math.sin(a)
    const depth = y * Math.sin(a) + z * Math.cos(a)
    return {
      x: x * Math.cos(b) - tiltedY * Math.sin(b) + 310,
      y: x * Math.sin(b) + tiltedY * Math.cos(b) + 177,
      depth,
    }
  }
  const faces: { points: string; depth: number; color: string }[] = []
  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < sides; j++) {
      const u = (i / segments) * Math.PI * 2
      const v = (j / sides) * Math.PI * 2
      const points = [
        project(u, v),
        project(u + (Math.PI * 2) / segments, v),
        project(u + (Math.PI * 2) / segments, v + (Math.PI * 2) / sides),
        project(u, v + (Math.PI * 2) / sides),
      ]
      const light = Math.cos(u - 2.4) * 0.28 + Math.sin(v + 0.6) * 0.45 + 0.55
      const l = Math.max(14, Math.min(86, 22 + light * 58))
      const copper = i < 12 || i > 34
      faces.push({
        points: points.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' '),
        depth: points.reduce((total, point) => total + point.depth, 0) / 4,
        color: copper ? `hsl(23 54% ${l}%)` : `hsl(32 8% ${l}%)`,
      })
    }
  }
  return faces.sort((a, b) => a.depth - b.depth)
})()
</script>

<template>
  <div
    class="experience-visual"
    :class="`visual-${mode}`"
    role="img"
    :aria-label="scene.description"
  >
    <Transition name="scene-reveal" mode="out-in">
      <div :key="mode" class="visual-scene" aria-hidden="true">
        <div class="scene-eyebrow">
          <span class="scene-mark"></span>{{ scene.title
          }}<span class="scene-index">/ {{ scene.index }}</span>
        </div>

        <svg
          v-if="mode === 'gaming'"
          class="landscape"
          viewBox="0 0 700 490"
          preserveAspectRatio="xMidYMid slice"
          aria-hidden="true"
        >
          <defs>
            <linearGradient :id="`${uid}-sky`" x2="0" y2="1">
              <stop stop-color="#11100f" />
              <stop offset="0.62" stop-color="#704025" />
              <stop offset="1" stop-color="#bd7745" />
            </linearGradient>
            <radialGradient :id="`${uid}-halo`">
              <stop stop-color="#ffbb76" stop-opacity="0.5" />
              <stop offset="0.5" stop-color="#f8a65e" stop-opacity="0.16" />
              <stop offset="1" stop-color="#e1914e" stop-opacity="0" />
            </radialGradient>
            <linearGradient :id="`${uid}-ring`" x1="0" y1="1" x2="1" y2="0">
              <stop stop-color="#ca6933" />
              <stop offset="0.5" stop-color="#ffe3bd" />
              <stop offset="1" stop-color="#ffb16a" />
            </linearGradient>
            <linearGradient :id="`${uid}-mist`" x2="0" y2="1">
              <stop stop-color="#9e643b" stop-opacity="0" />
              <stop offset="1" stop-color="#d3915d" stop-opacity="0.56" />
            </linearGradient>
            <linearGradient :id="`${uid}-trail`" x1="0" y1="0" x2="1" y2="1">
              <stop stop-color="#f7ce98" stop-opacity="0.15" />
              <stop offset="1" stop-color="#ff914b" stop-opacity="0.8" />
            </linearGradient>
          </defs>
          <path d="M0 0H700V490H0Z" :fill="gradient('sky')" />
          <ellipse cx="358" cy="204" rx="259" ry="214" :fill="gradient('halo')" />
          <circle cx="350" cy="190" r="91" fill="#1c1813" fill-opacity="0.6" />
          <circle
            cx="350"
            cy="190"
            r="92"
            fill="none"
            stroke="#fdb674"
            stroke-width="12"
            opacity="0.07"
          />
          <circle
            cx="350"
            cy="190"
            r="91"
            fill="none"
            :stroke="gradient('ring')"
            stroke-width="2.4"
          />
          <path
            d="M0 283 55 246 85 260 149 219 182 245 207 237 265 283 313 262 356 279 404 248 451 265 508 225 543 244 604 209 652 254 700 230V490H0Z"
            fill="#65442d"
          />
          <path
            d="m0 295 79-23 46 14 68-23 83 35 52-22 66 27 69-29 44 23 64-20 66 9 63-21v225H0Z"
            fill="#513925"
          />
          <path d="M0 250H700V370H0Z" :fill="gradient('mist')" />
          <path d="m0 236 69 25 37 40 59-11 62 40 53 8 43 30-27 122H0Z" fill="#28251f" />
          <path d="m69 261 37 40 59-11 62 40-83-11-48 7-45-27Z" fill="#514334" />
          <path
            d="m0 325 109-22 51 26 67 1 53 8 43 30-54-8-48 17-55-22-63 3-37 47H0Z"
            fill="#1d1e1a"
          />
          <path d="m700 252-77-27-30 57-58 26-36-8-52 36-39 20 34 134h258Z" fill="#29271f" />
          <path d="m623 225-30 57-58 26-36-8-52 36 42-14 55 6 64-29 27-25Z" fill="#73604a" />
          <path
            d="m700 336-62-17-80 21-58-2-92 18 26 34 62-15 31 17 71-17 38 25 64-7Z"
            fill="#151a16"
          />
          <path
            d="M353 322c-3 18 37 27 16 48s-64 18-58 45 57 29 46 75"
            fill="none"
            :stroke="gradient('trail')"
            stroke-width="2"
          />
          <path d="m0 430 72-30 74 6 69-28 48 14 59 45-17 53H0Z" fill="#101612" />
          <path d="m700 403-76 14-58-20-78 31-46-6-47 43 8 25h297Z" fill="#0d1310" />
          <path d="m263 392 59 45-66-27-48 13-66-17 73-28Z" fill="#303126" />
          <path d="M345 353h19" stroke="#ffe4b8" stroke-opacity="0.22" />
          <circle cx="355" cy="339" r="2.4" fill="#111813" />
          <path
            d="m353 342-2 8m3-8 4 0 2 7m-5-6v7m0 0-2 6m3-6 2 6"
            fill="none"
            stroke="#121914"
            stroke-width="2"
            stroke-linecap="round"
          />
          <path d="M350 344h3v6h-3Z" fill="#d69c65" />
          <path d="M328 88h44M350 80v16" stroke="#e9c198" stroke-width="0.6" opacity="0.3" />
        </svg>

        <div v-else-if="mode === 'creation'" class="studio-window">
          <div class="window-title">
            <span class="window-dots"><i></i><i></i><i></i></span><span>FORM STUDY / 001</span
            ><span class="window-context">PERSPECTIVE</span>
          </div>
          <div class="studio-viewport">
            <div class="studio-tools">
              <span>＋</span><span>↗</span><span>◈</span><span>◎</span>
            </div>
            <svg viewBox="0 0 620 340" class="sculpture" aria-hidden="true">
              <defs>
                <radialGradient :id="`${uid}-studio`">
                  <stop stop-color="#cda77d" stop-opacity="0.1" />
                  <stop offset="1" stop-color="#cda77d" stop-opacity="0" />
                </radialGradient>
                <radialGradient :id="`${uid}-shadow`">
                  <stop stop-color="#000" stop-opacity="0.9" />
                  <stop offset="1" stop-color="#000" stop-opacity="0" />
                </radialGradient>
              </defs>
              <ellipse cx="310" cy="157" rx="230" ry="160" :fill="gradient('studio')" />
              <g stroke="#888479" stroke-width="0.7" opacity="0.16">
                <path
                  d="M40 235 310 168 580 235M-20 265 310 183 640 265M-80 295 310 198 700 295M-140 325 310 213 760 325"
                  fill="none"
                />
                <path
                  d="m310 168-245 172m245-172L179 340m131-172v172m0-172 131 172m-131-172 245 172"
                />
              </g>
              <ellipse cx="310" cy="284" rx="141" ry="30" :fill="gradient('shadow')" />
              <g>
                <polygon
                  v-for="(face, index) in torusFaces"
                  :key="index"
                  :points="face.points"
                  :fill="face.color"
                  :stroke="face.color"
                  stroke-width="0.5"
                />
              </g>
              <path
                d="M441 143h28l16-16h49"
                fill="none"
                stroke="#cba174"
                stroke-opacity="0.5"
                stroke-width="0.8"
              />
              <circle cx="441" cy="143" r="2" fill="#e4bb8f" />
              <text x="486" y="120" fill="#c6b29a" font-size="9" letter-spacing="1.5">
                ALLOY / 02
              </text>
              <g transform="translate(567 292)" stroke-width="1.2">
                <path d="M0 0v-20" stroke="#b2b6a8" />
                <path d="M0 0l-15 9" stroke="#8b9688" />
                <path d="M0 0l17 8" stroke="#d8955d" />
                <circle r="2" fill="#a1a391" />
              </g>
            </svg>
            <div class="viewport-label">Parametric surface<span>材质 · 形态 · 光影</span></div>
          </div>
          <div class="studio-timeline">
            <div class="timeline-ruler">
              <span>01</span><span>08</span><span>16</span><span>24</span><span>32</span>
            </div>
            <div class="timeline-track"><span>FORM</span><i></i></div>
            <div class="timeline-track light-track"><span>LIGHT</span><i></i></div>
            <span class="timeline-playhead"></span>
          </div>
        </div>

        <div v-else class="workspace-window">
          <div class="window-title">
            <span class="window-dots"><i></i><i></i><i></i></span><span>WORKSPACE</span
            ><span class="window-context">TYPESCRIPT</span>
          </div>
          <div class="code-file">
            <span class="file-glyph">TS</span>render.ts<span class="file-status">SOURCE</span>
          </div>
          <div class="code-body">
            <div class="code-line">
              <span class="line-number">01</span
              ><code
                ><span class="code-keyword">import</span> { scene }
                <span class="code-keyword">from&nbsp;</span>
                <span class="code-string">'./scene'</span></code
              >
            </div>
            <div class="code-line"><span class="line-number">02</span><code>&nbsp;</code></div>
            <div class="code-line">
              <span class="line-number">03</span
              ><code
                ><span class="code-keyword">export function&nbsp;</span>
                <span class="code-function">render</span>() {</code
              >
            </div>
            <div class="code-line">
              <span class="line-number">04</span
              ><code>
                <span class="code-keyword">const</span> frame = scene.<span class="code-function"
                  >update</span
                >()</code
              >
            </div>
            <div class="code-line selected-line">
              <span class="line-number">05</span
              ><code>
                <span class="code-keyword">return</span> frame.<span class="code-function"
                  >compose</span
                >()</code
              >
            </div>
            <div class="code-line"><span class="line-number">06</span><code>}</code></div>
          </div>
          <div class="module-flow">
            <div class="module-label">MODULE GRAPH<span>依赖关系</span></div>
            <div class="flow-nodes">
              <div class="flow-node"><span>01</span>scene.ts</div>
              <span class="flow-link"></span>
              <div class="flow-node active-node"><span>02</span>render.ts</div>
              <span class="flow-link"></span>
              <div class="flow-node"><span>03</span>app.ts</div>
            </div>
          </div>
          <div class="terminal">
            <span class="terminal-prompt">❯</span><code>让想法，成为下一行代码。</code
            ><span class="terminal-cursor"></span>
          </div>
        </div>

        <div class="scene-footer">
          <span>{{ scene.caption }}</span
          ><span class="scene-footer-line"></span><span>AMD RYZEN™</span>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.experience-visual {
  position: relative;
  width: 100%;
  height: 490px;
  min-width: 0;
  overflow: hidden;
  isolation: isolate;
  background: #10100f;
  color: #c9baa5;
}
.experience-visual,
.experience-visual *,
.experience-visual *::before,
.experience-visual *::after {
  box-sizing: border-box;
}
.visual-scene {
  position: absolute;
  inset: 0;
  overflow: hidden;
}
.scene-eyebrow,
.scene-footer {
  position: absolute;
  z-index: 2;
  left: 28px;
  right: 28px;
  display: flex;
  align-items: center;
  gap: 10px;
  font:
    9px/1.5 'Segoe UI',
    sans-serif;
  letter-spacing: 1.7px;
}
.scene-eyebrow {
  top: 26px;
  color: #c7bbaa;
}
.scene-mark {
  width: 5px;
  height: 5px;
  background: #d2a273;
}
.scene-index {
  margin-left: auto;
  color: #958a7c;
  font-size: 10px;
}
.scene-footer {
  bottom: 24px;
  color: #b0a99c;
  font-size: 9px;
  letter-spacing: 1.1px;
}
.scene-footer > :first-child {
  letter-spacing: 2px;
}
.scene-footer-line {
  flex: 1;
  height: 1px;
  background: #d6ba921c;
  margin: 0 8px;
}
.landscape {
  width: 100%;
  height: 100%;
  display: block;
}
.visual-gaming .scene-footer {
  color: #b6b4a1;
}
.visual-gaming .scene-eyebrow {
  text-shadow: 0 1px 6px #000;
}
.visual-creation {
  background: radial-gradient(ellipse at 50% 45%, #27241f, #10100f 72%);
}
.visual-work {
  background: radial-gradient(ellipse at 30% 40%, #25241f, #0d100f 75%);
}
.studio-window,
.workspace-window {
  position: absolute;
  top: 69px;
  left: 28px;
  right: 28px;
  border: 1px solid #cdb79d26;
  border-radius: 5px;
  background: #171918;
  box-shadow: 0 24px 60px #0005;
  overflow: hidden;
}
.window-title {
  height: 32px;
  padding: 0 13px;
  display: flex;
  align-items: center;
  gap: 15px;
  background: #171817;
  border-bottom: 1px solid #c9bc9e13;
  color: #8c8f87;
  font:
    8px/1.5 'Segoe UI',
    sans-serif;
  letter-spacing: 1.4px;
}
.window-context {
  margin-left: auto;
  color: #676d64;
  font-size: 7px;
}
.window-dots {
  display: flex;
  gap: 4px;
}
.window-dots i {
  width: 4px;
  height: 4px;
  border: 1px solid #767971;
  border-radius: 50%;
}
.window-dots i:first-child {
  background: #9b7656;
  border-color: #9b7656;
}
.studio-viewport {
  height: 268px;
  position: relative;
  overflow: hidden;
  background: #1b1e1b;
}
.sculpture {
  width: 100%;
  height: 100%;
  display: block;
}
.studio-tools {
  position: absolute;
  left: 12px;
  top: 17px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  color: #7a8177;
  font: 16px/1 monospace;
}
.studio-tools span:nth-child(3) {
  color: #d0a077;
}
.viewport-label {
  position: absolute;
  bottom: 14px;
  left: 16px;
  color: #a7a99e;
  font:
    10px/1.5 'Segoe UI',
    sans-serif;
  letter-spacing: 0.4px;
}
.viewport-label span {
  display: block;
  margin-top: 3px;
  color: #747d71;
  font-size: 8px;
  letter-spacing: 1px;
}
.studio-timeline {
  position: relative;
  padding: 9px 16px 10px;
  height: 61px;
  background: #141714;
  border-top: 1px solid #c9bc9e13;
}
.timeline-ruler {
  margin-left: 44px;
  display: flex;
  justify-content: space-between;
  font: 7px/1 monospace;
  color: #858a7d;
}
.timeline-track {
  display: flex;
  align-items: center;
  margin-top: 7px;
  gap: 14px;
  height: 9px;
}
.timeline-track > span {
  flex: 0 0 30px;
  color: #929787;
  font: 6px/1 monospace;
  letter-spacing: 0.8px;
}
.timeline-track i {
  display: block;
  flex: 1;
  height: 100%;
  background: linear-gradient(90deg, #8e6545, #574533);
  border: 1px solid #bf8f5744;
  border-radius: 2px;
}
.light-track {
  margin-top: 4px;
}
.light-track i {
  margin-left: 20%;
  margin-right: 6%;
  background: #464e3b;
  border-color: #7f8b5c44;
}
.timeline-playhead {
  position: absolute;
  left: 43%;
  top: 9px;
  bottom: 7px;
  width: 1px;
  background: #d2af75;
}
.timeline-playhead::before {
  content: '';
  position: absolute;
  top: 0;
  left: -2px;
  width: 5px;
  height: 5px;
  background: #d2af75;
}
.workspace-window {
  top: 79px;
  transform: perspective(1100px) rotateY(-4deg) rotateX(2deg);
  transform-origin: 50% 50%;
}
.code-file {
  height: 36px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 16px;
  color: #d0c5b5;
  font: 10px/1 monospace;
  border-bottom: 1px solid #c9bc9e12;
}
.file-glyph {
  font-size: 8px;
  color: #bcbcb0;
}
.file-status {
  margin-left: auto;
  font-size: 7px;
  color: #73796d;
  letter-spacing: 1.5px;
}
.code-body {
  padding: 18px 0 20px;
  background: #181d18;
}
.code-line {
  display: flex;
  align-items: center;
  min-height: 23px;
  font:
    11px/23px Consolas,
    'Courier New',
    monospace;
  letter-spacing: -0.3px;
  color: #c4c4b6;
}
.line-number {
  flex: 0 0 43px;
  color: #646e60;
  text-align: center;
  font-size: 8px;
  user-select: none;
}
.code-line code {
  font: inherit;
  white-space: pre;
}
.code-keyword {
  color: #cfb79c;
}
.code-string {
  color: #a7b492;
}
.code-function {
  color: #e4a86d;
}
.selected-line {
  background: #e3bd8010;
}
.module-flow {
  padding: 14px 17px 17px;
  border-top: 1px solid #c9bc9e13;
}
.module-label {
  display: flex;
  justify-content: space-between;
  color: #7e8778;
  font:
    7px/1 'Segoe UI',
    sans-serif;
  letter-spacing: 1.3px;
}
.module-label span {
  font-size: 8px;
}
.flow-nodes {
  display: flex;
  align-items: center;
  padding-top: 13px;
}
.flow-node {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 10px;
  border: 1px solid #8d967a2d;
  color: #b1b7a5;
  font:
    9px/1.3 Consolas,
    monospace;
  border-radius: 2px;
  white-space: nowrap;
}
.flow-node > span {
  color: #626d5c;
  font-size: 7px;
}
.flow-link {
  height: 1px;
  flex: 1;
  min-width: 8px;
  background: #89936f55;
  position: relative;
}
.flow-link::after {
  content: '';
  position: absolute;
  right: 0;
  top: -2px;
  border-left: 3px solid #89936f;
  border-top: 2px solid transparent;
  border-bottom: 2px solid transparent;
}
.active-node {
  color: #dbb68e;
  border-color: #ca935851;
  background: #d9ad7610;
}
.active-node > span {
  color: #ae8054;
}
.terminal {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 33px;
  padding: 0 16px;
  border-top: 1px solid #c9bc9e13;
  background: #121612;
}
.terminal-prompt {
  color: #d6ad75;
  font-size: 10px;
}
.terminal code {
  font:
    9px/1.5 'Segoe UI',
    sans-serif;
  letter-spacing: 1px;
  color: #909b86;
}
.terminal-cursor {
  width: 4px;
  height: 9px;
  background: #9aab87;
  opacity: 0.55;
}
.scene-reveal-enter-active,
.scene-reveal-leave-active {
  transition:
    opacity 220ms ease,
    transform 400ms ease;
}
.scene-reveal-enter-from {
  opacity: 0;
  transform: translateY(6px);
}
.scene-reveal-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
@media (max-width: 1050px) and (min-width: 601px) {
  .scene-eyebrow,
  .scene-footer {
    left: 18px;
    right: 18px;
    font-size: 8px;
    letter-spacing: 1px;
  }
  .studio-window,
  .workspace-window {
    left: 18px;
    right: 18px;
  }
  .code-line {
    font-size: 9px;
    letter-spacing: -0.4px;
  }
  .line-number {
    flex-basis: 30px;
  }
  .flow-node {
    padding: 9px 6px;
    font-size: 8px;
    gap: 5px;
  }
}
@media (max-width: 600px) {
  .experience-visual {
    height: 340px;
  }
  .scene-eyebrow,
  .scene-footer {
    left: 18px;
    right: 18px;
    font-size: 8px;
    letter-spacing: 1px;
  }
  .scene-eyebrow {
    top: 17px;
  }
  .scene-footer {
    bottom: 15px;
  }
  .scene-footer > :first-child {
    letter-spacing: 1px;
  }
  .studio-window,
  .workspace-window {
    left: 18px;
    right: 18px;
    top: 46px;
  }
  .window-title {
    height: 25px;
    padding: 0 10px;
    gap: 10px;
    font-size: 7px;
  }
  .window-context {
    font-size: 6px;
    letter-spacing: 0.8px;
  }
  .studio-viewport {
    height: 190px;
  }
  .studio-timeline {
    height: 43px;
    padding: 5px 12px;
  }
  .timeline-track {
    margin-top: 5px;
    height: 7px;
  }
  .light-track {
    margin-top: 3px;
  }
  .timeline-playhead {
    top: 5px;
    bottom: 4px;
  }
  .studio-tools {
    font-size: 13px;
    gap: 12px;
    top: 12px;
  }
  .viewport-label {
    left: 12px;
    bottom: 9px;
    font-size: 8px;
  }
  .viewport-label span {
    font-size: 6px;
  }
  .code-file {
    height: 27px;
    font-size: 9px;
    padding: 0 12px;
  }
  .code-body {
    padding: 7px 0 8px;
  }
  .code-line {
    font-size: 9px;
    min-height: 16px;
    line-height: 16px;
    letter-spacing: -0.4px;
  }
  .line-number {
    flex-basis: 29px;
    font-size: 7px;
  }
  .module-flow {
    padding: 10px 12px 12px;
  }
  .module-label {
    font-size: 6px;
  }
  .module-label span {
    font-size: 7px;
  }
  .flow-nodes {
    padding-top: 9px;
  }
  .flow-node {
    padding: 7px 6px;
    font-size: 8px;
    gap: 5px;
  }
  .flow-node > span {
    font-size: 6px;
  }
  .terminal {
    min-height: 25px;
    padding: 0 12px;
  }
  .terminal code {
    font-size: 8px;
    letter-spacing: 0.7px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .scene-reveal-enter-active,
  .scene-reveal-leave-active {
    transition: none;
  }
  .scene-reveal-enter-from,
  .scene-reveal-leave-to {
    transform: none;
  }
  .workspace-window {
    transform: none;
  }
}
</style>
