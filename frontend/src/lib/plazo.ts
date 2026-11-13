/* Plazo de una acción correctiva — TSK-DOM-007 (FR-064). Lógica pura. */

export type EstadoPlazo = 'sin-plazo' | 'a-tiempo' | 'vence-hoy' | 'vencido' | 'cerrado'

/** `hoy` en AAAA-MM-DD de la hora local. */
export function hoyLocal(ahora = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${ahora.getFullYear()}-${p(ahora.getMonth() + 1)}-${p(ahora.getDate())}`
}

/** Un hallazgo resuelto ya no vence; uno abierto vence el día después de su plazo. */
export function estadoPlazo(
  plazo: string | null,
  status: 'open' | 'in_progress' | 'resolved',
  hoy: string,
): EstadoPlazo {
  if (status === 'resolved') return 'cerrado'
  if (!plazo) return 'sin-plazo'
  if (plazo < hoy) return 'vencido'
  if (plazo === hoy) return 'vence-hoy'
  return 'a-tiempo'
}

/** Plazo sugerido según la severidad: crítica 1 día, alta 3, media 7, baja 14. */
export function plazoSugerido(severidad: 'low' | 'medium' | 'high' | 'critical', ahora = new Date()): string {
  const dias = { critical: 1, high: 3, medium: 7, low: 14 }[severidad]
  const d = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate() + dias)
  return hoyLocal(d)
}
