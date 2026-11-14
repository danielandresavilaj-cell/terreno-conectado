import { beforeEach, describe, expect, it } from 'vitest'
import { db, guardarPlantillasCache } from '../src/lib/db'
import { SIN_INSPECCION_LOCAL, SIN_PLANTILLA_LOCAL, exportarInspeccionGuardada } from '../src/lib/exportar'
import { TENANT_A, publicada, uuid } from './fixtures'

/* TSK-OFF-017: reexportar una inspección ya enviada sin usar la red. Las rutas
 * felices (libro rellenado y evidencias) las cubre exportar.test.ts, que usa la
 * misma `exportarDocumento`; aquí se prueba que se arma con lo guardado. */

const ts = '2026-11-10T10:00:00.000Z'

async function inspeccion(revisionId: string | null) {
  await db.inspections.add({
    id: 'ins-enviada',
    tenantId: TENANT_A,
    siteId: uuid(30),
    templateId: uuid(10),
    templateVersion: 1,
    templateRevisionId: revisionId,
    executedBy: uuid(20),
    status: 'submitted',
    capturedAt: ts,
    syncedAt: ts,
    clientVersion: 1,
    templateName: 'Chequeo de seguridad minera',
    siteName: 'Faena Norte',
    answeredCount: 1,
    totalItems: 1,
  })
}

beforeEach(async () => {
  await db.delete()
  await db.open()
})

describe('exportarInspeccionGuardada (TSK-OFF-017)', () => {
  it('sin la inspección en el teléfono lo dice', async () => {
    expect(await exportarInspeccionGuardada('no-existe')).toEqual({ ok: false, error: SIN_INSPECCION_LOCAL })
  })

  it('sin revisión publicada no hay planilla que rellenar', async () => {
    await inspeccion(null)
    const r = await exportarInspeccionGuardada('ins-enviada')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/no viene de una revisión publicada/)
  })

  it('sin la plantilla en caché lo dice, sin intentar la red', async () => {
    await inspeccion(uuid(11))
    expect(await exportarInspeccionGuardada('ins-enviada')).toEqual({ ok: false, error: SIN_PLANTILLA_LOCAL })
  })

  it('con la plantilla pero sin la planilla original, explica que falta el original', async () => {
    await guardarPlantillasCache([publicada()])
    await inspeccion(uuid(11))
    const r = await exportarInspeccionGuardada('ins-enviada')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/documento original/)
  })
})
