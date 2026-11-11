/* Períodos del dashboard — FR-043, TSK-REP-007.
 *
 * Ventanas móviles (24 h / 7 / 30 días), meses calendario y un rango libre,
 * siempre en la hora local de quien mira. Se recalculan en cada uso: la
 * ventana móvil sigue corriendo con el auto-refresh de 30 s.
 */
export const PERIODOS = ['24 h', '7 días', '30 días', 'Este mes', 'Mes anterior', 'Rango'] as const
export type Periodo = (typeof PERIODOS)[number]

/** Rango personalizado (`YYYY-MM-DD` del input de fecha, hora local). */
export interface RangoFechas {
  desde: string
  hasta: string
}

export function rangoPeriodo(p: Periodo, rango: RangoFechas = { desde: '', hasta: '' }, ahora = new Date()): { desde?: string; hasta?: string } {
  // TSK-REP-007: meses calendario y rango libre, en la hora local del supervisor.
  if (p === 'Este mes') return { desde: new Date(ahora.getFullYear(), ahora.getMonth(), 1).toISOString(), hasta: ahora.toISOString() }
  if (p === 'Mes anterior') {
    return {
      desde: new Date(ahora.getFullYear(), ahora.getMonth() - 1, 1).toISOString(),
      hasta: new Date(new Date(ahora.getFullYear(), ahora.getMonth(), 1).getTime() - 1).toISOString(),
    }
  }
  if (p === 'Rango') {
    const local = (d: string, fin: boolean) => {
      const [y, m, dd] = d.split('-').map(Number)
      return new Date(y, m - 1, dd, fin ? 23 : 0, fin ? 59 : 0, fin ? 59 : 0, fin ? 999 : 0).toISOString()
    }
    return {
      desde: rango.desde ? local(rango.desde, false) : undefined,
      hasta: rango.hasta ? local(rango.hasta, true) : undefined,
    }
  }
  const hs = p === '24 h' ? 24 : p === '7 días' ? 168 : 720
  return {
    desde: new Date(ahora.getTime() - hs * 3_600_000).toISOString(),
    hasta: ahora.toISOString(),
  }
}

