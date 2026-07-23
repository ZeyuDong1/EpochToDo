import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

/**
 * Standalone Vite config for browser preview (no Electron).
 * Usage: npx vite --config vite.preview.config.ts --port 3999
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3999,
    strictPort: false,
  },
})
