import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  // TSK-OFF-023: la raíz del dominio es la landing pública; la app vive en
  // /app/ (mismo origen: la sesión y lo pendiente en IndexedDB se conservan).
  base: '/app/',
  // ExcelJS publica una build específica para browser. La entrada por defecto
  // incluye módulos Node (`fs`, `Buffer`) y rompe al importar una planilla en
  // Vite; el alias mantiene la entrada Node para backend/shared tests.
  resolve: {
    alias: {
      exceljs: 'exceljs/dist/exceljs.min.js',
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // La actualización se descarga, pero nunca recarga una captura a mitad de
      // turno: la persona la busca y confirma desde Mi cuenta (TSK-OFF-019).
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['pwa-192.png', 'pwa-512.png'],
      manifest: {
        name: 'Terreno Conectado',
        short_name: 'Terreno',
        description:
          'Captura de datos operacionales offline-first para faenas mineras y obras.',
        lang: 'es-CL',
        theme_color: '#0e0f11',
        background_color: '#0e0f11',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/app/',
        scope: '/app/',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          {
            src: 'pwa-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // Relativo al service worker (/app/sw.js) → /app/index.html. Sólo se
        // aplica a navegaciones dentro de /app/: la landing no es de la app.
        navigateFallback: 'index.html',
        navigateFallbackAllowlist: [/^\/app(\/|$)/],
        navigateFallbackDenylist: [/^\/api\//, /^\/api$/],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.(?:googleapis|gstatic)\.com\/.*/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'google-fonts',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
        ],
      },
    }),
  ],
  // Lee el `.env` de la raíz del monorepo, no `frontend/.env`: así las `VITE_*`
  // (demo, API) salen del mismo `.env` que usa el backend, en dev, test y build,
  // en cualquier plataforma. En CI no hay `.env` y Vite toma las `VITE_*` del
  // entorno del job. (Sin esto, un clon limpio en Windows no encuentra las VITE_*.)
  envDir: '..',
  server: { host: true, port: 5173 },
})
