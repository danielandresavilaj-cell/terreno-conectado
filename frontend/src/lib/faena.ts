/* Faena de la sesión — TSK-OFF-010 (FR-034).
 *
 * Una cuenta pertenece a una empresa, no a una faena: la empresa puede tener
 * varias y la persona elige en cuál está inspeccionando. Antes la app usaba
 * siempre la primera de la lista, así que en una empresa con dos faenas todas
 * las inspecciones quedaban en la primera.
 *
 * Lógica pura, sin React ni Dexie: se prueba en `test/faena.test.ts`.
 */
import type { Faena } from './types'

export interface FaenaInicial {
  faena: Faena | null
  /** Hay más de una faena y la persona todavía no eligió ninguna en este equipo. */
  porElegir: boolean
}

/**
 * Faena con la que arranca la sesión.
 *
 * 1. Si hay una inspección en curso, manda SU faena: el borrador ya nació
 *    asociado a ella y no se le cambia por la espalda.
 * 2. Si no, la última que la persona eligió en este equipo.
 * 3. Si no, la primera de la empresa; con más de una, se pide elegir.
 *
 * Una faena guardada que ya no existe en la empresa se ignora.
 */
export function elegirFaenaInicial(
  faenas: readonly Faena[],
  guardadaId: string | null,
  faenaDelBorradorId: string | null,
): FaenaInicial {
  const porId = (id: string | null) => (id ? (faenas.find((f) => f.id === id) ?? null) : null)
  const delBorrador = porId(faenaDelBorradorId)
  if (delBorrador) return { faena: delBorrador, porElegir: false }
  const guardada = porId(guardadaId)
  if (guardada) return { faena: guardada, porElegir: false }
  return { faena: faenas[0] ?? null, porElegir: faenas.length > 1 }
}

/** Motivo por el que no se puede cambiar de faena ahora; `null` si se puede. */
export function motivoParaNoCambiar(
  faenas: readonly Faena[],
  destinoId: string,
  hayBorrador: boolean,
): string | null {
  if (!faenas.some((f) => f.id === destinoId)) return 'Esa faena ya no existe en tu empresa.'
  if (hayBorrador) return 'Tienes una inspección sin enviar en la faena actual. Termínala o descártala para cambiar de faena.'
  return null
}
