import { Inject, Injectable } from '@nestjs/common'
import type { DashboardSupervision } from '@terreno/shared'
import type { JwtClaims } from '../auth/auth.types'
import { DbService } from '../db/db.service'
import { DASHBOARD_ROLES, exigirDashboard } from './dashboard.auth'
import { parsearFiltrosPeriodo } from './dashboard.contract'
import type { DashboardFiltros } from './dashboard.service'

/** Horas sin sincronizar a partir de las cuales un equipo se informa como inactivo. */
const HORAS_INACTIVO = 24
/** Zona horaria de la operación (Chile) para agrupar por día calendario. */
const ZONA = 'America/Santiago'

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))

/**
 * Dashboard de supervisión (TSK-REP-006). Cada consulta corre con RLS del
 * tenant y respeta el filtro de faena; el período aplica a lo que ocurrió en
 * él (actividad, cierres, lotes) y NO al backlog (abiertos, pendientes,
 * equipos inactivos), que se mide siempre "a hoy".
 */
@Injectable()
export class SupervisionDashboardService {
  constructor(@Inject(DbService) private readonly db: DbService) {}

  async obtener(u: JwtClaims, filtros: DashboardFiltros): Promise<DashboardSupervision> {
    exigirDashboard(u, DASHBOARD_ROLES)
    const t = u.tenant_id as string
    const { siteId, desde, hasta } = parsearFiltrosPeriodo(filtros)
    const periodo = [siteId, desde, hasta]
    const enPeriodo = (col: string) =>
      `${col} >= COALESCE($2::timestamptz, '-infinity') AND ${col} <= COALESCE($3::timestamptz, 'infinity')`
    const q = <R>(sql: string, params: unknown[] = periodo) => this.db.queryAsTenant<R>(t, sql, params)

    const [antig, criticos, cierre, topNok, revRes, revLista, porDia, porFaena, porTrab, espera, proc, equipos] =
      await Promise.all([
        q<{ a: number; b: number; c: number }>(
          `SELECT count(*) FILTER (WHERE now() - f.captured_at <= interval '1 day')::int AS a,
                  count(*) FILTER (WHERE now() - f.captured_at > interval '1 day'
                                     AND now() - f.captured_at <= interval '7 days')::int AS b,
                  count(*) FILTER (WHERE now() - f.captured_at > interval '7 days')::int AS c
             FROM finding f LEFT JOIN inspection i ON i.id = f.inspection_id
            WHERE f.status <> 'resolved' AND ($1::uuid IS NULL OR i.site_id = $1)`,
          [siteId],
        ),
        q<{ id: string; descripcion: string; severidad: string; faena_nombre: string | null; dias: number }>(
          `SELECT f.id, f.description AS descripcion, f.severity AS severidad, s.name AS faena_nombre,
                  floor(extract(epoch FROM now() - f.captured_at) / 86400)::int AS dias
             FROM finding f
             LEFT JOIN inspection i ON i.id = f.inspection_id
             LEFT JOIN site s ON s.id = i.site_id
            WHERE f.status <> 'resolved' AND f.severity IN ('high', 'critical')
              AND ($1::uuid IS NULL OR i.site_id = $1)
            ORDER BY (f.severity = 'critical') DESC, f.captured_at ASC
            LIMIT 10`,
          [siteId],
        ),
        q<{ media: number | null; p50: number | null; n: number }>(
          `SELECT avg(extract(epoch FROM f.resolved_at - f.captured_at) / 3600)::float8 AS media,
                  percentile_cont(0.5) WITHIN GROUP (
                    ORDER BY extract(epoch FROM f.resolved_at - f.captured_at) / 3600)::float8 AS p50,
                  count(*)::int AS n
             FROM finding f LEFT JOIN inspection i ON i.id = f.inspection_id
            WHERE f.resolved_at IS NOT NULL AND ($1::uuid IS NULL OR i.site_id = $1)
              AND ${enPeriodo('f.resolved_at')}`,
        ),
        q<{ template_item_id: string; prompt: string; plantilla: string | null; nok: number; respondidas: number }>(
          `SELECT r.template_item_id, ti.prompt, tp.name AS plantilla,
                  count(*) FILTER (WHERE r.value_ok = 'nok')::int AS nok,
                  count(*) FILTER (WHERE r.value_ok IS NOT NULL)::int AS respondidas
             FROM inspection_response r
             JOIN inspection i ON i.id = r.inspection_id
             JOIN template_item ti ON ti.id = r.template_item_id
             LEFT JOIN template tp ON tp.id = i.template_id
            WHERE ($1::uuid IS NULL OR i.site_id = $1) AND ${enPeriodo('i.captured_at')}
            GROUP BY r.template_item_id, ti.prompt, tp.name
           HAVING count(*) FILTER (WHERE r.value_ok = 'nok') > 0
            ORDER BY nok DESC, respondidas DESC
            LIMIT 5`,
        ),
        q<{ n: number; max: number | null; p50: number | null }>(
          `SELECT count(*)::int AS n,
                  max(extract(epoch FROM now() - COALESCE(synced_at, captured_at)) / 86400)::float8 AS max,
                  percentile_cont(0.5) WITHIN GROUP (
                    ORDER BY extract(epoch FROM now() - COALESCE(synced_at, captured_at)) / 86400)::float8 AS p50
             FROM inspection WHERE status = 'submitted' AND ($1::uuid IS NULL OR site_id = $1)`,
          [siteId],
        ),
        q<{ id: string; faena_nombre: string; plantilla: string | null; ejecutado_por: string; captured_at: string; dias: number }>(
          `SELECT i.id, s.name AS faena_nombre, tp.name AS plantilla, u.full_name AS ejecutado_por,
                  i.captured_at,
                  floor(extract(epoch FROM now() - COALESCE(i.synced_at, i.captured_at)) / 86400)::int AS dias
             FROM inspection i
             JOIN site s ON s.id = i.site_id
             JOIN app_user u ON u.id = i.executed_by
             LEFT JOIN template tp ON tp.id = i.template_id
            WHERE i.status = 'submitted' AND ($1::uuid IS NULL OR i.site_id = $1)
            ORDER BY COALESCE(i.synced_at, i.captured_at) ASC
            LIMIT 10`,
          [siteId],
        ),
        q<{ dia: string; n: number }>(
          `WITH rango AS (
             SELECT (COALESCE($2::timestamptz, now() - interval '6 days') AT TIME ZONE '${ZONA}')::date AS d0,
                    (COALESCE($3::timestamptz, now()) AT TIME ZONE '${ZONA}')::date AS d1
           ), dias AS (
             SELECT generate_series(d0, d1, interval '1 day')::date AS dia FROM rango
           )
           SELECT to_char(d.dia, 'YYYY-MM-DD') AS dia, count(i.id)::int AS n
             FROM dias d
             LEFT JOIN inspection i
               ON (i.captured_at AT TIME ZONE '${ZONA}')::date = d.dia
              AND ($1::uuid IS NULL OR i.site_id = $1)
            GROUP BY d.dia ORDER BY d.dia`,
        ),
        q<{ faena_id: string; faena_nombre: string; n: number }>(
          `SELECT s.id AS faena_id, s.name AS faena_nombre, count(i.id)::int AS n
             FROM site s
             LEFT JOIN inspection i ON i.site_id = s.id AND ${enPeriodo('i.captured_at')}
            WHERE ($1::uuid IS NULL OR s.id = $1)
            GROUP BY s.id, s.name ORDER BY n DESC, s.name`,
        ),
        q<{ usuario: string; n: number }>(
          `SELECT u.full_name AS usuario, count(*)::int AS n
             FROM inspection i JOIN app_user u ON u.id = i.executed_by
            WHERE ($1::uuid IS NULL OR i.site_id = $1) AND ${enPeriodo('i.captured_at')}
            GROUP BY u.full_name ORDER BY n DESC LIMIT 10`,
        ),
        q<{ p50: number | null; p95: number | null; n: number }>(
          `SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM client_sent_at - queued_at))::float8 AS p50,
                  percentile_cont(0.95) WITHIN GROUP (ORDER BY extract(epoch FROM client_sent_at - queued_at))::float8 AS p95,
                  count(*)::int AS n
             FROM inspection
            WHERE queued_at IS NOT NULL AND client_sent_at IS NOT NULL
              AND ($1::uuid IS NULL OR site_id = $1) AND ${enPeriodo('synced_at')}`,
        ),
        q<{ p95: number | null; n: number; err: number }>(
          `SELECT percentile_cont(0.95) WITHIN GROUP (ORDER BY extract(epoch FROM finished_at - started_at))::float8 AS p95,
                  count(*)::int AS n,
                  count(*) FILTER (WHERE status IN ('failed', 'partial'))::int AS err
             FROM sync_log
            WHERE status <> 'pending' AND finished_at IS NOT NULL AND started_at >= COALESCE($1::timestamptz, '-infinity') AND started_at <= COALESCE($2::timestamptz, 'infinity')`,
          [desde, hasta],
        ),
        q<{ device_id: string; usuario: string | null; ultima: string; horas: number }>(
          `SELECT DISTINCT ON (l.device_id) l.device_id, u.full_name AS usuario, l.finished_at AS ultima,
                  extract(epoch FROM now() - l.finished_at) / 3600 AS horas
             FROM sync_log l LEFT JOIN app_user u ON u.id = l.user_id
            WHERE l.finished_at IS NOT NULL AND l.finished_at >= now() - interval '30 days'
            ORDER BY l.device_id, l.finished_at DESC`,
          [],
        ),
      ])

    const a = antig[0] ?? { a: 0, b: 0, c: 0 }
    return {
      hallazgos: {
        abiertos_por_antiguedad: { hasta_1d: a.a, de_1_a_7d: a.b, mas_de_7d: a.c },
        criticos_abiertos: criticos.map((c) => ({
          id: c.id,
          descripcion: c.descripcion,
          severidad: c.severidad as DashboardSupervision['hallazgos']['criticos_abiertos'][number]['severidad'],
          faena_nombre: c.faena_nombre,
          dias_abierto: c.dias,
        })),
        cierre_horas_media: num(cierre[0]?.media),
        cierre_horas_p50: num(cierre[0]?.p50),
        resueltos_periodo: cierre[0]?.n ?? 0,
        top_nok: topNok,
      },
      revision: {
        pendientes: revRes[0]?.n ?? 0,
        dias_mas_antigua: num(revRes[0]?.max),
        dias_mediana: num(revRes[0]?.p50),
        mas_antiguas: revLista.map((r) => ({
          id: r.id,
          faena_nombre: r.faena_nombre,
          plantilla: r.plantilla,
          ejecutado_por: r.ejecutado_por,
          captured_at: new Date(r.captured_at).toISOString(),
          dias_esperando: r.dias,
        })),
      },
      actividad: {
        por_dia: porDia.map((d) => ({ dia: d.dia, inspecciones: d.n })),
        por_faena: porFaena.map((f) => ({ faena_id: f.faena_id, faena_nombre: f.faena_nombre, inspecciones: f.n })),
        por_trabajador: porTrab.map((w) => ({ usuario: w.usuario, inspecciones: w.n })),
        faenas_sin_actividad: porFaena.filter((f) => f.n === 0).length,
      },
      sincronizacion: {
        espera_sin_senal_p50_seg: num(espera[0]?.p50),
        espera_sin_senal_p95_seg: num(espera[0]?.p95),
        muestras_espera: espera[0]?.n ?? 0,
        procesamiento_p95_seg: num(proc[0]?.p95),
        lotes: proc[0]?.n ?? 0,
        lotes_con_error: proc[0]?.err ?? 0,
        equipos_inactivos: equipos
          .filter((e) => Number(e.horas) >= HORAS_INACTIVO)
          .map((e) => ({
            device_id: e.device_id,
            usuario: e.usuario,
            ultima_sync: new Date(e.ultima).toISOString(),
            horas_sin_sync: Math.floor(Number(e.horas)),
          })),
        equipos_activos_30d: equipos.length,
      },
    }
  }
}
