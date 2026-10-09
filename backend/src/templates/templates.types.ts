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
 */
export interface TemplateRevisionRow {
  id: string
  template_id: string
  tenant_id: string
  version: number | null
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

export interface UploadTemplateImportInput {
  tenantId: string
  uploadedBy: string
  fileKey: string
  fileName: string
}

export interface ParseTemplateImportInput {
  tenantId: string
  importId: string
  proposal: Record<string, unknown>
}

export interface ConfirmTemplateImportInput {
  tenantId: string
  importId: string
  /** Si se provee, publica inmediatamente; si no, deja el borrador para edición manual. */
  publish?: boolean
}