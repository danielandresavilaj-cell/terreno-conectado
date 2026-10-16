import { beforeEach, describe, expect, it } from 'vitest'
import { db, descartarRegistroCola } from '../src/lib/db'
import { TENANT_A, TENANT_B } from './fixtures'

const ts = '2026-10-16T10:00:00.000Z'

function filaOutbox(params: {
  entityType: 'inspection' | 'response' | 'finding' | 'attachment' | 'log_entry'
  entityId: string
  tenantId?: string
  status?: 'pending' | 'syncing' | 'synced' | 'failed'
}) {
  return db.outbox.add({
    entityType: params.entityType,
    entityId: params.entityId,
    tipo: ({ inspection: 'inspeccion', response: 'respuesta', finding: 'hallazgo', attachment: 'foto', log_entry: 'bitacora' } as const)[params.entityType],
    titulo: params.entityType,
    detalle: 'prueba',
    batchOrder: 1,
    status: params.status ?? 'pending',
    retries: 0,
    tenantId: params.tenantId ?? TENANT_A,
    capturedAt: ts,
    updatedAt: ts,
  })
}

beforeEach(async () => {
  await db.delete()
  await db.open()
})

describe('descartarRegistroCola', () => {
  it('elimina en una transacción el árbol local completo de una inspección', async () => {
    await db.inspections.add({
      id: 'ins-1', tenantId: TENANT_A, siteId: 'faena-a', templateId: 'tpl', templateVersion: 1,
      executedBy: 'operario-a', status: 'submitted', capturedAt: ts, syncedAt: null, clientVersion: 1,
      templateName: 'Checklist', siteName: 'Faena A', answeredCount: 1, totalItems: 1,
    })
    await db.responses.add({
      id: 'resp-1', inspectionId: 'ins-1', templateItemId: 'item-1', tenantId: TENANT_A,
      valueOk: 'nok', valueText: null, valueNumber: null, valueJson: null, capturedAt: ts, clientVersion: 1,
    })
    await db.findings.add({
      id: 'finding-1', inspectionId: 'ins-1', responseId: 'resp-1', tenantId: TENANT_A,
      severity: 'high', description: 'Peligro', status: 'open', capturedAt: ts, clientVersion: 0,
    })
    for (const [id, ownerType, ownerId] of [
      ['foto-ins', 'inspection', 'ins-1'],
      ['foto-resp', 'response', 'resp-1'],
      ['foto-find', 'finding', 'finding-1'],
    ] as const) {
      await db.attachments.add({
        id, tenantId: TENANT_A, ownerType, ownerId, mime: 'image/jpeg', bytes: 1,
        blob: new Blob(['x'], { type: 'image/jpeg' }), ancho: 1, alto: 1, capturedAt: ts, clientVersion: 0,
      })
    }
    const raiz = await filaOutbox({ entityType: 'inspection', entityId: 'ins-1' })
    if (raiz === undefined) throw new Error('El outbox no entregó un identificador')
    await filaOutbox({ entityType: 'response', entityId: 'resp-1' })
    await filaOutbox({ entityType: 'finding', entityId: 'finding-1' })
    await filaOutbox({ entityType: 'attachment', entityId: 'foto-ins' })
    await filaOutbox({ entityType: 'attachment', entityId: 'foto-resp' })
    await filaOutbox({ entityType: 'attachment', entityId: 'foto-find' })
    await db.logEntries.add({
      id: 'log-b', siteId: 'faena-b', authorId: 'operario-b', tenantId: TENANT_B, entryText: 'Conservar',
      tags: [], shiftDate: '2026-10-16', capturedAt: ts, clientVersion: 0,
    })
    await filaOutbox({ entityType: 'log_entry', entityId: 'log-b', tenantId: TENANT_B })

    await descartarRegistroCola(raiz, TENANT_A)

    expect(await db.inspections.get('ins-1')).toBeUndefined()
    expect(await db.responses.get('resp-1')).toBeUndefined()
    expect(await db.findings.get('finding-1')).toBeUndefined()
    expect(await db.attachments.count()).toBe(0)
    expect(await db.outbox.count()).toBe(1)
    expect(await db.logEntries.get('log-b')).toBeDefined()
  })

  it('descarta una bitácora sin tocar el resto de la cola', async () => {
    await db.logEntries.add({
      id: 'log-1', siteId: 'faena-a', authorId: 'operario-a', tenantId: TENANT_A, entryText: 'Prueba',
      tags: [], shiftDate: '2026-10-16', capturedAt: ts, clientVersion: 0,
    })
    const log = await filaOutbox({ entityType: 'log_entry', entityId: 'log-1', status: 'failed' })
    const otra = await filaOutbox({ entityType: 'log_entry', entityId: 'log-2' })
    if (log === undefined || otra === undefined) throw new Error('El outbox no entregó un identificador')

    await descartarRegistroCola(log, TENANT_A)

    expect(await db.logEntries.get('log-1')).toBeUndefined()
    expect(await db.outbox.get(log)).toBeUndefined()
    expect(await db.outbox.get(otra)).toBeDefined()
  })

  it('protege una fila en envío o ya confirmada', async () => {
    await db.inspections.add({
      id: 'ins-sync', tenantId: TENANT_A, siteId: 'faena-a', templateId: 'tpl', templateVersion: 1,
      executedBy: 'operario-a', status: 'submitted', capturedAt: ts, syncedAt: null, clientVersion: 1,
      templateName: 'Checklist', siteName: 'Faena A', answeredCount: 0, totalItems: 1,
    })
    const enviando = await filaOutbox({ entityType: 'inspection', entityId: 'ins-sync', status: 'syncing' })
    if (enviando === undefined) throw new Error('El outbox no entregó un identificador')

    await expect(descartarRegistroCola(enviando, TENANT_A)).rejects.toThrow('pendientes o fallidos')
    expect(await db.inspections.get('ins-sync')).toBeDefined()
    expect(await db.outbox.get(enviando)).toBeDefined()
  })
})
