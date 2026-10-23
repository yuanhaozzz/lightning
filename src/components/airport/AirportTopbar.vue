<script setup lang="ts">
defineProps<{ mode: 'overview' | 'operations' }>()
defineEmits<{ 'change-mode': [mode: 'overview' | 'operations'] }>()
</script>

<template>
  <header class="airport-topbar">
    <div class="airport-brand" aria-label="AEROTWIN 机场地面保障">
      <svg class="airport-brand-symbol" viewBox="0 0 40 36" fill="none" aria-hidden="true">
        <path d="M2 31 16 4l5 10-9 17H2Z" fill="#398EF4" />
        <path d="m23 4 15 27H27l-9-17 5-10Z" fill="#65B6F5" />
        <path d="m19.8 20 6 11H14l5.8-11Z" fill="#3478F6" />
      </svg>
      <span class="airport-brand-divider" aria-hidden="true" />
      <strong>AEROTWIN</strong><span class="airport-brand-description">机场地面保障</span>
    </div>
    <nav class="airport-primary-nav" aria-label="主要导航">
      <button
        :class="['airport-nav-button', { 'is-current': mode === 'overview' }]"
        type="button"
        :aria-current="mode === 'overview' ? 'page' : undefined"
        @click="$emit('change-mode', 'overview')"
      >
        机位总览
      </button>
      <button
        :class="['airport-nav-button', { 'is-current': mode === 'operations' }]"
        type="button"
        :aria-current="mode === 'operations' ? 'page' : undefined"
        @click="$emit('change-mode', 'operations')"
      >
        保障作业
      </button>
      <span class="airport-disabled-nav" tabindex="0" aria-label="运行回放，后续版本开放"
        ><button class="airport-nav-button" type="button" disabled tabindex="-1">运行回放</button
        ><span class="airport-nav-tooltip" role="tooltip">后续版本开放</span></span
      >
    </nav>
    <span class="airport-demo-label"><span aria-hidden="true" />演示数据</span>
  </header>
</template>

<style scoped>
.airport-topbar {
  position: absolute;
  z-index: 10;
  inset: 0 0 auto;
  height: 64px;
  display: flex;
  align-items: center;
  padding: 0 30px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.65);
  background: rgba(244, 249, 255, 0.88);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  box-shadow: 0 1px 12px rgba(24, 49, 76, 0.035);
  color: #152b4a;
}
.airport-brand {
  display: flex;
  align-items: center;
  gap: 14px;
  white-space: nowrap;
}
.airport-brand-symbol {
  width: 36px;
  height: 36px;
  flex-shrink: 0;
}
.airport-brand-divider {
  height: 25px;
  width: 1px;
  background: #cedceb;
  margin: 0 2px;
}
.airport-brand strong {
  font-size: 25px;
  font-weight: 760;
  letter-spacing: -0.65px;
  line-height: 1;
}
.airport-brand-description {
  font-size: 17px;
  font-weight: 600;
  letter-spacing: 0.3px;
}
.airport-primary-nav {
  position: absolute;
  left: 50%;
  top: 0;
  height: 64px;
  transform: translateX(-50%);
  display: flex;
  align-items: stretch;
  gap: 44px;
}
.airport-nav-button {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 64px;
  padding: 0 12px;
  margin: 0;
  border: 0;
  border-radius: 0;
  background: none;
  color: #7f8da0;
  font: inherit;
  font-size: 16px;
  font-weight: 600;
  letter-spacing: 0.4px;
  white-space: nowrap;
  box-shadow: none;
  cursor: pointer;
}
.airport-nav-button:not(:disabled):hover {
  color: #2669e8;
}
.airport-nav-button:focus-visible {
  outline: 2px solid #3478f6;
  outline-offset: -6px;
}
.airport-nav-button.is-current {
  color: #2669e8;
  cursor: default;
}
.airport-nav-button.is-current::after {
  content: '';
  height: 3px;
  width: 100%;
  position: absolute;
  bottom: 0;
  left: 0;
  border-radius: 2px 2px 0 0;
  background: #3478f6;
}
.airport-nav-button:disabled {
  cursor: not-allowed;
  opacity: 0.85;
}
.airport-disabled-nav {
  position: relative;
  display: flex;
  cursor: not-allowed;
  outline-offset: -7px;
}
.airport-nav-tooltip {
  position: absolute;
  left: 50%;
  top: 72px;
  transform: translate(-50%, -3px);
  padding: 8px 12px;
  border-radius: 7px;
  background: #263b54;
  color: #fff;
  font-size: 12px;
  font-weight: 400;
  white-space: nowrap;
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transition:
    opacity 0.15s,
    transform 0.15s;
  box-shadow: 0 4px 14px #152b4a1a;
}
.airport-disabled-nav:hover .airport-nav-tooltip,
.airport-disabled-nav:focus-visible .airport-nav-tooltip {
  opacity: 1;
  visibility: visible;
  transform: translate(-50%, 0);
}
.airport-demo-label {
  display: inline-flex;
  gap: 7px;
  align-items: center;
  margin-left: auto;
  padding: 7px 14px;
  border: 1px solid #3478f61e;
  border-radius: 18px;
  color: #3779de;
  background: #e6f0ff9c;
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
}
.airport-demo-label > span {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #6198eb;
}
@media (max-width: 1480px) {
  .airport-topbar {
    padding: 0 28px;
  }
  .airport-brand {
    gap: 10px;
  }
  .airport-brand strong {
    font-size: 22px;
  }
  .airport-brand-description {
    font-size: 15px;
  }
  .airport-primary-nav {
    left: 58%;
    gap: 32px;
  }
}
@media (max-width: 1000px) {
  .airport-brand-description {
    display: none;
  }
  .airport-primary-nav {
    left: 56%;
    gap: 16px;
  }
}
@media (max-width: 700px) {
  .airport-topbar {
    padding: 0 14px;
  }
  .airport-brand {
    gap: 7px;
  }
  .airport-brand-symbol {
    width: 27px;
  }
  .airport-brand-divider {
    display: none;
  }
  .airport-brand strong {
    font-size: 18px;
  }
  .airport-primary-nav {
    position: static;
    transform: none;
    margin-left: auto;
    gap: 4px;
  }
  .airport-nav-button {
    padding: 0 8px;
    font-size: 13px;
  }
  .airport-demo-label {
    display: none;
  }
}
</style>
