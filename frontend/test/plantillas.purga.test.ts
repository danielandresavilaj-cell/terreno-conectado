/* Purga del caché de originales (TSK-FORM-009, FR-018).
 *
 * El dispositivo tiene un tope de bytes (25 MB) para los `.xlsx` fuentes. Cuando
 * se excede salen los más antiguos, pero la revisión congelada del borrador en
 * curso JAMÁS se borra: es la que hace falta para exportar el documento
 * rellenado (FR-019/044) y borrarla dejaría la inspección sin salida.
 */
import { describe, expect, it } from 'vitest'
import {
  planificarPurga,
  revisionesParaOriginal,
  type OriginalCacheado,
} from '../src/lib/plantillas'
import { publicada, uuid } from './fixtures'

function original(revision_id: string, bytes_length: number, cached_at: number): OriginalCacheado {
  return { revision_id, bytes_length, cached_at }
}

/** Aplica el plan a una lista y devuelve lo que queda (simula el borrado). */
function aplicar(
  originales: readonly OriginalCacheado[],
  plan: ReturnType<typeof planificarPurga>,
): OriginalCacheado[] {
  const fuera = new Set(plan.aBorrar)
  return originales.filter((o) => !fuera.has(o.revision_id))
}

describe('purga por presupuesto', () => {
  it('borra las más antiguas por `cached_at` hasta entrar en el presupuesto', () => {
    const originales = [
      original(uuid(11), 10, 1000),
      original(uuid(12), 10, 3000),
      original(uuid(13), 10, 2000),
    ]

    const plan = planificarPurga(originales, 20, null, [uuid(11), uuid(12), uuid(13)])

    expect(plan.aBorrar).toEqual([uuid(11)])
    expect(plan.bytesRestantes).toBe(20)
  })

  it('bajo presupuesto no borra nada', () => {
    const originales = [original(uuid(11), 10, 1000), original(uuid(12), 10, 2000)]

    expect(planificarPurga(originales, 1000, null, [uuid(11), uuid(12)]).aBorrar).toEqual([])
  })

  it('NUNCA borra la revisión activa, aunque sea la más antigua', () => {
    const originales = [
      original(uuid(11), 10, 1000), // activa y la más antigua
      original(uuid(12), 10, 2000),
      original(uuid(13), 10, 3000),
    ]

    const plan = planificarPurga(originales, 10, uuid(11), [uuid(11), uuid(12), uuid(13)])

    expect(plan.aBorrar).toEqual([uuid(12), uuid(13)])
    expect(plan.bytesRestantes).toBe(10)
  })

  it('desempata por `revision_id` cuando dos originales comparten `cached_at`', () => {
    const originales = [original(uuid(21), 10, 5000), original(uuid(20), 10, 5000)]

    const plan = planificarPurga(originales, 10, null, [uuid(20), uuid(21)])

    expect(plan.aBorrar).toEqual([uuid(20)])
  })
})

describe('purga de originales huérfanos', () => {
  it('borra el original cuya revisión ya no está entre las plantillas', () => {
    const originales = [original(uuid(11), 10, 1000), original(uuid(99), 10, 2000)]

    const plan = planificarPurga(originales, 1000, null, [uuid(11)])

    expect(plan.aBorrar).toEqual([uuid(99)])
  })

  it('la revisión activa sigue a salvo aunque ya no esté en la vista del rol', () => {
    const plan = planificarPurga([original(uuid(99), 10, 1000)], 1000, uuid(99), [])
    expect(plan.aBorrar).toEqual([])
  })
})

describe('idempotencia de la purga', () => {
  it('aplicar el plan dos veces no borra nada extra ni falla', () => {
    const originales = [
      original(uuid(11), 10, 1000),
      original(uuid(12), 10, 2000),
      original(uuid(99), 10, 3000),
    ]
    const vivas = [uuid(11), uuid(12)]

    const primero = planificarPurga(originales, 15, uuid(12), vivas)
    const despues = aplicar(originales, primero)
    const segundo = planificarPurga(despues, 15, uuid(12), vivas)

    expect(primero.aBorrar).toEqual([uuid(99), uuid(11)])
    expect(segundo.aBorrar).toEqual([])
    expect(segundo.bytesRestantes).toBe(primero.bytesRestantes)
  })

  it('un caché vacío no produce plan', () => {
    expect(planificarPurga([], 100, null, []).aBorrar).toEqual([])
  })
})
describe('selección de originales a descargar', () => {
  const items = [
    publicada({ revision_id: uuid(11), published_seq: 3 }),
    publicada({ revision_id: uuid(12), published_seq: 30 }),
    publicada({ revision_id: uuid(13), published_seq: 20 }),
    publicada({ revision_id: uuid(14), published_seq: 10 }),
  ]

  it('de la más nueva a la más antigua, saltando lo ya cacheado', () => {
    const r = revisionesParaOriginal(items, [uuid(13)], 2)

    expect(r).toEqual([uuid(12), uuid(14)])
  })

  it('la revisión congelada va primera aunque no sea la más reciente', () => {
    // Sin esto, con más plantillas nuevas que el límite, el original del turno
    // en curso nunca se bajaría (y es justo el que la purga no puede borrar).
    const r = revisionesParaOriginal(items, [], 2, uuid(11))

    expect(r).toEqual([uuid(11), uuid(12)])
  })

  it('no propone lo que ya está en el dispositivo', () => {
    expect(revisionesParaOriginal(items, items.map((i) => i.revision_id), 3)).toEqual([])
  })
})
