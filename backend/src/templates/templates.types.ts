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
  definition: Record<string, unknown>
}

export interface UpdateDraftInput {
  tenantId: string
  revisionId: string
  definition: Record<string, unknown>
}