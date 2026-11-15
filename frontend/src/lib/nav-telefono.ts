/* Reparto de secciones en la barra inferior del teléfono — TSK-OFF-022.
 *
 * En el teléfono la navegación va abajo, al alcance del pulgar, para todos los
 * roles de empresa. Caben cinco botones cómodos en 360 px: con cinco secciones
 * o menos van todas; con más, van las cuatro que ese rol usa a diario y el
 * quinto botón, "Más", abre una hoja con el resto.
 *
 * El administrador de plataforma tiene una sola sección y no lleva barra.
 */
import type { Pantalla } from './navegacion'
import type { Rol } from './types'

export const MAX_BOTONES_BARRA = 5

/** Las cuatro secciones de uso diario por rol cuando no caben todas. */
const PRINCIPALES: Partial<Record<Rol, Pantalla[]>> = {
  supervisor: ['formularios', 'captura', 'dashboard', 'hallazgos'],
  tenant_admin: ['dashboard', 'hallazgos', 'administracion', 'plantillas'],
}

export interface RepartoBarra {
  /** Botones que se ven siempre en la barra, en el orden de `secciones`. */
  principales: Pantalla[]
  /** Secciones que van en la hoja "Más" (vacía si caben todas). */
  mas: Pantalla[]
}

/** `secciones` llega en el orden de la navegación (el de las pestañas). */
export function repartirSecciones(rol: Rol, secciones: Pantalla[]): RepartoBarra {
  if (secciones.length <= MAX_BOTONES_BARRA) return { principales: secciones, mas: [] }
  const preferidas = (PRINCIPALES[rol] ?? []).filter((p) => secciones.includes(p))
  const elegidas = new Set<Pantalla>(preferidas)
  for (const s of secciones) {
    if (elegidas.size >= MAX_BOTONES_BARRA - 1) break
    elegidas.add(s)
  }
  return {
    principales: secciones.filter((s) => elegidas.has(s)),
    mas: secciones.filter((s) => !elegidas.has(s)),
  }
}

/** ¿Lleva barra inferior? Sólo en el teléfono y con más de una sección. */
export function llevaBarraInferior(esTelefono: boolean, secciones: readonly unknown[]): boolean {
  return esTelefono && secciones.length > 1
}
