import { ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { DbService } from '../db/db.service'
import type {
  CreateDraftInput,
  CreateTemplateInput,
  TemplateRevisionRow,
  TemplateRow,
  UpdateDraftInput,
} from './templates.types'

/**
 * DS del módulo 007 (TSK-FORM-002): plantillas versionadas e inmutables.
 *
 * Requisitos:
 *  - FR-007  aislamiento por tenant (RLS en el motor, Artículo IV).
 *  - FR-049  la revisión `published` es inmutable: solo `draft` se edita/se
 *            borra; todo cambio exige una revisión nueva (draft → published).
 *  - FR-027  `version` se asigna al publicar (max+1 por plantilla) y es la base
 *            del delta `since=<template_version>` de plantillas.
 *
 * El rol de negocio (field_worker/supervisor/tenant_admin) se validará en los
 * controladores de las tasks siguientes (003+); aquí solo el tenant aísla.
 */
@Injectable()
export class TemplatesService {
  constructor(private readonly db: DbService) {}

  /** Crea la cabecera de una plantilla (tenant_admin). */
  async createTemplate(input: CreateTemplateInput): Promise<TemplateRow> {
    const [row] = await this.db.queryAsTenant<TemplateRow>(
      input.tenantId,
      `INSERT INTO template (id, tenant_id, name, description)
       VALUES (gen_random_uuid(), $1, $2, $3)
       RETURNING *`,
      [input.tenantId, input.name, input.description ?? null],
    )
    return row
  }

  /** Lista las cabeceras del tenant (para el asignador, TSK-FORM-008). */
  async listTemplates(tenantId: string): Promise<TemplateRow[]> {
    return this.db.queryAsTenant<TemplateRow>(
      tenantId,
      `SELECT * FROM template WHERE status = 'active' ORDER BY created_at`,
    )
  }

  /** Lista las revisiones de una plantilla del tenant, más nuevas primero. */
  async listRevisionsByTemplate(tenantId: string, templateId: string): Promise<TemplateRevisionRow[]> {
    return this.db.queryAsTenant<TemplateRevisionRow>(
      tenantId,
      `SELECT * FROM template_revision WHERE template_id = $1 ORDER BY created_at DESC`,
      [templateId],
    )
  }

  /** Crea una revisión en `draft` (version NULL; la publica TSK-FORM-006). */
  async createDraftRevision(input: CreateDraftInput): Promise<TemplateRevisionRow> {
    const [row] = await this.db.queryAsTenant<TemplateRevisionRow>(
      input.tenantId,
      `INSERT INTO template_revision (id, template_id, tenant_id, definition, status)
       VALUES (gen_random_uuid(), $1, $2, $3::jsonb, 'draft')
       RETURNING *`,
      [input.templateId, input.tenantId, JSON.stringify(input.definition)],
    )
    return row
  }

  /** Edita SOLO una revisión en `draft` (FR-049: nula para published/archived). */
  async updateDraftRevision(input: UpdateDraftInput): Promise<TemplateRevisionRow> {
    const [row] = await this.db.queryAsTenant<TemplateRevisionRow>(
      input.tenantId,
      `UPDATE template_revision
       SET definition = $2::jsonb, updated_at = now()
       WHERE id = $1 AND status = 'draft'
       RETURNING *`,
      [input.revisionId, JSON.stringify(input.definition)],
    )
    if (!row) {
      throw new ConflictException('la revisión no existe o ya no está en estado draft (FR-049)')
    }
    return row
  }

  /**
   * Publica un borrador: asigna `version` (max+1 por plantilla, FR-027),
   * `published_at` y congela el estado (FR-049). Atómico por tenant.
   */
  async publishRevision(tenantId: string, revisionId: string): Promise<TemplateRevisionRow> {
    return this.db.withTenantTransaction<TemplateRevisionRow>(tenantId, async (run) => {
      const [draft] = await run<{ template_id: string }>(
        `SELECT template_id FROM template_revision WHERE id = $1 AND status = 'draft'`,
        [revisionId],
      )
      if (!draft) {
        throw new ConflictException('la revisión no existe o ya no está en estado draft (FR-049)')
      }

      const [{ next }] = await run<{ next: number }>(
        `SELECT COALESCE(MAX(version), 0) + 1 AS next
         FROM template_revision WHERE template_id = $1 AND version IS NOT NULL`,
        [draft.template_id],
      )

      const [row] = await run<TemplateRevisionRow>(
        `UPDATE template_revision
         SET status = 'published', version = $2, published_at = now(), updated_at = now()
         WHERE id = $1 AND status = 'draft'
         RETURNING *`,
        [revisionId, next],
      )
      if (!row) {
        throw new ConflictException('la revisión no existe o ya no está en estado draft (FR-049)')
      }
      return row
    })
  }

  /**
   * Archiva una revisión en `draft` (descarte). Una revisión `published` es
   * inmutable también para archivarse desde `tc_app` (FR-049 estricto); la vía
   * de administración que la deprecie sin tocar RLS se resuelve en las tasks
   * de administración del módulo.
   */
  async archiveDraftRevision(tenantId: string, revisionId: string): Promise<TemplateRevisionRow> {
    const [row] = await this.db.queryAsTenant<TemplateRevisionRow>(
      tenantId,
      `UPDATE template_revision
       SET status = 'archived', updated_at = now()
       WHERE id = $1 AND status = 'draft'
       RETURNING *`,
      [revisionId],
    )
    if (!row) {
      throw new ConflictException('la revisión no existe o ya no está en estado draft (FR-049)')
    }
    return row
  }

  /** Obtiene una revisión del tenant o 404. */
  async getRevision(tenantId: string, revisionId: string): Promise<TemplateRevisionRow> {
    const [row] = await this.db.queryAsTenant<TemplateRevisionRow>(
      tenantId,
      `SELECT * FROM template_revision WHERE id = $1`,
      [revisionId],
    )
    if (!row) {
      throw new NotFoundException('revisión no encontrada para este tenant')
    }
    return row
  }
}