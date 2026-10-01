import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [vue(), VitePWA({ registerType: 'autoUpdate', includeAssets: ['icon.svg'], manifest: { name: '弘文雅思8分', short_name: '弘文雅思', description: '弘文雅思8分 · 私人雅思学习与记忆训练', theme_color: '#f5efdf', background_color: '#f5efdf', display: 'standalone', start_url: '/', icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }] }, workbox: { globPatterns: ['**/*.{js,css,html,svg,png,woff2}'] } })],
  server: { host: '127.0.0.1', port: 1420, strictPort: true },
  clearScreen: false
})
