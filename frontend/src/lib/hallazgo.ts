/* Reglas del hallazgo en el dispositivo — TSK-OFF-007 (FR-032).
 *
 * Lógica pura, sin React: se prueba en `test/hallazgo.test.ts`.
 */
import type { Severidad } from './types'

/** Largo mínimo para que una descripción diga algo ("ok", "." no sirven). */
export const DESCRIPCION_MINIMA = 5

/** TSK-OFF-016: máximo de fotos por hallazgo (se impone en la interfaz). */
export const MAX_FOTOS_HALLAZGO = 5

export interface ErroresHallazgo {
  severidad?: string
  descripcion?: string
}

/** Un hallazgo alta o crítica se destaca en supervisión (FR-035): sin una
 *  descripción, quien lo recibe no sabe qué pasó ni dónde. */
export function exigeDescripcion(sev: Severidad | null): boolean {
  return sev === 'alta' || sev === 'critica'
}

/**
 * La severidad la elige la persona: no viene preseleccionada, porque un valor
 * por omisión ("media") terminaba siendo el que se guardaba sin pensarlo.
 */
export function erroresDeHallazgo(sev: Severidad | null, descripcion: string): ErroresHallazgo {
  const errores: ErroresHallazgo = {}
  if (!sev) errores.severidad = 'Elige la severidad del hallazgo.'
  if (exigeDescripcion(sev) && descripcion.trim().length < DESCRIPCION_MINIMA) {
    errores.descripcion = 'Describe qué observaste: un hallazgo de severidad alta o crítica necesita descripción.'
  }
  return errores
}

/** Resumen corto para la cola local. */
export function detalleDeHallazgo(descripcion: string): string {
  const limpio = descripcion.trim().replace(/\s+/g, ' ')
  if (!limpio) return 'Sin descripción'
  return limpio.length > 42 ? `${limpio.slice(0, 41)}…` : limpio
}
