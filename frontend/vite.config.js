import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
      '/uploads': 'http://localhost:8000',
    },
  },
  optimizeDeps: {
    // Tell Vite to pre-bundle pdfjs-dist so the worker URL resolves correctly
    include: ['pdfjs-dist'],
  },
  build: {
    rollupOptions: {
      // Keep pdfjs worker as a separate chunk so import.meta.url works
      output: {
        manualChunks: {
          pdfjs: ['pdfjs-dist'],
        },
      },
    },
  },
})
