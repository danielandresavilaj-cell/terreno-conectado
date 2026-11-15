/* Abrir un formulario con un QR sin señal — TSK-OPS-003-C, tramo 2 (FR-060/061).
 *
 * El teléfono resuelve el código contra los activos y el catálogo asignado que
 * ya tiene guardados, sin pedir nada a la red: calcula el mismo SHA-256 que el
 * servidor, distingue un código ajeno, uno de otra faena y uno cuyo formulario
 * no está asignado, y la inspección que nace del QR envía su `asset_id`.
 */
import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import { aSyncRecord, db, ensureDraftInspection, guardarActivosCache, type ActivoRow, type OutboxRow } from '../src/lib/db'
import { hashQr, mensajeQr, resolverQr } from '../src/lib/qr'
import { TENANT_A, TENANT_B, publicada, uuid } from './fixtures'

const FAENA = uuid(50)
const OTRA_FAENA = uuid(51)
const PLANTILLA = uuid(10)
const QR = 'tc1:abcdefghijklmnopqrstuv'
const sha = (t: string) => createHash('sha256').update(t, 'utf8').digest('hex')

function activo(over: Partial<ActivoRow> = {}): ActivoRow {
  return {
    id: uuid(60),
    tenantId: TENANT_A,
    siteId: FAENA,
    templateId: PLANTILLA,
    name: 'Camioneta CA-12',
    kind: 'vehicle',
    qrHash: sha(QR),
    ...over,
  }
}

const formularios = [publicada({ template_id: PLANTILLA, revision_id: uuid(11), version: 1 }), publicada({ template_id: PLANTILLA, revision_id: uuid(12), version: 2 })]

beforeEach(async () => {
  await db.delete()
  await db.open()
})

describe('resolver un QR sin señal (TSK-OPS-003-C)', () => {
  it('calcula el mismo SHA-256 que el servidor', async () => {
    expect(await hashQr(QR)).toBe(sha(QR))
  })

  it('abre la revisión más nueva del formulario del activo, aunque el código venga sin prefijo o con espacios', async () => {
    await guardarActivosCache(TENANT_A, [activo()])
    for (const texto of [QR, ' TC1:abcdefgh ijklmnopqrstuv ', 'abcdefghijklmnopqrstuv']) {
      const r = await resolverQr({ texto, tenantId: TENANT_A, faenaId: FAENA, formularios })
      expect(r.estado).toBe('ok')
      if (r.estado === 'ok') expect(r.revision.revision_id).toBe(uuid(12))
    }
  })

  it('distingue código inválido, desconocido, de otra faena y sin formulario asignado', async () => {
    await guardarActivosCache(TENANT_A, [activo(), activo({ id: uuid(61), siteId: OTRA_FAENA, qrHash: sha('tc1:zzzzzzzzzzzzzzzzzzzzzz') })])
    const base = { tenantId: TENANT_A, faenaId: FAENA, formularios }
    expect((await resolverQr({ ...base, texto: 'https://otro.sitio' })).estado).toBe('invalido')
    expect((await resolverQr({ ...base, texto: 'tc1:yyyyyyyyyyyyyyyyyyyyyy' })).estado).toBe('desconocido')
    const otra = await resolverQr({ ...base, texto: 'tc1:zzzzzzzzzzzzzzzzzzzzzz' })
    expect(otra.estado).toBe('otra-faena')
    expect(mensajeQr(otra, () => 'Planta Llano Seco')).toContain('Planta Llano Seco')
    expect((await resolverQr({ ...base, texto: QR, formularios: [] })).estado).toBe('sin-formulario')
  })

  it('no usa activos de otra empresa guardados en el mismo teléfono', async () => {
    await guardarActivosCache(TENANT_B, [activo({ tenantId: TENANT_B })])
    expect((await resolverQr({ texto: QR, tenantId: TENANT_A, faenaId: FAENA, formularios })).estado).toBe('desconocido')
  })

  it('al sincronizar, un activo revocado (que ya no viene) deja de abrir', async () => {
    await guardarActivosCache(TENANT_A, [activo()])
    await guardarActivosCache(TENANT_A, [])
    expect((await resolverQr({ texto: QR, tenantId: TENANT_A, faenaId: FAENA, formularios })).estado).toBe('desconocido')
  })

  it('la inspección abierta por QR envía su asset_id; una normal no manda el campo', async () => {
    const base = { tenantId: TENANT_A, siteId: FAENA, executedBy: uuid(70), templateName: 'Chequeo', siteName: 'Faena', totalItems: 1, templateId: PLANTILLA, templateVersion: 2, templateRevisionId: uuid(12) }
    const conQr = await ensureDraftInspection({ ...base, assetId: uuid(60) })
    const fila = (id: string) => ({ entityType: 'inspection', entityId: id, tenantId: TENANT_A, capturedAt: new Date().toISOString() }) as OutboxRow
    expect((await aSyncRecord(fila(conQr.id))).payload).toMatchObject({ asset_id: uuid(60) })

    await db.inspections.update(conQr.id, { status: 'submitted' })
    const normal = await ensureDraftInspection(base)
    expect(normal.id).not.toBe(conQr.id)
    expect((await aSyncRecord(fila(normal.id))).payload).not.toHaveProperty('asset_id')
  })
})
