import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'
import { viteStaticCopy } from 'vite-plugin-static-copy'

// https://vite.dev/config/
export default defineConfig({
  define: {
    CESIUM_BASE_URL: JSON.stringify('/cesium'),
  },
  plugins: [
    vue(),
    vueDevTools(),
    viteStaticCopy({ targets: [
      { src: 'node_modules/cesium/Build/Cesium/Workers', dest: 'cesium' },
      { src: 'node_modules/cesium/Build/Cesium/ThirdParty', dest: 'cesium' },
      { src: 'node_modules/cesium/Build/Cesium/Assets', dest: 'cesium' },
      { src: 'node_modules/cesium/Build/Cesium/Widgets', dest: 'cesium' },
    ] }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    watch: {
      // 忽略构建产物、临时目录，以及编辑器/工具链写入时产生的原子临时目录
      // （这类目录会在写入瞬间被创建并锁定，chokidar 监听会抛 EBUSY 并结束进程）。
      ignored: ['**/tmp/**', '**/dist/**', '**/.*.tmpdir/**', '**/*.tmpdir/**'],
    },
  },
})
