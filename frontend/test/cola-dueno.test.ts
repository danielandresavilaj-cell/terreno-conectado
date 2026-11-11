/* TSK-AUTH-010 — en un dispositivo compartido cada usuario ve y envía sólo
 * su propia cola. Las filas previas a v1 (sin dueño) se asignan al primer
 * usuario de su empresa que entra. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  contadorPendientes,
  db,
  getDraftInspectionId,
  listOutbox,
  setDraftInspectionId,
  setDueñoCola,
  sincronizables,
} from '../src/lib/db'
import { sincronizarCola } from '../src/lib/sync'
import { clearToken } from '../src/lib/api'
import { TENANT_A, TENANT_B } from './fixtures'

const ts = '2026-11-11T10:00:00.000Z'

function fila(entityId: string, tenantId: string, userId?: string) {
  return db.outbox.add({
    entityType: 'log_entry',
    entityId,
    tipo: 'bitacora',
    titulo: 'Bitácora',
    detalle: 'prueba',
    batchOrder: 5,
    status: 'pending',
    retries: 0,
    tenantId,
    userId,
    capturedAt: ts,
    updatedAt: ts,
  })
}

beforeEach(async () => {
  await setDueñoCola(null)
  await db.delete()
  await db.open()
})

afterEach(() => vi.unstubAllGlobals())

describe('cola por usuario (TSK-AUTH-010)', () => {
  it('cada usuario ve y sincroniza sólo sus filas', async () => {
    await fila('a', TENANT_A, 'usuario-1')
    await fila('b', TENANT_A, 'usuario-2')

    await setDueñoCola({ userId: 'usuario-1', tenantId: TENANT_A })
    expect(await contadorPendientes()).toBe(1)
    expect((await sincronizables()).map((f) => f.entityId)).toEqual(['a'])

    await setDueñoCola({ userId: 'usuario-2', tenantId: TENANT_A })
    expect((await listOutbox()).map((f) => f.entityId)).toEqual(['b'])
  })

  it('las filas sin dueño pasan al primer usuario de su empresa, no al de otra', async () => {
    await fila('legado-a', TENANT_A)
    await fila('legado-b', TENANT_B)

    await setDueñoCola({ userId: 'usuario-1', tenantId: TENANT_A })
    expect((await listOutbox()).map((f) => f.entityId)).toEqual(['legado-a'])

    await setDueñoCola({ userId: 'usuario-9', tenantId: TENANT_B })
    expect((await listOutbox()).map((f) => f.entityId)).toEqual(['legado-b'])
  })

  it('el borrador en curso es por usuario', async () => {
    await setDueñoCola({ userId: 'usuario-1', tenantId: TENANT_A })
    await setDraftInspectionId('borrador-1')
    await setDueñoCola({ userId: 'usuario-2', tenantId: TENANT_A })
    expect(await getDraftInspectionId()).toBeNull()
    await setDueñoCola({ userId: 'usuario-1', tenantId: TENANT_A })
    expect(await getDraftInspectionId()).toBe('borrador-1')
  })
})

describe('sesión expirada en el sync (TSK-AUTH-010)', () => {
  it('sin sesión renovable la cola queda en pausa, sin sumar intentos', async () => {
    vi.stubGlobal('document', { cookie: '' })
    vi.stubGlobal('window', { setTimeout, clearTimeout, dispatchEvent: () => true })
    clearToken()
    await setDueñoCola({ userId: 'usuario-1', tenantId: TENANT_A })
    await fila('a', TENANT_A, 'usuario-1')

    const r = await sincronizarCola()

    expect(r.estado).toBe('sin_sesion')
    const filas = await db.outbox.toArray()
    expect(filas[0].status).toBe('pending')
    expect(filas[0].retries).toBe(0)
  })
})
