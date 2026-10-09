/**
 * Contrato wire de `POST /api/v1/sync/batch` — spec 003 (TSK-WS-007).
 *
 * Fuente de verdad de los tipos del cliente: el worker de cola (TSK-WS-008)
 * arma el `SyncBatchRequest` desde el outbox local; el backend valida contra
 * el mismo vocabulario (snake_case, espejo del data-model §2.2).
 *
 * Orden de dependencias del lote (FR-020): site → inspection → responses →
 * findings → log_entries → attachments. El cliente los envía en cualquier
 * orden: el servidor los procesa agrupados por este orden.
 *
 * Idempotencia (FR-021): `id` es el UUIDv7 de cliente; el servidor hace
 * `ON CONFLICT (id) DO UPDATE ... WHERE excluded.client_version > tabla`.
 */

export type SyncEntityType = 'inspection' | 'response' | 'finding' | 'log_entry' | 'attachment'

export type SyncInspectionStatus = 'draft' | 'in_progress' | 'submitted' | 'reviewed'
export type SyncOkNokNa = 'ok' | 'nok' | 'na'
export type SyncSeverity = 'low' | 'medium' | 'high' | 'critical'
export type SyncFindingStatus = 'open' | 'in_progress' | 'resolved'
export type SyncOwnerType = 'inspection' | 'finding' | 'log_entry' | 'response'

/**
 * Forma híbrida de `inspection_response.value_json` (FR-036, data-model §2.2):
 * string para date/time/select_single, string[] para select_multiple.
 * ok_nok_na/numeric/text siguen en sus columnas escalares; photo deja el
 * marcador en `value_text` y los bytes en un ATTACHMENT `owner_type='response'`
 * (FR-037).
 */
export type SyncValorJson = string | string[]

export interface SyncInspectionPayload {
  site_id: string
  template_id: string
  template_version: number
  executed_by: string
  status: SyncInspectionStatus
}

export interface SyncResponsePayload {
  inspection_id: string
  template_item_id: string
  value_ok: SyncOkNokNa | null
  value_text: string | null
  value_number: number | null
  /** JSON del campo (forma + tamaño validados en servidor, FR-039 es device-side). */
  value_json?: SyncValorJson | null
}

export interface SyncFindingPayload {
  inspection_id: string | null
  response_id: string | null
  severity: SyncSeverity
  description: string
  status: SyncFindingStatus
}

export interface SyncLogEntryPayload {
  site_id: string
  author_id: string
  entry_text: string
  tags: string[]
  /** Fecha ISO `YYYY-MM-DD` del turno. */
  shift_date: string
}

export interface SyncAttachmentPayload {
  owner_type: SyncOwnerType
  owner_id: string
  mime: string
  bytes: number
  width: number
  height: number
  /** Opcional: bytes como base64 (V1 escribe al volumen Docker, ver data-model §2.2). */
  data?: string
}

type SyncPayload =
  | SyncInspectionPayload
  | SyncResponsePayload
  | SyncFindingPayload
  | SyncLogEntryPayload
  | SyncAttachmentPayload

/** Cada registro del lote, mínimo y plano: identidad + payload separado. */
export interface SyncRecord {
  entity_type: SyncEntityType
  id: string
  tenant_id: string
  /** Contador de edición local; autoridad del LWW (FR-023). */
  client_version: number
  /** Autoridad de tiempo (captura en cliente). ISO 8601. */
  captured_at: string
  payload: SyncPayload
}

export interface SyncBatchRequest {
  /** UUIDv7 generado por el dispositivo al armar el lote. */
  batch_id: string
  /** UUIDv7 persistente del dispositivo (FR-015, data-model §2.3). */
  device_id: string
  /** Límite por lote: fuera de ese rango se rechaza el request completo. */
  records: SyncRecord[]
}

export type SyncBatchStatus = 'ok' | 'partial' | 'failed'

export interface SyncBatchResponse {
  batch_id: string
  status: SyncBatchStatus
  records_total: number
  records_ok: number
  records_failed: number
  /** Registros aceptados sin cambios (idempotencia de replay). */
  records_unchanged?: number
  /** Máximo 5 fallos: motivos para depurar el replay (FR-021). */
  errors?: string[]
}