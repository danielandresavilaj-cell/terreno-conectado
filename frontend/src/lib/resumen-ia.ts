/* Resumen de Gerencia con IA — reglas de la pantalla (TSK-REP-014, FR-068).
 *
 * Funciones puras, sin React, para probarlas sin navegador: cuándo se muestra
 * el bloque, qué botón ofrece, qué dice el pie y cómo se nombra un período.
 *
 * Los resúmenes se guardan en el servidor. Por eso el botón sólo aparece si no
 * hay resumen para el filtro o si el guardado quedó desactualizado: con las
 * mismas cifras, pedirlo otra vez no aportaría nada (y el servidor devolvería
 * el mismo texto sin gastar).
 */
import type { EstadoResumenIA, ResumenIA } from '@terreno/shared'

export type AccionResumen = 'resumir' | 'actualizar' | null

export type VistaResumenIA =
  /** Sin IA y sin resumen guardado (o aún sin saberlo): el bloque no aparece. */
  | { visible: false }
  | { visible: true; accion: AccionResumen; puedePedir: boolean; motivo: string | null }

export function vistaResumenIA(
  estado: EstadoResumenIA | null,
  guardado: ResumenIA | null,
  online: boolean,
  pidiendo: boolean,
): VistaResumenIA {
  if (!estado || (!estado.disponible && !guardado)) return { visible: false }
  // Sin IA en el servidor se siguen mostrando los resúmenes ya guardados.
  const accion: AccionResumen = !estado.disponible ? null : !guardado ? 'resumir' : guardado.desactualizado ? 'actualizar' : null
  if (accion === null) return { visible: true, accion, puedePedir: false, motivo: null }
  if (!online) return { visible: true, accion, puedePedir: false, motivo: 'El resumen con IA necesita conexión.' }
  if (pidiendo) return { visible: true, accion, puedePedir: false, motivo: null }
  if (estado.restantes_hoy <= 0) {
    return { visible: true, accion, puedePedir: false, motivo: `Ya se usaron los ${estado.tope_diario} resúmenes de hoy. Mañana se renuevan.` }
  }
  return { visible: true, accion, puedePedir: true, motivo: null }
}

const HORA = new Intl.DateTimeFormat('es-CL', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
const DIA = new Intl.DateTimeFormat('es-CL', { day: 'numeric', month: 'short' })
const DIA_ANIO = new Intl.DateTimeFormat('es-CL', { day: 'numeric', month: 'short', year: 'numeric' })

function mismoDia(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

/** "hoy a las 13:23" o "el 9 nov a las 18:02". */
export function cuandoSeGenero(isoGenerado: string, ahora = new Date()): string {
  const d = new Date(isoGenerado)
  return `${mismoDia(d, ahora) ? 'hoy' : `el ${DIA.format(d)}`} a las ${HORA.format(d)}`
}

/** Pie del resumen: deja claro que lo escribió una IA y cuándo. */
export function pieResumenIA(r: ResumenIA, restantes: number | null, ahora = new Date()): string {
  const cupo = restantes === null ? '' : ` Quedan ${restantes} resúmenes hoy.`
  return `Generado con IA ${cuandoSeGenero(r.generado_en, ahora)} a partir de las cifras de este panel. Revísalo antes de compartirlo.${cupo}`
}

/** Cómo se nombra el período de un resumen guardado, en la hora de quien mira. */
export function etiquetaPeriodo(desde: string | null, hasta: string | null): string {
  if (!desde && !hasta) return 'Todo el período'
  if (!desde) return `Hasta el ${DIA_ANIO.format(new Date(hasta as string))}`
  if (!hasta) return `Desde el ${DIA_ANIO.format(new Date(desde))}`
  const d = new Date(desde)
  const h = new Date(hasta)
  if (mismoDia(d, h)) return DIA_ANIO.format(d)
  return `${d.getFullYear() === h.getFullYear() ? DIA.format(d) : DIA_ANIO.format(d)} – ${DIA_ANIO.format(h)}`
}

/** Restantes después de pedir: un resumen que ya estaba guardado no gasta cupo. */
export function restantesTras(estado: EstadoResumenIA, r: ResumenIA): EstadoResumenIA {
  if (r.desde_cache) return estado
  return { ...estado, restantes_hoy: Math.max(0, estado.restantes_hoy - 1) }
}
