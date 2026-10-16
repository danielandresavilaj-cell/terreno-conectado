/**
 * Conversión para el control numérico de captura.
 *
 * El valor que se persiste sigue siendo un `number`, pero mientras la persona
 * está escribiendo se admiten estados intermedios como `-` o `12,`. Validar
 * esos estados como si ya fueran una respuesta impedía escribir `25` cuando
 * el mínimo era, por ejemplo, 10: el primer `2` se rechazaba y desaparecía.
 */

/** `null` significa que el texto todavía no constituye un número terminado. */
export function numeroDesdeEdicion(texto: string): number | null {
  const normalizado = texto.trim().replace(',', '.')
  if (normalizado === '' || normalizado === '-' || normalizado === '+' || normalizado.endsWith('.')) {
    return null
  }
  const numero = Number(normalizado)
  return Number.isFinite(numero) ? numero : null
}

/** Evita persistir mientras el número completo aún no cumple sus límites. */
export function numeroDentroDeRango(
  numero: number,
  props: { min?: unknown; max?: unknown },
): boolean {
  return (
    (typeof props.min !== 'number' || numero >= props.min) &&
    (typeof props.max !== 'number' || numero <= props.max)
  )
}

/** Sólo se conservan caracteres que pueden ser parte de un decimal con coma o punto. */
export function esEdicionNumericaPosible(texto: string): boolean {
  return /^[+-]?(?:\d+)?(?:[,.]\d*)?$/.test(texto)
}
