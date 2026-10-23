<script setup lang="ts">
import { defineAsyncComponent } from 'vue'
import { RouterView, useRoute } from 'vue-router'

// Standalone experiences avoid loading the legacy Cesium dashboard shell.
const route = useRoute()
const LegacyApp = defineAsyncComponent(() => import('./App.vue'))
</script>

<template>
  <RouterView v-if="route.name === 'aerotwin' || route.meta.standalone" />
  <LegacyApp v-else />
</template>
