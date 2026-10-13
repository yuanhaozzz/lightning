import { createRouter, createWebHistory } from 'vue-router'
import RouteShell from './RouteShell.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/mine-digital-twin',
      name: 'mine-digital-twin',
      component: () => import('../features/mine-digital-twin/index.vue'),
    },
    { path: '/', name: 'legacy-dashboard', component: RouteShell },
    { path: '/command-center', name: 'command-center', component: RouteShell },
    { path: '/digital-twin', name: 'digital-twin-map', component: RouteShell },
    { path: '/water-screen', name: 'water-screen', component: RouteShell },
    { path: '/tianji-command', name: 'tianji-command', component: RouteShell },
    { path: '/tianji-command-v1', name: 'tianji-command-v1', component: RouteShell },
    { path: '/tianji-command-v2', name: 'tianji-command-v2', component: RouteShell },
    { path: '/tianji-command-v3', name: 'tianji-command-v3', component: RouteShell },
  ],
})

export default router
