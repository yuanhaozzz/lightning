import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './RouteApp.vue'
import router from './router'

const app = createApp(App)

app.use(createPinia())
app.use(router)

// Resolve the initial route before choosing its lazy page shell.
void router.isReady().then(() => app.mount('#app'))
