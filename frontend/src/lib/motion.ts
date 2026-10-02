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

import type { Transition } from 'motion/react'

/** Curvas CSS expuestas como easing de Motion. */
export const EASE = {
  out: [0.23, 1, 0.32, 1],
  inOut: [0.77, 0, 0.175, 1],
  drawer: [0.32, 0.72, 0, 1],
} as const

/** Entrada estándar de bloque de contenido: sube 8px y aparece. */
export const enterBlock: Transition = {
  duration: 0.26,
  ease: EASE.out,
}

/** Entrada de sheet/drawer: spring con rebote mínimo. */
export const sheetSpring: Transition = { type: 'spring', duration: 0.42, bounce: 0.16 }

/** Pop de selección en un control segmentado (ok/nok/na, severidad).
 *  Ocurre decenas de veces por sesión → spring corto, casi sin rebote. */
export const tapPop: Transition = { type: 'spring', duration: 0.26, bounce: 0.22 }

/** Stagger de 40 ms: cascada legible sin ralentizar (rango sano 30–80 ms). */
export const STAGGER = 0.04

/** Escala de salida: nunca scale(0), nada aparece de la nada. */
export const FROM = { opacity: 0, scale: 0.95, y: 8 } as const
