import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import type { AvanceHallazgoBody, HallazgoAsignadoDto, SignatureStroke } from '@terreno/shared'
import { DbService } from '../db/db.service'

type Run = <R = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<R[]>

export type EstadoHallazgo = 'open' | 'in_progress' | 'resolved'

/** TSK-DOM-007 (FR-064): cambios de gestión del hallazgo; `undefined` = no tocar. */
export interface CambiosHallazgo {
  status?: EstadoHallazgo
  assignee_id?: string | null
  due_date?: string | null
  resolution_note?: string | null
}

export interface HallazgoGestion {
  id: string
  status: EstadoHallazgo
  assignee_id: string | null
  responsable: string | null
  due_date: string | null
  resolution_note: string | null
  /** TSK-DOM-008 (FR-067): lo que reportó el responsable y cuándo (ISO). */
  progress_note: string | null
  reported_at: string | null
}

/** Ventana en que el responsable sigue viendo un hallazgo ya resuelto. */
const DIAS_RESUELTOS_VISIBLES = 14

/**
 * Ciclo de supervisión (FR-031/032, TSK-DOM-005). Decisiones del supervisor o
 * del admin de empresa sobre datos ya sincronizados; todo con RLS y auditado
 * en la misma transacción.
 */
@Injectable()
export class SupervisionService {
  constructor(@Inject(DbService) private readonly db: DbService) {}

  /** FR-031: sólo una inspección enviada (`submitted`) pasa a `reviewed`. */
  revisarInspeccion(tenantId: string, actorId: string, id: string): Promise<{ id: string; status: string }> {
    return this.db.withTenantTransaction(tenantId, async (run) => {
      const actual = await run<{
        status: string
        signature_required: boolean
        requires_supervisor_signature: boolean
      }>('SELECT status, signature_required, requires_supervisor_signature FROM inspection WHERE id = $1 FOR UPDATE', [id])
      if (!actual[0]) throw new NotFoundException('Inspección no encontrada')
      if (actual[0].status === 'reviewed') return { id, status: 'reviewed' }
      if (actual[0].status !== 'submitted') {
        throw new ConflictException('Sólo se puede revisar una inspección enviada')
      }
      if (actual[0].signature_required) {
        const firmas = await run<{ signer_role: 'inspector' | 'supervisor' }>(
          'SELECT signer_role FROM inspection_signature WHERE inspection_id = $1',
          [id],
        )
        const roles = new Set(firmas.map((f) => f.signer_role))
        if (!roles.has('inspector')) throw new ConflictException('La inspección requiere la firma del inspector')
        if (actual[0].requires_supervisor_signature && !roles.has('supervisor')) {
          throw new ConflictException('La plantilla exige cofirma de supervisión antes de revisar')
        }
      }
      await run(
        "UPDATE inspection SET status = 'reviewed', reviewed_at = now(), updated_at = now() WHERE id = $1",
        [id],
      )
      await auditar(run, actorId, tenantId, 'inspection_reviewed', 'inspection', id, { from: 'submitted' })
      return { id, status: 'reviewed' }
    })
  }

  /** FR-057: cofirma en línea de una inspección ya firmada por quien la ejecutó. */
  cofirmarInspeccion(
    tenantId: string,
    actorId: string,
    id: string,
    strokes: SignatureStroke[],
  ): Promise<{ id: string; signer_role: 'supervisor' }> {
    return this.db.withTenantTransaction(tenantId, async (run) => {
      const actual = await run<{ requires_supervisor_signature: boolean; status: string }>(
        'SELECT requires_supervisor_signature, status FROM inspection WHERE id = $1 FOR UPDATE',
        [id],
      )
      if (!actual[0]) throw new NotFoundException('Inspección no encontrada')
      if (actual[0].status !== 'submitted') throw new ConflictException('Sólo se puede cofirmar una inspección enviada')
      if (!actual[0].requires_supervisor_signature) {
        throw new ConflictException('Esta inspección no requiere cofirma de supervisión')
      }
      const [inspector] = await run<{ content_hash: string }>(
        "SELECT content_hash FROM inspection_signature WHERE inspection_id = $1 AND signer_role = 'inspector'",
        [id],
      )
      if (!inspector) throw new ConflictException('Falta la firma del inspector')
      const existente = await run<{ id: string }>(
        "SELECT id FROM inspection_signature WHERE inspection_id = $1 AND signer_role = 'supervisor'",
        [id],
      )
      if (existente[0]) return { id: existente[0].id, signer_role: 'supervisor' }
      const signatureId = randomUUID()
      await run(
        `INSERT INTO inspection_signature
           (id, tenant_id, inspection_id, signer_id, signer_role, strokes_json,
            content_hash, declaration_version, signed_at, client_version)
         VALUES ($1, $2, $3, $4, 'supervisor', $5::jsonb, $6, 'v1', now(), 0)`,
        [signatureId, tenantId, id, actorId, JSON.stringify(strokes), inspector.content_hash],
      )
      await auditar(run, actorId, tenantId, 'inspection_signed', 'inspection_signature', signatureId, {
        inspection_id: id,
        signer_role: 'supervisor',
      })
      return { id: signatureId, signer_role: 'supervisor' }
    })
  }

  /** FR-032: estado del hallazgo (abierto → en curso → resuelto, o reabrir). */
  cambiarEstadoHallazgo(
    tenantId: string,
    actorId: string,
    id: string,
    status: EstadoHallazgo,
  ): Promise<{ id: string; status: EstadoHallazgo }> {
    return this.db.withTenantTransaction(tenantId, async (run) => {
      const actual = await run<{ status: string }>('SELECT status FROM finding WHERE id = $1 FOR UPDATE', [id])
      if (!actual[0]) throw new NotFoundException('Hallazgo no encontrado')
      if (actual[0].status !== status) {
        // resolved_at mide el tiempo de cierre; reabrir lo limpia (TSK-REP-006).
        await run(
          `UPDATE finding SET status = $2, updated_at = now(),
                  resolved_at = CASE WHEN $2 = 'resolved' THEN now() ELSE NULL END
            WHERE id = $1`,
          [id, status],
        )
        await auditar(run, actorId, tenantId, 'finding_status_changed', 'finding', id, {
          from: actual[0].status,
          to: status,
        })
      }
      return { id, status }
    })
  }

  /**
   * TSK-DOM-007 (FR-064): gestión del hallazgo como acción correctiva —
   * estado, responsable, plazo y nota de cierre — en una sola transacción y con
   * UN registro de auditoría que dice qué cambió (antes → después).
   *
   * El responsable tiene que ser una cuenta activa de la misma empresa: se lee
   * con la conexión del tenant (RLS), así que una cuenta ajena no existe.
   */
  gestionarHallazgo(tenantId: string, actorId: string, id: string, cambios: CambiosHallazgo): Promise<HallazgoGestion> {
    return this.db.withTenantTransaction(tenantId, async (run) => {
      const [actual] = await run<{
        status: EstadoHallazgo
        assignee_id: string | null
        due_date: string | null
        resolution_note: string | null
        progress_note: string | null
        reported_ms: number | null
      }>(
        `SELECT status, assignee_id, to_char(due_date, 'YYYY-MM-DD') AS due_date, resolution_note,
                progress_note, (extract(epoch FROM reported_at) * 1000)::float8 AS reported_ms
           FROM finding WHERE id = $1 FOR UPDATE`,
        [id],
      )
      if (!actual) throw new NotFoundException('Hallazgo no encontrado')
      if (cambios.assignee_id) {
        const [persona] = await run<{ id: string }>(
          'SELECT id FROM app_user WHERE id = $1 AND is_active AND tenant_id IS NOT NULL',
          [cambios.assignee_id],
        )
        if (!persona) throw new BadRequestException('El responsable debe ser una cuenta activa de tu empresa')
      }
      const nuevo = {
        status: cambios.status ?? actual.status,
        assignee_id: cambios.assignee_id !== undefined ? cambios.assignee_id : actual.assignee_id,
        due_date: cambios.due_date !== undefined ? cambios.due_date : actual.due_date,
        resolution_note:
          cambios.resolution_note !== undefined ? cambios.resolution_note?.trim() || null : actual.resolution_note,
      }
      const cambio: Record<string, { de: unknown; a: unknown }> = {}
      for (const k of ['status', 'assignee_id', 'due_date', 'resolution_note'] as const) {
        if (nuevo[k] !== actual[k]) cambio[k] = { de: actual[k], a: nuevo[k] }
      }
      // TSK-DOM-008 (FR-067): otro responsable empieza de cero (sin el avance
      // del anterior) y reabrir devuelve el hallazgo a quien lo tenía, sin el
      // "listo para revisar".
      const reasignado = cambio.assignee_id !== undefined
      const reabierto = cambio.status !== undefined && nuevo.status === 'open'
      let avance = {
        progress_note: actual.progress_note,
        reported_at: actual.reported_ms == null ? null : new Date(actual.reported_ms).toISOString(),
      }
      if (Object.keys(cambio).length > 0) {
        const [fila] = await run<{ progress_note: string | null; reported_ms: number | null }>(
          `UPDATE finding SET status = $2, assignee_id = $3, due_date = $4::date, resolution_note = $5,
                  updated_at = now(),
                  resolved_at = CASE WHEN $2 = 'resolved' THEN COALESCE(resolved_at, now()) ELSE NULL END,
                  assigned_at = CASE WHEN $6 THEN (CASE WHEN $3::uuid IS NULL THEN NULL ELSE now() END)
                                     ELSE assigned_at END,
                  progress_note = CASE WHEN $6 THEN NULL ELSE progress_note END,
                  reported_at = CASE WHEN $6 OR $7 THEN NULL ELSE reported_at END
            WHERE id = $1
            RETURNING progress_note, (extract(epoch FROM reported_at) * 1000)::float8 AS reported_ms`,
          [id, nuevo.status, nuevo.assignee_id, nuevo.due_date, nuevo.resolution_note, reasignado, reabierto],
        )
        avance = {
          progress_note: fila.progress_note,
          reported_at: fila.reported_ms == null ? null : new Date(fila.reported_ms).toISOString(),
        }
        if (cambio.status) {
          // Mismo evento de siempre para el cambio de estado (TSK-DOM-005).
          await auditar(run, actorId, tenantId, 'finding_status_changed', 'finding', id, {
            from: actual.status,
            to: nuevo.status,
          })
        }
        const { status: _status, ...resto } = cambio
        if (Object.keys(resto).length > 0) {
          await auditar(run, actorId, tenantId, 'finding_assigned', 'finding', id, resto)
        }
      }
      const [persona] = nuevo.assignee_id
        ? await run<{ full_name: string }>('SELECT full_name FROM app_user WHERE id = $1', [nuevo.assignee_id])
        : []
      return { id, ...nuevo, ...avance, responsable: persona?.full_name ?? null }
    })
  }

  /**
   * TSK-DOM-008 (FR-067): `GET /findings/asignados` — los hallazgos de los que
   * se hace cargo quien consulta. Los abiertos y en curso, más los resueltos de
   * los últimos 14 días para que vea el cierre. Con la conexión del tenant (RLS):
   * sólo su empresa, y además sólo los suyos.
   */
  async asignados(tenantId: string, actorId: string): Promise<HallazgoAsignadoDto[]> {
    interface Row {
      id: string
      severity: HallazgoAsignadoDto['severity']
      status: EstadoHallazgo
      description: string
      due_date: string | null
      assigned_ms: number | null
      progress_note: string | null
      reported_ms: number | null
      resolution_note: string | null
      resolved_ms: number | null
      faena: string | null
      formulario: string | null
      pregunta: string | null
      inspeccion_ms: number | null
      autor: string | null
      fotos_ids: string[] | null
    }
    const ms = (v: number | null) => (v == null ? null : new Date(v).toISOString())
    const rows = await this.db.queryAsTenant<Row>(
      tenantId,
      `SELECT f.id, f.severity, f.status, f.description,
              to_char(f.due_date, 'YYYY-MM-DD') AS due_date,
              (extract(epoch FROM COALESCE(f.assigned_at, f.updated_at)) * 1000)::float8 AS assigned_ms,
              f.progress_note,
              (extract(epoch FROM f.reported_at) * 1000)::float8 AS reported_ms,
              f.resolution_note,
              (extract(epoch FROM f.resolved_at) * 1000)::float8 AS resolved_ms,
              s.name AS faena, t.name AS formulario,
              (SELECT it->>'prompt'
                 FROM template_revision tr,
                      jsonb_array_elements(tr.definition->'sections') sec,
                      jsonb_array_elements(sec->'items') it
                WHERE tr.template_id = i.template_id AND tr.version = i.template_version
                  AND it->>'id' = ir.template_item_id::text
                LIMIT 1) AS pregunta,
              (extract(epoch FROM i.captured_at) * 1000)::float8 AS inspeccion_ms,
              u.full_name AS autor,
              COALESCE((SELECT array_agg(a.id ORDER BY a.captured_at, a.id) FROM attachment a
                         WHERE a.owner_type = 'finding' AND a.owner_id = f.id), '{}') AS fotos_ids
         FROM finding f
         LEFT JOIN inspection i ON i.id = f.inspection_id
         LEFT JOIN inspection_response ir ON ir.id = f.response_id
         LEFT JOIN site s ON s.id = i.site_id
         LEFT JOIN template t ON t.id = i.template_id
         LEFT JOIN app_user u ON u.id = i.executed_by
        WHERE f.assignee_id = $1
          AND (f.status <> 'resolved' OR f.resolved_at >= now() - make_interval(days => $2))
        ORDER BY (f.status = 'resolved'), f.due_date NULLS LAST, COALESCE(f.assigned_at, f.updated_at) DESC`,
      [actorId, DIAS_RESUELTOS_VISIBLES],
    )
    return rows.map((r) => ({
      id: r.id,
      severity: r.severity,
      status: r.status,
      description: r.description,
      due_date: r.due_date,
      assigned_at: ms(r.assigned_ms) ?? '',
      progress_note: r.progress_note,
      reported_at: ms(r.reported_ms),
      resolution_note: r.resolution_note,
      resolved_at: ms(r.resolved_ms),
      faena: r.faena,
      formulario: r.formulario,
      pregunta: r.pregunta,
      inspeccion_at: ms(r.inspeccion_ms),
      autor: r.autor,
      fotos_ids: r.fotos_ids ?? [],
    }))
  }

  /**
   * TSK-DOM-008 (FR-067): `PATCH /findings/:id/avance` — el responsable lo
   * empieza o reporta lo que hizo. No lo resuelve: eso lo decide supervisión.
   * Un hallazgo que no es suyo, ya resuelto o de otra empresa → 404 (no se
   * distingue, para no revelar hallazgos ajenos).
   */
  avanzarHallazgo(
    tenantId: string,
    actorId: string,
    id: string,
    body: AvanceHallazgoBody,
  ): Promise<{ id: string; status: EstadoHallazgo; progress_note: string | null; reported_at: string | null }> {
    return this.db.withTenantTransaction(tenantId, async (run) => {
      const [actual] = await run<{ status: EstadoHallazgo; progress_note: string | null; reported_ms: number | null }>(
        `SELECT status, progress_note, (extract(epoch FROM reported_at) * 1000)::float8 AS reported_ms
           FROM finding
          WHERE id = $1 AND assignee_id = $2 AND status <> 'resolved'
          FOR UPDATE`,
        [id, actorId],
      )
      if (!actual) throw new NotFoundException('Hallazgo no encontrado entre los tuyos')
      const nota = body.accion === 'reportar' ? body.nota.trim() : null
      if (body.accion === 'reportar' && !nota) {
        throw new BadRequestException('Cuenta qué hiciste para reportar el hallazgo')
      }
      const [fila] = await run<{ status: EstadoHallazgo; progress_note: string | null; reported_ms: number | null }>(
        body.accion === 'iniciar'
          ? `UPDATE finding SET status = 'in_progress', updated_at = now()
              WHERE id = $1
              RETURNING status, progress_note, (extract(epoch FROM reported_at) * 1000)::float8 AS reported_ms`
          : `UPDATE finding SET status = 'in_progress', progress_note = $2, reported_at = now(), updated_at = now()
              WHERE id = $1
              RETURNING status, progress_note, (extract(epoch FROM reported_at) * 1000)::float8 AS reported_ms`,
        body.accion === 'iniciar' ? [id] : [id, nota],
      )
      const iso = (v: number | null) => (v == null ? null : new Date(v).toISOString())
      await auditar(run, actorId, tenantId, 'finding_progress', 'finding', id, {
        accion: body.accion,
        status: { de: actual.status, a: fila.status },
        ...(body.accion === 'reportar'
          ? { progress_note: { de: actual.progress_note, a: fila.progress_note }, reported_at: { de: iso(actual.reported_ms), a: iso(fila.reported_ms) } }
          : {}),
      })
      return { id, status: fila.status, progress_note: fila.progress_note, reported_at: iso(fila.reported_ms) }
    })
  }

  /** Cuentas activas de la empresa que pueden hacerse cargo de un hallazgo. */
  async equipo(tenantId: string): Promise<Array<{ id: string; nombre: string; rol: string }>> {
    return this.db.queryAsTenant<{ id: string; nombre: string; rol: string }>(
      tenantId,
      `SELECT id, full_name AS nombre, role AS rol FROM app_user
        WHERE is_active AND tenant_id IS NOT NULL ORDER BY full_name`,
    )
  }

  /** El conflicto conserva sus dos versiones; sólo se registra la revisión. */
  revisarConflicto(
    tenantId: string,
    actorId: string,
    id: string,
  ): Promise<{ id: string; reviewed_at: string; reviewed_by: string }> {
    return this.db.withTenantTransaction(tenantId, async (run) => {
      const rows = await run<{ id: string; reviewed_at: string; reviewed_by: string }>(
        `UPDATE conflict_record SET reviewed_at = COALESCE(reviewed_at, now()),
                reviewed_by = COALESCE(reviewed_by, $2)
          WHERE id = $1
          RETURNING id, reviewed_at, reviewed_by`,
        [id, actorId],
      )
      if (!rows[0]) throw new NotFoundException('Conflicto no encontrado')
      if (rows[0].reviewed_by === actorId) {
        await auditar(run, actorId, tenantId, 'conflict_reviewed', 'conflict_record', id, {})
      }
      return rows[0]
    })
  }
}

async function auditar(
  run: Run,
  actorId: string,
  tenantId: string,
  action: string,
  entityType: string,
  entityId: string,
  payload: unknown,
): Promise<void> {
  await run(
    `INSERT INTO audit_log (id, actor_id, tenant_id, action, entity_type, entity_id, payload)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [randomUUID(), actorId, tenantId, action, entityType, entityId, JSON.stringify(payload)],
  )
}
