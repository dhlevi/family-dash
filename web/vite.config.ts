import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'

/**
 * The dev server proxies the API so the front end always talks to a
 * same-origin `/api`, exactly as it does in production behind nginx. That
 * keeps the API client free of environment branching.
 */
const apiTarget = process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:3000'

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true },
      '/media': { target: apiTarget, changeOrigin: true },
      '/healthCheck': { target: apiTarget, changeOrigin: true },
      '/openapi': { target: apiTarget, changeOrigin: true }
    }
  },
  build: {
    outDir: 'dist',
    // The Pi's browser is the only consumer; a source map costs nothing to
    // ship and makes a console error in the field readable.
    sourcemap: true,
    chunkSizeWarningLimit: 900
  }
})
