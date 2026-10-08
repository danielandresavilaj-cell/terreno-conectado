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
import { uuidv7, type SyncRecord, type TemplatePublicadaDto } from '@terreno/shared'
import { PLANTILLA } from './seed'
import type { Identidad, Usuario } from './types'

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
  /** Forma híbrida FR-036: date/time/select_single → string;
   *  select_multiple → string[]; null en los demás tipos. */
  valueJson?: string | string[] | null
  /** @deprecated Borradores previos a TSK-FORM-004: el binario ahora vive en un
   *  ATTACHMENT `owner_type='response'` (FR-037); se migra en `migrarFotosLegacy`. */
  valuePhoto?: Blob | null
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
  /** FR-037: 'response' = foto de ítem photo; owner_id → inspection_response.id. */
  ownerType: 'inspection' | 'finding' | 'log_entry' | 'response'
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

/** Revisión publicada cacheada en el dispositivo (FR-018, TSK-FORM-001/009).
 *  La captura renderiza desde acá aunque no haya red. */
export interface PlantillaCacheRow extends TemplatePublicadaDto {
  cachedAt: string
}

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
  plantillas: EntityTable<PlantillaCacheRow, 'revision_id'>
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

// v2 (TSK-FORM-001): caché local de revisiones publicadas para render offline.
db.version(2).stores({
  plantillas: 'revision_id, template_id, version',
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

/* ------------------------------------------------------ identidad offline
 *
 * TSK-WS-011: el login y `GET /sites` confirman tenant + faenas con IDs
 * reales; se cachean aquí para que la captura offline (FR-006) sepa a qué
 * tenant/faena escribir sin red. `SesionCaché` incluye también el perfil para
 * restaurar la sesión visual sin consultar `/auth/me` cuando no hay señal. */

export interface SesionCaché {
  perfil: { id: string; tenant_id: string | null; email: string; role: string; full_name: string }
  identidad: Identidad
  ts: string
}

export async function guardarSesionCaché(s: SesionCaché): Promise<void> {
  await db.meta.put({ key: 'tc_sesion', value: JSON.stringify(s) })
}

export async function sesionCaché(): Promise<SesionCaché | null> {
  const row = await db.meta.get('tc_sesion')
  if (!row?.value) return null
  try {
    const s = JSON.parse(String(row.value)) as SesionCaché
    if (!s?.identidad?.tenantId) return null
    return s
  } catch {
    return null
  }
}

export async function borrarSesionCaché(): Promise<void> {
  await db.meta.delete('tc_sesion')
}

/** UUID del template demo, estable por dispositivo (el servidor lo valida como
 *  UUID; un string legible como el viejo 'plantilla-…-v3' rompería el UPDATE). */
export async function getTemplateId(): Promise<string> {
  const row = await db.meta.get('templateId')
  if (row?.value && typeof row.value === 'string') return row.value
  const id = uuidv7()
  await db.meta.put({ key: 'templateId', value: id })
  return id
}

export async function getDraftInspectionId(): Promise<string | null> {
  const row = await db.meta.get('draftInspectionId')
  return row?.value ? String(row.value) : null
}

export async function getInspection(id: string): Promise<InspectionRow | undefined> {
  return db.inspections.get(id)
}

export async function setDraftInspectionId(id: string | null): Promise<void> {
  if (id) await db.meta.put({ key: 'draftInspectionId', value: id })
  else await db.meta.delete('draftInspectionId')
}

/* ------------------------------------------------ plantillas cacheadas */

/** Guarda revisiones publicadas descargadas (upsert por revisión). */
export async function guardarPlantillasCache(items: TemplatePublicadaDto[]): Promise<void> {
  if (items.length === 0) return
  const ts = ahoraIso()
  await db.plantillas.bulkPut(items.map((i) => ({ ...i, cachedAt: ts })))
}

/** Revisiones publicadas cacheadas en el dispositivo, más nueva primero. */
export async function plantillasCacheadas(): Promise<PlantillaCacheRow[]> {
  const rows = await db.plantillas.toArray()
  return rows.sort((a, b) => b.version - a.version)
}

/* ------------------------------------------------------ draft de captura */

export async function ensureDraftInspection(params: {
  tenantId: string
  siteId: string
  executedBy: string
  templateName: string
  siteName: string
  totalItems: number
  /** FR-038: congelamiento — si la plantilla activa lo define, el borrador
   *  nace con su `template_id`/`version` y conserva ese marco aunque la
   *  plantilla publicada cambie después. */
  templateId?: string
  templateVersion?: number
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
    templateId: params.templateId ?? (await getTemplateId()),
    templateVersion: params.templateVersion ?? 3,
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

/**
 * Upsert de la respuesta de un ítem. Los valores opcionales con `undefined`
 * NO tocan la columna existente; `null` la limpia (así un campo se puede
 * vaciar). `valueJson` guarda la forma híbrida de select/date/time (FR-036);
 * la foto de respuesta NO va acá: se persiste con `guardarFotoRespuesta`
 * (ATTACHMENT, FR-037).
 */
export async function upsertResponse(params: {
  inspectionId: string
  templateItemId: string
  tenantId: string
  valueOk?: ResponseValor | null
  valueText?: string | null
  valueNumber?: number | null
  valueJson?: string | string[] | null
}): Promise<string> {
  const existing = await db.responses
    .where('[inspectionId+templateItemId]')
    .equals([params.inspectionId, params.templateItemId])
    .first()
  if (existing) {
    await db.responses.update(existing.id, {
      ...(params.valueOk !== undefined ? { valueOk: params.valueOk } : {}),
      ...(params.valueText !== undefined ? { valueText: params.valueText } : {}),
      ...(params.valueNumber !== undefined ? { valueNumber: params.valueNumber } : {}),
      ...(params.valueJson !== undefined ? { valueJson: params.valueJson } : {}),
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
    valueOk: params.valueOk ?? null,
    valueText: params.valueText ?? null,
    valueNumber: params.valueNumber ?? null,
    valueJson: params.valueJson ?? null,
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
  await db.transaction('rw', [db.outbox, db.responses, db.attachments], async () => {
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
    // FR-037: la foto de respuesta viaja como ATTACHMENT `owner_type='response'`.
    // Se encola acá (y no al capturar) para que el lote traiga primero la
    // respuesta referenciada: orden FR-020 (response=2 < attachment=4).
    const ids = new Set(respuestas.map((r) => r.id))
    const fotos = await db.attachments.where('ownerType').equals('response').toArray()
    for (const a of fotos) {
      if (!ids.has(a.ownerId)) continue
      await encolar(
        'attachment',
        a.id,
        'Foto de respuesta',
        `${a.ancho}×${a.alto} · ${Math.round(a.bytes / 1024)} KB comprimida (FR-012)`,
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

/** Foto de un ítem photo → ATTACHMENT `owner_type='response'` (FR-037). No se
 *  encola: el outbox la toma en `submitInspection`, junto a su respuesta. */
export async function guardarFotoRespuesta(params: {
  responseId: string
  tenantId: string
  /** Blob ya comprimido (≤1280 px, q0.7) por `comprimirImagen` (FR-012). */
  foto: { blob: Blob; ancho: number; alto: number; mime: string }
}): Promise<void> {
  const ts = ahoraIso()
  const existente = await db.attachments
    .where('ownerId')
    .equals(params.responseId)
    .and((a) => a.ownerType === 'response')
    .first()
  if (existente) {
    await db.attachments.update(existente.id, {
      mime: params.foto.mime,
      bytes: params.foto.blob.size,
      blob: params.foto.blob,
      ancho: params.foto.ancho,
      alto: params.foto.alto,
      capturedAt: ts,
      clientVersion: existente.clientVersion + 1,
    })
    return
  }
  await db.attachments.add({
    id: uuidv7(),
    tenantId: params.tenantId,
    ownerType: 'response',
    ownerId: params.responseId,
    mime: params.foto.mime,
    bytes: params.foto.blob.size,
    blob: params.foto.blob,
    ancho: params.foto.ancho,
    alto: params.foto.alto,
    capturedAt: ts,
    clientVersion: 0,
  })
}

/** Vaciar el campo photo: borra el ATTACHMENT local, su fila de outbox (si el
 *  envío ya la encoló) y el binario legado `valuePhoto`. */
export async function quitarFotoRespuesta(responseId: string): Promise<void> {
  const adjuntos = await db.attachments
    .where('ownerId')
    .equals(responseId)
    .and((a) => a.ownerType === 'response')
    .toArray()
  await db.transaction('rw', [db.responses, db.attachments, db.outbox], async () => {
    for (const a of adjuntos) {
      await db.outbox.where('[entityType+entityId]').equals(['attachment', a.id]).delete()
      await db.attachments.delete(a.id)
    }
    await db.responses.update(responseId, { valuePhoto: undefined })
  })
}

/**
 * TSK-FORM-004 (one-shot, marca en `meta`): los borradores previos guardaban
 * el binario de la foto en `valuePhoto`. Lo migra a un ATTACHMENT
 * `owner_type='response'` conservando el marcador `valueText='capturada'`;
 * si la inspección ya fue enviada, la encola de inmediato para que suba en el
 * próximo lote (las respuestas ya están en outbox o sincronizadas).
 */
export async function migrarFotosLegacy(): Promise<void> {
  const hecho = await db.meta.get('fotosLegacyMigradas')
  if (hecho?.value === '1') return
  const conFoto = await db.responses.filter((r) => r.valuePhoto != null).toArray()
  if (conFoto.length > 0) {
    const ts = ahoraIso()
    await db.transaction('rw', [db.responses, db.attachments, db.inspections, db.outbox], async () => {
      for (const r of conFoto) {
        const blob = r.valuePhoto
        if (!blob) continue
        let ancho = 0
        let alto = 0
        try {
          const bmp = await createImageBitmap(blob)
          ancho = bmp.width
          alto = bmp.height
          bmp.close()
        } catch {
          continue // sin dimensiones el servidor la rechaza (width/height ≥ 1)
        }
        const attId = uuidv7()
        await db.attachments.add({
          id: attId,
          tenantId: r.tenantId,
          ownerType: 'response',
          ownerId: r.id,
          mime: blob.type || 'image/jpeg',
          bytes: blob.size,
          blob,
          ancho,
          alto,
          capturedAt: ts,
          clientVersion: 0,
        })
        await db.responses.update(r.id, { valuePhoto: undefined })
        const ins = await db.inspections.get(r.inspectionId)
        if (ins && (ins.status === 'submitted' || ins.status === 'reviewed')) {
          await encolar(
            'attachment',
            attId,
            'Foto de respuesta',
            `${ancho}×${alto} · ${Math.round(blob.size / 1024)} KB comprimida (FR-012)`,
            r.tenantId,
          )
        }
      }
    })
  }
  await db.meta.put({ key: 'fotosLegacyMigradas', value: '1' })
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

/* ----------------------------------------------- capa de sync (TSK-WS-008)
 *
 * El worker (`lib/sync.ts`) lee del outbox vía `sincronizables`, arma el
 * `SyncBatchRequest` con `aSyncRecord` y escribe el desenlace con
 * `marcar*`. Concurrencia 1 y backoff los controla el propio worker.
 */

/** Filas listas para enviar: pendientes y fallidas, en orden de dependencia (FR-020). */
export async function sincronizables(): Promise<OutboxRow[]> {
  const rows = await db.outbox.where('status').anyOf('pending', 'failed').toArray()
  return rows.sort((a, b) => a.batchOrder - b.batchOrder || a.entityId.localeCompare(b.entityId))
}

/** Fila del outbox → SyncRecord wire (contrato de `shared/src/sync.ts`). */
export async function aSyncRecord(o: OutboxRow): Promise<SyncRecord> {
  const payload = await payloadDe(o)
  return {
    entity_type: o.entityType,
    id: o.entityId,
    tenant_id: o.tenantId,
    client_version: payload.client_version,
    captured_at: payload.captured_at,
    payload: payload.body,
  }
}

async function payloadDe(o: OutboxRow): Promise<{
  client_version: number
  captured_at: string
  body: SyncRecord['payload']
}> {
  switch (o.entityType) {
    case 'inspection': {
      const r = await db.inspections.get(o.entityId)
      if (!r) throw new Error(`inspection ${o.entityId} no existe`)
      return {
        client_version: r.clientVersion,
        captured_at: r.capturedAt,
        body: {
          site_id: r.siteId,
          template_id: r.templateId,
          template_version: r.templateVersion,
          executed_by: r.executedBy,
          status: r.status,
        },
      }
    }
    case 'response': {
      const r = await db.responses.get(o.entityId)
      if (!r) throw new Error(`response ${o.entityId} no existe`)
      return {
        client_version: r.clientVersion,
        captured_at: r.capturedAt,
        body: {
          inspection_id: r.inspectionId,
          template_item_id: r.templateItemId,
          value_ok: r.valueOk,
          value_text: r.valueText,
          value_number: r.valueNumber,
          value_json: r.valueJson ?? null,
        },
      }
    }
    case 'finding': {
      const r = await db.findings.get(o.entityId)
      if (!r) throw new Error(`finding ${o.entityId} no existe`)
      return {
        client_version: r.clientVersion,
        captured_at: r.capturedAt,
        body: {
          inspection_id: r.inspectionId,
          response_id: r.responseId,
          severity: r.severity,
          description: r.description,
          status: r.status,
        },
      }
    }
    case 'log_entry': {
      const r = await db.logEntries.get(o.entityId)
      if (!r) throw new Error(`log_entry ${o.entityId} no existe`)
      return {
        client_version: r.clientVersion,
        captured_at: r.capturedAt,
        body: {
          site_id: r.siteId,
          author_id: r.authorId,
          entry_text: r.entryText,
          tags: r.tags,
          shift_date: r.shiftDate,
        },
      }
    }
    case 'attachment': {
      const r = await db.attachments.get(o.entityId)
      if (!r) throw new Error(`attachment ${o.entityId} no existe`)
      return {
        client_version: r.clientVersion,
        captured_at: r.capturedAt,
        body: {
          owner_type: r.ownerType,
          owner_id: r.ownerId,
          mime: r.mime,
          bytes: r.bytes,
          width: r.ancho,
          height: r.alto,
          data: await blobABase64(r.blob),
        },
      }
    }
  }
}

/** Blob → base64 para el campo `data` del adjunto (V1, volumen Docker). */
function blobABase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      if (typeof result !== 'string') return reject(new Error('lectura del blob falló'))
      // FileReader entrega data URLs; extraemos solo el base64.
      resolve(result.slice(result.indexOf(',') + 1))
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

/** FR-026: marca los envíos exitosos → `synced` (y `syncedAt` en las inspecciones). */
export async function marcarSincronizado(filas: OutboxRow[]): Promise<void> {
  if (filas.length === 0) return
  const ts = ahoraIso()
  await db.transaction('rw', db.outbox, db.inspections, async () => {
    for (const f of filas) {
      await db.outbox.update(f.id as number, {
        status: 'synced',
        retries: 0,
        lastError: undefined,
        updatedAt: ts,
      })
      if (f.entityType === 'inspection') {
        await db.inspections.where('id').equals(f.entityId).modify({ syncedAt: ts })
      }
    }
  })
}

/** FR-022: un fallo suma un intento, deja el error y vuelve la fila a `failed`. */
export async function marcarFallido(fila: OutboxRow, mensaje: string): Promise<void> {
  await db.outbox.update(fila.id as number, {
    status: 'failed',
    retries: (fila.retries ?? 0) + 1,
    lastError: mensaje.slice(0, 300),
    updatedAt: ahoraIso(),
  })
}

/** Durante el envío la fila pasa a `syncing` (transición visible en la cola). */
export async function marcarEnviando(filas: OutboxRow[]): Promise<void> {
  if (filas.length === 0) return
  const ts = ahoraIso()
  for (const f of filas) {
    await db.outbox.update(f.id as number, { status: 'syncing', updatedAt: ts })
  }
}

/* ------------------------------------------------------------ seed demo */

const SEED_VERSION = '3'
const PNG_BLANCO =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

/**
 * Primer arranque: siembra el outbox/entidades demo (mismo contenido realista
 * del mockup, pero persistido de verdad) para que FR-013 se vea desde el
 * primer frame — y ahora con la IDENTIDAD REAL de la sesión (TSK-WS-011): los
 * IDs de tenant/site/ejecutor/template son los que el backend espera, así el
 * primer sync es un lote válido de verdad (nada de IDs falsos 'f-01/u-carla').
 *
 * Re-siembra (con borrado) SOLO si cambió la semilla (SEED_VERSION) o si el
 * dispositivo quedó con datos de otro tenant: en un equipo compartido, los
 * borradores de la empresa A no pueden sincronizarse con la sesión de B sin
 * violar el aislamiento (NFR-05). Dentro del mismo tenant no se toca nada.
 */
export async function seedDemoDataIfNeeded(
  cola: Array<{
    uuid: string
    titulo: string
    detalle: string
    tipo: string
    estado: string
    orden: number
    tenantId: string
    intentos?: number
  }>,
  identidad: Identidad,
  usuario: Usuario,
): Promise<void> {
  const previoRaw = await db.meta.get('seedVersion')
  let previo: { version: string; tenantId: string } | null = null
  try {
    if (previoRaw?.value) {
      previo = JSON.parse(String(previoRaw.value)) as { version: string; tenantId: string }
    }
  } catch {
    previo = null
  }
  if (
    previo &&
    previo.version === SEED_VERSION &&
    previo.tenantId === identidad.tenantId
  ) {
    return
  }

  const sitio = identidad.faenas[0]
  if (!sitio) {
    await db.meta.put({
      key: 'seedVersion',
      value: JSON.stringify({ version: SEED_VERSION, tenantId: identidad.tenantId }),
    })
    return
  }

  const ts = ahoraIso()
  const filas: OutboxRow[] = cola
    .filter((r) => r.tipo !== 'respuesta')
    .map((r, i) => ({
      entityType: TIPO_ENTIDAD_ENTITY[r.tipo as OutboxTipo] ?? 'finding',
      entityId: r.uuid,
      tipo: r.tipo as OutboxTipo,
      titulo: r.titulo,
      detalle: r.detalle,
      batchOrder: r.orden,
      status: r.estado as SyncEstado,
      retries: r.intentos ?? 0,
      tenantId: identidad.tenantId,
      capturedAt: new Date(Date.now() - (cola.length - i) * 60_000).toISOString(),
      updatedAt: ts,
    }))

  const templateId = await getTemplateId()

  await db.transaction(
    'rw',
    [db.outbox, db.inspections, db.responses, db.findings, db.logEntries, db.attachments, db.meta],
    async () => {
      await db.outbox.clear()
      await db.inspections.clear()
      await db.responses.clear()
      await db.findings.clear()
      await db.logEntries.clear()
      await db.attachments.clear()

      await db.outbox.bulkAdd(filas)
      const insp = cola.find((c) => c.tipo === 'inspeccion')
      if (insp) {
        await db.inspections.add({
          id: insp.uuid,
          tenantId: identidad.tenantId,
          siteId: sitio.id,
          templateId,
          templateVersion: 3,
          executedBy: usuario.id,
          status: 'submitted',
          capturedAt: ts,
          syncedAt: ts,
          clientVersion: 0,
          templateName: 'Seguridad en rajo',
          siteName: sitio.nombre,
          answeredCount: 5,
          totalItems: 8,
        })
        /* Respuestas del checklist: se crean COMO ENTIDAD y como filas del
         * outbox (orden 2). Así el hallazgo r-3 y la foto r-4 encuentran su
         * inspección/respuesta en el MISMO lote (FR-021) y el primer sync
         * entero cae al tenant de verdad. */
        for (const item of PLANTILLA.slice(0, 5)) {
          const responseId = uuidv7()
          await db.responses.add({
            id: responseId,
            inspectionId: insp.uuid,
            templateItemId: item.id,
            tenantId: identidad.tenantId,
            valueOk: item.id === 'i-02' ? 'nok' : 'ok',
            valueText: null,
            valueNumber: item.id === 'i-04' ? 180 : null,
            capturedAt: ts,
            clientVersion: 0,
          })
          await db.outbox.add({
            entityType: 'response',
            entityId: responseId,
            tipo: 'respuesta',
            titulo: 'Respuestas de checklist',
            detalle: `Ítem ${item.id} · ${item.id === 'i-02' ? 'nok' : 'ok'}`,
            batchOrder: 2,
            status: 'pending',
            retries: 0,
            tenantId: identidad.tenantId,
            capturedAt: ts,
            updatedAt: ts,
          })
        }
      }
      const hallazgo = cola.find((c) => c.tipo === 'hallazgo')
      if (hallazgo && insp) {
        const responseId = (await db.responses
          .where('templateItemId')
          .equals('i-02')
          .and((r) => r.inspectionId === insp.uuid)
          .first())?.id
        await db.findings.add({
          id: hallazgo.uuid,
          inspectionId: insp.uuid,
          responseId: responseId ?? null,
          tenantId: identidad.tenantId,
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
          siteId: sitio.id,
          authorId: usuario.id,
          tenantId: identidad.tenantId,
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
          tenantId: identidad.tenantId,
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
      await db.meta.put({
        key: 'seedVersion',
        value: JSON.stringify({ version: SEED_VERSION, tenantId: identidad.tenantId }),
      })
    },
  )
}

const TIPO_ENTIDAD_ENTITY: Record<OutboxTipo, OutboxRow['entityType']> = {
  inspeccion: 'inspection',
  respuesta: 'response',
  hallazgo: 'finding',
  foto: 'attachment',
  bitacora: 'log_entry',
}