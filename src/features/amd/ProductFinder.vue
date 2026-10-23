<script setup lang="ts">
import { computed, ref, useId } from 'vue'

const emit = defineEmits<{
  recommend: [productId: string | null]
}>()

const finderId = useId()
const options = [
  {
    id: 'all',
    label: '查看全部',
    productId: null,
    title: '从你的使用习惯开始。',
    description:
      '选择一个使用方向，了解相关的核心配置；也可以直接浏览下方产品，加入对比后查看完整规格。',
  },
  {
    id: 'gaming',
    label: '游戏与多任务',
    productId: '9700x',
    title: '可优先了解 Ryzen 7 9700X',
    description:
      '游戏之外，也为语音、浏览器与日常多任务留出空间。8 核心 / 16 线程，默认 TDP 为 65W。',
  },
  {
    id: 'creation',
    label: '多线程创作',
    productId: '9950x',
    title: '可优先了解 Ryzen 9 9950X',
    description:
      '面向渲染、编码等可利用多线程的创作任务，提供 16 核心 / 32 线程与 80MB L2 + L3 缓存。',
  },
  {
    id: 'development',
    label: '日常开发',
    productId: '9600x',
    title: '可优先了解 Ryzen 5 9600X',
    description:
      '从编辑代码到运行本地服务，6 核心 / 12 线程可作为日常开发的配置起点，采用 AM5 平台。',
  },
] as const

const selectedId = ref<(typeof options)[number]['id']>('all')
const recommendation = computed(() => options.find((option) => option.id === selectedId.value)!)

function selectOption(option: (typeof options)[number]) {
  selectedId.value = option.id
  emit('recommend', option.productId)
}
</script>

<template>
  <div class="product-finder">
    <fieldset class="finder-directions">
      <legend>你的电脑，主要用来做什么？</legend>
      <div class="finder-options">
        <label v-for="option in options" :key="option.id" class="finder-option">
          <input
            type="radio"
            :name="`processor-use-${finderId}`"
            :value="option.id"
            :checked="selectedId === option.id"
            @change="selectOption(option)"
          />
          <span>{{ option.label }}</span>
        </label>
      </div>
    </fieldset>

    <div class="finder-result">
      <div class="finder-copy" aria-live="polite" aria-atomic="true">
        <p class="finder-title">{{ recommendation.title }}</p>
        <p class="finder-description">{{ recommendation.description }}</p>
      </div>
      <a
        v-if="recommendation.productId"
        class="finder-link"
        :href="`#processor-${recommendation.productId}`"
      >
        查看这款处理器 <span aria-hidden="true">↓</span>
      </a>
      <p v-else class="finder-note">3 款处理器，探索更多可能</p>
    </div>
  </div>
</template>

<style scoped>
.product-finder {
  margin-bottom: 24px;
  padding: 24px;
  border: 1px solid #ffffff24;
  background: linear-gradient(110deg, #191612, #121212 70%);
}
.finder-directions {
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}
.finder-directions legend {
  padding: 0;
  margin-bottom: 16px;
  color: #e7e0d8;
  font-size: 15px;
  font-weight: 500;
}
.finder-options {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.finder-option {
  position: relative;
  cursor: pointer;
}
.finder-option input {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
.finder-option span {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 44px;
  padding: 10px 20px;
  border: 1px solid #ffffff30;
  color: #c5bdb4;
  background: #0d0d0d;
  font-size: 14px;
  line-height: 1.5;
  transition:
    color 160ms,
    border-color 160ms,
    background 160ms;
}
.finder-option:hover span {
  color: #fff4e9;
  border-color: #c68b64;
}
.finder-option input:checked + span {
  color: #fff1e6;
  border-color: #ed7e48;
  background: #5b2a15;
}
.finder-option input:focus-visible + span {
  outline: 2px solid #ffaf7e;
  outline-offset: 4px;
}
.finder-result {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  min-height: 108px;
  margin-top: 20px;
  padding-top: 20px;
  border-top: 1px solid #ffffff1a;
}
.finder-copy {
  max-width: 730px;
}
.product-finder .finder-title {
  margin: 0 0 6px;
  color: #f1e9e0;
  font-size: 18px;
  font-weight: 600;
  line-height: 1.5;
}
.product-finder .finder-description {
  margin: 0;
  color: #bcb2a8;
  font-size: 14px;
  line-height: 1.8;
}
.product-finder .finder-link {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  gap: 16px;
  min-height: 44px;
  color: #ffb284;
  font-size: 14px;
  white-space: nowrap;
}
.finder-link:hover {
  text-decoration: underline;
  text-underline-offset: 5px;
}
.finder-note {
  flex-shrink: 0;
  margin: 0;
  color: #b1a397;
  font-size: 12px;
}
@media (max-width: 850px) {
  .finder-result {
    align-items: flex-start;
    flex-direction: column;
    gap: 10px;
  }
  .finder-note {
    display: flex;
    align-items: center;
    min-height: 44px;
  }
}
@media (max-width: 600px) {
  .product-finder {
    padding: 20px 16px;
  }
  .finder-options {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .finder-option span {
    padding-inline: 8px;
  }
  .finder-copy {
    min-height: 136px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .finder-option span {
    transition: none;
  }
}
</style>
