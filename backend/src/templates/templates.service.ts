import { randomUUID } from 'node:crypto'
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { ZodError } from 'zod'
import {
  parseTemplateDefinition,
  type TemplateDefinition,
  type TemplatesDeltaResponse,
} from '@terreno/shared'
import { DbService } from '../db/db.service'
import type {
  CreateDraftInput,
  CreateTemplateInput,
  TemplateItemRow,
  TemplateRevisionRow,
  TemplateRow,
  TemplateSectionRow,
  UpdateDraftInput,
} from './templates.types'

/**
 * DS del módulo 007: plantillas versionadas e inmutables + catálogo tipado.
 *
 * Requisitos:
 *  - FR-007  aislamiento por tenant (RLS en el motor, Artículo IV).
 *  - FR-027  `version` se asigna al publicar (max+1 por plantilla); base del
 *            delta `since=<template_version>` de plantillas.
 *  - FR-036  catálogo de 8 tipos de campo (contrato Zod en `@terreno/shared`).
 *  - FR-039  la definición se valida con el MISMO contrato que validará la
 *            respuesta en el dispositivo: una plantilla guardada siempre es
 *            válida para el render (TSK-FORM-001).
 *  - FR-049  la revisión `published` es inmutable; su catálogo materializado
 *            (template_section/template_item) también (políticas RLS).
 *
 * El rol de negocio (field_worker/supervisor/tenant_admin) se validará en los
 * controladores de las tasks siguientes; aquí solo el tenant aísla.
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

  /**
   * Valida la definición con el contrato compartido (FR-036/FR-039) y devuelve
   * la forma normalizada. Lanza 400 con el detalle del primer error de contrato.
   */
  private validateOrThrow(definition: unknown): TemplateDefinition {
    try {
      return parseTemplateDefinition(definition)
    } catch (error) {
      if (error instanceof ZodError) {
        const detail = error.issues
          .slice(0, 3)
          .map((i) => `${i.path.join('.') || 'definition'}: ${i.message}`)
          .join('; ')
        throw new BadRequestException(`definición de plantilla inválida: ${detail}`)
      }
      throw error
    }
  }

  /** Crea una revisión en `draft` (version NULL; validada, FR-039/FR-049). */
  async createDraftRevision(input: CreateDraftInput): Promise<TemplateRevisionRow> {
    const definition = this.validateOrThrow(input.definition)
    const [row] = await this.db.queryAsTenant<TemplateRevisionRow>(
      input.tenantId,
      `INSERT INTO template_revision (id, template_id, tenant_id, definition, status)
       VALUES (gen_random_uuid(), $1, $2, $3::jsonb, 'draft')
       RETURNING *`,
      [input.templateId, input.tenantId, JSON.stringify(definition)],
    )
    return row
  }

  /** Edita SOLO una revisión en `draft` (FR-049: nula para published/archived). */
  async updateDraftRevision(input: UpdateDraftInput): Promise<TemplateRevisionRow> {
    const definition = this.validateOrThrow(input.definition)
    const [row] = await this.db.queryAsTenant<TemplateRevisionRow>(
      input.tenantId,
      `UPDATE template_revision
       SET definition = $2::jsonb, updated_at = now()
       WHERE id = $1 AND status = 'draft'
       RETURNING *`,
      [input.revisionId, JSON.stringify(definition)],
    )
    if (!row) {
      throw new ConflictException('la revisión no existe o ya no está en estado draft (FR-049)')
    }
    return row
  }

  /**
   * Publica un borrador: asigna `version` (max+1 por plantilla, FR-027),
   * materializa el catálogo tipado (template_section/template_item) y congela
   * todo el contenido (FR-049). Atómico por tenant — la materialización ocurre
   * ANTES del cambio de estado porque el RLS exige revisión en `draft`.
   */
  async publishRevision(tenantId: string, revisionId: string): Promise<TemplateRevisionRow> {
    return this.db.withTenantTransaction<TemplateRevisionRow>(tenantId, async (run) => {
      const [draft] = await run<{ template_id: string; definition: unknown }>(
        `SELECT template_id, definition
         FROM template_revision WHERE id = $1 AND status = 'draft'`,
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

      const definition = this.validateOrThrow(draft.definition)
      await this.materializeCatalog(run, tenantId, revisionId, definition)

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

  /** Persiste secciones/ítems tipados de una definición ya validada. */
  private async materializeCatalog(
    run: <R = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<R[]>,
    tenantId: string,
    revisionId: string,
    definition: TemplateDefinition,
  ): Promise<void> {
    for (const [sectionIndex, section] of definition.sections.entries()) {
      const sectionId = section.id ?? randomUUID()
      await run<TemplateSectionRow>(
        `INSERT INTO template_section (id, revision_id, tenant_id, position, title)
         VALUES ($1, $2, $3, $4, $5)`,
        [sectionId, revisionId, tenantId, section.position ?? sectionIndex, section.title],
      )
      for (const [itemIndex, item] of section.items.entries()) {
        await run<TemplateItemRow>(
          `INSERT INTO template_item
             (id, section_id, tenant_id, position, prompt, response_type,
              require_finding_on_nok, props, help)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)`,
          [
            item.id,
            sectionId,
            tenantId,
            itemIndex,
            item.prompt,
            item.response_type,
            item.require_finding_on_nok ?? false,
            item.props !== undefined ? JSON.stringify(item.props) : null,
            item.help ?? null,
          ],
        )
      }
    }
  }

  /**
   * Catálogo de ítems de una revisión (tipos + props), ordenado por
   * sección/ítem. Usado por import/export (TSK-FORM-005/010) y reportes.
   */
  async listItemsByRevision(tenantId: string, revisionId: string): Promise<TemplateItemRow[]> {
    return this.db.queryAsTenant<TemplateItemRow>(
      tenantId,
      `SELECT i.*
       FROM template_item i
       JOIN template_section s ON s.id = i.section_id
       WHERE s.revision_id = $1
       ORDER BY s.position, i.position`,
      [revisionId],
    )
  }

  /** Crea plantilla + borrador de forma atómica (para POST /templates, TSK-FORM-006). */
  async createTemplateWithDraft(input: {
    tenantId: string
    name: string
    description?: string
    definition: unknown
  }): Promise<TemplateRevisionRow> {
    const definition = this.validateOrThrow(input.definition)
    return this.db.withTenantTransaction<TemplateRevisionRow>(input.tenantId, async (run) => {
      const [template] = await run<TemplateRow>(
        `INSERT INTO template (id, tenant_id, name, description)
         VALUES (gen_random_uuid(), $1, $2, $3)
         RETURNING *`,
        [input.tenantId, input.name, input.description ?? null],
      )

      const [row] = await run<TemplateRevisionRow>(
        `INSERT INTO template_revision (id, template_id, tenant_id, definition, status)
         VALUES (gen_random_uuid(), $1, $2, $3::jsonb, 'draft')
         RETURNING *`,
        [template.id, input.tenantId, JSON.stringify(definition)],
      )
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

  /**
   * Revisiones publicadas del tenant para la captura (TSK-FORM-001, FR-018)
   * con delta opcional `since` (FR-027): devuelve sólo `version > since`.
   * `latest_version` es el techo publicado del tenant — el cliente lo guarda
   * como próximo `since` del delta (TSK-FORM-009).
   */
  async listPublishedRevisions(tenantId: string, since?: number): Promise<TemplatesDeltaResponse> {
    const [rows, [{ max }]] = await Promise.all([
      this.db.queryAsTenant<TemplateRevisionRow & { name: string }>(
        tenantId,
        `SELECT r.*, t.name
           FROM template_revision r
           JOIN template t ON t.id = r.template_id
          WHERE r.status = 'published'
            AND ($1::int IS NULL OR r.version > $1)
          ORDER BY r.version DESC, r.published_at DESC, r.id`,
        [since ?? null],
      ),
      this.db.queryAsTenant<{ max: number | null }>(
        tenantId,
        `SELECT MAX(version) AS max FROM template_revision WHERE status = 'published'`,
      ),
    ])
    return {
      items: rows.map((r) => ({
        template_id: r.template_id,
        revision_id: r.id,
        tenant_id: r.tenant_id,
        name: r.name,
        version: r.version as number,
        published_at: r.published_at,
        definition: r.definition as unknown as TemplateDefinition,
      })),
      latest_version: max,
    }
  }
}