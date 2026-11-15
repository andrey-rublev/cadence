import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Northwind's own site. Its API (backend/partner_demo) is a separate service; Cadence is
// reached directly from the browser only to hand over evidence (VITE_CADENCE_API).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
  server: {
    port: 5180,
    strictPort: true,
    proxy: { '/api': process.env.NORTHWIND_API ?? 'http://127.0.0.1:8100' },
  },
})
