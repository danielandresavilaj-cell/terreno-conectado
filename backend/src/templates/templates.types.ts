/**
 * Tipos del módulo 007 (TSK-FORM-002) — data-model §2.2 (v1.1.0).
 */

/** Fila de `template` (cabecera del formulario, FR-007 RLS). */
export interface TemplateRow {
  id: string
  tenant_id: string
  name: string
  description: string | null
  status: 'active' | 'archived'
  created_at: string
  updated_at: string
}

/** Estados del ciclo de vida de una revisión (FR-049). */
export type TemplateRevisionStatus = 'draft' | 'published' | 'archived'

/**
 * Fila de `template_revision` (contenido versionado e inmutable).
 * `version` es NULL en borrador y se asigna al publicar (FR-027).
 * `published_seq` es la secuencia GLOBAL de publicación y va en bigint: el
 * driver lo devuelve como texto, de ahí `string | number` (TSK-FORM-009).
 */
export interface TemplateRevisionRow {
  id: string
  template_id: string
  tenant_id: string
  version: number | null
  published_seq: string | number | null
  definition: Record<string, unknown>
  status: TemplateRevisionStatus
  source_import_id: string | null
  published_at: string | null
  created_at: string
  updated_at: string
}

export interface CreateTemplateInput {
  tenantId: string
  name: string
  description?: string
}

export interface CreateDraftInput {
  tenantId: string
  templateId: string
  /** Definición sin validar (la valida el contrato Zod, FR-039). */
  definition: unknown
}

export interface UpdateDraftInput {
  tenantId: string
  revisionId: string
  definition: unknown
}

/** Fila de `template_section` (catálogo tipado, migration 005). */
export interface TemplateSectionRow {
  id: string
  revision_id: string
  tenant_id: string
  position: number
  title: string
  created_at: string
  updated_at: string
}

/** Fila de `template_item` (catálogo tipado, migration 005, FR-036). */
export interface TemplateItemRow {
  id: string
  section_id: string
  tenant_id: string
  position: number
  prompt: string
  response_type: string
  require_finding_on_nok: boolean
  props: Record<string, unknown> | null
  help: string | null
  created_at: string
  updated_at: string
}

/** Estados del ciclo de vida de un import (FR-047). */
export type TemplateImportStatus = 'uploaded' | 'parsed' | 'proposed' | 'confirmed' | 'failed'

/** Fila de `template_imports` (documento fuente .xlsx, FR-029/047/051). */
export interface TemplateImportRow {
  id: string
  tenant_id: string
  uploaded_by: string
  file_key: string
  file_name: string
  status: TemplateImportStatus
  proposed_schema: Record<string, unknown> | null
  error: string | null
  confirmed_at: string | null
  created_at: string
  updated_at: string
}

export interface ConfirmTemplateImportInput {
  tenantId: string
  importId: string
  /** Si se provee, publica inmediatamente; si no, deja el borrador para edición manual. */
  publish?: boolean
  /**
   * Definición revisada por el humano (el wizard edita ítems en el dispositivo).
   * Si no llega, se usa la propuesta del parser tal cual.
   */
  definition?: unknown
  /** Nombre de la plantilla decidido por el admin; si falta, `file_name` del import. */
  name?: string
  description?: string
  /** Actor de la confirmación, para la auditoría FR-047. */
  actorId?: string
}

/* ── Asignación por faena y rol (TSK-FORM-008, FR-008/009) ───────────────── */

export type TemplateAssignmentRole = 'field_worker' | 'supervisor'

/** Fila de `template_assignment` (data-model §2.2). */
export interface TemplateAssignmentRow {
  id: string
  tenant_id: string
  template_revision_id: string
  site_id: string | null
  role: TemplateAssignmentRole
  active: boolean
  assigned_by: string
  assigned_at: string
  created_at: string
  updated_at: string
}

export interface AssignTemplateInput {
  tenantId: string
  revisionId: string
  /** `null` = asignación global (todas las faenas). */
  siteId: string | null
  role: TemplateAssignmentRole
  active?: boolean
  assignedBy: string
}

/** Filtro de lectura de plantillas para un rol operativo (FR-009). */
export interface WorkerTemplateFilter {
  role: TemplateAssignmentRole
  /** Faena activa del dispositivo; `null` = sin filtro de faena (todas las suyas). */
  siteId: string | null
}

/**
 * Documento original de una revisión, ya resuelto en el volumen de sync
 * (TSK-FORM-009, FR-018/019). El controller sólo lo sirve en streaming.
 */
export interface TemplateOriginalFile {
  /** Ruta ABSOLUTA dentro de `SYNC_VOLUME` (validada contra el volumen). */
  path: string
  /** Nombre del archivo tal como lo subió el `tenant_admin`. */
  fileName: string
}