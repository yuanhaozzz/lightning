<script setup lang="ts">
defineProps<{
  name: 'layers' | 'overview' | 'aircraft' | 'bridge' | 'service' | 'reset' | 'eye' | 'eye-off'
}>()
</script>

<template>
  <svg
    class="airport-icon"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.7"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <template v-if="name === 'layers'">
      <path d="m12 3 9 5-9 5-9-5 9-5Z" />
      <path d="m3 12 9 5 9-5M3 16l9 5 9-5" />
    </template>
    <template v-else-if="name === 'overview'">
      <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" />
      <path d="m4 7.5 8 4.5 8-4.5M12 12v9M8 5.3l8 4.5" />
    </template>
    <template v-else-if="name === 'aircraft'">
      <path
        d="m20.7 3.3-1.4-.4-5.7 6-8-1.8-1.8 1.8 6.6 3.1-4 4.5-3-.3-1.1 1.1 4.4 2.1 2.1 4.4 1.1-1.1-.3-3 4.5-4 3.1 6.6 1.8-1.8-1.8-8 6-5.7-.5-1.5Z"
        transform="translate(1 -1) scale(.87)"
      />
    </template>
    <template v-else-if="name === 'bridge'">
      <path d="M3 4h4v16H3zM7 7h11v8H7M11 7v8M15 7v8M18 6h3v10h-3M17 16v4M15 20h4" />
    </template>
    <template v-else-if="name === 'service'">
      <path d="M3 6h10v11H3zM13 10h4l4 4v3h-8M16 10v4h5" />
      <circle cx="6" cy="19" r="2" />
      <circle cx="17" cy="19" r="2" />
    </template>
    <template v-else-if="name === 'reset'"><path d="M4 10a8 8 0 1 1 1.5 7M4 4v6h6" /></template>
    <template v-else-if="name === 'eye'">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </template>
    <template v-else>
      <path
        d="m3 3 18 18M10.6 5.1 12 5c6.5 0 10 7 10 7a18 18 0 0 1-3 3.8M6.3 6.3A21 21 0 0 0 2 12s3.5 7 10 7c1.7 0 3.3-.5 4.6-1.2M10 10a3 3 0 0 0 4 4"
      />
    </template>
  </svg>
</template>

<style scoped>
.airport-icon {
  display: block;
  flex: 0 0 auto;
  width: 20px;
  height: 20px;
}
</style>
