/**
 * TSK-AUTH-012 (FR-005): el 423 dice cuántos minutos FALTAN ("… (7 min)").
 * Si el servidor no lo trae (versión anterior), se dice el bloqueo completo.
 */
export function mensajeBloqueo(detalle: string | null | undefined): string {
  const m = /\((\d+)\s*min\)/i.exec(detalle ?? '')
  const minutos = m ? Number(m[1]) : 15
  const cuando = minutos === 1 ? '1 minuto' : `${minutos} minutos`
  return `Tu cuenta quedó bloqueada por demasiados intentos. Vuelve a intentar en ${cuando}.`
}
