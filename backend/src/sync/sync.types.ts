/**
 * Tipos del dominio de ingesta — espejo wire de `shared/src/sync.ts`
 * (data-model.md §2.2, spec 003).
 *
 * Se duplican deliberadamente aquí para que el backend compile sin acoplar el
 * programa tsc a fuentes del workspace `shared` (el build de backend usa
 * `tsc -p tsconfig.build.json` con rootDir en `src/`). El contrato canónico es
 * el de shared: si cambian, se cambian ambos en el mismo PR.
 */

export type SyncEntityType = 'inspection' | 'response' | 'finding' | 'log_entry' | 'attachment'

export type SyncInspectionStatus = 'draft' | 'in_progress' | 'submitted' | 'reviewed'
export type SyncOkNokNa = 'ok' | 'nok' | 'na'
export type SyncSeverity = 'low' | 'medium' | 'high' | 'critical'
export type SyncFindingStatus = 'open' | 'in_progress' | 'resolved'
export type SyncOwnerType = 'inspection' | 'finding' | 'log_entry'

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
  shift_date: string
}

export interface SyncAttachmentPayload {
  owner_type: SyncOwnerType
  owner_id: string
  mime: string
  bytes: number
  width: number
  height: number
  data?: string
}

export interface SyncRecord {
  entity_type: SyncEntityType
  id: string
  tenant_id: string
  client_version: number
  captured_at: string
  payload:
    | SyncInspectionPayload
    | SyncResponsePayload
    | SyncFindingPayload
    | SyncLogEntryPayload
    | SyncAttachmentPayload
}

export interface SyncBatchRequest {
  batch_id: string
  device_id: string
  records: SyncRecord[]
}

export type SyncBatchStatus = 'ok' | 'partial' | 'failed'

export interface SyncBatchResponse {
  batch_id: string
  status: SyncBatchStatus
  records_total: number
  records_ok: number
  records_failed: number
  records_unchanged: number
  /** Máximo 5 fallos: motivos para depurar el replay (FR-021). */
  errors: string[]
}