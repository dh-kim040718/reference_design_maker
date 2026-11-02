import react from '@vitejs/plugin-react'
import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, process.cwd(), '')
  const target = environment.VITE_API_PROXY_TARGET || environment.VITE_API_BASE_URL || 'http://127.0.0.1:8000'
  return {
  plugins: [react()],
  server: {
    proxy: {
      '/health': target,
      '/api': target,
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
  }
})
