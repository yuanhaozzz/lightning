<script setup lang="ts">
defineProps<{ name: string; size?: number }>()
const paths: Record<string, string> = {
  globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18Z',
  layers: 'm12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5',
  bolt: 'm13 2-8 12h6l-1 8 9-13h-7l1-7Z',
  shield: 'm12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Zm-4 9 3 3 5-6',
  target: 'M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z',
  expand: 'M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5',
  grid: 'M3 3h6v6H3V3Zm12 0h6v6h-6V3ZM3 15h6v6H3v-6Zm12 0h6v6h-6v-6Z',
  chevron: 'm9 5 7 7-7 7',
  arrow: 'M4 12h16m-6-6 6 6-6 6',
  close: 'm6 6 12 12M6 18 18 6',
  plus: 'M5 12h14M12 5v14',
  minus: 'M5 12h14',
  reset: 'M3 10a9 9 0 1 1 2 8M3 4v6h6',
  play: 'm8 4 12 8-12 8V4Z',
  pause: 'M8 5v14M16 5v14',
  radar: 'M12 3a9 9 0 1 0 9 9M12 7a5 5 0 1 0 5 5m-5 0 8-8M12 12h.01',
  building: 'M4 21V8h9v13M13 13h7v8M7 11h3m-3 4h3M3 21h18M8 8V3',
  check: 'm5 12 4 4L19 6',
  signal: 'M4 19v-3m5 3v-7m5 7V8m5 11V4',
  download: 'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',
}
</script>

<template>
  <svg
    :width="size || 20"
    :height="size || 20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.5"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path :d="paths[name] || paths.globe" />
  </svg>
</template>
