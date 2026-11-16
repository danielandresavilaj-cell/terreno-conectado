import type { FindingDto } from '@terreno/shared'
import { estadoPlazo } from './plazo'

/** Cinco registros dejan visible el siguiente bloque de Gerencia en teléfono. */
export const TANDA_LISTADO = 5

const PESO_SEVERIDAD: Record<FindingDto['severity'], number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
}

export function siguienteLimite(actual: number, total: number, paso = TANDA_LISTADO): number {
  return Math.min(total, actual + paso)
}

/** Orden de atención operacional: plazo vencido, severidad y fecha reciente. */
export function ordenarHallazgosPorPrioridad(items: FindingDto[], hoy: string): FindingDto[] {
  return [...items].sort((a, b) => {
    const vencidoA = estadoPlazo(a.due_date, a.status, hoy) === 'vencido' ? 1 : 0
    const vencidoB = estadoPlazo(b.due_date, b.status, hoy) === 'vencido' ? 1 : 0
    if (vencidoA !== vencidoB) return vencidoB - vencidoA
    const severidad = PESO_SEVERIDAD[b.severity] - PESO_SEVERIDAD[a.severity]
    if (severidad !== 0) return severidad
    return Date.parse(b.captured_at) - Date.parse(a.captured_at)
  })
}

/** Inspecciones y bitácora conservan una secuencia temporal descendente. */
export function ordenarPorFechaReciente<T extends { captured_at: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => Date.parse(b.captured_at) - Date.parse(a.captured_at))
}
