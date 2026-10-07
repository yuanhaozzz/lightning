import { createRouter, createWebHistory } from 'vue-router'
import RouteShell from './RouteShell.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', name: 'legacy-dashboard', component: RouteShell },
    { path: '/command-center', name: 'command-center', component: RouteShell },
    { path: '/digital-twin', name: 'digital-twin-map', component: RouteShell },
    { path: '/water-screen', name: 'water-screen', component: RouteShell },
    { path: '/tianji-command', name: 'tianji-command', component: RouteShell },
  ],
})

export default router
