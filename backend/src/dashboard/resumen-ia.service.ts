/**
 * Resumen de Gerencia con IA — reglas de uso (TSK-REP-014, FR-068, Enmienda 009).
 *
 * · Sólo supervisión y administración (roles del dashboard), con RLS: las
 *   cifras salen de `DashboardService.summary` con la conexión del tenant y los
 *   resúmenes se leen y escriben en `resumen_ia` con la misma conexión.
 * · Cada resumen redactado se GUARDA (migración 024). Para un filtro (faena +
 *   días del período) se muestra el último guardado sin llamar a la IA:
 *     - si las cifras de hoy son las mismas, pedirlo de nuevo lo devuelve tal
 *       cual (no llama a la API ni cuenta para el tope);
 *     - si cambiaron, se muestra marcado "desactualizado" y se puede actualizar,
 *       lo que agrega una fila nueva (las anteriores quedan como historial).
 * · Tope diario por empresa (`IA_TOPE_RESUMEN_DIARIO`, 20 por omisión),
 *   contado en `audit_log`; separado del tope del import (ADR-005, Enmienda 1).
 * · No escribe datos de negocio: sólo `resumen_ia` y `audit_log`.
 */
import { randomUUID } from 'node:crypto'
import {
  BadGatewayException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common'
import type { ConsultaResumenIA, EstadoResumenIA, HistorialResumenIA, ResumenIA, ResumenIASalida } from '@terreno/shared'
import type { JwtClaims } from '../auth/auth.types'
import { DbService } from '../db/db.service'
import { exigirDashboard } from './dashboard.auth'
import { parsearFiltrosPeriodo, type FiltrosPeriodo } from './dashboard.contract'
import { DashboardService, type DashboardFiltros } from './dashboard.service'
import { alcanceResumen, datosParaResumen, huellaCifras, periodoCerrado, type DatosResumen } from './resumen-ia.datos'
import { REDACTOR_RESUMEN, type RedactorResumen } from './resumen-ia'

const TODAS = 'Todas las faenas'
const HISTORIAL_MAX = 20

export function topeDiarioResumen(): number {
  const n = Number(process.env.IA_TOPE_RESUMEN_DIARIO)
  return Number.isInteger(n) && n >= 0 ? n : 20
}

interface FilaResumen {
  id: string
  site_id: string | null
  faena: string | null
  desde: Date | string | null
  hasta: Date | string | null
  cerrado: boolean
  cifras_hash: string
  contenido: ResumenIASalida
  modelo: string
  generado_en: Date | string
}

/** Lo que hace falta del filtro actual para buscar, comparar o redactar. */
interface Contexto {
  tenantId: string
  periodo: FiltrosPeriodo
  alcance: string
  cerrado: boolean
  datos: DatosResumen
  huella: string
}

const iso = (v: Date | string | null): string | null => (v === null ? null : new Date(v).toISOString())

const COLUMNAS = `r.id, r.site_id, s.name AS faena, r.desde, r.hasta, r.cerrado, r.cifras_hash,
                  r.contenido, r.modelo, r.generado_en`

@Injectable()
export class ResumenIAService {
  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(DashboardService) private readonly dashboard: DashboardService,
    @Inject(REDACTOR_RESUMEN) private readonly redactor: RedactorResumen,
  ) {}

  /** Estado de la IA y el último resumen guardado del filtro. No llama a la IA. */
  async consultar(u: JwtClaims, filtros: DashboardFiltros): Promise<ConsultaResumenIA> {
    exigirDashboard(u)
    const ctx = await this.contexto(u, filtros)
    const fila = await this.ultimo(ctx)
    return {
      ...(await this.estado(ctx.tenantId)),
      guardado: fila ? this.aDto(fila, { desde_cache: true, desactualizado: fila.cifras_hash !== ctx.huella }) : null,
    }
  }

  /** Devuelve el guardado si las cifras no cambiaron; si no, redacta uno nuevo y lo guarda. */
  async generar(u: JwtClaims, filtros: DashboardFiltros): Promise<ResumenIA> {
    exigirDashboard(u)
    if (!this.redactor.disponible()) throw new ServiceUnavailableException('La IA no está configurada en este servidor.')
    const ctx = await this.contexto(u, filtros)

    const fila = await this.ultimo(ctx)
    if (fila && fila.cifras_hash === ctx.huella) return this.aDto(fila, { desde_cache: true, desactualizado: false })

    const tope = topeDiarioResumen()
    if ((await this.usosHoy(ctx.tenantId)) >= tope) {
      throw new HttpException(
        `Se alcanzó el máximo de ${tope} resúmenes con IA de hoy. Mañana se renueva; las cifras del panel siguen disponibles.`,
        HttpStatus.TOO_MANY_REQUESTS,
      )
    }

    const r = await this.redactor.redactar(ctx.datos)
    const id = randomUUID()
    await this.db.withTenantTransaction(ctx.tenantId, async (run) => {
      await run(
        `INSERT INTO audit_log (id, actor_id, tenant_id, action, entity_type, entity_id, payload)
         VALUES ($1, $2, $3, 'dashboard_resumen_ia', 'resumen_ia', $4, $5)`,
        [
          randomUUID(),
          u.sub,
          ctx.tenantId,
          r.ok ? id : null,
          JSON.stringify({
            alcance: ctx.alcance,
            modelo: r.modelo,
            tokens_entrada: r.tokens_entrada,
            tokens_salida: r.tokens_salida,
            ok: r.ok,
          }),
        ],
      )
      if (!r.ok) return
      await run(
        `INSERT INTO resumen_ia (id, tenant_id, site_id, alcance, desde, hasta, cerrado, cifras_hash,
                                 contenido, modelo, tokens_entrada, tokens_salida, generado_por)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          id,
          ctx.tenantId,
          ctx.periodo.siteId,
          ctx.alcance,
          ctx.periodo.desde,
          ctx.periodo.hasta,
          ctx.cerrado,
          ctx.huella,
          JSON.stringify(r.salida),
          r.modelo,
          r.tokens_entrada,
          r.tokens_salida,
          u.sub,
        ],
      )
    })
    if (!r.ok) throw new BadGatewayException(r.error)

    return {
      ...r.salida,
      id,
      modelo: r.modelo,
      generado_en: new Date().toISOString(),
      faena: ctx.periodo.siteId ? ctx.datos.faena : TODAS,
      desde: ctx.periodo.desde,
      hasta: ctx.periodo.hasta,
      cerrado: ctx.cerrado,
      desde_cache: false,
      desactualizado: false,
    }
  }

  /** Los últimos resúmenes guardados, de una faena o de todas. No llama a la IA. */
  async historial(u: JwtClaims, siteId: string | null): Promise<HistorialResumenIA> {
    exigirDashboard(u)
    const tenantId = u.tenant_id as string
    const { siteId: faena } = parsearFiltrosPeriodo({ site_id: siteId })
    const filas = await this.db.queryAsTenant<FilaResumen>(
      tenantId,
      `SELECT ${COLUMNAS}
         FROM resumen_ia r
         LEFT JOIN site s ON s.id = r.site_id
        WHERE ($1::uuid IS NULL OR r.site_id = $1)
        ORDER BY r.generado_en DESC
        LIMIT ${HISTORIAL_MAX}`,
      [faena],
    )
    return { items: filas.map((f) => this.aDto(f, { desde_cache: true, desactualizado: false })) }
  }

  private async estado(tenantId: string): Promise<EstadoResumenIA> {
    const tope = topeDiarioResumen()
    if (!this.redactor.disponible()) return { disponible: false, restantes_hoy: 0, tope_diario: tope }
    return { disponible: true, restantes_hoy: Math.max(0, tope - (await this.usosHoy(tenantId))), tope_diario: tope }
  }

  private async contexto(u: JwtClaims, filtros: DashboardFiltros): Promise<Contexto> {
    const tenantId = u.tenant_id as string
    const periodo = parsearFiltrosPeriodo(filtros)
    const cerrado = periodoCerrado(periodo)
    const datos = datosParaResumen(await this.dashboard.summary(u, filtros), periodo, cerrado)
    return { tenantId, periodo, alcance: alcanceResumen(periodo), cerrado, datos, huella: huellaCifras(tenantId, datos) }
  }

  private async ultimo(ctx: Contexto): Promise<FilaResumen | null> {
    const [fila] = await this.db.queryAsTenant<FilaResumen>(
      ctx.tenantId,
      `SELECT ${COLUMNAS}
         FROM resumen_ia r
         LEFT JOIN site s ON s.id = r.site_id
        WHERE r.alcance = $1
        ORDER BY r.generado_en DESC
        LIMIT 1`,
      [ctx.alcance],
    )
    return fila ?? null
  }

  private aDto(f: FilaResumen, marcas: { desde_cache: boolean; desactualizado: boolean }): ResumenIA {
    return {
      titular: f.contenido.titular,
      puntos: f.contenido.puntos,
      atencion: f.contenido.atencion,
      id: f.id,
      modelo: f.modelo,
      generado_en: iso(f.generado_en) as string,
      faena: f.site_id ? (f.faena ?? 'Faena') : TODAS,
      desde: iso(f.desde),
      hasta: iso(f.hasta),
      cerrado: f.cerrado,
      ...marcas,
    }
  }

  private async usosHoy(tenantId: string): Promise<number> {
    const [fila] = await this.db.queryAsTenant<{ n: number }>(
      tenantId,
      `SELECT count(*)::int AS n FROM audit_log
        WHERE tenant_id = $1 AND action = 'dashboard_resumen_ia'
          AND occurred_at > now() - interval '24 hours'`,
      [tenantId],
    )
    return fila?.n ?? 0
  }
}
