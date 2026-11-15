/* La app vive en /app (TSK-OFF-023). Antes vivía en la raíz, así que:
 *  - una app ya instalada en el teléfono abre la raíz (su start_url antigua):
 *    si corre como app instalada, va directo a /app;
 *  - un enlace viejo a una pantalla (`/#captura`, `/#cola`…) sigue funcionando.
 * Va en el <head> y sin `defer` para redirigir antes de pintar la landing. */
;(() => {
  const PANTALLAS = [
    'cuenta', 'administracion', 'plataforma', 'formularios', 'captura', 'bitacora', 'cola',
    'dashboard', 'conflictos', 'importar', 'crear-formulario', 'plantillas', 'hallazgos', 'activos',
  ]
  const hash = location.hash.replace(/^#/, '')
  const instalada =
    window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true
  if (instalada || PANTALLAS.includes(hash)) location.replace('/app/' + location.hash)
})()
