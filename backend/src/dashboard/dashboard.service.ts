/**
 * Lecturas del dashboard mínimo del supervisor (spec 005, TSK-WS-011).
 *
 * Nada de esto escribe: es el consumo read-only de lo syncronizado, con RLS
 * por tenant (Artículo IV) y roles supervisor/tenant_admin. Las métricas de
 * sincronización viven en supervision-dashboard.service (TSK-REP-006).
 *
 * Alcance reducido contractual: sin queries materializadas ni percentiles por
 * lote (eso es del módulo 005, semanas 9-12).
 */

import { Inject, Injectable } from '@nestjs/common'
import { DbService } from '../db/db.service'
import type { JwtClaims } from '../auth/auth.types'
import { exigirDashboard, DASHBOARD_ROLES } from './dashboard.auth'
import { parsearFiltrosPeriodo, parsearFiltrosFindings, type FiltrosPeriodo } from './dashboard.contract'
import type {
  BitacoraResponse,
  DashboardFindingsResponse,
  DashboardSummary,
  FindingDto,
  SiteDto,
  SitesResponse,
} from '@terreno/shared'

export interface DashboardFiltros {
  site_id?: string | null
  desde?: string | null
  hasta?: string | null
}

export interface FindingsFiltros extends DashboardFiltros {
  severidad?: string | null
  estado?: string | null
  /** FR-041: filtra por el usuario que ejecutó la inspección (id, no nombre). */
  autor_id?: string | null
  limit: number
  offset: number
}

/**
 * Valida `site_id`/rango con el contrato compartido del módulo
 * (`dashboard.contract`): las consultas nuevas de TSK-FORM-010 usan el mismo, así
 * que un filtro mal escrito se rechaza igual en todos los endpoints del
 * dashboard y con el mismo mensaje.
 */
function normalizeFiltro(f: DashboardFiltros): FiltrosPeriodo {
  return parsearFiltrosPeriodo(f)
}

@Injectable()
export class DashboardService {
  constructor(@Inject(DbService) private readonly db: DbService) {}

  /** El que autoriza es el rol + tener tenant: field_worker no ve el dashboard. */
  private exigir(u: JwtClaims, roles: readonly string[] = DASHBOARD_ROLES): void {
    exigirDashboard(u, roles)
  }

  /* ------------------------------------------------------------ faenas */

  /** Faenas/obras del tenant + nombre del tenant (bootstrapea la captura offline, FR-006). */
  async listSites(u: JwtClaims): Promise<SitesResponse> {
    this.exigir(u, ['field_worker', 'supervisor', 'tenant_admin'])
    const rows = await this.db.queryAsTenant<SiteDto>(
      u.tenant_id as string,
      `SELECT id, name AS nombre,
              CASE kind WHEN 'mining' THEN 'mina' ELSE 'obra' END AS tipo
         FROM site ORDER BY name`,
    )
    const tenantId = u.tenant_id as string
    const ten = await this.db.queryOwner<{ id: string; name: string }>(
      'SELECT id, name FROM tenant WHERE id = $1',
      [tenantId],
    )
    return {
      items: rows,
      tenant: { id: tenantId, nombre: ten[0]?.name ?? tenantId },
    }
  }

  /* ------------------------------------------------------------ summary */

  async summary(u: JwtClaims, filtros: DashboardFiltros): Promise<DashboardSummary> {
    this.exigir(u)
    const tenantId = u.tenant_id as string
    const { siteId, desde, hasta } = normalizeFiltro(filtros)

    const [estados, porSev, sincronizaciones, conflictos, urgentes, autores, vencidos, tendencia] = await Promise.all([
      this.db.queryAsTenant<{ status: string; n: number }>(
        tenantId,
        `SELECT status, count(*)::int AS n
           FROM inspection
          WHERE ($1::uuid IS NULL OR site_id = $1)
            AND captured_at >= COALESCE($2::timestamptz, '-infinity'::timestamptz)
            AND captured_at <= COALESCE($3::timestamptz, 'infinity'::timestamptz)
          GROUP BY status`,
        [siteId, desde, hasta],
      ),
      this.db.queryAsTenant<{ severity: string; n: number }>(
        tenantId,
        `SELECT f.severity AS severity, count(*)::int AS n
           FROM finding f
           LEFT JOIN inspection i ON i.id = f.inspection_id
          WHERE ($1::uuid IS NULL OR i.site_id = $1)
            AND f.captured_at >= COALESCE($2::timestamptz, '-infinity'::timestamptz)
            AND f.captured_at <= COALESCE($3::timestamptz, 'infinity'::timestamptz)
          GROUP BY f.severity`,
        [siteId, desde, hasta],
      ),
      this.db.queryAsTenant<{ n: number }>(
        tenantId,
        `SELECT count(*)::int AS n
           FROM sync_log
          WHERE started_at >= COALESCE($1::timestamptz, '-infinity'::timestamptz)
            AND started_at <= COALESCE($2::timestamptz, 'infinity'::timestamptz)`,
        [desde, hasta],
      ),
      this.db.queryAsTenant<{ n: number }>(
        tenantId,
        `SELECT count(*)::int AS n
           FROM conflict_record
          WHERE reviewed_at IS NULL -- pendientes de revisión (FR-040, TSK-DOM-005)
            AND resolved_at >= COALESCE($1::timestamptz, '-infinity'::timestamptz)
            AND resolved_at <= COALESCE($2::timestamptz, 'infinity'::timestamptz)`,
        [desde, hasta],
      ),
      this.db.queryAsTenant<{ n: number }>(
        tenantId,
        `SELECT count(*)::int AS n
           FROM finding f
           LEFT JOIN inspection i ON i.id = f.inspection_id
          WHERE f.severity IN ('high','critical') AND f.status <> 'resolved'
            AND ($1::uuid IS NULL OR i.site_id = $1)
            AND f.captured_at >= COALESCE($2::timestamptz, '-infinity'::timestamptz)
            AND f.captured_at <= COALESCE($3::timestamptz, 'infinity'::timestamptz)`,
        [siteId, desde, hasta],
      ),
      // FR-041: autores con actividad en el período → opciones del filtro por autor.
      this.db.queryAsTenant<{ id: string; nombre: string }>(
        tenantId,
        `SELECT DISTINCT u.id, u.full_name AS nombre
           FROM inspection i
           JOIN app_user u ON u.id = i.executed_by
          WHERE ($1::uuid IS NULL OR i.site_id = $1)
            AND i.captured_at >= COALESCE($2::timestamptz, '-infinity'::timestamptz)
            AND i.captured_at <= COALESCE($3::timestamptz, 'infinity'::timestamptz)
          ORDER BY u.full_name`,
        [siteId, desde, hasta],
      ),
      // TSK-REP-011 (FR-064): acciones correctivas con plazo pasado. Es deuda
      // abierta, no actividad del período: no se recorta por fechas.
      this.db.queryAsTenant<{ n: number }>(
        tenantId,
        `SELECT count(*)::int AS n
           FROM finding f
           LEFT JOIN inspection i ON i.id = f.inspection_id
          WHERE f.status <> 'resolved' AND f.due_date < current_date
            AND ($1::uuid IS NULL OR i.site_id = $1)`,
        [siteId],
      ),
      // TSK-REP-012 (FR-040): inspecciones y hallazgos por semana (lunes a
      // domingo, UTC del servidor) de las últimas 8, por faena y sin recorte
      // de período: la tendencia se lee igual cualquiera sea el filtro elegido.
      this.db.queryAsTenant<{ semana: string; inspecciones: number; hallazgos: number }>(
        tenantId,
        `SELECT to_char(s.semana, 'YYYY-MM-DD') AS semana,
                (SELECT count(*)::int FROM inspection i
                  WHERE i.captured_at >= s.semana AND i.captured_at < s.semana + interval '7 days'
                    AND ($1::uuid IS NULL OR i.site_id = $1)) AS inspecciones,
                (SELECT count(*)::int FROM finding f
                   LEFT JOIN inspection i ON i.id = f.inspection_id
                  WHERE f.captured_at >= s.semana AND f.captured_at < s.semana + interval '7 days'
                    AND ($1::uuid IS NULL OR i.site_id = $1)) AS hallazgos
           FROM generate_series(
                  date_trunc('week', now()) - interval '7 weeks',
                  date_trunc('week', now()),
                  interval '1 week'
                ) AS s(semana)
          ORDER BY s.semana`,
        [siteId],
      ),
    ])

    const porEstado = { draft: 0, in_progress: 0, submitted: 0, reviewed: 0 }
    for (const r of estados) porEstado[r.status as keyof typeof porEstado] = r.n

    const porSeveridad = { low: 0, medium: 0, high: 0, critical: 0 }
    for (const r of porSev) porSeveridad[r.severity as keyof typeof porSeveridad] = r.n

    const faenas = await this.listSites(u)
    const totalHallazgos = (Object.values(porSeveridad) as number[]).reduce((a, b) => a + b, 0)

    return {
      site_id: siteId,
      faenas: faenas.items,
      autores,
      inspecciones_por_estado: porEstado,
      hallazgos_por_severidad: porSeveridad,
      hallazgos_urgentes: urgentes[0]?.n ?? 0,
      hallazgos_vencidos: vencidos[0]?.n ?? 0,
      tendencia_semanal: tendencia,
      hallazgos_total: totalHallazgos,
      conflictos_pendientes: conflictos[0]?.n ?? 0,
      sincronizaciones: sincronizaciones[0]?.n ?? 0,
    }
  }

  /* ------------------------------------------------------------ bitácora */

  /**
   * TSK-REP-009 (FR-033/063): la bitácora de la empresa, para que la lea quien
   * no la escribió — el turno entrante y la supervisión.
   *
   * Lo pueden leer también los trabajadores: el relevo es justamente para
   * ellos. La RLS limita a la empresa (Art. IV); dentro de ella no hay
   * restricción por faena porque una cuenta no tiene faenas asignadas.
   */
  async bitacora(
    u: JwtClaims,
    f: { site_id: string | null; desde: string | null; hasta: string | null; limit: number; offset: number },
  ): Promise<BitacoraResponse> {
    this.exigir(u, ['field_worker', 'supervisor', 'tenant_admin'])
    const tenantId = u.tenant_id as string
    const { siteId, desde, hasta } = parsearFiltrosPeriodo(f)
    const where = `
        WHERE ($1::uuid IS NULL OR l.site_id = $1)
          AND l.captured_at >= COALESCE($2::timestamptz, '-infinity'::timestamptz)
          AND l.captured_at <= COALESCE($3::timestamptz, 'infinity'::timestamptz)`
    const [rows, total] = await Promise.all([
      this.db.queryAsTenant<{
        id: string
        faena_id: string
        faena_nombre: string
        autor_id: string
        autor: string | null
        texto: string
        tags: string[]
        fecha_turno: string
        captured_ms: number
      }>(
        tenantId,
        `SELECT l.id, l.site_id AS faena_id, s.name AS faena_nombre,
                l.author_id AS autor_id, u.full_name AS autor,
                l.entry_text AS texto, l.tags, to_char(l.shift_date, 'YYYY-MM-DD') AS fecha_turno,
                (extract(epoch FROM l.captured_at) * 1000)::float8 AS captured_ms
           FROM log_entry l
           JOIN site s ON s.id = l.site_id
           LEFT JOIN app_user u ON u.id = l.author_id
         ${where}
          ORDER BY l.captured_at DESC, l.id DESC
          LIMIT $4 OFFSET $5`,
        [siteId, desde, hasta, f.limit, f.offset],
      ),
      this.db.queryAsTenant<{ n: number }>(
        tenantId,
        `SELECT count(*)::int AS n FROM log_entry l ${where}`,
        [siteId, desde, hasta],
      ),
    ])
    return {
      items: rows.map((r) => ({
        id: r.id,
        faena_id: r.faena_id,
        faena_nombre: r.faena_nombre,
        autor_id: r.autor_id,
        autor: r.autor ?? 'Usuario no disponible',
        texto: r.texto,
        tags: r.tags ?? [],
        fecha_turno: r.fecha_turno,
        captured_at: new Date(r.captured_ms).toISOString(),
      })),
      total: total[0]?.n ?? 0,
    }
  }

  /* ------------------------------------------------------------ findings */

  async findings(u: JwtClaims, f: FindingsFiltros): Promise<DashboardFindingsResponse> {
    this.exigir(u)
    const tenantId = u.tenant_id as string
    const { siteId, desde, hasta, severidad, estado, autorId } = parsearFiltrosFindings(f)

    interface Row {
      id: string
      severity: string
      status: string
      description: string
      faena_id: string | null
      faena_nombre: string | null
      autor_id: string | null
      autor: string | null
      captured_ms: number | null
      synced_ms: number | null
      foto_id: string | null
      foto_mime: string | null
      foto_bytes: number | null
      foto_ancho: number | null
      foto_alto: number | null
      fotos_ids: string[]
      assignee_id: string | null
      responsable: string | null
      due_date: string | null
      resolution_note: string | null
    }

    const where = `
        WHERE ($1::uuid IS NULL OR i.site_id = $1)
          AND f.captured_at >= COALESCE($2::timestamptz, '-infinity'::timestamptz)
          AND f.captured_at <= COALESCE($3::timestamptz, 'infinity'::timestamptz)
          AND ($4::text IS NULL OR f.severity = $4)
          AND ($5::text IS NULL OR f.status = $5)
          AND ($6::uuid IS NULL OR i.executed_by = $6)`
    const base = `
        FROM finding f
        LEFT JOIN inspection i ON i.id = f.inspection_id
        LEFT JOIN site s ON s.id = i.site_id
        LEFT JOIN app_user u ON u.id = i.executed_by
        LEFT JOIN app_user r ON r.id = f.assignee_id
        LEFT JOIN LATERAL (
          SELECT a2.id, a2.mime, a2.bytes, a2.width, a2.height
            FROM attachment a2
           WHERE a2.owner_type = 'finding' AND a2.owner_id = f.id
           ORDER BY a2.captured_at DESC LIMIT 1
        ) a ON true`

    const [rows, totalRows] = await Promise.all([
      this.db.queryAsTenant<Row>(
        tenantId,
        `SELECT f.id, f.severity, f.status, f.description,
                i.site_id AS faena_id, s.name AS faena_nombre,
                i.executed_by AS autor_id, u.full_name AS autor,
                (extract(epoch FROM f.captured_at) * 1000)::float8 AS captured_ms,
                (extract(epoch FROM i.synced_at) * 1000)::float8 AS synced_ms,
                a.id AS foto_id, a.mime AS foto_mime, a.bytes AS foto_bytes,
                a.width AS foto_ancho, a.height AS foto_alto,
                COALESCE((SELECT array_agg(a3.id ORDER BY a3.captured_at, a3.id) FROM attachment a3
                           WHERE a3.owner_type = 'finding' AND a3.owner_id = f.id), '{}') AS fotos_ids,
                f.assignee_id, r.full_name AS responsable,
                to_char(f.due_date, 'YYYY-MM-DD') AS due_date, f.resolution_note
         ${base}
         ${where}
         ORDER BY f.captured_at DESC
         LIMIT $7 OFFSET $8`,
        [siteId, desde, hasta, severidad, estado, autorId, f.limit, f.offset],
      ),
      this.db.queryAsTenant<{ n: number }>(
        tenantId,
        `SELECT count(*)::int AS n ${base} ${where}`,
        [siteId, desde, hasta, severidad, estado, autorId],
      ),
    ])

    const items: FindingDto[] = rows.map((r) => ({
      id: r.id,
      severity: r.severity as FindingDto['severity'],
      status: r.status as FindingDto['status'],
      description: r.description,
      faena_id: r.faena_id,
      faena_nombre: r.faena_nombre,
      autor_id: r.autor_id,
      autor: r.autor,
      captured_at: r.captured_ms == null ? '' : new Date(r.captured_ms).toISOString(),
      synced_at: r.synced_ms == null ? null : new Date(r.synced_ms).toISOString(),
      foto_id: r.foto_id,
      foto_mime: r.foto_mime,
      foto_bytes: r.foto_bytes,
      foto_ancho: r.foto_ancho,
      foto_alto: r.foto_alto,
      fotos_ids: r.fotos_ids ?? [],
      assignee_id: r.assignee_id,
      responsable: r.responsable,
      due_date: r.due_date,
      resolution_note: r.resolution_note,
    }))

    return { items, total: totalRows[0]?.n ?? 0 }
  }
}