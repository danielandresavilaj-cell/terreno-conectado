import { randomUUID } from 'node:crypto'
import { mkdir, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
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
import { SyncVolumeService } from '../storage/sync-volume.service'
import type {
  AssignTemplateInput,
  ConfirmTemplateImportInput,
  CreateDraftInput,
  CreateTemplateInput,
  TemplateAssignmentRow,
  TemplateImportRow,
  TemplateItemRow,
  TemplateOriginalFile,
  TemplateRevisionRow,
  TemplateRow,
  TemplateSectionRow,
  UpdateDraftInput,
  WorkerTemplateFilter,
} from './templates.types'

/** Fila de la consulta del delta: la revisión más el nombre de su plantilla. */
type DeltaRow = TemplateRevisionRow & { name: string }

/**
 * FR-009: predicado de visibilidad por rol/faena de un rol operativo. Sin
 * filtro (`rol` NULL) el predicado es tautológico y el `tenant_admin` ve todo.
 *
 * Los números de parámetro se reciben explícitamente porque cada consulta
 * numera distinto: mandar un parámetro que la query no referencia hace fallar
 * PostgreSQL con "could not determine data type of parameter $n" (el alias `r`
 * es el de `template_revision` en todas ellas).
 */
function visibilidadRolOperativo(rolParam: string, siteParam: string): string {
  return `(${rolParam}::text IS NULL OR EXISTS (
      SELECT 1 FROM template_assignment a
       WHERE a.template_revision_id = r.id
         AND a.tenant_id = r.tenant_id
         AND a.active
         AND a.role = ${rolParam}
         AND (${siteParam}::uuid IS NULL OR a.site_id IS NULL OR a.site_id = ${siteParam})
    ))`
}

/** ¿Existe el fichero en disco? Un original borrado a mano no es un 500. */
async function existeEnDisco(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/**
 * DS del módulo 007: plantillas versionadas e inmutables + catálogo tipado.
 *
 * Requisitos:
 *  - FR-007  aislamiento por tenant (RLS en el motor, Artículo IV).
 *  - FR-027  `version` se asigna al publicar (max+1 por plantilla) y
 *            `published_seq` es la secuencia GLOBAL de publicación: el cursor
 *            del delta `since=` (TSK-FORM-009).
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
    private readonly volume: SyncVolumeService,
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
   * Publica un borrador: asigna `version` (max+1 por plantilla, FR-027), sella
   * `published_seq` (cursor global del delta, TSK-FORM-009), materializa el
   * catálogo tipado (template_section/template_item) y congela todo el
   * contenido (FR-049). Atómico por tenant — la materialización ocurre ANTES
   * del cambio de estado porque el RLS exige revisión en `draft`.
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
         SET status = 'published', version = $2,
             published_seq = nextval('template_revision_published_seq'),
             published_at = now(), updated_at = now()
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
   * con delta opcional `since` (FR-027/TSK-FORM-009): devuelve sólo
   * `published_seq > since`.
   *
   * El umbral es la secuencia GLOBAL de publicación y NO `version` (que se
   * asigna por plantilla): con la plantilla A en v9 y la B en v3, un cursor
   * global sobre `version` jamás entregaría la v4 de B. `latest_seq` es el
   * techo publicado visible — el cliente lo guarda como próximo `since`.
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
    // techo de secuencia) con placeholders distintos según sus parámetros: es
    // lo que impide que el delta salte revisiones que se asignan más tarde.
    const [rows, [{ max }]] = await Promise.all([
      this.db.queryAsTenant<DeltaRow>(
        tenantId,
        `SELECT r.*, t.name
           FROM template_revision r
           JOIN template t ON t.id = r.template_id
          WHERE r.status = 'published'
            AND ($1::bigint IS NULL OR r.published_seq > $1)
            AND ${visibilidadRolOperativo('$2', '$3')}
          ORDER BY r.published_seq DESC`,
        [since ?? null, role, siteId],
      ),
      this.db.queryAsTenant<{ max: string | null }>(
        tenantId,
        `SELECT MAX(r.published_seq) AS max
           FROM template_revision r
          WHERE r.status = 'published'
            AND ${visibilidadRolOperativo('$1', '$2')}`,
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
        // published_seq es bigint: el CHECK de la migración 009 garantiza no
        // nulo en toda revisión publicada, así que el casts a número es seguro.
        published_seq: Number(r.published_seq),
        published_at: r.published_at,
        definition: r.definition as unknown as TemplateDefinition,
      })),
      latest_seq: max === null ? null : Number(max),
    }
  }

  /* ── Documento original .xlsx (TSK-FORM-009, FR-018/019) ───────────────── */

  /**
   * Resuelve el `.xlsx` fuente de una revisión publicada para descargarlo
   * offline (FR-019/044). Devuelve ruta y nombre; los bytes los emite el
   * controller en streaming, no viajan por `POST /sync/batch`.
   *
   * Sin asignación, un rol operativo recibe 404 (no 403) para que el id no sea
   * enumerable por fuerza bruta; el `tenant_admin` ve todo lo de su tenant y el
   * cruce de tenant cae en 404 por RLS.
   */
  async getRevisionOriginal(
    tenantId: string,
    revisionId: string,
    worker?: WorkerTemplateFilter,
  ): Promise<TemplateOriginalFile> {
    const [row] = await this.db.queryAsTenant<{
      source_import_id: string | null
      file_key: string | null
      file_name: string | null
    }>(
      tenantId,
      `SELECT r.source_import_id, i.file_key, i.file_name
         FROM template_revision r
         LEFT JOIN template_imports i ON i.id = r.source_import_id
        WHERE r.id = $1`,
      [revisionId],
    )
    if (!row) {
      throw new NotFoundException('revisión no encontrada para este tenant')
    }

    if (worker) {
      const [visible] = await this.db.queryAsTenant<{ id: string }>(
        tenantId,
        `SELECT r.id FROM template_revision r
          WHERE r.id = $1 AND ${visibilidadRolOperativo('$2', '$3')}`,
        [revisionId, worker.role, worker.siteId],
      )
      if (!visible) {
        throw new NotFoundException('revisión no encontrada para este tenant')
      }
    }

    if (!row.source_import_id || !row.file_key || !row.file_name) {
      throw new NotFoundException(
        'la revisión no proviene de una importación .xlsx: no hay documento original que descargar (FR-019)',
      )
    }

    const path = this.volume.rutaEn(row.file_key)
    if (!(await existeEnDisco(path))) {
      throw new NotFoundException('el documento original de la revisión no está en el volumen de sync')
    }
    return { path, fileName: row.file_name }
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
    const key = `template_imports/${tenantId}/${importId}.xlsx`
    const path = join(this.volume.raiz(), key)
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
   * Confirma la propuesta y genera una plantilla + borrador (FR-048).
   * Si `publish=true`, publica inmediatamente (solo si la definición es válida).
   * Nunca publica automáticamente sin el flag explícito.
   */
  async confirmTemplateImport(input: ConfirmTemplateImportInput): Promise<TemplateRevisionRow> {
    return this.db.withTenantTransaction<TemplateRevisionRow>(input.tenantId, async (run) => {
      // El estado se mira en dos pasos a propósito. Un import de OTRO tenant es
      // invisible por RLS, así que si el filtro trajera `status = 'proposed'`
      // desde el `WHERE` no se podría distinguir "no existe para ti" de "ya
      // estaba confirmado" y ambos casos responderían 409: un 409 confirma que
      // el id existe en el sistema, que es justo lo que no hay que filtrar. Con
      // la fila primero, lo que el tenant no puede ver cae en 404 y el 409 queda
      // para lo que sí es un conflicto de estado (confirmar dos veces).
      const [imp] = await run<TemplateImportRow>(
        `SELECT * FROM template_imports WHERE id = $1`,
        [input.importId],
      )
      if (!imp) {
        throw new NotFoundException('import no encontrado para este tenant')
      }
      if (imp.status !== 'proposed') {
        throw new ConflictException('el import no está en estado proposed')
      }

      const proposal = templateImportProposalSchema.parse(imp.proposed_schema)
      // La definición revisada manda si llega: el wizard edita los ítems en el
      // dispositivo y luego confirma (FR-048). Sin ella se publica la propuesta
      // del parser, que es el camino simple.
      const definition =
        input.definition === undefined
          ? this.proposalToDefinition(proposal)
          : (input.definition as TemplateDefinition)
      const validated = this.validateOrThrow(definition)

      const [template] = await run<TemplateRow>(
        `INSERT INTO template (id, tenant_id, name, description, status)
         VALUES (gen_random_uuid(), $1, $2, $3, 'active')
         RETURNING *`,
        [
          input.tenantId,
          input.name?.trim() || imp.file_name,
          input.description?.trim() ?? `Importado desde ${proposal.nombre_archivo}`,
        ],
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

      // FR-047: confirmar un import es un acto auditable. Sin esta fila, el
      // ciclo `proposed → confirmed` — y con él el documento fuente que hace
      // posible exportar el original (FR-019) — no dejaba rastro de quién lo
      // confirmó. `audit_log` es append-only, así que se escribe dentro de la
      // misma transacción: o queda el import confirmado y su fila, o no queda
      // ninguno de los dos.
      if (input.actorId) {
        await run(
          `INSERT INTO audit_log (id, actor_id, tenant_id, action, entity_type, entity_id, payload)
           VALUES ($1, $2, $3, 'template_import_confirmed', 'template_import', $4, $5)`,
          [
            randomUUID(),
            input.actorId,
            input.tenantId,
            imp.id,
            JSON.stringify({
              template_id: template.id,
              revision_id: revision.id,
              archivo: imp.file_name,
              definicion_revisada: input.definition !== undefined,
              publicado: Boolean(input.publish),
            }),
          ],
        )
      }

      if (input.publish) {
        await this.materializeCatalog(run, input.tenantId, revision.id, validated)
        const [published] = await run<TemplateRevisionRow>(
          `UPDATE template_revision
           SET status = 'published', version = (
             SELECT COALESCE(MAX(version), 0) + 1
             FROM template_revision WHERE template_id = $2 AND version IS NOT NULL
           ),
           published_seq = nextval('template_revision_published_seq'),
           published_at = now(), updated_at = now()
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