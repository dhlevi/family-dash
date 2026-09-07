import { createPinia } from 'pinia'
import { createApp } from 'vue'
import App from './App.vue'
import { router } from './router'
import './styles/main.css'

const app = createApp(App)

app.use(createPinia())
app.use(router)

/**
 * A wall display has nobody watching a console. Log component errors loudly
 * so `docker compose logs web` and a browser console both have something to
 * go on after the fact.
 */
app.config.errorHandler = (error, _instance, info) => {
  console.error(`[family-dash] Vue error (${info})`, error)
}

app.mount('#app')
