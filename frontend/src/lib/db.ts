/* Persistencia local offline — Dexie/IndexedDB (FR-011, FR-014, FR-015).
 *
 * Espejo del data-model §2.4: `outbox`, `inspections`, `responses`, `findings`,
 * `logEntries`, `attachments` (blobs) y `meta`. Los IDs son UUIDv7 generados en
 * el cliente (FR-015); el outbox referencia cada registro por `entityType+entityId`
 * con el orden de dependencia de FR-020 (faena→inspección→respuestas→hallazgos→fotos).
 *
 * La capa de SYNC consume este outbox en TSK-WS-007 (ingesta idempotente) y
 * TSK-WS-008 (worker + backoff); acá solo se encola (estado `pending`).
 */

import Dexie, { type EntityTable } from 'dexie'
import { uuidv7 } from '@terreno/shared'
import { PLANTILLA } from './seed'

export type SyncEstado = 'pending' | 'syncing' | 'synced' | 'failed'
export type OutboxTipo = 'inspeccion' | 'respuesta' | 'hallazgo' | 'foto' | 'bitacora'
export type Severity = 'low' | 'medium' | 'high' | 'critical'
export type ResponseValor = 'ok' | 'nok' | 'na'

export interface OutboxRow {
  id?: number
  entityType: 'inspection' | 'response' | 'finding' | 'attachment' | 'log_entry'
  entityId: string
  tipo: OutboxTipo
  titulo: string
  detalle: string
  /** FR-020: orden de dependencia al sincronizar. */
  batchOrder: number
  status: SyncEstado
  retries: number
  lastError?: string
  tenantId: string
  capturedAt: string
  updatedAt: string
}

export interface InspectionRow {
  id: string
  tenantId: string
  siteId: string
  templateId: string
  templateVersion: number
  executedBy: string
  status: 'draft' | 'in_progress' | 'submitted' | 'reviewed'
  capturedAt: string
  syncedAt: string | null
  clientVersion: number
  templateName: string
  siteName: string
  answeredCount: number
  totalItems: number
}

export interface ResponseRow {
  id: string
  inspectionId: string
  templateItemId: string
  tenantId: string
  valueOk: ResponseValor | null
  valueText: string | null
  valueNumber: number | null
  capturedAt: string
  clientVersion: number
}

export interface FindingRow {
  id: string
  inspectionId: string | null
  responseId: string | null
  tenantId: string
  severity: Severity
  description: string
  status: 'open' | 'in_progress' | 'resolved'
  capturedAt: string
  clientVersion: number
}

export interface LogEntryRow {
  id: string
  siteId: string
  authorId: string
  tenantId: string
  entryText: string
  tags: string[]
  shiftDate: string
  capturedAt: string
  clientVersion: number
}

export interface AttachmentRow {
  id: string
  tenantId: string
  ownerType: 'inspection' | 'finding' | 'log_entry'
  ownerId: string
  mime: string
  bytes: number
  blob: Blob
  /** FR-012: la foto se comprime a ≤1280 px q0.7 ANTES de encolarse. */
  ancho: number
  alto: number
  capturedAt: string
  clientVersion: number
}

export type MetaValue = string | number | null

export const ORDEN_BATCH: Record<OutboxRow['entityType'], number> = {
  inspection: 1,
  response: 2,
  finding: 3,
  attachment: 4,
  log_entry: 5,
}

export const TIPO_ENTIDAD: Record<OutboxRow['entityType'], OutboxTipo> = {
  inspection: 'inspeccion',
  response: 'respuesta',
  finding: 'hallazgo',
  attachment: 'foto',
  log_entry: 'bitacora',
}

export const db = new Dexie('terreno-conectado') as Dexie & {
  outbox: EntityTable<OutboxRow, 'id'>
  inspections: EntityTable<InspectionRow, 'id'>
  responses: EntityTable<ResponseRow, 'id'>
  findings: EntityTable<FindingRow, 'id'>
  logEntries: EntityTable<LogEntryRow, 'id'>
  attachments: EntityTable<AttachmentRow, 'id'>
  meta: EntityTable<{ key: string; value: MetaValue }, 'key'>
}

db.version(1).stores({
  outbox: '++id, entityType, status, [entityType+entityId]',
  inspections: 'id, tenantId, status, [tenantId+capturedAt]',
  responses: 'id, inspectionId, templateItemId, [inspectionId+templateItemId]',
  findings: 'id, inspectionId, severity, tenantId, [tenantId+capturedAt]',
  logEntries: 'id, siteId, authorId, [tenantId+capturedAt]',
  attachments: 'id, ownerId, ownerType',
  meta: 'key',
})

/* ------------------------------------------------------------------ util */

function ahoraIso(): string {
  return new Date().toISOString()
}

function encolar(
  entityType: OutboxRow['entityType'],
  entityId: string,
  titulo: string,
  detalle: string,
  tenantId: string,
): Promise<number | undefined> {
  const ts = ahoraIso()
  return db.outbox.add({
    entityType,
    entityId,
    tipo: TIPO_ENTIDAD[entityType],
    titulo,
    detalle,
    batchOrder: ORDEN_BATCH[entityType],
    status: 'pending',
    retries: 0,
    tenantId,
    capturedAt: ts,
    updatedAt: ts,
  })
}

/* ------------------------------------------------------------------ meta */

export async function getDeviceId(): Promise<string> {
  const row = await db.meta.get('deviceId')
  if (row?.value) return String(row.value)
  const id = uuidv7()
  await db.meta.put({ key: 'deviceId', value: id })
  return id
}

export async function getDraftInspectionId(): Promise<string | null> {
  const row = await db.meta.get('draftInspectionId')
  return row?.value ? String(row.value) : null
}

export async function setDraftInspectionId(id: string | null): Promise<void> {
  if (id) await db.meta.put({ key: 'draftInspectionId', value: id })
  else await db.meta.delete('draftInspectionId')
}

/* ------------------------------------------------------ draft de captura */

export async function ensureDraftInspection(params: {
  tenantId: string
  siteId: string
  executedBy: string
  templateName: string
  siteName: string
  totalItems: number
}): Promise<{ id: string; answeredCount: number }> {
  const existing = await getDraftInspectionId()
  if (existing) {
    const row = await db.inspections.get(existing)
    if (row && (row.status === 'draft' || row.status === 'in_progress')) {
      const answered = await db.responses.where('inspectionId').equals(existing).count()
      return { id: existing, answeredCount: answered }
    }
    await setDraftInspectionId(null)
  }
  const id = uuidv7()
  const model: InspectionRow = {
    id,
    tenantId: params.tenantId,
    siteId: params.siteId,
    templateId: 'plantilla-rajo-seguridad-v3',
    templateVersion: 3,
    executedBy: params.executedBy,
    status: 'draft',
    capturedAt: ahoraIso(),
    syncedAt: null,
    clientVersion: 0,
    templateName: params.templateName,
    siteName: params.siteName,
    answeredCount: 0,
    totalItems: params.totalItems,
  }
  await db.inspections.add(model)
  await setDraftInspectionId(id)
  return { id, answeredCount: 0 }
}

export async function upsertResponse(params: {
  inspectionId: string
  templateItemId: string
  tenantId: string
  valueOk: ResponseValor | null
  valueText?: string | null
  valueNumber?: number | null
}): Promise<string> {
  const existing = await db.responses
    .where('[inspectionId+templateItemId]')
    .equals([params.inspectionId, params.templateItemId])
    .first()
  if (existing) {
    await db.responses.update(existing.id, {
      valueOk: params.valueOk,
      valueText: params.valueText ?? existing.valueText,
      valueNumber: params.valueNumber ?? existing.valueNumber,
      capturedAt: ahoraIso(),
      clientVersion: existing.clientVersion + 1,
    })
    return existing.id
  }
  const id = uuidv7()
  await db.responses.add({
    id,
    inspectionId: params.inspectionId,
    templateItemId: params.templateItemId,
    tenantId: params.tenantId,
    valueOk: params.valueOk,
    valueText: params.valueText ?? null,
    valueNumber: params.valueNumber ?? null,
    capturedAt: ahoraIso(),
    clientVersion: 0,
  })
  return id
}

export async function submitInspection(inspectionId: string): Promise<void> {
  const ins = await db.inspections.get(inspectionId)
  if (!ins) throw new Error('Borrador de inspección no encontrado')
  await db.inspections.update(inspectionId, {
    status: 'submitted',
    answeredCount: await db.responses.where('inspectionId').equals(inspectionId).count(),
  })
  await db.transaction('rw', db.outbox, async () => {
    await encolar(
      'inspection',
      inspectionId,
      `Inspección · ${ins.templateName}`,
      `${ins.siteName} · ${ins.totalItems} ítems`,
      ins.tenantId,
    )
    const respuestas = await db.responses.where('inspectionId').equals(inspectionId).toArray()
    for (const r of respuestas) {
      await encolar(
        'response',
        r.id,
        'Respuestas de checklist',
        `Ítem ${r.templateItemId} · ${r.valueOk ?? '—'}`,
        ins.tenantId,
      )
    }
  })
  await setDraftInspectionId(null)
}

export async function respuestaDelItem(
  inspectionId: string,
  templateItemId: string,
): Promise<ResponseRow | undefined> {
  return db.responses
    .where('[inspectionId+templateItemId]')
    .equals([inspectionId, templateItemId])
    .first()
}

export async function addFinding(params: {
  inspectionId: string
  responseId: string | null
  tenantId: string
  severity: Severity
  description: string
  detalle: string
  /** FR-012: blob ya comprimido (≤1280 px, q0.7) por `comprimirImagen`. */
  foto: { blob: Blob; ancho: number; alto: number; mime: string } | null
}): Promise<void> {
  const ts = ahoraIso()
  const findingId = uuidv7()
  const finding: FindingRow = {
    id: findingId,
    inspectionId: params.inspectionId,
    responseId: params.responseId,
    tenantId: params.tenantId,
    severity: params.severity,
    description: params.description,
    status: 'open',
    capturedAt: ts,
    clientVersion: 0,
  }
  await db.transaction('rw', db.findings, db.attachments, db.outbox, async () => {
    await db.findings.add(finding)
    await encolar(
      'finding',
      findingId,
      `Hallazgo · Severidad ${params.severity}`,
      params.detalle,
      params.tenantId,
    )
    if (params.foto) {
      const attachmentId = uuidv7()
      await db.attachments.add({
        id: attachmentId,
        tenantId: params.tenantId,
        ownerType: 'finding',
        ownerId: findingId,
        mime: params.foto.mime,
        bytes: params.foto.blob.size,
        blob: params.foto.blob,
        ancho: params.foto.ancho,
        alto: params.foto.alto,
        capturedAt: ts,
        clientVersion: 0,
      })
      await encolar(
        'attachment',
        attachmentId,
        'Evidencia fotográfica',
        `${params.foto.ancho}×${params.foto.alto} · ${Math.round(params.foto.blob.size / 1024)} KB comprimida (FR-012)`,
        params.tenantId,
      )
    }
  })
}

export async function addLogEntry(params: {
  siteId: string
  authorId: string
  tenantId: string
  entryText: string
  tags: string[]
  shiftDate: string
  detalle: string
}): Promise<void> {
  const ts = ahoraIso()
  const id = uuidv7()
  const entry: LogEntryRow = {
    id,
    siteId: params.siteId,
    authorId: params.authorId,
    tenantId: params.tenantId,
    entryText: params.entryText,
    tags: params.tags,
    shiftDate: params.shiftDate,
    capturedAt: ts,
    clientVersion: 0,
  }
  await db.transaction('rw', db.logEntries, db.outbox, async () => {
    await db.logEntries.add(entry)
    await encolar('log_entry', id, 'Bitácora de turno', params.detalle, params.tenantId)
  })
}

export async function listOutbox(): Promise<OutboxRow[]> {
  return db.outbox.orderBy('id').reverse().toArray()
}

export async function listLogEntries(siteId: string | null): Promise<LogEntryRow[]> {
  const rows = siteId
    ? await db.logEntries.where('siteId').equals(siteId).toArray()
    : await db.logEntries.toArray()
  return rows.sort((a, b) => (a.capturedAt < b.capturedAt ? 1 : -1))
}

export async function contadorPendientes(): Promise<number> {
  return db.outbox.where('status').anyOf('pending', 'syncing', 'failed').count()
}

export async function contadorFallidos(): Promise<number> {
  return db.outbox.where('status').equals('failed').count()
}

/* ------------------------------------------------------------ seed demo */

const SEED_VERSION = '2'
const PNG_BLANCO =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

/**
 * Primer arranque: siembra el outbox/entidades demo (mismo contenido realista
 * del mockup, pero persistido de verdad) para que FR-013 se vea desde el
 * primer frame. No vuelve a correr si `meta.seedVersion === SEED_VERSION`.
 */
export async function seedDemoDataIfNeeded(cola: Array<{ uuid: string; titulo: string; detalle: string; tipo: string; estado: string; orden: number; tenantId: string; intentos?: number }>): Promise<void> {
  const row = await db.meta.get('seedVersion')
  if (row?.value === SEED_VERSION) return

  const ts = ahoraIso()
  const filas: OutboxRow[] = cola.map((r, i) => ({
    entityType: TIPO_ENTIDAD_ENTITY[r.tipo as OutboxTipo] ?? 'finding',
    entityId: r.uuid,
    tipo: r.tipo as OutboxTipo,
    titulo: r.titulo,
    detalle: r.detalle,
    batchOrder: r.orden,
    status: r.estado as SyncEstado,
    retries: r.intentos ?? 0,
    tenantId: r.tenantId,
    capturedAt: new Date(Date.now() - (cola.length - i) * 60_000).toISOString(),
    updatedAt: ts,
  }))

  await db.transaction(
    'rw',
    [db.outbox, db.inspections, db.responses, db.findings, db.logEntries, db.attachments, db.meta],
    async () => {
    await db.outbox.bulkAdd(filas)
    const insp = cola.find((c) => c.tipo === 'inspeccion')
    if (insp) {
      await db.inspections.add({
        id: insp.uuid,
        tenantId: insp.tenantId,
        siteId: 'f-01',
        templateId: 'plantilla-rajo-seguridad-v3',
        templateVersion: 3,
        executedBy: 'u-carla',
        status: 'submitted',
        capturedAt: ts,
        syncedAt: ts,
        clientVersion: 0,
        templateName: 'Seguridad en rajo',
        siteName: 'Faena Centinela — Sector Norte',
        answeredCount: 5,
        totalItems: 8,
      })
      for (const item of PLANTILLA.slice(0, 5)) {
        await db.responses.add({
          id: await idRespuesta(insp.uuid, item.id),
          inspectionId: insp.uuid,
          templateItemId: item.id,
          tenantId: insp.tenantId,
          valueOk: item.id === 'i-02' ? 'nok' : 'ok',
          valueText: null,
          valueNumber: item.id === 'i-04' ? 180 : null,
          capturedAt: ts,
          clientVersion: 0,
        })
      }
    }
    const hallazgo = cola.find((c) => c.tipo === 'hallazgo')
    if (hallazgo) {
      await db.findings.add({
        id: hallazgo.uuid,
        inspectionId: insp?.uuid ?? null,
        responseId: insp ? await idRespuesta(insp.uuid, 'i-02') : null,
        tenantId: hallazgo.tenantId,
        severity: 'high',
        description: 'Sin señalización en ruta de evacuación',
        status: 'open',
        capturedAt: ts,
        clientVersion: 0,
      })
    }
    const logRows = cola.filter((c) => c.tipo === 'bitacora')
    for (const l of logRows) {
      await db.logEntries.add({
        id: l.uuid,
        siteId: 'f-01',
        authorId: 'u-carla',
        tenantId: l.tenantId,
        entryText:
          l.detalle.startsWith('2 entradas')
            ? 'Relevo de turno con el jefe Jh. Salas. Se deja faena nivelada. Queda pendiente la señalización de la ruta de evacuación por falta de conos.'
            : 'Viento sostenido del este, visibilidad buena. Se postergó el movimiento de la shovel por polvo en la rampa de acceso.',
        tags: l.detalle === 'Turno B · 2 entradas' ? ['Turno B', 'Relevo'] : ['Clima'],
        shiftDate: ts.slice(0, 10),
        capturedAt: ts,
        clientVersion: 0,
      })
    }
    const foto = cola.find((c) => c.tipo === 'foto')
    if (foto) {
      const blob = await (await fetch(PNG_BLANCO)).blob()
      await db.attachments.add({
        id: foto.uuid,
        tenantId: foto.tenantId,
        ownerType: 'finding',
        ownerId: hallazgo?.uuid ?? '',
        mime: 'image/png',
        bytes: blob.size,
        blob,
        ancho: 1,
        alto: 1,
        capturedAt: ts,
        clientVersion: 0,
      })
    }
    await db.meta.put({ key: 'seedVersion', value: SEED_VERSION })
  })
}

const TIPO_ENTIDAD_ENTITY: Record<OutboxTipo, OutboxRow['entityType']> = {
  inspeccion: 'inspection',
  respuesta: 'response',
  hallazgo: 'finding',
  foto: 'attachment',
  bitacora: 'log_entry',
}

async function idRespuesta(inspectionId: string, templateItemId: string): Promise<string> {
  const r = await respuestaDelItem(inspectionId, templateItemId)
  return r?.id ?? uuidv7()
}