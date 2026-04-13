import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/run-pipeline': 'http://localhost:8000',
      '/download-resume': 'http://localhost:8000',
      '/health': 'http://localhost:8000',
    },
  },
})
