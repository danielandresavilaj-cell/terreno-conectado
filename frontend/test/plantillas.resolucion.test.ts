/* Resolución de la plantilla activa (TSK-FORM-009, FR-028).
 *
 * El congelado manda: si hay borrador, la revisión es la suya. Y cuando esa
 * revisión no está disponible, la respuesta es un estado explícito, NO un
 * reencuadre silencioso a la plantilla más nueva — reencuadrar dejaría al
 * trabajador respondiendo un ítem que no es el que leyó al abrir el turno.
 */
import { describe, expect, it } from 'vitest'
import { elegirPlantillaActiva, type MarcoBorrador } from '../src/lib/plantillas'
import { publicada, uuid } from './fixtures'

const BORRADOR_V4: MarcoBorrador = {
  templateId: uuid(10),
  templateVersion: 4,
  templateRevisionId: uuid(14),
}

describe('plantilla activa con borrador congelado', () => {
  it('manda la revisión congelada aunque exista una más nueva', () => {
    const items = [
      publicada({ revision_id: uuid(14), version: 4, published_seq: 7 }),
      publicada({ revision_id: uuid(15), version: 5, published_seq: 40 }),
    ]

    const r = elegirPlantillaActiva(items, BORRADOR_V4)

    expect(r.estado).toBe('ok')
    expect(r.estado === 'ok' && r.revision.revision_id).toBe(uuid(14))
  })

  it('si la revisión congelada no está, NO reencuadra: devuelve no-disponible', () => {
    const items = [
      publicada({ revision_id: uuid(15), version: 5, published_seq: 40 }),
      publicada({ revision_id: uuid(16), version: 6, published_seq: 41 }),
    ]

    const r = elegirPlantillaActiva(items, BORRADOR_V4)

    expect(r.estado).toBe('no-disponible')
    // El marco congelado viaja en la respuesta para que la UI pueda nombrarlo.
    expect(r.estado === 'no-disponible' && r.marco).toEqual(BORRADOR_V4)
  })

  it('sin caché alguna y con borrador congelado tampoco reencuadra', () => {
    expect(elegirPlantillaActiva([], BORRADOR_V4).estado).toBe('no-disponible')
  })

  it('un borrador legado (sin revisionId) se resuelve por plantilla+versión', () => {
    const items = [
      publicada({ revision_id: uuid(15), template_id: uuid(10), version: 9, published_seq: 40 }),
      publicada({ revision_id: uuid(16), template_id: uuid(10), version: 4, published_seq: 7 }),
    ]

    const r = elegirPlantillaActiva(items, { ...BORRADOR_V4, templateRevisionId: null })

    expect(r.estado === 'ok' && r.revision.revision_id).toBe(uuid(16))
  })

  it('borrador legado sin caché: cae a la demo en vez de bloquear el turno', () => {
    const r = elegirPlantillaActiva([], { ...BORRADOR_V4, templateRevisionId: null })
    expect(r.estado).toBe('sin-plantillas')
  })
})

describe('plantilla activa sin borrador', () => {
  it('elige la de mayor `published_seq`, no la de mayor `version`', () => {
    const items = [
      publicada({ revision_id: uuid(11), version: 9, published_seq: 4 }),
      publicada({ revision_id: uuid(12), version: 1, published_seq: 12 }),
    ]

    const r = elegirPlantillaActiva(items, null)

    expect(r.estado === 'ok' && r.revision.revision_id).toBe(uuid(12))
  })

  it('sin plantillas devuelve sin-plantillas (la UI usa la demo local)', () => {
    expect(elegirPlantillaActiva([], null).estado).toBe('sin-plantillas')
  })

  it('desempate determinista: misma secuencia y versión ⇒ siempre la misma revisión', () => {
    const items = [
      publicada({ revision_id: uuid(30), version: 2, published_seq: 8 }),
      publicada({ revision_id: uuid(20), version: 2, published_seq: 8 }),
    ]

    const r1 = elegirPlantillaActiva(items, null)
    const r2 = elegirPlantillaActiva([...items].reverse(), null)

    expect(r1.estado === 'ok' && r1.revision.revision_id).toBe(uuid(20))
    expect(r2.estado === 'ok' && r2.revision.revision_id).toBe(uuid(20))
  })

  it('desempate por versión cuando la secuencia es la misma', () => {
    const items = [
      publicada({ revision_id: uuid(30), version: 1, published_seq: 8 }),
      publicada({ revision_id: uuid(20), version: 2, published_seq: 8 }),
    ]

    const r = elegirPlantillaActiva(items, null)

    expect(r.estado === 'ok' && r.revision.revision_id).toBe(uuid(20))
  })
})