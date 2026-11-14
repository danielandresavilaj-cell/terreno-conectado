/* Actualización controlada de la PWA — TSK-OFF-019.
 *
 * `vite-plugin-pwa` registra el service worker fuera de React. Este pequeño
 * almacén enlaza ese registro con Mi cuenta sin acoplar la interfaz a Workbox.
 * Buscar una versión no recarga la aplicación; sólo la persona confirma cuándo
 * activarla. Los borradores y la cola viven en IndexedDB, no en el worker.
 */

export type FaseActualizacion = 'preparando' | 'lista' | 'buscando' | 'disponible' | 'aplicando' | 'sin_soporte' | 'error'

export interface EstadoActualizacion {
  fase: FaseActualizacion
  mensaje: string
}

interface OperacionesActualizacion {
  buscar: () => Promise<void>
  aplicar: () => Promise<void>
}

let operaciones: OperacionesActualizacion | null = null
let hayActualizacionPendiente = false
let estado: EstadoActualizacion = {
  fase: 'preparando',
  mensaje: 'Preparando la búsqueda de actualizaciones…',
}
const oyentes = new Set<() => void>()

function cambiar(nuevo: EstadoActualizacion) {
  estado = nuevo
  oyentes.forEach((oir) => oir())
}

export function estadoActualizacionPwa() {
  return estado
}

export function suscribirActualizacionPwa(oir: () => void) {
  oyentes.add(oir)
  return () => oyentes.delete(oir)
}

/** Lo llama `main.tsx` cuando el registro del service worker ya está listo. */
export function configurarActualizacionPwa(nuevasOperaciones: OperacionesActualizacion) {
  operaciones = nuevasOperaciones
  cambiar(
    hayActualizacionPendiente
      ? { fase: 'disponible', mensaje: 'Hay una actualización lista para instalar.' }
      : { fase: 'lista', mensaje: 'Puedes buscar una actualización cuando quieras.' },
  )
}

/** Una versión se descargó, pero queda esperando la decisión de la persona. */
export function avisarActualizacionDisponible() {
  hayActualizacionPendiente = true
  cambiar({ fase: 'disponible', mensaje: 'Hay una actualización lista para instalar.' })
}

/** Navegador sin service worker, o registro que no pudo iniciarse. */
export function indicarActualizacionNoDisponible() {
  operaciones = null
  cambiar({
    fase: 'sin_soporte',
    mensaje: 'La búsqueda de actualizaciones está disponible desde la PWA instalada en un navegador compatible.',
  })
}

export async function buscarActualizacionPwa() {
  if (!operaciones) {
    indicarActualizacionNoDisponible()
    return
  }
  cambiar({ fase: 'buscando', mensaje: 'Buscando una versión nueva…' })
  try {
    await operaciones.buscar()
    // `onNeedRefresh` puede haber cambiado el estado mientras se esperaba.
    if (estado.fase === 'buscando') cambiar({ fase: 'lista', mensaje: 'Ya tienes la versión más reciente.' })
  } catch {
    cambiar({ fase: 'error', mensaje: 'No se pudo buscar la actualización. Revisa tu conexión e inténtalo otra vez.' })
  }
}

/** Activa el worker que quedó esperando; se llama sólo tras la confirmación UI. */
export async function aplicarActualizacionPwa() {
  if (!operaciones || !hayActualizacionPendiente) return
  cambiar({ fase: 'aplicando', mensaje: 'Aplicando actualización…' })
  try {
    await operaciones.aplicar()
  } catch {
    cambiar({ fase: 'error', mensaje: 'No se pudo aplicar la actualización. Puedes volver a intentarlo.' })
  }
}

/** Sólo para aislar el estado de las pruebas unitarias. */
export function reiniciarActualizacionPwa() {
  operaciones = null
  hayActualizacionPendiente = false
  cambiar({ fase: 'preparando', mensaje: 'Preparando la búsqueda de actualizaciones…' })
}
