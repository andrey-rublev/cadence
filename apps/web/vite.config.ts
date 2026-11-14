import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
  server: {
    port: 5173,
    strictPort: true,
    // Same-origin API in development, so the session cookie needs no CORS setup.
    // CADENCE_API points a second dev stack at its own backend (see PLAN.md, How to run).
    proxy: { '/api': process.env.CADENCE_API ?? 'http://127.0.0.1:8000' },
  },
})
