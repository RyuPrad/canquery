import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    // Keep the manifest in the release artifact, including non-dotfile copies.
    manifest: 'asset-manifest.json',
  },
  server: {
    proxy: {
      '/web-api': { target: 'http://localhost:3100', changeOrigin: true },
      '/api': {
        target: 'http://localhost:3100',
        changeOrigin: true,
      },
    },
  },
})
