/* Tema antes del primer pintado — TSK-OFF-005.
 * Script clásico y síncrono en <head>: fija data-theme en <html> antes de que
 * se pinte la página, así quien eligió el modo claro no ve un destello oscuro.
 * Es un archivo propio (no un <script> en línea) para no abrir la CSP de Caddy
 * (`script-src 'self'`). Debe coincidir con `src/lib/tema.ts`. */
/* global document, localStorage, window */
(function () {
  /* TSK-OFF-011: sin elección guardada se sigue el tema del sistema; a pleno
   * sol muchos teléfonos ya están en claro y una pantalla clara se lee mejor. */
  var guardado = null
  try {
    guardado = localStorage.getItem('tc-tema')
  } catch {
    /* almacenamiento bloqueado: se sigue el sistema */
  }
  var prefiereClaro = false
  try {
    prefiereClaro = window.matchMedia('(prefers-color-scheme: light)').matches
  } catch {
    /* sin matchMedia: oscuro */
  }
  var tema = guardado === 'claro' || guardado === 'oscuro' ? guardado : prefiereClaro ? 'claro' : 'oscuro'
  document.documentElement.dataset.theme = tema === 'claro' ? 'light' : 'dark'
  if (tema === 'claro') {
    var meta = document.querySelector('meta[name="theme-color"]')
    if (meta) meta.setAttribute('content', '#f5f3ef')
  }
})()
