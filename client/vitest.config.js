import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.js',
    globals: true,
    // Page suites render whole routes with real timers and debounces; on a
    // loaded runner several sit near the 5 s default and time out together.
    testTimeout: 15000,
  },
})
