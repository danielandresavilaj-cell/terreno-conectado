/* Delta de plantillas por cursor (TSK-FORM-009, FR-027).
 *
 * Lo que se fija aquí es el modo de fallo que motivó la tarea: el cursor del
 * delta se calculaba con `Math.max(items.map(i => i.version))`. `version` es POR
 * PLANTILLA, así que ese umbral global saltaba revisiones de otras plantillas
 * para siempre. El cursor es `published_seq`, y además NO avanza si el delta no
 * se integró completo (caos #8 del `test-plan.md`).
 */
import { describe, expect, it } from 'vitest'
import { cursorDesdeGuardado, fusionarDelta } from '../src/lib/plantillas'
import { publicada, TENANT_A, TENANT_B, uuid } from './fixtures'

describe('cursor del delta', () => {
  it('el `since` que se envía es el cursor persistido, nunca el max de `version`', () => {
    // Plantilla A en v9 (seq 9) y plantilla B en v3 (seq 3): el umbral global
    // `version=9` impediría que la v4 de B (seq 10) llegara nunca al dispositivo.
    const items = [
      publicada({ template_id: uuid(10), revision_id: uuid(11), version: 9, published_seq: 9 }),
      publicada({ template_id: uuid(20), revision_id: uuid(21), version: 3, published_seq: 3 }),
    ]

    const primera = cursorDesdeGuardado(null, items, 9)
    expect(primera.cursor).toBe(9)

    // Siguiente pasada: llega la v4 de B. Con el cursor 9 vuelve, con un umbral
    // de `version` (max 9) también, pero con `since=version` la v4 de B se
    // habría perdido en el camino.
    const segunda = cursorDesdeGuardado(primera.cursor, [publicada({ published_seq: 10, version: 4 })], 10)
    expect(segunda.since).toBe(9)
    expect(segunda.cursor).toBe(10)
  })

  it('sin cursor previo no manda `since` (delta completo)', () => {
    const { since, cursor } = cursorDesdeGuardado(null, [publicada({ published_seq: 5 })], 5)
    expect(since).toBeNull()
    expect(cursor).toBe(5)
  })

  it('el cursor NO avanza si el delta no se integró completo (caos #8)', () => {
    const items = [publicada({ published_seq: 12 }), publicada({ revision_id: uuid(22), published_seq: 11 })]

    const r = cursorDesdeGuardado(4, items, 12, false)

    // Queda intacto para que la próxima sincronización repita el mismo delta.
    expect(r.cursor).toBe(4)
    expect(r.since).toBe(4)
  })

  it('un delta incompleto y sin cursor previo deja el cursor en null', () => {
    expect(cursorDesdeGuardado(null, [publicada({ published_seq: 30 })], 30, false).cursor).toBeNull()
  })

  it('el cursor nunca retrocede aunque el servidor devuelva una ventana vieja', () => {
    expect(cursorDesdeGuardado(20, [publicada({ published_seq: 7 })], 7).cursor).toBe(20)
  })

  it('el cursor de un tenant no se mueve con el delta de otro', () => {
    // Cada tenant tiene su umbral: son cursores independientes, no un global.
    const cursorA = cursorDesdeGuardado(100, [], 140).cursor
    const cursorB = cursorDesdeGuardado(3, [], 4).cursor
    expect(cursorA).toBe(140)
    expect(cursorB).toBe(4)
  })

  it('el `latest_seq` del servidor manda aunque venga con huecos', () => {
    expect(cursorDesdeGuardado(null, [publicada({ published_seq: 8 })], 13).cursor).toBe(13)
  })

  it('un delta vacío sin nada nuevo deja el cursor donde estaba', () => {
    expect(cursorDesdeGuardado(6, [], 6).cursor).toBe(6)
    expect(cursorDesdeGuardado(null, [], null).cursor).toBeNull()
  })
})

describe('merge del delta con la caché', () => {
  it('la red pisa a la caché por `revision_id` sin duplicar filas', () => {
    const cache = [publicada({ revision_id: uuid(11), name: 'Nombre viejo' })]
    const items = [publicada({ revision_id: uuid(11), name: 'Nombre nuevo' })]

    const fusion = fusionarDelta(cache, items)

    expect(fusion).toHaveLength(1)
    expect(fusion[0].name).toBe('Nombre nuevo')
  })

  it('conserva lo que el delta no trae (una revisión no desaparece del caché)', () => {
    const cache = [
      publicada({ revision_id: uuid(11), tenant_id: TENANT_A, published_seq: 2 }),
      publicada({ revision_id: uuid(12), tenant_id: TENANT_A, published_seq: 1 }),
    ]

    const fusion = fusionarDelta(cache, [publicada({ revision_id: uuid(11), published_seq: 5 })])

    expect(fusion.map((i) => i.revision_id)).toEqual([uuid(11), uuid(12)])
  })

  it('un delta vacío devuelve el caché intacto y en orden', () => {
    const cache = [
      publicada({ revision_id: uuid(11), published_seq: 3 }),
      publicada({ revision_id: uuid(12), published_seq: 9 }),
    ]

    expect(fusionarDelta(cache, []).map((i) => i.revision_id)).toEqual([uuid(12), uuid(11)])
  })

  it('el orden es por `published_seq`, no por `version` (que es por plantilla)', () => {
    const fusion = fusionarDelta(
      [],
      [
        publicada({ revision_id: uuid(11), version: 9, published_seq: 4 }),
        publicada({ revision_id: uuid(12), version: 1, published_seq: 12 }),
      ],
    )

    expect(fusion.map((i) => i.revision_id)).toEqual([uuid(12), uuid(11)])
  })

  it('no mezcla tenants: cada sesión resuelve sobre su propio caché', () => {
    const cache = [publicada({ revision_id: uuid(11), tenant_id: TENANT_A })]
    const deOtro = publicada({ revision_id: uuid(21), tenant_id: TENANT_B })

    const fusion = fusionarDelta(cache, [deOtro])

    expect(fusion.map((i) => i.tenant_id)).toEqual([TENANT_A, TENANT_B])
  })
})