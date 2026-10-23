<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import ProcessorScene from './AsyncProcessorScene.vue'
import ArchitectureStory from './ArchitectureStory.vue'
import ExperienceVisual from './ExperienceVisual.vue'
import ProductFinder from './ProductFinder.vue'
import './fonts.css'

const products = [
  {
    id: '9950x',
    tier: '9',
    name: '9950X',
    tag: '为无尽创造力而生',
    cores: 16,
    threads: 32,
    boost: '5.7',
    cache: 80,
    tdp: 170,
    description: '从复杂渲染到多任务创作，把宏大的想法变成现实。',
    url: 'https://www.amd.com/en/products/processors/desktops/ryzen/9000-series/amd-ryzen-9-9950x.html',
  },
  {
    id: '9700x',
    tier: '7',
    name: '9700X',
    tag: '游刃有余，尽兴而战',
    cores: 8,
    threads: 16,
    boost: '5.5',
    cache: 40,
    tdp: 65,
    description: '游戏、直播、创作。为你的每一种热爱保留实力。',
    url: 'https://www.amd.com/en/products/processors/desktops/ryzen/9000-series/amd-ryzen-7-9700x.html',
  },
  {
    id: '9600x',
    tier: '5',
    name: '9600X',
    tag: '下一场精彩，从此开始',
    cores: 6,
    threads: 12,
    boost: '5.4',
    cache: 38,
    tdp: 65,
    description: '让日常灵感与游戏热情，拥有一个强劲的起点。',
    url: 'https://www.amd.com/en/products/processors/desktops/ryzen/9000-series/amd-ryzen-5-9600x.html',
  },
]
const experiences = [
  {
    id: 'gaming' as const,
    label: '沉浸游戏',
    kicker: 'PLAY WITHOUT LIMITS',
    title: '进入世界。\n成为主角。',
    text: '从开放世界的每一次探索，到竞技赛场的每一个瞬间。让强劲的桌面算力，陪你全情投入。',
    note: '你的下一场冒险，正在加载。',
    code: 'WORLD_01 / GAME ON',
    number: '01',
  },
  {
    id: 'creation' as const,
    label: '灵感创作',
    kicker: 'MAKE THE IMPOSSIBLE',
    title: '大胆想象。\n尽情创造。',
    text: '建模、剪辑、渲染，让想法从脑海走向屏幕。多核心、多线程的力量，为复杂的创作流程而来。',
    note: '让每一帧，承载你的想象。',
    code: 'STUDIO_02 / CREATE MORE',
    number: '02',
  },
  {
    id: 'work' as const,
    label: '高效进阶',
    kicker: 'BUILD YOUR NEXT',
    title: '专注当下。\n构建未来。',
    text: '从代码编译到并行任务，在切换与协作之间保持专注。把时间留给真正值得投入的事情。',
    note: '下一个突破，始于你的桌面。',
    code: 'SYSTEM_03 / STAY IN FLOW',
    number: '03',
  },
]
const experienceIndex = ref(0)
const experience = computed(() => experiences[experienceIndex.value]!)
const selected = ref<string[]>(['9950x', '9700x'])
const comparisonProducts = computed(() => products.filter((p) => selected.value.includes(p.id)))
const compareDialog = ref<HTMLDialogElement>()
const menuOpen = ref(false)
const menuToggle = ref<HTMLButtonElement>()
const energy = ref(false)
const sceneReady = ref(false)
const sceneUnsupported = ref(false)
const activeSection = ref('overview')
const selectionMessage = ref('')
const recommendedProduct = ref<string | null>(null)
const navItems = [
  { id: 'overview', label: '概览' },
  { id: 'architecture', label: '核心架构' },
  { id: 'experience', label: '无限可能' },
  { id: 'products', label: '处理器家族' },
]
let sectionObserver: IntersectionObserver | undefined
let previousTitle = ''
let previousLanguage = ''
let previousDescription: string | null = null
let metaDescription: HTMLMetaElement | null = null
let createdDescription = false
let conceptIcon: HTMLLinkElement | undefined
let lastFocus: HTMLElement | null = null
let priorOverflow = ''
let hadSmoothScroll = false

function onSceneReady() {
  sceneReady.value = true
  sceneUnsupported.value = false
}
function closeMobileMenu() {
  menuOpen.value = false
  void nextTick(() => menuToggle.value?.focus())
}
function toggleProduct(id: string) {
  selected.value = selected.value.includes(id)
    ? selected.value.filter((item) => item !== id)
    : [...selected.value, id]
  selectionMessage.value = `已选择 ${selected.value.length} 款处理器`
}
function openComparison() {
  if (!selected.value.length) return
  lastFocus = document.activeElement as HTMLElement
  priorOverflow = document.body.style.overflow
  document.body.style.overflow = 'hidden'
  compareDialog.value?.showModal()
}
function closeComparison() {
  compareDialog.value?.close()
}
function afterClose() {
  document.body.style.overflow = priorOverflow
  lastFocus?.focus()
}
function changeExperience(event: KeyboardEvent) {
  const movement = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
  if (!movement && event.key !== 'Home' && event.key !== 'End') return
  event.preventDefault()
  experienceIndex.value =
    event.key === 'Home' ? 0 : event.key === 'End' ? 2 : (experienceIndex.value + movement + 3) % 3
  void nextTick(() => document.getElementById(`tab-${experience.value.id}`)?.focus())
}
onMounted(() => {
  previousTitle = document.title
  previousLanguage = document.documentElement.lang
  document.title = 'AMD Ryzen 9000 系列 | 生而强悍，不止于快'
  document.documentElement.lang = 'zh-CN'
  hadSmoothScroll = document.documentElement.classList.contains('amd-smooth-scroll')
  document.documentElement.classList.add('amd-smooth-scroll')
  document.body.classList.add('amd-page-active')
  conceptIcon = document.createElement('link')
  conceptIcon.rel = 'icon'
  conceptIcon.type = 'image/svg+xml'
  conceptIcon.href = `${import.meta.env.BASE_URL}amd-concept.svg`
  document.head.append(conceptIcon)
  metaDescription = document.querySelector('meta[name="description"]')
  if (!metaDescription) {
    metaDescription = document.createElement('meta')
    metaDescription.name = 'description'
    document.head.append(metaDescription)
    createdDescription = true
  }
  previousDescription = metaDescription.getAttribute('content')
  metaDescription.content =
    '探索 AMD Ryzen 9000 系列桌面处理器与 Zen 5 架构，按游戏、创作和开发需求了解产品，比较核心、线程、频率和平台规格。'
  sectionObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) activeSection.value = entry.target.id
      })
    },
    { rootMargin: '-15% 0px -55% 0px' },
  )
  document
    .querySelectorAll('.amd-page main > section[id]')
    .forEach((el) => sectionObserver?.observe(el))
})
onBeforeUnmount(() => {
  sectionObserver?.disconnect()
  document.title = previousTitle
  document.documentElement.lang = previousLanguage
  if (!hadSmoothScroll) document.documentElement.classList.remove('amd-smooth-scroll')
  document.body.classList.remove('amd-page-active')
  conceptIcon?.remove()
  if (compareDialog.value?.open) document.body.style.overflow = priorOverflow
  if (createdDescription) metaDescription?.remove()
  else if (previousDescription === null) metaDescription?.removeAttribute('content')
  else metaDescription?.setAttribute('content', previousDescription)
})
</script>

<template>
  <div class="amd-page">
    <a class="skip-link" href="#main-content">跳至主要内容</a>
    <header class="amd-header">
      <a class="amd-brand" href="#overview" aria-label="AMD Ryzen 首页" @click="menuOpen = false"
        >AMD<span class="amd-mark" aria-hidden="true"></span
      ></a>
      <span class="brand-divider"></span><span class="brand-series">RYZEN<span>™</span></span>
      <nav class="desktop-nav" aria-label="主要导航">
        <a
          v-for="item in navItems"
          :key="item.id"
          :href="`#${item.id}`"
          :class="{ active: activeSection === item.id }"
          :aria-current="activeSection === item.id ? 'location' : undefined"
          >{{ item.label }}</a
        >
      </nav>
      <a class="header-cta" href="#products">寻找你的 Ryzen <span>↗</span></a>
      <button
        ref="menuToggle"
        class="menu-toggle"
        type="button"
        :aria-expanded="menuOpen"
        aria-controls="amd-mobile-nav"
        :aria-label="menuOpen ? '关闭导航' : '打开导航'"
        @click="menuOpen = !menuOpen"
      >
        {{ menuOpen ? '✕' : '☰' }}
      </button>
      <nav
        v-if="menuOpen"
        id="amd-mobile-nav"
        class="mobile-nav"
        aria-label="移动端导航"
        @keydown.esc="closeMobileMenu"
      >
        <a v-for="item in navItems" :key="item.id" :href="`#${item.id}`" @click="menuOpen = false"
          >{{ item.label }} <span>↗</span></a
        >
      </nav>
    </header>

    <main id="main-content">
      <section
        id="overview"
        class="amd-hero"
        :class="{ energized: energy }"
        aria-labelledby="hero-title"
      >
        <div class="hero-coordinate">EST. 1969 <span>ENGINEERED TO ADVANCE</span></div>
        <div class="hero-watermark" aria-hidden="true">RYZEN</div>
        <div class="hero-copy">
          <p class="eyebrow"><span class="status-dot"></span> AMD RYZEN™ 9000 SERIES</p>
          <h1 id="hero-title">生而强悍。<br /><span>不止于快。</span></h1>
          <p class="hero-english">POWER. WITHOUT LIMITS.</p>
          <p class="hero-description">
            每一次突破，都源于一颗强大的内核。<br />AMD 锐龙 9000 系列处理器，让热爱全速发生。
          </p>
          <div class="hero-actions">
            <a href="#products" class="button-primary">探索处理器 <span>↗</span></a>
            <a href="#architecture" class="button-text"
              ><span class="play-icon">↓</span> 深入核心架构</a
            >
          </div>
        </div>
        <div class="hero-visual">
          <div class="orbital-ring" aria-hidden="true"></div>
          <ProcessorScene
            :active="energy"
            @ready="onSceneReady"
            @unsupported="sceneUnsupported = true"
          />
        </div>
        <div class="hero-controls">
          <div class="chip-caption">
            <span class="crosshair">+</span>
            <div>AMD RYZEN™ 9 9950X<small>THE POWER AT YOUR CORE</small></div>
          </div>
          <button
            v-if="!sceneUnsupported"
            class="energy-toggle"
            type="button"
            :aria-pressed="energy"
            :disabled="!sceneReady"
            @click="energy = !energy"
          >
            <span :class="{ lit: energy }" aria-hidden="true"></span
            >{{ !sceneReady ? '视效加载中' : energy ? '能量视效已开启' : '开启能量视效' }}
            <span aria-hidden="true">{{ energy ? '✓' : '+' }}</span>
          </button>
          <span class="scene-status">{{
            sceneUnsupported
              ? 'AMD Ryzen 9000 系列'
              : sceneReady
                ? '移动指针 · 探索视角'
                : '正在构建核心…'
          }}</span>
        </div>
        <div class="hero-bottom">
          <div class="hero-specs" aria-label="Ryzen 9 9950X 规格">
            <div>
              <strong>16<span>核</span></strong
              ><small>强劲核心</small>
            </div>
            <div>
              <strong>32<span>线程</span></strong
              ><small>并行创作</small>
            </div>
            <div>
              <strong>5.7<span>GHz</span></strong
              ><small>最高加速频率¹</small>
            </div>
          </div>
          <a class="scroll-cue" href="#architecture"
            ><span>SCROLL TO EXPLORE</span><span class="scroll-line">↓</span></a
          >
        </div>
        <span class="hero-index">01 — 04</span>
      </section>

      <div class="statement-strip" aria-hidden="true">
        <span>ADVANCING</span><span class="strip-symbol">✳</span><span>WHAT'S POSSIBLE</span
        ><span class="strip-symbol">✳</span><span>AMD RYZEN™</span
        ><span class="strip-symbol">✳</span>
      </div>

      <ArchitectureStory />

      <section id="experience" class="experience section-pad" aria-labelledby="experience-title">
        <div class="section-heading">
          <p class="eyebrow">02 / MADE FOR YOUR AMBITION</p>
          <span class="section-note">热爱，不设限。</span>
        </div>
        <div class="experience-top">
          <h2 id="experience-title">你的世界。<span>全速以赴。</span></h2>
          <div
            class="experience-tabs"
            role="tablist"
            aria-label="使用场景"
            @keydown="changeExperience"
          >
            <button
              v-for="(item, i) in experiences"
              :id="`tab-${item.id}`"
              :key="item.id"
              type="button"
              role="tab"
              :aria-selected="i === experienceIndex"
              :tabindex="i === experienceIndex ? 0 : -1"
              :aria-controls="`panel-${item.id}`"
              @click="experienceIndex = i"
            >
              {{ item.label }}<span>↗</span>
            </button>
          </div>
        </div>
        <div
          :id="`panel-${experience.id}`"
          class="experience-panel"
          :class="`experience-${experience.id}`"
          role="tabpanel"
          :aria-labelledby="`tab-${experience.id}`"
          tabindex="0"
        >
          <ExperienceVisual :mode="experience.id" />
          <div class="experience-content">
            <p class="eyebrow">{{ experience.kicker }}</p>
            <h3>{{ experience.title }}</h3>
            <p>{{ experience.text }}</p>
            <a class="inline-link" href="#products">发现你的处理器 <span>↗</span></a
            ><span class="experience-number">{{ experience.number }}</span>
          </div>
          <span class="experience-caption">{{ experience.note }}</span>
        </div>
      </section>

      <section id="products" class="products section-pad" aria-labelledby="products-title">
        <div class="section-heading">
          <p class="eyebrow">03 / FIND YOUR POWER</p>
          <span class="section-note">每一种热爱，都有强大内核。</span>
        </div>
        <div class="products-heading">
          <h2 id="products-title">找到你的 <span>Ryzen。</span></h2>
          <p>不同的追求，一样的全力以赴。<br />探索 AMD 锐龙 9000 系列桌面处理器。</p>
        </div>
        <ProductFinder @recommend="recommendedProduct = $event" />
        <div class="product-grid">
          <article
            v-for="product in products"
            :id="`processor-${product.id}`"
            :key="product.id"
            class="product-card"
            :class="[
              `tier-${product.tier}`,
              { 'is-recommended': recommendedProduct === product.id },
            ]"
          >
            <div class="product-card-top">
              <span>RYZEN™ {{ product.tier }}</span
              ><span>9000 SERIES</span>
            </div>
            <p v-if="recommendedProduct === product.id" class="product-recommendation">
              适合你的使用方向
            </p>
            <div class="product-art" aria-hidden="true">
              <div class="product-orbit"></div>
              <div class="mini-chip">
                <span>AMD</span><strong>RYZEN</strong><small>{{ product.name }}</small>
              </div>
              <span class="product-tier">{{ product.tier }}</span>
            </div>
            <p class="product-tag">{{ product.tag }}</p>
            <h3>
              AMD Ryzen™ {{ product.tier }}<br /><span>{{ product.name }}</span>
            </h3>
            <p class="product-description">{{ product.description }}</p>
            <dl class="product-specs">
              <div>
                <dt>核心 / 线程</dt>
                <dd>{{ product.cores }} / {{ product.threads }}</dd>
              </div>
              <div>
                <dt>最高加速频率¹</dt>
                <dd>{{ product.boost }} <span>GHz</span></dd>
              </div>
            </dl>
            <div class="product-actions">
              <a
                :href="product.url"
                target="_blank"
                rel="noopener noreferrer"
                :aria-label="`在 AMD 官网了解 Ryzen ${product.name}，在新标签页打开`"
                >了解详情 <span>↗</span></a
              ><label
                ><input
                  type="checkbox"
                  :checked="selected.includes(product.id)"
                  @change="toggleProduct(product.id)"
                /><span>加入对比</span><span class="sr-only"> Ryzen {{ product.name }}</span></label
              >
            </div>
          </article>
        </div>
        <div class="compare-bar">
          <p><span class="compare-symbol">⊞</span> 你的下一颗核心，该如何选择？</p>
          <button type="button" :disabled="!selected.length" @click="openComparison">
            对比已选处理器 <span>{{ selected.length.toString().padStart(2, '0') }}</span> ↗
          </button>
        </div>
        <p class="sr-only" role="status">{{ selectionMessage }}</p>
      </section>

      <section class="closing-section" aria-label="开启更多可能">
        <p class="eyebrow">THE NEXT IS YOURS.</p>
        <h2>下一次突破。<br /><span>由你定义。</span></h2>
        <a
          class="button-primary"
          href="https://www.amd.com/en/products/processors/desktops/ryzen.html"
          target="_blank"
          rel="noopener noreferrer"
          >前往 AMD 官方网站 <span>↗</span></a
        >
        <div class="closing-ring" aria-hidden="true"></div>
        <span class="closing-watermark" aria-hidden="true">AMD</span>
      </section>
    </main>

    <footer class="amd-footer">
      <div class="footer-top">
        <a class="amd-brand" href="#overview" aria-label="返回顶部"
          >AMD<span class="amd-mark" aria-hidden="true"></span
        ></a>
        <p>together we advance_</p>
        <a href="#overview">回到顶部 ↑</a>
      </div>
      <div class="legal-copy">
        <p>
          ¹
          最高加速频率是处理器在执行突发单线程工作负载时，单个核心可达到的最高频率。实际表现受散热、主板、BIOS
          与系统配置等因素影响。首屏规格对应 Ryzen 9 9950X；缓存为 L2 与 L3 合计。产品规格以 AMD
          官方资料为准。
        </p>
        <p>
          本页面为独立设计作品，非 AMD 官方网站。AMD、Ryzen 及相关标识属于其各自权利人。
          产品与结构图仅用于展示说明，实际规格及兼容性以 AMD 官方资料为准。
        </p>
      </div>
      <div class="footer-bottom">
        <span>RYZEN™ 9000 SERIES</span><span>DESIGNED FOR WHAT'S NEXT. <i></i></span>
      </div>
    </footer>

    <dialog
      ref="compareDialog"
      class="compare-dialog"
      aria-labelledby="compare-title"
      @close="afterClose"
      @click="
        (event) => {
          if (event.target === compareDialog) closeComparison()
        }
      "
    >
      <div class="dialog-inner">
        <div class="dialog-heading">
          <div>
            <p class="eyebrow">FIND YOUR POWER</p>
            <h2 id="compare-title">核心实力，一目了然。</h2>
          </div>
          <button
            type="button"
            class="dialog-close"
            aria-label="关闭对比"
            autofocus
            @click="closeComparison"
          >
            ✕
          </button>
        </div>
        <div
          class="table-scroll"
          tabindex="0"
          role="region"
          aria-label="处理器参数对比，可横向滚动"
        >
          <table>
            <caption class="sr-only">
              已选 AMD Ryzen 9000 系列处理器规格对比
            </caption>
            <thead>
              <tr>
                <th scope="col">处理器</th>
                <th v-for="product in comparisonProducts" :key="product.id" scope="col">
                  Ryzen {{ product.tier }}<strong>{{ product.name }}</strong>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">核心 / 线程</th>
                <td v-for="p in comparisonProducts" :key="p.id">{{ p.cores }} / {{ p.threads }}</td>
              </tr>
              <tr>
                <th scope="row">最高加速频率¹</th>
                <td v-for="p in comparisonProducts" :key="p.id">{{ p.boost }} GHz</td>
              </tr>
              <tr>
                <th scope="row">L2 + L3 缓存</th>
                <td v-for="p in comparisonProducts" :key="p.id">{{ p.cache }} MB</td>
              </tr>
              <tr>
                <th scope="row">默认 TDP</th>
                <td v-for="p in comparisonProducts" :key="p.id">{{ p.tdp }} W</td>
              </tr>
              <tr>
                <th scope="row">架构 / 插槽</th>
                <td v-for="p in comparisonProducts" :key="p.id">Zen 5 / AM5</td>
              </tr>
              <tr>
                <th scope="row">官方规格</th>
                <td v-for="p in comparisonProducts" :key="p.id">
                  <a
                    :href="p.url"
                    target="_blank"
                    rel="noopener noreferrer"
                    :aria-label="`查看 ${p.name} 官方规格`"
                    >前往 AMD ↗</a
                  >
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="dialog-note">
          ¹ 最高加速频率并非全核运行频率。请结合主板支持、散热和使用场景选择处理器。
        </p>
        <button class="button-primary" type="button" @click="closeComparison">
          继续探索 <span>↗</span>
        </button>
      </div>
    </dialog>
  </div>
</template>

<style scoped src="./style.css"></style>

<style scoped>
.product-card {
  scroll-margin-top: 100px;
}
.product-card.is-recommended {
  border-color: #dc703e;
  background: linear-gradient(145deg, #2e2016, #151311 65%);
}
.product-recommendation {
  position: absolute;
  top: 54px;
  left: 24px;
  z-index: 3;
  font-size: 12px;
  color: #ffd2b0;
  background: #60331bd9;
  padding: 5px 10px;
  border-left: 2px solid #ff7940;
}
@media (max-width: 850px) {
  .product-recommendation {
    left: 16px;
    top: 47px;
    font-size: 11px;
  }
}
@media (max-width: 600px) {
  .product-recommendation {
    left: 24px;
    top: 54px;
    font-size: 12px;
  }
}
</style>
