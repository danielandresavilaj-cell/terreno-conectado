/* Cuota de almacenamiento local — FR-017.
 *
 * Dos capas:
 *  · `estimarCuota`/`cuotaEsAlta` son puras (Storage API inyectada): el
 *    navegador que no expone `navigator.storage.estimate()` no debe inventar
 *    un porcentaje.
 *  · `contadorFotosPendientes` y `sincronizables(priorizarFotos)` tocan Dexie
 *    sobre `fake-indexeddb`: cuentan las fotos en cola y suben al frente sólo
 *    las que ya pueden enviarse (su dueño no está pendiente), sin romper el
 *    orden de dependencias (FR-020).
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { cuotaEsAlta, estimarCuota, UMBRAL_CUOTA_PCT } from '../src/lib/cuota'
import { contadorFotosPendientes, db, sincronizables, type OutboxRow } from '../src/lib/db'
import { TENANT_A, uuid } from './fixtures'

beforeEach(async () => {
  await db.delete()
  await db.open()
})

describe('estimarCuota (Storage API inyectada)', () => {
  it('sin navegador ni Storage API no hay dato: no se inventa un porcentaje', async () => {
    expect(await estimarCuota(undefined)).toEqual({
      disponible: false,
      usoBytes: null,
      cuotaBytes: null,
      usadaPct: null,
    })
    expect(await estimarCuota({})).toMatchObject({ disponible: false, usadaPct: null })
  })

  it('calcula el porcentaje redondeado desde usage/quota', async () => {
    const r = await estimarCuota({ estimate: async () => ({ usage: 829, quota: 1000 }) })
    expect(r).toEqual({ disponible: true, usoBytes: 829, cuotaBytes: 1000, usadaPct: 83 })
  })

  it('acota el porcentaje a 100 aunque el uso exceda la cuota', async () => {
    const r = await estimarCuota({ estimate: async () => ({ usage: 200, quota: 100 }) })
    expect(r.usadaPct).toBe(100)
  })

  it('degrada a sin-dato si la estimación falla o la cuota es 0', async () => {
    expect(await estimarCuota({ estimate: async () => Promise.reject(new Error('boom')) })).toMatchObject(
      { disponible: false, usadaPct: null },
    )
    expect(await estimarCuota({ estimate: async () => ({ usage: 10, quota: 0 }) })).toMatchObject({
      disponible: false,
      usadaPct: null,
    })
    expect(await estimarCuota({ estimate: async () => ({ quota: 100 }) })).toMatchObject({
      disponible: false,
      usadaPct: null,
    })
  })
})

describe('cuotaEsAlta (umbral FR-017)', () => {
  it('avisa desde el umbral; sin dato no avisa', () => {
    expect(UMBRAL_CUOTA_PCT).toBe(80)
    expect(cuotaEsAlta(null)).toBe(false)
    expect(cuotaEsAlta(UMBRAL_CUOTA_PCT - 1)).toBe(false)
    expect(cuotaEsAlta(UMBRAL_CUOTA_PCT)).toBe(true)
    expect(cuotaEsAlta(100)).toBe(true)
  })
})

function fila(over: Partial<OutboxRow>): OutboxRow {
  return {
    entityType: 'inspection',
    entityId: uuid(1),
    tipo: 'inspeccion',
    titulo: 't',
    detalle: 'd',
    batchOrder: 1,
    status: 'pending',
    retries: 0,
    tenantId: TENANT_A,
    capturedAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...over,
  }
}

describe('contadorFotosPendientes (FR-017)', () => {
  it('cuenta sólo las fotos no sincronizadas', async () => {
    await db.outbox.bulkAdd([
      fila({ entityType: 'attachment', entityId: uuid(10), tipo: 'foto', status: 'pending' }),
      fila({ entityType: 'attachment', entityId: uuid(11), tipo: 'foto', status: 'failed' }),
      fila({ entityType: 'attachment', entityId: uuid(12), tipo: 'foto', status: 'synced' }),
      fila({ entityType: 'inspection', entityId: uuid(13), status: 'pending' }),
    ])
    expect(await contadorFotosPendientes()).toBe(2)
  })
})

describe('sincronizables: prioriza fotos ya sincronizables (FR-017)', () => {
  it('sube al frente la foto cuyo dueño NO está en la cola y respeta la dependencia', async () => {
    const respLibre = uuid(20) // dueño ya sincronizado → no está en la cola
    const respPendiente = uuid(21) // dueño todavía pendiente
    await db.attachments.bulkAdd([
      { id: respLibre + '-foto', tenantId: TENANT_A, ownerType: 'response', ownerId: respLibre, mime: 'image/jpeg', bytes: 1, blob: new Blob(), ancho: 1, alto: 1, capturedAt: '2026-10-01T00:00:00.000Z', clientVersion: 0 },
      { id: respPendiente + '-foto', tenantId: TENANT_A, ownerType: 'response', ownerId: respPendiente, mime: 'image/jpeg', bytes: 1, blob: new Blob(), ancho: 1, alto: 1, capturedAt: '2026-10-01T00:00:00.000Z', clientVersion: 0 },
    ])
    await db.outbox.bulkAdd([
      fila({ entityType: 'response', entityId: respPendiente, tipo: 'respuesta', batchOrder: 2 }),
      fila({ entityType: 'attachment', entityId: respLibre + '-foto', tipo: 'foto', batchOrder: 4 }),
      fila({ entityType: 'attachment', entityId: respPendiente + '-foto', tipo: 'foto', batchOrder: 4 }),
    ])

    const normal = await sincronizables()
    expect(normal[0].entityId).toBe(respPendiente) // dependency order intacto por defecto

    const priorizado = await sincronizables(true)
    expect(priorizado[0].entityId).toBe(respLibre + '-foto') // foto libre primero
    // La foto cuyo dueño sigue pendiente NO se adelanta a su dependencia.
    const iDueno = priorizado.findIndex((f) => f.entityId === respPendiente)
    const iFoto = priorizado.findIndex((f) => f.entityId === respPendiente + '-foto')
    expect(iDueno).toBeLessThan(iFoto)
  })
})
