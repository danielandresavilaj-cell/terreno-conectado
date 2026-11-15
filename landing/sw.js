/* Retiro del service worker antiguo (TSK-OFF-023).
 *
 * Hasta noviembre de 2026 la app vivía en la raíz y registraba `/sw.js` con
 * alcance `/`. Ahora la raíz es la landing y la app vive en `/app/` con su
 * propio service worker (`/app/sw.js`). Los teléfonos que ya la tenían
 * instalada piden este archivo al buscar actualización: se activa de
 * inmediato, borra las cachés del shell antiguo, se desregistra y lleva las
 * pestañas abiertas a `/app/` (con la misma pantalla). Los datos sin enviar
 * están en IndexedDB del dominio, no en este service worker: no se tocan.
 */
self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const nombres = await caches.keys()
      // Sólo las cachés del shell antiguo (alcance raíz); las de /app/ quedan.
      await Promise.all(nombres.filter((n) => !n.includes('/app/')).map((n) => caches.delete(n)))
      await self.registration.unregister()
      const ventanas = await self.clients.matchAll({ type: 'window' })
      for (const ventana of ventanas) {
        const url = new URL(ventana.url)
        if (!url.pathname.startsWith('/app/')) ventana.navigate(new URL('/app/' + url.hash, url.origin).href)
      }
    })(),
  )
})
