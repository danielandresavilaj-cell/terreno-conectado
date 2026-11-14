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

describe('firma guardada por una versión anterior (TSK-OFF-018)', () => {
  it('al enviar se ajusta a lo que acepta el servidor y el hash no cambia', async () => {
    const { aSyncRecord } = await import('../src/lib/db')
    const { id } = await borrador()
    await submitInspection(id, {
      strokes: [{ points: [{ x: 10, y: 20 }, { x: 400, y: 600 }] }],
      declarationVersion: 'v1',
    })
    const firma = await db.signatures.where('inspectionId').equals(id).first()
    if (!firma) throw new Error('sin firma')
    // Como quedaba con el pad anterior: un toque suelto y un trazo de 1500 puntos.
    const larga = Array.from({ length: 1500 }, (_, i) => ({ x: Math.round(i / 1.5), y: 300 + Math.round(100 * Math.sin(i / 9)) }))
    await db.signatures.update(firma.id, { strokes: [{ points: [{ x: 5, y: 5 }] }, { points: larga }] })

    const fila = (await db.outbox.toArray()).find((f) => f.entityType === 'inspection_signature')
    if (!fila) throw new Error('sin fila de firma')
    const registro = await aSyncRecord(fila)
    const strokes = (registro.payload as { strokes: Array<{ points: unknown[] }>; content_hash: string }).strokes
    expect(strokes.every((s) => s.points.length >= 2)).toBe(true)
    expect(strokes.reduce((n, s) => n + s.points.length, 0)).toBeLessThanOrEqual(1024)
    expect((registro.payload as { content_hash: string }).content_hash).toBe(firma.contentHash)
  })
})
