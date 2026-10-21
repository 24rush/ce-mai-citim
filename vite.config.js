import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '0.0.0.0',
    proxy: {
      '/api/goodreads': {
        target: 'https://www.goodreads.com',
        changeOrigin: true,
        rewrite: (path) => {
          const url = new URL(path, 'http://localhost')
          const userId = url.pathname.replace(/^\/api\/goodreads\//, '').split('/')[0]
          const shelf = url.searchParams.get('shelf') || 'read'
          return `/review/list_rss/${userId}?shelf=${encodeURIComponent(shelf)}`
        },
      },
    },
  },
  preview: {
    host: '0.0.0.0',
    proxy: {
      '/api/goodreads': {
        target: 'https://www.goodreads.com',
        changeOrigin: true,
        rewrite: (path) => {
          const url = new URL(path, 'http://localhost')
          const userId = url.pathname.replace(/^\/api\/goodreads\//, '').split('/')[0]
          const shelf = url.searchParams.get('shelf') || 'read'
          return `/review/list_rss/${userId}?shelf=${encodeURIComponent(shelf)}`
        },
      },
    },
  },
})
