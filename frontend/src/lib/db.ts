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
import {
  templateOriginalMetaSchema,
  uuidv7,
  type SyncRecord,
  type TemplateOriginalMeta,
  type TemplatePublicadaDto,
} from '@terreno/shared'
import { type PlanPurga } from './plantillas'
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
  /** FR-028: revisión publicada exacta con la que nació el borrador. Antes de
   *  TSK-FORM-009 el congelado era sólo `templateId`+`templateVersion`, que no
   *  desambigua dos revisiones publicadas del mismo par; `null` = borrador legado
   *  (se resuelve por `templateId`+`templateVersion`). */
  templateRevisionId?: string | null
  executedBy: string
  status: 'draft' | 'in_progress' | 'submitted' | 'reviewed'
  capturedAt: string
  syncedAt: string | null
  clientVersion: number
  templateName: string
  siteName: string
  answeredCount: number
  totalItems: number
  /** FR-034: georreferencia opcional capturada en terreno. */
  location?: { lat: number; lon: number } | null
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

/** Original `.xlsx` de una revisión en el dispositivo (FR-018, TSK-FORM-009).
 *  Los BYTES no viajan en el contrato: se suman al download y se guardan como
 *  `Blob`; la metadata sí se valida con el schema de `@terreno/shared`. */
export interface PlantillaOriginalRow extends TemplateOriginalMeta {
  bytes: Blob
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
  plantillaOriginales: EntityTable<PlantillaOriginalRow, 'revision_id'>
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

// v3 (TSK-FORM-009): documento original de cada revisión (bytes en el
// dispositivo para exportar el documento rellenado sin conexión, FR-019/044).
// El cursor del delta NO vive en una tabla: va en `meta` por tenant, porque un
// dispositivo compartido cambia de sesión y el umbral de un tenant no puede
// saltarle another's revisiones (ni al revés).
db.version(3).stores({
  plantillaOriginales: 'revision_id, tenant_id, cached_at',
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

/* --------------------------------- delta de plantillas (TSK-FORM-009, FR-027)
 *
 * El cursor es `published_seq` (secuencia GLOBAL de publicación), guardado POR
 * TENANT: `version` es por plantilla y un umbral global saltaba revisiones
 * (ver `lib/plantillas.ts`). Un dispositivo alterna sesiones de distintas
 * empresas, así que un único cursor compartido dejaría huecos en ambos sentidos.
 */

const CURSOR_PREFIX = 'tc_plantilla_cursor:'
const SELECCION_PLANTILLA_PREFIX = 'tc_plantilla_seleccion:'

export async function leerCursorPlantilla(tenantId: string): Promise<number | null> {
  const row = await db.meta.get(`${CURSOR_PREFIX}${tenantId}`)
  return typeof row?.value === 'number' ? row.value : null
}

export async function guardarCursorPlantilla(tenantId: string, seq: number): Promise<void> {
  await db.meta.put({ key: `${CURSOR_PREFIX}${tenantId}`, value: seq })
}

/** La última plantilla elegida se recuerda por empresa y faena, no globalmente. */
function claveSeleccionPlantilla(tenantId: string, siteId: string): string {
  return `${SELECCION_PLANTILLA_PREFIX}${tenantId}:${siteId}`
}

export async function leerPlantillaSeleccionada(tenantId: string, siteId: string): Promise<string | null> {
  const row = await db.meta.get(claveSeleccionPlantilla(tenantId, siteId))
  return typeof row?.value === 'string' ? row.value : null
}

export async function guardarPlantillaSeleccionada(
  tenantId: string,
  siteId: string,
  revisionId: string,
): Promise<void> {
  await db.meta.put({ key: claveSeleccionPlantilla(tenantId, siteId), value: revisionId })
}

/* ------------------------------------- originales .xlsx (FR-018, TSK-FORM-009) */

/**
 * Cachea el original de una revisión. Idempotente por `revision_id`: volver a
 * descargar el mismo libro reemplaza la fila, no la duplica. La metadata se
 * valida con el contrato de `@terreno/shared` antes de tocar IndexedDB — un
 * original sin `file_name` o con MIME inesperado no sirve para exportar y es
 * mejor que no entre al caché.
 */
export async function guardarOriginalPlantilla(params: {
  meta: TemplateOriginalMeta
  bytes: Blob
}): Promise<void> {
  const meta = templateOriginalMetaSchema.parse(params.meta)
  await db.plantillaOriginales.put({ ...meta, bytes: params.bytes })
}

export async function listarOriginalesPlantilla(
  tenantId?: string | null,
): Promise<PlantillaOriginalRow[]> {
  const rows = tenantId
    ? await db.plantillaOriginales.where('tenant_id').equals(tenantId).toArray()
    : await db.plantillaOriginales.toArray()
  return rows.sort((a, b) => a.cached_at - b.cached_at)
}

export async function originalDePlantilla(
  revisionId: string,
): Promise<PlantillaOriginalRow | undefined> {
  return db.plantillaOriginales.get(revisionId)
}

export async function borrarOriginalesPlantilla(revisionIds: readonly string[]): Promise<void> {
  if (revisionIds.length === 0) return
  await db.plantillaOriginales.bulkDelete([...revisionIds])
}

/** Aplica un plan de `planificarPurga` (FR-018). Idempotente: borrar dos veces
 *  las mismas revisiones no falla ni deja rastro. */
export async function aplicarPurgaOriginales(plan: PlanPurga): Promise<void> {
  await borrarOriginalesPlantilla(plan.aBorrar)
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
  /** FR-028: la revisión EXACTA con la que se abrió el turno. Es lo que impide
   *  reencuadrar a otra revisión del mismo template al resolver la plantilla
   *  activa; los borradores previos arrives sin ella. */
  templateRevisionId?: string | null
}): Promise<{ id: string; answeredCount: number }> {
  const existing = await getDraftInspectionId()
  if (existing) {
    const row = await db.inspections.get(existing)
    if (row && (row.status === 'draft' || row.status === 'in_progress')) {
      // El early-return conserva el marco congelado (FR-028). Sólo se completa
      // `templateRevisionId` si al borrador aún le falta (nació en un arranque
      // anterior a TSK-FORM-009): rellenarlo NO reencuadra nada porque la
      // revisión corresponde al `templateId`/`templateVersion` que ya guarda.
      if (!row.templateRevisionId && params.templateRevisionId) {
        await db.inspections.update(existing, { templateRevisionId: params.templateRevisionId })
      }
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
    templateRevisionId: params.templateRevisionId ?? null,
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

/**
 * Descarta el borrador en curso y lo que cuelgue de él (FR-028).
 *
 * El bloqueo `'no-disponible'` es correcto —reencuadrar invalidaría lo ya
 * respondido— pero no puede ser un callejón sin salida: hay caminos en los que
 * la revisión congelada no vuelve nunca, p. ej. un borrador nacido del fallback
 * demo (marco inventado) o una plantilla que el supervisor desasignó, donde el
 * servidor ya no la sirve y el delta no la traerá. Esta función es la salida
 * EXPLÍCITA: borra el marco y deja crear uno nuevo. Nada se borra en silencio;
 * la decisión es del usuario y la UI la pide con confirmación.
 *
 * No encola nada: un borrador descartado nunca se sincroniza (pertenece al
 * outbox sólo al enviarse).
 */
export async function descartarBorrador(): Promise<void> {
  const id = await getDraftInspectionId()
  if (!id) return
  const respuestas = await db.responses.where('inspectionId').equals(id).toArray()
  const hallazgos = await db.findings.where('inspectionId').equals(id).toArray()
  // Los adjuntos cuelgan de la inspección, de sus respuestas o de sus hallazgos
  // (`owner_type` FR-012/FR-037); borrar por `ownerId` los cubre todos sin
  // tener que enumerar tipos.
  const duenos = [id, ...respuestas.map((r) => r.id), ...hallazgos.map((h) => h.id)]

  await db.transaction(
    'rw',
    [db.inspections, db.responses, db.findings, db.attachments, db.meta],
    async () => {
      await db.attachments.where('ownerId').anyOf(duenos).delete()
      await db.responses.where('inspectionId').equals(id).delete()
      await db.findings.where('inspectionId').equals(id).delete()
      await db.inspections.delete(id)
      await setDraftInspectionId(null)
    },
  )
}

/**
 * Restablece por completo los datos locales de prueba de una empresa. Incluye
 * la caché offline de formularios, sus originales y la última selección, para
 * que el dispositivo vuelva a mostrar exactamente lo que el servidor asigne
 * después del reinicio. No borra registros del servidor.
 */
export async function limpiarDatosLocalesPrueba(tenantId: string): Promise<void> {
  const borradorId = await getDraftInspectionId()
  const borrador = borradorId ? await db.inspections.get(borradorId) : undefined

  await db.transaction(
    'rw',
    [
      db.outbox,
      db.inspections,
      db.responses,
      db.findings,
      db.logEntries,
      db.attachments,
      db.plantillas,
      db.plantillaOriginales,
      db.meta,
    ],
    async () => {
      await db.outbox.filter((fila) => fila.tenantId === tenantId).delete()
      await db.inspections.filter((fila) => fila.tenantId === tenantId).delete()
      await db.responses.filter((fila) => fila.tenantId === tenantId).delete()
      await db.findings.filter((fila) => fila.tenantId === tenantId).delete()
      await db.logEntries.filter((fila) => fila.tenantId === tenantId).delete()
      await db.attachments.filter((fila) => fila.tenantId === tenantId).delete()
      await db.plantillas.filter((fila) => fila.tenant_id === tenantId).delete()
      await db.plantillaOriginales.where('tenant_id').equals(tenantId).delete()
      await db.meta.delete(`${CURSOR_PREFIX}${tenantId}`)
      await db.meta.where('key').startsWith(`${SELECCION_PLANTILLA_PREFIX}${tenantId}:`).delete()
      if (borrador?.tenantId === tenantId) await setDraftInspectionId(null)
    },
  )
}

export async function submitInspection(
  inspectionId: string,
  location?: { lat: number; lon: number } | null,
): Promise<void> {
  const ins = await db.inspections.get(inspectionId)
  if (!ins) throw new Error('Borrador de inspección no encontrado')
  await db.inspections.update(inspectionId, {
    status: 'submitted',
    answeredCount: await db.responses.where('inspectionId').equals(inspectionId).count(),
    ...(location !== undefined ? { location } : {}),
    clientVersion: ins.clientVersion + 1,
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

/** FR-017: fotos aún en la cola (adjuntos pendientes/fallidos, no sincronizados).
 *  Es el número que la UI muestra como "fotos pendientes de subir". */
export async function contadorFotosPendientes(): Promise<number> {
  const rows = await db.outbox.where('entityType').equals('attachment').toArray()
  return rows.filter((r) => r.status !== 'synced').length
}

/** FR-017: reordena la cola para que las fotos YA sincronizables —adjuntos cuyo
 *  dueño (inspección/respuesta/hallazgo/bitácora) no está en la cola, así que su
 *  FK no bloquea— suban primero y liberen bytes locales antes que el resto. Las
 *  que sí dependen de algo pendiente quedan en su lugar para no romper el orden
 *  de dependencias (FR-020). */
async function priorizarFotosLibres(filas: OutboxRow[]): Promise<OutboxRow[]> {
  const pendientes = new Set(filas.map((f) => `${f.entityType}:${f.entityId}`))
  const libres = new Set<number | undefined>()
  for (const f of filas) {
    if (f.entityType !== 'attachment') continue
    const a = await db.attachments.get(f.entityId)
    // El `ownerType` del adjunto usa los mismos nombres que `entityType`; si el
    // dueño no está en la cola, su FK ya está satisfecha.
    if (!a || !pendientes.has(`${a.ownerType}:${a.ownerId}`)) libres.add(f.id)
  }
  const primero: OutboxRow[] = []
  const resto: OutboxRow[] = []
  for (const f of filas) (libres.has(f.id) ? primero : resto).push(f)
  return [...primero, ...resto]
}

/** Filas listas para enviar: pendientes y fallidas, en orden de dependencia (FR-020).
 *  Con `priorizarFotos` (FR-017) las fotos ya sincronizables pasan al frente. */
export async function sincronizables(priorizarFotos = false): Promise<OutboxRow[]> {
  const rows = await db.outbox.where('status').anyOf('pending', 'failed').toArray()
  const ordenadas = rows.sort((a, b) => a.batchOrder - b.batchOrder || a.entityId.localeCompare(b.entityId))
  return priorizarFotos ? priorizarFotosLibres(ordenadas) : ordenadas
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
          location: r.location ?? null,
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

/** Marca de versión del primer arranque. Ya NO se siembra contenido demo con
 * IDs fijos (F-01); solo se registra que el dispositivo ya inicializó, para
 * no repetir el trabajo en cada arranque. */
const SEED_VERSION = '3'

/** Ya no se siembra contenido demo con IDs fijos (F-01). Se deja como NO-OP
 * para preservar compatibilidad con las llamadas existentes; el outbox empieza
 * vacío. */
export async function seedDemoDataIfNeeded(
  _cola: Array<{
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
  _usuario: Usuario,
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
  if (previo && previo.version === SEED_VERSION && previo.tenantId === identidad.tenantId) {
    return
  }
  await db.meta.put({
    key: 'seedVersion',
    value: JSON.stringify({ version: SEED_VERSION, tenantId: identidad.tenantId }),
  })
}
