/* Caché local de TSK-FORM-009: cursor del delta por tenant y documentos
 * originales (FR-018/027).
 *
 * Corre sobre `fake-indexeddb`, no sobre un DOM: lo que importa aquí es que el
 * store nuevo existe desde la v3, que el upsert es idempotente y que los bytes
 * del `.xlsx` vuelven byte a byte después del ciclo de guardado.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import Dexie from 'dexie'
import { XLSX_MIME } from '@terreno/shared'
import {
  aplicarPurgaOriginales,
  borrarOriginalesPlantilla,
  db,
  guardarCursorPlantilla,
  guardarOriginalPlantilla,
  leerCursorPlantilla,
  listarOriginalesPlantilla,
  originalDePlantilla,
} from '../src/lib/db'
import { planificarPurga } from '../src/lib/plantillas'
import { bytesFalsos, META_ORIGINAL_BASE, TENANT_A, TENANT_B, uuid } from './fixtures'

beforeEach(async () => {
  await db.delete()
  await db.open()
})

describe('cursor del delta por tenant', () => {
  it('guarda y lee el cursor de un tenant', async () => {
    expect(await leerCursorPlantilla(TENANT_A)).toBeNull()
    await guardarCursorPlantilla(TENANT_A, 42)
    expect(await leerCursorPlantilla(TENANT_A)).toBe(42)
  })

  it('un tenant NO pisa el cursor de otro (dispositivo compartido)', async () => {
    await guardarCursorPlantilla(TENANT_A, 120)
    await guardarCursorPlantilla(TENANT_B, 7)

    expect(await leerCursorPlantilla(TENANT_A)).toBe(120)
    expect(await leerCursorPlantilla(TENANT_B)).toBe(7)
  })

  it('sobrescribe su propio cursor sin dejar filas sueltas', async () => {
    await guardarCursorPlantilla(TENANT_A, 1)
    await guardarCursorPlantilla(TENANT_A, 2)

    const claves = await db.meta
      .filter((r) => r.key.startsWith('tc_plantilla_cursor:'))
      .toArray()
    expect(claves).toHaveLength(1)
    expect(await leerCursorPlantilla(TENANT_A)).toBe(2)
  })
})

describe('caché de documentos originales', () => {
  it('el upsert es idempotente por `revision_id`: no duplica filas', async () => {
    await guardarOriginalPlantilla({
      meta: { ...META_ORIGINAL_BASE },
      bytes: bytesFalsos('libro v1'),
    })
    await guardarOriginalPlantilla({
      meta: { ...META_ORIGINAL_BASE, cached_at: META_ORIGINAL_BASE.cached_at + 1000 },
      bytes: bytesFalsos('libro v1 descargado de nuevo'),
    })

    const rows = await listarOriginalesPlantilla(TENANT_A)
    expect(rows).toHaveLength(1)
    expect(rows[0].cached_at).toBe(META_ORIGINAL_BASE.cached_at + 1000)
  })

  it('los bytes del original vuelven intactos tras el ciclo', async () => {
    const contenido = 'PK\x03\x04 libreoffice-en-fin-de-los-dias'
    await guardarOriginalPlantilla({
      meta: { ...META_ORIGINAL_BASE, bytes_length: contenido.length },
      bytes: bytesFalsos(contenido),
    })

    const row = await originalDePlantilla(META_ORIGINAL_BASE.revision_id)

    expect(row).toBeDefined()
    expect(await row!.bytes.text()).toBe(contenido)
    expect(row!.bytes.size).toBe(row!.bytes_length)
    expect(row!.mime).toBe(XLSX_MIME)
  })

  it('una metadata fuera de contrato no entra al caché', async () => {
    await expect(
      guardarOriginalPlantilla({
        // MIME que no es el de V1 (ADR-003): el original no serviría para exportar.
        meta: { ...META_ORIGINAL_BASE, mime: 'text/plain' as typeof XLSX_MIME },
        bytes: bytesFalsos('x'),
      }),
    ).rejects.toThrow()
    expect(await listarOriginalesPlantilla(TENANT_A)).toHaveLength(0)
  })

  it('los originales de otro tenant no se listan (aislamiento FR-007)', async () => {
    await guardarOriginalPlantilla({
      meta: { ...META_ORIGINAL_BASE, revision_id: uuid(11), tenant_id: TENANT_A },
      bytes: bytesFalsos('a'),
    })
    await guardarOriginalPlantilla({
      meta: { ...META_ORIGINAL_BASE, revision_id: uuid(21), tenant_id: TENANT_B },
      bytes: bytesFalsos('b'),
    })

    expect(await listarOriginalesPlantilla(TENANT_A)).toHaveLength(1)
    expect(await listarOriginalesPlantilla(null)).toHaveLength(2)
  })

  it('la purga borra por `revision_id` y es idempotente', async () => {
    for (const n of [11, 12, 13]) {
      await guardarOriginalPlantilla({
        meta: { ...META_ORIGINAL_BASE, revision_id: uuid(n), cached_at: n * 1000 },
        bytes: bytesFalsos(`libro ${n}`),
      })
    }

    const enCache = await listarOriginalesPlantilla(TENANT_A)
    // Presupuesto de UN libro: sólo sobrevive el más reciente (`cached_at` mayor).
    const plan = planificarPurga(enCache, META_ORIGINAL_BASE.bytes_length, null, [
      uuid(11),
      uuid(12),
      uuid(13),
    ])
    await aplicarPurgaOriginales(plan)
    await aplicarPurgaOriginales(plan)

    expect((await listarOriginalesPlantilla(TENANT_A)).map((o) => o.revision_id)).toEqual([
      uuid(13),
    ])
  })

  it('borrar una lista vacía no revienta la transacción', async () => {
    await expect(borrarOriginalesPlantilla([])).resolves.toBeUndefined()
  })
})

describe('upgrade de Dexie v2 → v3', () => {
  it('conserva las revisiones cacheadas y agrega el store de originales', async () => {
    await db.close()
    await db.delete()

    // Base tal como la dejó la versión anterior a TSK-FORM-009.
    const legado = new Dexie('terreno-conectado')
    legado.version(2).stores({
      outbox: '++id, entityType, status, [entityType+entityId]',
      inspections: 'id, tenantId, status, [tenantId+capturedAt]',
      responses: 'id, inspectionId, templateItemId, [inspectionId+templateItemId]',
      findings: 'id, inspectionId, severity, tenantId, [tenantId+capturedAt]',
      logEntries: 'id, siteId, authorId, [tenantId+capturedAt]',
      attachments: 'id, ownerId, ownerType',
      meta: 'key',
      plantillas: 'revision_id, template_id, version',
    })
    await legado.table('plantillas').put({
      template_id: uuid(10),
      revision_id: uuid(11),
      tenant_id: TENANT_A,
      name: 'Chequeo de seguridad minera',
      version: 2,
      published_seq: 17,
      published_at: '2026-10-01T00:00:00.000Z',
      definition: { sections: [] },
      cachedAt: '2026-10-01T00:00:00.000Z',
    })
    await legado.close()

    await db.open()

    const rows = await db.plantillas.toArray()
    expect(rows).toHaveLength(1)
    expect(rows[0].revision_id).toBe(uuid(11))
    expect(db.tables.map((t) => t.name)).toContain('plantillaOriginales')
    expect(await db.plantillaOriginales.toArray()).toEqual([])
  })
})