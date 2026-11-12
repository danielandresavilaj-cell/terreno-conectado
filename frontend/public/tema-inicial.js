/* Tema antes del primer pintado — TSK-OFF-005.
 * Script clásico y síncrono en <head>: fija data-theme en <html> antes de que
 * se pinte la página, así quien eligió el modo claro no ve un destello oscuro.
 * Es un archivo propio (no un <script> en línea) para no abrir la CSP de Caddy
 * (`script-src 'self'`). Debe coincidir con `src/lib/tema.ts`. */
/* global document, localStorage */
(function () {
  var tema = 'oscuro'
  try {
    if (localStorage.getItem('tc-tema') === 'claro') tema = 'claro'
  } catch {
    /* almacenamiento bloqueado: modo oscuro por defecto */
  }
  document.documentElement.dataset.theme = tema === 'claro' ? 'light' : 'dark'
  if (tema === 'claro') {
    var meta = document.querySelector('meta[name="theme-color"]')
    if (meta) meta.setAttribute('content', '#f5f3ef')
  }
})()
