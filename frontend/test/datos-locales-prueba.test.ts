import { beforeEach, describe, expect, it } from 'vitest'
import {
  db,
  ensureDraftInspection,
  getDraftInspectionId,
  guardarOriginalPlantilla,
  limpiarDatosLocalesPrueba,
} from '../src/lib/db'
import { bytesFalsos, META_ORIGINAL_BASE, TENANT_A, TENANT_B } from './fixtures'

beforeEach(async () => {
  await db.delete()
  await db.open()
})

describe('limpiarDatosLocalesPrueba', () => {
  it('restablece también el caché de formularios del tenant, sin tocar otro tenant', async () => {
    const inspeccionA = await ensureDraftInspection({
      tenantId: TENANT_A,
      siteId: 'faena-a',
      executedBy: 'operario-a',
      templateName: 'Formulario A',
      siteName: 'Faena A',
      totalItems: 1,
    })
    await db.outbox.add({
      entityType: 'inspection', entityId: inspeccionA.id, tipo: 'inspeccion', titulo: 'A', detalle: 'A',
      batchOrder: 1, status: 'failed', retries: 1, tenantId: TENANT_A,
      capturedAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z',
    })
    await db.logEntries.add({
      id: 'log-a', siteId: 'faena-a', authorId: 'operario-a', tenantId: TENANT_A, entryText: 'prueba',
      tags: [], shiftDate: '2026-10-01', capturedAt: '2026-10-01T00:00:00.000Z', clientVersion: 0,
    })
    await db.inspections.add({
      id: 'ins-b', tenantId: TENANT_B, siteId: 'faena-b', templateId: 't-b', templateVersion: 1,
      executedBy: 'operario-b', status: 'draft', capturedAt: '2026-10-01T00:00:00.000Z', syncedAt: null,
      clientVersion: 0, templateName: 'Formulario B', siteName: 'Faena B', answeredCount: 0, totalItems: 1,
    })
    await guardarOriginalPlantilla({ meta: META_ORIGINAL_BASE, bytes: bytesFalsos('xlsx') })

    await limpiarDatosLocalesPrueba(TENANT_A)

    expect(await getDraftInspectionId()).toBeNull()
    expect(await db.inspections.where('tenantId').equals(TENANT_A).count()).toBe(0)
    expect(await db.outbox.filter((fila) => fila.tenantId === TENANT_A).count()).toBe(0)
    expect(await db.logEntries.filter((fila) => fila.tenantId === TENANT_A).count()).toBe(0)
    expect(await db.inspections.where('tenantId').equals(TENANT_B).count()).toBe(1)
    expect(await db.plantillaOriginales.count()).toBe(0)
  })
})
