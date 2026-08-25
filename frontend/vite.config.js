import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
    },
  },
  server: {
    port: 5173,
    // ลูกค้าสแกน QR จากมือถือในวง LAN เดียวกันตอน dev ต้อง expose ออกนอก localhost
    host: true,
  },
})
