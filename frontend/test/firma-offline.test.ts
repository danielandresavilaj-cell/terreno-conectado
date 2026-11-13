import { beforeEach, describe, expect, it } from 'vitest'
import { db, ensureDraftInspection, submitInspection } from '../src/lib/db'
import { TENANT_A } from './fixtures'

beforeEach(async () => {
  await db.delete()
  await db.open()
})

async function borrador() {
  return ensureDraftInspection({
    tenantId: TENANT_A,
    siteId: 'faena-a',
    executedBy: 'operario-a',
    templateName: 'Chequeo de seguridad',
    siteName: 'Faena A',
    totalItems: 1,
  })
}

describe('firma offline de cierre (FR-056)', () => {
  it('no deja cerrar la inspección con un toque o sin firma', async () => {
    const { id } = await borrador()

    await expect(submitInspection(id, { strokes: [], declarationVersion: 'v1' })).rejects.toThrow('firma')
    await expect(submitInspection(id, {
      strokes: [{ points: [{ x: 1, y: 1 }] }],
      declarationVersion: 'v1',
    })).rejects.toThrow('firma')
  })

  it('guarda la firma y la cola junto a la inspección aun sin red', async () => {
    const { id } = await borrador()

    await expect(submitInspection(id, {
      strokes: [{ points: [{ x: 10, y: 20 }, { x: 400, y: 600 }] }],
      declarationVersion: 'v1',
    })).resolves.toBe(true)

    expect((await db.inspections.get(id))?.status).toBe('submitted')
    const firma = await db.signatures.where('inspectionId').equals(id).first()
    expect(firma?.signerRole).toBe('inspector')
    expect(firma?.contentHash).toMatch(/^[0-9a-f]{64}$/)
    expect((await db.outbox.toArray()).map((fila) => fila.entityType)).toEqual(
      expect.arrayContaining(['inspection', 'inspection_signature']),
    )
  })
})
