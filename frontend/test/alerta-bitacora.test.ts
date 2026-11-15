/* Alerta desde la bitácora — TSK-DOM-009 (FR-069).
 *
 * En el teléfono, sin red: la entrada y su alerta se guardan y encolan juntas,
 * la alerta queda ligada a la entrada y a su faena (no a una inspección), una
 * entrada tiene a lo más una alerta, y el lote envía la bitácora antes que el
 * hallazgo para que el servidor pueda validar la referencia.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import {
  ORDEN_BATCH,
  aSyncRecord,
  addLogEntry,
  db,
  guardarHallazgo,
  hallazgoDeBitacora,
  severidadesDeBitacora,
} from '../src/lib/db'
import { TENANT_A } from './fixtures'

const FAENA = '0190f0a0-0000-7000-8000-0000000000f1'
const AUTOR = '0190f0a0-0000-7000-8000-000000000001'

async function nuevaEntrada(texto = 'Se cortó la luz en el sector norte del chancador') {
  return addLogEntry({
    siteId: FAENA,
    authorId: AUTOR,
    tenantId: TENANT_A,
    entryText: texto,
    tags: ['Seguridad'],
    shiftDate: '2026-11-15',
    detalle: 'Faena · Seguridad',
  })
}

async function alertaPara(logEntryId: string, severity: 'low' | 'medium' | 'high' | 'critical', description: string) {
  const previa = await hallazgoDeBitacora(logEntryId)
  return guardarHallazgo({
    inspectionId: null,
    responseId: null,
    logEntryId,
    siteId: FAENA,
    hallazgoId: previa?.hallazgo.id ?? null,
    tenantId: TENANT_A,
    severity,
    description,
    detalle: description,
    fotosNuevas: [],
    fotosQuitar: [],
  })
}

beforeEach(async () => {
  await db.delete()
  await db.open()
})

describe('alerta desde la bitácora (TSK-DOM-009)', () => {
  it('addLogEntry devuelve el id de la entrada', async () => {
    const id = await nuevaEntrada()
    expect(await db.logEntries.get(id)).toMatchObject({ siteId: FAENA, authorId: AUTOR })
  })

  it('la alerta se liga a la entrada y a su faena, sin inspección', async () => {
    const entrada = await nuevaEntrada()
    const { id, creado } = await alertaPara(entrada, 'high', 'Tablero eléctrico con cables expuestos')
    expect(creado).toBe(true)
    expect(await db.findings.get(id)).toMatchObject({
      inspectionId: null,
      responseId: null,
      logEntryId: entrada,
      siteId: FAENA,
      severity: 'high',
      status: 'open',
    })
    expect(await severidadesDeBitacora()).toEqual(new Map([[entrada, 'high']]))
  })

  it('una entrada tiene una sola alerta: corregirla actualiza la misma', async () => {
    const entrada = await nuevaEntrada()
    const primera = await alertaPara(entrada, 'medium', 'Cables sueltos')
    const segunda = await alertaPara(entrada, 'critical', 'Cables expuestos con tensión')
    expect(segunda).toEqual({ id: primera.id, creado: false })
    expect(await db.findings.count()).toBe(1)
    expect(await db.findings.get(primera.id)).toMatchObject({ severity: 'critical', clientVersion: 1 })
  })

  it('el lote envía la bitácora antes que el hallazgo y con sus referencias', async () => {
    expect(ORDEN_BATCH.log_entry).toBeLessThan(ORDEN_BATCH.finding)
    const entrada = await nuevaEntrada()
    const { id } = await alertaPara(entrada, 'high', 'Derrame de aceite en la rampa')
    const filas = await db.outbox.toArray()
    const fila = filas.find((f) => f.entityType === 'finding' && f.entityId === id)
    expect(fila).toBeDefined()
    expect(filas.some((f) => f.entityType === 'log_entry' && f.entityId === entrada)).toBe(true)
    const registro = await aSyncRecord(fila!)
    expect(registro.payload).toMatchObject({
      inspection_id: null,
      response_id: null,
      log_entry_id: entrada,
      site_id: FAENA,
      severity: 'high',
    })
  })

  it('un hallazgo de inspección no envía campos de bitácora', async () => {
    const { id } = await guardarHallazgo({
      inspectionId: 'ins-1',
      responseId: 'resp-1',
      tenantId: TENANT_A,
      severity: 'low',
      description: 'Señalética borrosa',
      detalle: 'Señalética borrosa',
      fotosNuevas: [],
      fotosQuitar: [],
    })
    const fila = (await db.outbox.toArray()).find((f) => f.entityType === 'finding' && f.entityId === id)!
    const registro = await aSyncRecord(fila)
    expect(registro.payload).not.toHaveProperty('log_entry_id')
    expect(registro.payload).not.toHaveProperty('site_id')
  })
})
