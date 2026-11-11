import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { DbService } from '../db/db.service'

type Run = <R = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<R[]>

export type EstadoHallazgo = 'open' | 'in_progress' | 'resolved'

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
      const actual = await run<{ status: string }>('SELECT status FROM inspection WHERE id = $1 FOR UPDATE', [id])
      if (!actual[0]) throw new NotFoundException('Inspección no encontrada')
      if (actual[0].status === 'reviewed') return { id, status: 'reviewed' }
      if (actual[0].status !== 'submitted') {
        throw new ConflictException('Sólo se puede revisar una inspección enviada')
      }
      await run(
        "UPDATE inspection SET status = 'reviewed', reviewed_at = now(), updated_at = now() WHERE id = $1",
        [id],
      )
      await auditar(run, actorId, tenantId, 'inspection_reviewed', 'inspection', id, { from: 'submitted' })
      return { id, status: 'reviewed' }
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
