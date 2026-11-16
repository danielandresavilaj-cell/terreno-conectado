/* Desplegar y plegar sin perder el lugar — TSK-REP-019.
 *
 * Al abrir el detalle de una inspección en su misma ficha se puede plegar otro
 * que estaba abierto más arriba; sin compensar, la ficha tocada saltaría hacia
 * arriba y la persona perdería dónde estaba. `conservarPosicion` mide el
 * elemento tocado antes y después del cambio y desplaza la página la diferencia.
 */

/** Ejecuta `accion` y deja `ancla` en el mismo lugar de la pantalla. */
export function conservarPosicion(ancla: HTMLElement, accion: () => void): void {
  const antes = ancla.getBoundingClientRect().top
  accion()
  requestAnimationFrame(() => {
    if (!ancla.isConnected) return
    const diferencia = ancla.getBoundingClientRect().top - antes
    if (Math.abs(diferencia) > 1) window.scrollBy(0, diferencia)
  })
}

/**
 * Tras plegar un detalle largo, si el inicio de su ficha quedó por encima de la
 * barra superior, la trae justo debajo de ella. Si se ve, no mueve nada.
 */
export function asomarSiQuedoArriba(el: HTMLElement | null, margen = 72): void {
  if (!el) return
  requestAnimationFrame(() => {
    if (!el.isConnected) return
    const top = el.getBoundingClientRect().top
    if (top < margen) window.scrollBy(0, top - margen)
  })
}
