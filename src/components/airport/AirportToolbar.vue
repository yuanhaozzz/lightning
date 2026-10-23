<script setup lang="ts">
import AirportIcon from './AirportIcon.vue'
import type { AirportView } from '../../config/airport'

defineProps<{ activeView: AirportView | 'custom'; panelsVisible: boolean; disabled?: boolean }>()
defineEmits<{ view: [view: AirportView]; reset: []; 'toggle-panels': [] }>()

const views: {
  value: AirportView
  label: string
  icon: 'overview' | 'aircraft' | 'bridge' | 'service'
}[] = [
  { value: 'overview', label: '总览', icon: 'overview' },
  { value: 'aircraft', label: '飞机', icon: 'aircraft' },
  { value: 'bridge', label: '廊桥', icon: 'bridge' },
  { value: 'service', label: '作业视角', icon: 'service' },
]
</script>

<template>
  <footer class="airport-toolbar" aria-label="场景控制">
    <div class="airport-stand-label">
      <AirportIcon name="layers" /><strong>A21</strong><span>近机位</span>
    </div>
    <div class="airport-view-controls" role="group" aria-label="观察视角">
      <button
        v-for="view in views"
        :key="view.value"
        type="button"
        :class="['airport-view-button', { 'is-active': activeView === view.value }]"
        :aria-pressed="activeView === view.value"
        :disabled="disabled"
        @click="$emit('view', view.value)"
      >
        <AirportIcon :name="view.icon" /><span>{{ view.label }}</span>
      </button>
    </div>
    <div class="airport-utility-controls">
      <button
        class="airport-utility-button"
        type="button"
        :disabled="disabled"
        @click="$emit('reset')"
        title="恢复初始镜头与观察中心，不改变任务状态"
      >
        <AirportIcon name="reset" /><span>视角复位</span>
      </button>
      <button
        class="airport-utility-button airport-panels-toggle"
        type="button"
        :aria-pressed="!panelsVisible"
        @click="$emit('toggle-panels')"
      >
        <AirportIcon :name="panelsVisible ? 'eye' : 'eye-off'" /><span>{{
          panelsVisible ? '隐藏面板' : '显示面板'
        }}</span>
      </button>
    </div>
  </footer>
</template>

<style scoped>
.airport-toolbar {
  position: absolute;
  left: 50%;
  bottom: 24px;
  transform: translateX(-50%);
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 24px;
  height: 64px;
  width: calc(100% - 56px);
  max-width: 1440px;
  padding: 0 18px 0 28px;
  background: rgba(255, 255, 255, 0.86);
  border: 1px solid rgba(255, 255, 255, 0.8);
  border-radius: 12px;
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  box-shadow: 0 7px 26px rgba(34, 54, 77, 0.1);
  color: #253e5d;
}
.airport-stand-label {
  display: flex;
  align-items: center;
  gap: 11px;
  white-space: nowrap;
  font-size: 15px;
}
.airport-stand-label :deep(.airport-icon) {
  width: 23px;
  height: 23px;
  margin-right: 4px;
  color: #536b87;
}
.airport-stand-label strong {
  font-size: 17px;
  font-weight: 700;
  letter-spacing: 0.4px;
}
.airport-stand-label > span {
  font-weight: 500;
}
.airport-view-controls {
  display: flex;
  align-items: center;
  padding: 3px;
  border: 1px solid rgba(221, 230, 241, 0.35);
  border-radius: 24px;
  background: rgba(243, 247, 252, 0.82);
}
.airport-view-button,
.airport-utility-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 9px;
  margin: 0;
  padding: 0 22px;
  height: 40px;
  border: 0;
  border-radius: 22px;
  background: transparent;
  color: #65758b;
  font: inherit;
  font-size: 14px;
  font-weight: 500;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
  box-shadow: none;
  transition:
    background 0.18s,
    color 0.18s,
    box-shadow 0.18s;
}
.airport-view-button {
  min-width: 112px;
}
.airport-view-button :deep(.airport-icon) {
  width: 17px;
  height: 17px;
}
.airport-view-button:hover:not(.is-active):not(:disabled),
.airport-utility-button:hover:not(:disabled) {
  background: #e5eef9;
  color: #2e5e9f;
}
.airport-view-button.is-active {
  color: white;
  background: #3478f6;
  box-shadow:
    0 3px 8px rgba(52, 120, 246, 0.18),
    inset 0 1px 0 #ffffff20;
}
.airport-view-button:focus-visible,
.airport-utility-button:focus-visible {
  outline: 2px solid #3478f6;
  outline-offset: 3px;
}
.airport-view-button:disabled,
.airport-utility-button:disabled {
  opacity: 0.48;
  cursor: wait;
}
.airport-utility-controls {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}
.airport-utility-button {
  padding: 0 15px;
  background: rgba(242, 247, 252, 0.6);
}
.airport-utility-button :deep(.airport-icon) {
  width: 17px;
  height: 17px;
}
.airport-panels-toggle {
  min-width: 120px;
}
@media (max-width: 1480px) {
  .airport-toolbar {
    gap: 18px;
    padding-left: 24px;
  }
  .airport-view-button {
    min-width: 104px;
    padding: 0 18px;
  }
}
@media (max-width: 900px) {
  .airport-toolbar {
    gap: 12px;
    padding: 0 14px;
  }
  .airport-stand-label {
    gap: 7px;
    font-size: 13px;
  }
  .airport-stand-label :deep(.airport-icon) {
    display: none;
  }
  .airport-view-button {
    min-width: 80px;
    padding: 0 13px;
  }
  .airport-utility-button {
    padding: 0 10px;
    gap: 6px;
  }
  .airport-panels-toggle {
    min-width: 104px;
  }
}
@media (max-width: 700px) {
  .airport-toolbar {
    width: calc(100% - 28px);
    bottom: 14px;
    height: auto;
    min-height: 104px;
    padding: 9px 12px;
    grid-template-columns: 1fr auto;
    gap: 6px 10px;
  }
  .airport-stand-label {
    grid-column: 1;
  }
  .airport-view-controls {
    grid-row: 2;
    grid-column: 1 / -1;
    justify-self: center;
  }
  .airport-utility-controls {
    grid-row: 1;
    grid-column: 2;
  }
  .airport-utility-button {
    height: 30px;
    font-size: 12px;
  }
  .airport-panels-toggle {
    min-width: 92px;
  }
  .airport-view-button {
    height: 34px;
    min-width: 76px;
    padding: 0 9px;
    gap: 6px;
  }
}
</style>
