import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import type { SignatureStroke } from '@terreno/shared'
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
}

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
      }>(
        `SELECT status, assignee_id, to_char(due_date, 'YYYY-MM-DD') AS due_date, resolution_note
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
      if (Object.keys(cambio).length > 0) {
        await run(
          `UPDATE finding SET status = $2, assignee_id = $3, due_date = $4::date, resolution_note = $5,
                  updated_at = now(),
                  resolved_at = CASE WHEN $2 = 'resolved' THEN COALESCE(resolved_at, now()) ELSE NULL END
            WHERE id = $1`,
          [id, nuevo.status, nuevo.assignee_id, nuevo.due_date, nuevo.resolution_note],
        )
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
      return { id, ...nuevo, responsable: persona?.full_name ?? null }
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
