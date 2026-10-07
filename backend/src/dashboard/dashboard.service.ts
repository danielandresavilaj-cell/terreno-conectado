/**
 * Lecturas del dashboard mínimo del supervisor (spec 005, TSK-WS-011).
 *
 * Nada de esto escribe: es el consumo read-only de lo syncronizado, con RLS
 * por tenant (Artículo IV) y roles supervisor/tenant_admin. La latencia se
 * mide con `inspection.synced_at - captured_at` (FR-040/NFR-03): el server
 * fija `synced_at = now()` al aplicar la ingesta (sync.service).
 *
 * Alcance reducido contractual: sin queries materializadas ni percentiles por
 * lote (eso es del módulo 005, semanas 9-12).
 */

import { BadRequestException, ForbiddenException, Inject, Injectable } from '@nestjs/common'
import { DbService } from '../db/db.service'
import type { JwtClaims } from '../auth/auth.types'
import type {
  DashboardFindingsResponse,
  DashboardSummary,
  FindingDto,
  SiteDto,
  SitesResponse,
} from './dashboard.types'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DASHBOARD_ROLES = ['supervisor', 'tenant_admin'] as const

export interface DashboardFiltros {
  site_id?: string | null
  desde?: string | null
  hasta?: string | null
}

export interface FindingsFiltros extends DashboardFiltros {
  severidad?: string | null
  estado?: string | null
  limit: number
  offset: number
}

/** Valida `site_id`/rango y devuelve parámetros listos para el SQL. */
function normalizeFiltro(f: DashboardFiltros): { siteId: string | null; desde: string | null; hasta: string | null } {
  if (f.site_id !== undefined && f.site_id !== null && f.site_id !== '' && !UUID_RE.test(f.site_id)) {
    throw new BadRequestException('faena inválida')
  }
  for (const [k, v] of [
    ['desde', f.desde],
    ['hasta', f.hasta],
  ] as const) {
    if (v !== undefined && v !== null && v !== '' && Number.isNaN(Date.parse(v))) {
      throw new BadRequestException(`${k} inválido`)
    }
  }
  return {
    siteId: f.site_id || null,
    desde: f.desde ? new Date(f.desde).toISOString() : null,
    hasta: f.hasta ? new Date(f.hasta).toISOString() : null,
  }
}

@Injectable()
export class DashboardService {
  constructor(@Inject(DbService) private readonly db: DbService) {}

  /** El que autoriza es el rol + tener tenant: field_worker no ve el dashboard. */
  private exigir(u: JwtClaims, roles: readonly string[] = DASHBOARD_ROLES): void {
    if (!u.tenant_id) throw new ForbiddenException('Requerido un tenant')
    if (!roles.includes(u.rol)) throw new ForbiddenException('Rol no autorizado')
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

    const [estados, porSev, latencia, sincronizaciones, conflictos, urgentes] = await Promise.all([
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
      this.db.queryAsTenant<{ media: number | null; p95: number | null }>(
        tenantId,
        `SELECT avg(extract(epoch FROM (synced_at - captured_at)))::float8 AS media,
                percentile_cont(0.95) WITHIN GROUP (
                  ORDER BY extract(epoch FROM (synced_at - captured_at)))::float8 AS p95
           FROM inspection
          WHERE synced_at IS NOT NULL
            AND ($1::uuid IS NULL OR site_id = $1)
            AND captured_at >= COALESCE($2::timestamptz, '-infinity'::timestamptz)
            AND captured_at <= COALESCE($3::timestamptz, 'infinity'::timestamptz)`,
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
          WHERE resolved_at >= COALESCE($1::timestamptz, '-infinity'::timestamptz)
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
      inspecciones_por_estado: porEstado,
      hallazgos_por_severidad: porSeveridad,
      hallazgos_urgentes: urgentes[0]?.n ?? 0,
      hallazgos_total: totalHallazgos,
      latencia_media_seg: latencia[0]?.media ?? null,
      latencia_p95_seg: latencia[0]?.p95 ?? null,
      conflictos_pendientes: conflictos[0]?.n ?? 0,
      sincronizaciones: sincronizaciones[0]?.n ?? 0,
    }
  }

  /* ------------------------------------------------------------ findings */

  async findings(u: JwtClaims, f: FindingsFiltros): Promise<DashboardFindingsResponse> {
    this.exigir(u)
    const tenantId = u.tenant_id as string
    const { siteId, desde, hasta } = normalizeFiltro(f)
    const severidad = f.severidad || null
    const estado = f.estado || null

    interface Row {
      id: string
      severity: string
      status: string
      description: string
      faena_id: string | null
      faena_nombre: string | null
      autor: string | null
      captured_ms: number | null
      synced_ms: number | null
      foto_id: string | null
      foto_mime: string | null
      foto_bytes: number | null
      foto_ancho: number | null
      foto_alto: number | null
    }

    const where = `
        WHERE ($1::uuid IS NULL OR i.site_id = $1)
          AND f.captured_at >= COALESCE($2::timestamptz, '-infinity'::timestamptz)
          AND f.captured_at <= COALESCE($3::timestamptz, 'infinity'::timestamptz)
          AND ($4::text IS NULL OR f.severity = $4)
          AND ($5::text IS NULL OR f.status = $5)`
    const base = `
        FROM finding f
        LEFT JOIN inspection i ON i.id = f.inspection_id
        LEFT JOIN site s ON s.id = i.site_id
        LEFT JOIN app_user u ON u.id = i.executed_by
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
                u.full_name AS autor,
                (extract(epoch FROM f.captured_at) * 1000)::float8 AS captured_ms,
                (extract(epoch FROM i.synced_at) * 1000)::float8 AS synced_ms,
                a.id AS foto_id, a.mime AS foto_mime, a.bytes AS foto_bytes,
                a.width AS foto_ancho, a.height AS foto_alto
         ${base}
         ${where}
         ORDER BY f.captured_at DESC
         LIMIT $6 OFFSET $7`,
        [siteId, desde, hasta, severidad, estado, f.limit, f.offset],
      ),
      this.db.queryAsTenant<{ n: number }>(
        tenantId,
        `SELECT count(*)::int AS n ${base} ${where}`,
        [siteId, desde, hasta, severidad, estado],
      ),
    ])

    const items: FindingDto[] = rows.map((r) => ({
      id: r.id,
      severity: r.severity as FindingDto['severity'],
      status: r.status as FindingDto['status'],
      description: r.description,
      faena_id: r.faena_id,
      faena_nombre: r.faena_nombre,
      autor: r.autor,
      captured_at: r.captured_ms == null ? '' : new Date(r.captured_ms).toISOString(),
      synced_at: r.synced_ms == null ? null : new Date(r.synced_ms).toISOString(),
      foto_id: r.foto_id,
      foto_mime: r.foto_mime,
      foto_bytes: r.foto_bytes,
      foto_ancho: r.foto_ancho,
      foto_alto: r.foto_alto,
    }))

    return { items, total: totalRows[0]?.n ?? 0 }
  }
}