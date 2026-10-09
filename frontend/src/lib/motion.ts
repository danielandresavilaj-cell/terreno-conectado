/* Tokens de movimiento compartidos.
 *
 * Contrato de este mockup: los botones SÍ reaccionan (el usuario lo pide
 * explícitamente), pero no hay lógica de negocio detrás. Cada interacción
 * visible es un cambio de estado visual local.
 *
 * Valores derivados de emil-design-eng:
 *  · entradas   → ease-out fuerte, 180–260 ms
 *  · modales/sheets → spring suave, 260–380 ms, origen en el disparador
 *  · presión    → scale(0.97), 160 ms (transición CSS, no keyframes)
 *  · contadores → 500–700 ms, se ejecutan una vez por montaje
 *  · movimiento continuo (pulse) → linear/spring, nunca ease-in
 */

/** Curvas CSS expuestas como easing de Motion. */
export const EASE = {
  out: [0.23, 1, 0.32, 1],
  inOut: [0.77, 0, 0.175, 1],
  drawer: [0.32, 0.72, 0, 1],
} as const

/** Stagger de 40 ms: cascada legible sin ralentizar (rango sano 30–80 ms). */
export const STAGGER = 0.04
