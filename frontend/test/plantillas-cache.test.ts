/* Caracterización del caché local de plantillas (congelado FR-028 incluido).
 *
 * Estos tests NO cubren código nuevo: fijan el comportamiento que ya sostenía la
 * captura antes de que TSK-FORM-009 lo tocara, y sirven de red de seguridad para
 * el refactor del delta.
 *
 * Los casos marcados como "carácter actual" describen limitaciones conocidas
 * que 009 todavía no cambió: cuando el cambio llegue, este test debe fallar a
 * propósito para que el diff muestre la diferencia.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { TemplatePublicadaDto } from '@terreno/shared'
import { db, guardarPlantillasCache, getInspection, plantillasCacheadas } from '../src/lib/db'

/** Definición mínima válida para el tipo (el caché no revalida con Zod). */
function publicada(over: Partial<TemplatePublicadaDto> = {}): TemplatePublicadaDto {
  return {
    template_id: '01890000-0000-7000-8000-0000000000a6',
    revision_id: '01890000-0000-7000-8000-0000000000a8',
    tenant_id: '01890000-0000-7000-8000-0000000000a1',
    name: 'Chequeo de seguridad minera',
    version: 1,
    published_seq: 1,
    published_at: '2026-10-01T00:00:00.000Z',
    definition: {
      sections: [
        {
          id: 'sec-1',
          title: 'Seguridad',
          items: [{ id: 'item-1', prompt: '¿EPP completo?', response_type: 'ok_nok_na' }],
        },
      ],
    },
    ...over,
  }
}

beforeEach(async () => {
  await db.delete()
  await db.open()
})

describe('caché de plantillas publicadas', () => {
  it('guarda y devuelve las revisiones por orden de versión descendente', async () => {
    await guardarPlantillasCache([
      publicada({ revision_id: 'r1', version: 1 }),
      publicada({ revision_id: 'r3', version: 3 }),
      publicada({ revision_id: 'r2', version: 2 }),
    ])
    const rows = await plantillasCacheadas()
    expect(rows.map((r) => r.version)).toEqual([3, 2, 1])
    expect(rows[0].cachedAt).toEqual(expect.any(String))
  })

  it('el upsert es idempotente por revisión: la red no duplica filas', async () => {
    await guardarPlantillasCache([publicada({ revision_id: 'r1', version: 1 })])
    await guardarPlantillasCache([publicada({ revision_id: 'r1', version: 1, name: 'Renombrada' })])
    const rows = await plantillasCacheadas()
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('Renombrada')
  })

  it('no revisa versiones distintas de la misma plantilla', async () => {
    // Carácter actual: conviven v1 y v2 porque la clave es `revision_id`.
    await guardarPlantillasCache([
      publicada({ revision_id: 'r1', version: 1 }),
      publicada({ revision_id: 'r2', version: 2 }),
    ])
    expect(await plantillasCacheadas()).toHaveLength(2)
  })

  it('un delta vacío no borra la caché ni la pisa', async () => {
    await guardarPlantillasCache([publicada({ revision_id: 'r1', version: 1 })])
    await guardarPlantillasCache([])
    expect(await plantillasCacheadas()).toHaveLength(1)
  })

  it('conserva las revisiones de otro tenant (el filtro es del consumidor)', async () => {
    // Carácter actual: `plantillasCacheadas()` no filtra por tenant; lo hace
    // `cargarPlantilla`. Si 009 mueve ese filtro, este test debe cambiar.
    await guardarPlantillasCache([
      publicada({ revision_id: 'rA', tenant_id: 'tenant-a' }),
      publicada({ revision_id: 'rB', tenant_id: 'tenant-b' }),
    ])
    expect(await plantillasCacheadas()).toHaveLength(2)
  })
})

describe('borrador de inspección (congelado FR-028)', () => {
  const base = {
    tenantId: 'tenant-a',
    siteId: 'site-a',
    executedBy: 'user-1',
    templateName: 'Chequeo de seguridad minera',
    siteName: 'Faena El Roble',
    totalItems: 1,
  }

  it('reutiliza el borrador en curso y NO reescribe su plantilla (FR-028)', async () => {
    const { ensureDraftInspection, setDraftInspectionId } = await import('../src/lib/db')
    await db.inspections.add({
      id: 'draft-1',
      ...base,
      templateId: '01890000-0000-7000-8000-0000000000a6',
      templateVersion: 1,
      status: 'draft',
      capturedAt: '2026-10-01T00:00:00.000Z',
      syncedAt: null,
      clientVersion: 0,
      answeredCount: 0,
      totalItems: 1,
    })
    await setDraftInspectionId('draft-1')

    // Segunda llamada con OTRA plantilla y OTRO total: el marco congelado gana.
    const otro = await ensureDraftInspection({
      ...base,
      templateId: 'plantilla-nueva',
      templateVersion: 99,
      totalItems: 42,
    })
    expect(otro.id).toBe('draft-1')

    const row = await getInspection('draft-1')
    expect(row?.templateId).toBe('01890000-0000-7000-8000-0000000000a6')
    expect(row?.templateVersion).toBe(1)
    expect(row?.totalItems).toBe(1)
  })

  it('el borrador persiste la revisión congelada (TSK-FORM-009)', async () => {
    const { ensureDraftInspection } = await import('../src/lib/db')
    const creado = await ensureDraftInspection({
      ...base,
      templateId: 't-1',
      templateVersion: 1,
      templateRevisionId: '01890000-0000-7000-8000-0000000000a8',
    })
    const row = await getInspection(creado.id)
    expect(row).toBeDefined()
    // Antes daba `false`: 009 añadió la columna porque `template_id`+`version`
    // no desambigua dos revisiones publicadas del mismo par (FR-028).
    expect(row?.templateRevisionId).toBe('01890000-0000-7000-8000-0000000000a8')
  })

  it('el borrador heredado (sin revisionId) queda en null, no se inventa uno', async () => {
    const { ensureDraftInspection } = await import('../src/lib/db')
    const creado = await ensureDraftInspection({ ...base, templateId: 't-1', templateVersion: 1 })
    expect((await getInspection(creado.id))?.templateRevisionId).toBeNull()
  })
})