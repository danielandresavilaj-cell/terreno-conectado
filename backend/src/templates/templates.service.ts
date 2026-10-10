import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ZodError } from 'zod'
import {
  parseTemplateDefinition,
  templateImportProposalSchema,
  type TemplateDefinition,
  type TemplatesDeltaResponse,
  type TemplateImportProposal,
} from '@terreno/shared'
import { proponerImport } from '@terreno/shared/xlsx'
import { DbService } from '../db/db.service'
import type {
  AssignTemplateInput,
  ConfirmTemplateImportInput,
  CreateDraftInput,
  CreateTemplateInput,
  ParseTemplateImportInput,
  TemplateAssignmentRow,
  TemplateImportRow,
  TemplateItemRow,
  TemplateRevisionRow,
  TemplateRow,
  TemplateSectionRow,
  UpdateDraftInput,
  UploadTemplateImportInput,
  WorkerTemplateFilter,
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
  constructor(
    private readonly db: DbService,
    private readonly config: ConfigService,
  ) {}

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
  async listPublishedRevisions(
    tenantId: string,
    since?: number,
    worker?: WorkerTemplateFilter,
  ): Promise<TemplatesDeltaResponse> {
    // FR-009: un rol operativo (field_worker/supervisor) sólo ve las revisiones
    // publicadas asignadas a su rol y, si el dispositivo informa su faena, a esa
    // faena o a una asignación global (`site_id IS NULL`). El admin ve todo.
    const role = worker?.role ?? null
    const siteId = worker?.siteId ?? null
    // El mismo criterio de visibilidad se reusa en las dos consultas (items y
    // techo de versión) con placeholders distintos según sus parámetros.
    const visibility = (rp: string, sp: string): string =>
      `(${rp}::text IS NULL OR EXISTS (
        SELECT 1 FROM template_assignment a
         WHERE a.template_revision_id = r.id
           AND a.tenant_id = r.tenant_id
           AND a.active
           AND a.role = ${rp}
           AND (${sp}::uuid IS NULL OR a.site_id IS NULL OR a.site_id = ${sp})
      ))`
    const [rows, [{ max }]] = await Promise.all([
      this.db.queryAsTenant<TemplateRevisionRow & { name: string }>(
        tenantId,
        `SELECT r.*, t.name
           FROM template_revision r
           JOIN template t ON t.id = r.template_id
          WHERE r.status = 'published'
            AND ($1::int IS NULL OR r.version > $1)
            AND ${visibility('$2', '$3')}
          ORDER BY r.version DESC, r.published_at DESC, r.id`,
        [since ?? null, role, siteId],
      ),
      this.db.queryAsTenant<{ max: number | null }>(
        tenantId,
        `SELECT MAX(r.version) AS max
           FROM template_revision r
          WHERE r.status = 'published'
            AND ${visibility('$1', '$2')}`,
        [role, siteId],
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

  /* ── Asignación por faena y rol (TSK-FORM-008, FR-008/009) ─────────────── */

  /** Todas las asignaciones del tenant (para el asignador del `tenant_admin`). */
  async listAssignments(tenantId: string): Promise<TemplateAssignmentRow[]> {
    return this.db.queryAsTenant<TemplateAssignmentRow>(
      tenantId,
      `SELECT * FROM template_assignment ORDER BY assigned_at DESC, id`,
    )
  }

  /**
   * Asigna (o reactiva) una revisión publicada a una faena+rol. Idempotente por
   * el único lógico: repetir la misma combinación actualiza `active` y auditoría
   * en vez de duplicar (FR-008). Sólo acepta revisiones `published` (FR-049).
   */
  async assignTemplate(input: AssignTemplateInput): Promise<TemplateAssignmentRow> {
    const [rev] = await this.db.queryAsTenant<TemplateRevisionRow>(
      input.tenantId,
      `SELECT * FROM template_revision WHERE id = $1`,
      [input.revisionId],
    )
    if (!rev) throw new NotFoundException('Revisión no encontrada')
    if (rev.status !== 'published') {
      throw new BadRequestException('Sólo se asignan revisiones publicadas (FR-008/049)')
    }
    if (input.siteId) {
      const [site] = await this.db.queryAsTenant<{ id: string }>(
        input.tenantId,
        `SELECT id FROM site WHERE id = $1`,
        [input.siteId],
      )
      if (!site) throw new BadRequestException('La faena no pertenece al tenant')
    }

    const active = input.active ?? true
    if (input.siteId === null) {
      const [row] = await this.db.queryAsTenant<TemplateAssignmentRow>(
        input.tenantId,
        `INSERT INTO template_assignment
           (id, tenant_id, template_revision_id, site_id, role, active, assigned_by)
         VALUES (gen_random_uuid(), $1, $2, NULL, $3, $4, $5)
         ON CONFLICT (template_revision_id, role) WHERE site_id IS NULL
         DO UPDATE SET active = EXCLUDED.active,
                       assigned_by = EXCLUDED.assigned_by,
                       assigned_at = now(),
                       updated_at = now()
         RETURNING *`,
        [input.tenantId, input.revisionId, input.role, active, input.assignedBy],
      )
      return row
    }
    const [row] = await this.db.queryAsTenant<TemplateAssignmentRow>(
      input.tenantId,
      `INSERT INTO template_assignment
         (id, tenant_id, template_revision_id, site_id, role, active, assigned_by)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6)
       ON CONFLICT (template_revision_id, site_id, role) WHERE site_id IS NOT NULL
       DO UPDATE SET active = EXCLUDED.active,
                     assigned_by = EXCLUDED.assigned_by,
                     assigned_at = now(),
                     updated_at = now()
       RETURNING *`,
      [input.tenantId, input.revisionId, input.siteId, input.role, active, input.assignedBy],
    )
    return row
  }

  /** Quita una asignación del tenant (FR-008). 404 si no existe o es de otro tenant. */
  async deleteAssignment(tenantId: string, assignmentId: string): Promise<void> {
    const rows = await this.db.queryAsTenant<{ id: string }>(
      tenantId,
      `DELETE FROM template_assignment WHERE id = $1 RETURNING id`,
      [assignmentId],
    )
    if (!rows.length) throw new NotFoundException('Asignación no encontrada')
  }

  /* ── Importación de plantillas desde .xlsx (TSK-FORM-007) ──────────────── */

  /** Crea un registro `uploaded` para un .xlsx recién subido (FR-029/047). */
  async uploadTemplateImport(input: UploadTemplateImportInput): Promise<TemplateImportRow> {
    const [row] = await this.db.queryAsTenant<TemplateImportRow>(
      input.tenantId,
      `INSERT INTO template_imports
         (id, tenant_id, uploaded_by, file_key, file_name, status)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, 'uploaded')
       RETURNING *`,
      [input.tenantId, input.uploadedBy, input.fileKey, input.fileName],
    )
    return row
  }

  /**
   * Recibe el buffer de un .xlsx, crea el import, guarda el archivo fuente como
   * ATTACHMENT (`owner_type='template_import'`), lo parsea y deja el import en
   * estado `proposed` (éxito) o `failed` (error). Todo en una transacción por
   * tenant (FR-029/047/051).
   */
  async uploadAndParseTemplateImport(
    tenantId: string,
    uploadedBy: string,
    fileName: string,
    buffer: Buffer,
  ): Promise<TemplateImportRow> {
    return this.db.withTenantTransaction<TemplateImportRow>(tenantId, async (run) => {
      const [imp] = await run<TemplateImportRow>(
        `INSERT INTO template_imports
           (id, tenant_id, uploaded_by, file_key, file_name, status)
         VALUES (gen_random_uuid(), $1, $2, '', $3, 'uploaded')
         RETURNING *`,
        [tenantId, uploadedBy, fileName],
      )

      const fileKey = await this.writeImportFile(tenantId, imp.id, buffer)
      await run(
        `INSERT INTO attachment
           (id, tenant_id, owner_type, owner_id, file_key, mime, bytes,
            width, height, captured_at, client_version)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, NULL, now(), 0)`,
        [randomUUID(), tenantId, 'template_import', imp.id, fileKey, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer.length],
      )

      await run(
        `UPDATE template_imports SET file_key = $2 WHERE id = $1`,
        [imp.id, fileKey],
      )

      const parsed = await proponerImport(new Uint8Array(buffer), fileName)
      if (!parsed.ok) {
        await run(
          `UPDATE template_imports
           SET status = 'failed', error = $2, updated_at = now()
           WHERE id = $1`,
          [imp.id, parsed.error],
        )
        const [failed] = await run<TemplateImportRow>(`SELECT * FROM template_imports WHERE id = $1`, [imp.id])
        return failed
      }

      let proposal: TemplateImportProposal
      try {
        proposal = templateImportProposalSchema.parse(parsed.propuesta)
      } catch (error) {
        if (error instanceof ZodError) {
          const detail = error.issues
            .slice(0, 3)
            .map((i) => `${i.path.join('.') || 'proposal'}: ${i.message}`)
            .join('; ')
          await run(
            `UPDATE template_imports
             SET status = 'failed', error = $2, updated_at = now()
             WHERE id = $1`,
            [imp.id, `propuesta inválida: ${detail}`],
          )
          const [failed] = await run<TemplateImportRow>(`SELECT * FROM template_imports WHERE id = $1`, [imp.id])
          return failed
        }
        throw error
      }

      const [row] = await run<TemplateImportRow>(
        `UPDATE template_imports
         SET status = 'proposed', proposed_schema = $2::jsonb, updated_at = now()
         WHERE id = $1
         RETURNING *`,
        [imp.id, JSON.stringify(proposal)],
      )
      return row
    })
  }

  private async writeImportFile(tenantId: string, importId: string, buffer: Buffer): Promise<string> {
    const volume = resolve(this.config.get<string>('SYNC_VOLUME') ?? join(process.cwd(), '.vol'))
    const key = `template_imports/${tenantId}/${importId}.xlsx`
    const path = join(volume, key)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, buffer)
    return key
  }

  /** Obtiene un import del tenant o 404. */
  async getTemplateImport(tenantId: string, importId: string): Promise<TemplateImportRow> {
    const [row] = await this.db.queryAsTenant<TemplateImportRow>(
      tenantId,
      `SELECT * FROM template_imports WHERE id = $1`,
      [importId],
    )
    if (!row) {
      throw new NotFoundException('import no encontrado para este tenant')
    }
    return row
  }

  /** Lista imports del tenant, más recientes primero. */
  async listTemplateImports(tenantId: string): Promise<TemplateImportRow[]> {
    return this.db.queryAsTenant<TemplateImportRow>(
      tenantId,
      `SELECT * FROM template_imports ORDER BY created_at DESC`,
    )
  }

  /**
   * Guarda la propuesta parseada por el importador (TSK-FORM-005) y pasa el
   * import a estado `proposed`. Valida el contrato Zod compartido (FR-039).
   */
  async parseTemplateImport(input: ParseTemplateImportInput): Promise<TemplateImportRow> {
    let proposal: TemplateImportProposal
    try {
      proposal = templateImportProposalSchema.parse(input.proposal)
    } catch (error) {
      if (error instanceof ZodError) {
        const detail = error.issues
          .slice(0, 3)
          .map((i) => `${i.path.join('.') || 'proposal'}: ${i.message}`)
          .join('; ')
        throw new BadRequestException(`propuesta de import inválida: ${detail}`)
      }
      throw error
    }

    const [row] = await this.db.queryAsTenant<TemplateImportRow>(
      input.tenantId,
      `UPDATE template_imports
       SET status = 'proposed', proposed_schema = $2::jsonb, updated_at = now()
       WHERE id = $1 AND status IN ('uploaded', 'parsed', 'proposed')
       RETURNING *`,
      [input.importId, JSON.stringify(proposal)],
    )
    if (!row) {
      throw new ConflictException('el import no existe o ya fue confirmado/fallido')
    }
    return row
  }

  /**
   * Marca un import como fallido (parseo inválido, .xlsx corrupto, etc.).
   * Deja traza en `error` para auditoría (FR-051).
   */
  async failTemplateImport(
    tenantId: string,
    importId: string,
    error: string,
  ): Promise<TemplateImportRow> {
    const [row] = await this.db.queryAsTenant<TemplateImportRow>(
      tenantId,
      `UPDATE template_imports
       SET status = 'failed', error = $2, updated_at = now()
       WHERE id = $1 AND status IN ('uploaded', 'parsed', 'proposed')
       RETURNING *`,
      [importId, error],
    )
    if (!row) {
      throw new ConflictException('el import no existe o ya fue confirmado/fallido')
    }
    return row
  }

  /**
   * Confirma la propuesta y genera una plantilla + borrador (FR-048).
   * Si `publish=true`, publica inmediatamente (solo si la definición es válida).
   * Nunca publica automáticamente sin el flag explícito.
   */
  async confirmTemplateImport(input: ConfirmTemplateImportInput): Promise<TemplateRevisionRow> {
    return this.db.withTenantTransaction<TemplateRevisionRow>(input.tenantId, async (run) => {
      const [imp] = await run<TemplateImportRow>(
        `SELECT * FROM template_imports
         WHERE id = $1 AND status = 'proposed'`,
        [input.importId],
      )
      if (!imp) {
        throw new ConflictException('el import no está en estado proposed')
      }

      const proposal = templateImportProposalSchema.parse(imp.proposed_schema)
      const definition = this.proposalToDefinition(proposal)
      const validated = this.validateOrThrow(definition)

      const [template] = await run<TemplateRow>(
        `INSERT INTO template (id, tenant_id, name, description, status)
         VALUES (gen_random_uuid(), $1, $2, $3, 'active')
         RETURNING *`,
        [input.tenantId, imp.file_name, `Importado desde ${proposal.nombre_archivo}`],
      )

      const [revision] = await run<TemplateRevisionRow>(
        `INSERT INTO template_revision
           (id, template_id, tenant_id, definition, status, source_import_id)
         VALUES (gen_random_uuid(), $1, $2, $3::jsonb, 'draft', $4)
         RETURNING *`,
        [template.id, input.tenantId, JSON.stringify(validated), imp.id],
      )

      await run(
        `UPDATE template_imports
         SET status = 'confirmed', confirmed_at = now(), updated_at = now()
         WHERE id = $1`,
        [imp.id],
      )

      if (input.publish) {
        await this.materializeCatalog(run, input.tenantId, revision.id, validated)
        const [published] = await run<TemplateRevisionRow>(
          `UPDATE template_revision
           SET status = 'published', version = (
             SELECT COALESCE(MAX(version), 0) + 1
             FROM template_revision WHERE template_id = $2 AND version IS NOT NULL
           ), published_at = now(), updated_at = now()
           WHERE id = $1 AND status = 'draft'
           RETURNING *`,
          [revision.id, template.id],
        )
        if (!published) {
          throw new ConflictException('no se pudo publicar la revisión importada')
        }
        return published
      }

      return revision
    })
  }

  /** Convierte la propuesta del parser en una `TemplateDefinition` validable. */
  private proposalToDefinition(proposal: TemplateImportProposal): TemplateDefinition {
    return {
      sections: proposal.secciones.map((section, sidx) => ({
        id: randomUUID(),
        title: section.titulo,
        position: sidx,
        items: section.items.map((item) => ({
          id: randomUUID(),
          prompt: item.prompt,
          response_type: item.response_type,
          require_finding_on_nok: false,
          props: item.props,
          help: undefined,
        })),
      })),
    }
  }
}