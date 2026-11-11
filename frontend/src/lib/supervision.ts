/* Titulares del dashboard de supervisión — TSK-REP-006.
 *
 * Cada bloque abre con una frase que dice qué hacer. Viven aquí, puros, para
 * probarlos sin DOM. Sin muestras se dice "sin datos suficientes": nunca se
 * inventa un número.
 */
import type { DashboardSupervision } from '@terreno/shared'

export const SIN_DATOS = 'Sin datos suficientes'

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`

/** Duración legible desde segundos: "45 s", "12 min", "3,5 h", "2 d". */
export function duracion(seg: number | null): string {
  if (seg === null || !Number.isFinite(seg)) return '—'
  if (seg < 60) return `${Math.round(seg)} s`
  if (seg < 3600) return `${Math.round(seg / 60)} min`
  if (seg < 86400) return `${(seg / 3600).toFixed(1).replace('.', ',')} h`
  return `${(seg / 86400).toFixed(1).replace('.', ',')} d`
}

export function titularHallazgos(h: DashboardSupervision['hallazgos']): string {
  const viejos = h.abiertos_por_antiguedad.mas_de_7d
  const criticos = h.criticos_abiertos.length
  if (criticos > 0) {
    return `${plural(criticos, 'hallazgo crítico o alto abierto', 'hallazgos críticos o altos abiertos')}${
      viejos > 0 ? ` · ${viejos} con más de 7 días` : ''
    }`
  }
  const abiertos = viejos + h.abiertos_por_antiguedad.de_1_a_7d + h.abiertos_por_antiguedad.hasta_1d
  if (abiertos === 0) return 'Sin hallazgos abiertos'
  return `${plural(abiertos, 'hallazgo abierto', 'hallazgos abiertos')}, ninguno crítico`
}

export function titularRevision(r: DashboardSupervision['revision']): string {
  if (r.pendientes === 0) return 'Todo revisado'
  const dias = Math.floor(r.dias_mas_antigua ?? 0)
  return `${plural(r.pendientes, 'inspección espera', 'inspecciones esperan')} revisión${
    dias >= 1 ? ` · la más antigua hace ${plural(dias, 'día', 'días')}` : ''
  }`
}

export function titularActividad(a: DashboardSupervision['actividad']): string {
  const total = a.por_dia.reduce((s, d) => s + d.inspecciones, 0)
  if (total === 0) return 'Sin inspecciones en el período'
  return `${plural(total, 'inspección', 'inspecciones')}${
    a.faenas_sin_actividad > 0 ? ` · ${plural(a.faenas_sin_actividad, 'faena sin actividad', 'faenas sin actividad')}` : ''
  }`
}

export function titularSincronizacion(s: DashboardSupervision['sincronizacion']): string {
  if (s.equipos_inactivos.length > 0) {
    return `${plural(s.equipos_inactivos.length, 'equipo lleva', 'equipos llevan')} más de 24 h sin sincronizar`
  }
  if (s.lotes_con_error > 0) return `${plural(s.lotes_con_error, 'lote con errores', 'lotes con errores')} en el período`
  if (s.lotes === 0 && s.muestras_espera === 0) return SIN_DATOS
  return 'Sincronización al día'
}

/** % con un decimal o null si no hay base. */
export function porcentaje(parte: number, total: number): number | null {
  return total > 0 ? Math.round((parte / total) * 1000) / 10 : null
}
