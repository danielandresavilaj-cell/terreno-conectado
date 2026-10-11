/* Callejón sin salida del congelado (FR-028).
 *
 * Cuando la revisión congelada del borrador no se puede resolver, la captura
 * queda bloqueada a propósito: reencuadrar en silencio invalidaría lo ya
 * respondido. Ese bloqueo tiene que tener salida EXPLÍCITA, o el trabajador se
 * queda sin poder cerrar el turno.
 *
 * Los dos caminos que llevan ahí:
 *  1. El borrador nació del fallback demo (sin señal, sin plantillas cacheadas)
 *     y después llegaron plantillas reales del servidor. Su marco es inventado:
 *     un UUID local y la versión por defecto 3, que no corresponden a ninguna
 *     revisión publicada.
 *  2. El supervisor desasignó la plantilla. El servidor ya no la sirve, así que
 *     el delta no la traerá nunca y la promesa de "se descargará sola" es falsa.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { db, ensureDraftInspection, getDraftInspectionId, getInspection } from '../src/lib/db'
import { elegirPlantillaActiva, type MarcoBorrador } from '../src/lib/plantillas'
import { TENANT_A, publicada } from './fixtures'

const params = {
  tenantId: TENANT_A,
  siteId: 'faena-a',
  executedBy: 'user-1',
  templateName: 'Chequeo de seguridad minera',
  siteName: 'Faena El Roble',
  totalItems: 1,
}

beforeEach(async () => {
  await db.delete()
  await db.open()
})

describe('bloqueo del congelado sin salida (FR-028)', () => {
  it('un borrador nacido del fallback demo queda bloqueado al llegar plantillas reales', async () => {
    // Sin señal y sin caché: la plantilla activa es la demo → UUID local, v3.
    const creado = await ensureDraftInspection(params)
    const row = await getInspection(creado.id)
    expect(row?.templateRevisionId ?? null).toBeNull()

    // Vuelve la señal: el delta entrega la plantilla real.
    const reales = [publicada({ revision_id: 'r-real', published_seq: 4 })]
    const marco: MarcoBorrador = {
      templateId: row!.templateId,
      templateVersion: row!.templateVersion,
      templateRevisionId: row!.templateRevisionId ?? null,
    }
    const r = elegirPlantillaActiva(reales, marco)

    // Bloqueado: correcto, el marco del borrador no corresponde a ninguna revisión.
    expect(r.estado).toBe('no-disponible')
    // Pero NO puede ser un callejón sin salida: tiene que existir una forma
    // explícita de descartarlo (ver `descartarBorrador`).
    expect(creado.id).toBeTruthy()
  })

  it('descartarBorrador libera el turno: borra el marco y deja crear uno nuevo', async () => {
    const { descartarBorrador } = await import('../src/lib/db')
    const creado = await ensureDraftInspection(params)
    await db.responses.add({
      id: 'resp-1',
      inspectionId: creado.id,
      templateItemId: 'item-1',
      tenantId: TENANT_A,
      valueOk: 'ok',
      valueText: null,
      valueNumber: null,
      valueJson: null,
      capturedAt: '2026-10-01T00:00:00.000Z',
      clientVersion: 0,
    })
    expect(await db.responses.count()).toBe(1)

    await descartarBorrador()

    expect(await getDraftInspectionId()).toBeNull()
    expect(await getInspection(creado.id)).toBeUndefined()
    expect(await db.responses.count()).toBe(0)

    // Con el marco liberado, la plantilla real vuelve a ser elegible.
    const siguiente = await ensureDraftInspection({ ...params, totalItems: 9 })
    const fila = await getInspection(siguiente.id)
    expect(fila?.totalItems).toBe(9)
  })
})