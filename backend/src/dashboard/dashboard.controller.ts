/**
 * Endpoints de lectura del dashboard del supervisor (spec 005, TSK-WS-011) y de
 * la exportación de inspecciones (TSK-FORM-010, FR-044/045/046/047).
 *
 *  · `GET /api/v1/dashboard/summary`  — métricas agregadas (FR-035/040/043)
 *  · `GET /api/v1/dashboard/findings` — detalle de hallazgos (FR-040)
 *  · `GET /api/v1/dashboard/inspections` — inspecciones del período (FR-044)
 *  · `GET /api/v1/dashboard/inspections/:id/export` — el `.xlsx` original
 *    rellenado + hoja "Evidencias" (FR-019/044)
 *  · `POST /api/v1/dashboard/inspections/export-lote` — ZIP con un `.xlsx` por
 *    inspección del período + manifiesto (FR-045/046) y auditoría del lote
 *    (FR-047)
 *  · `GET /api/v1/sites`              — faenas/obras del tenant (FR-006)
 *
 * El dashboard no escribe datos de negocio (el flujo es Captura → Sync →
 * Dashboard; el app Web es un visor). La ÚNICA escritura del módulo es la fila
 * de `audit_log` del lote (FR-047), que es un log append-only y no altera
 * ninguna inspección.
 */

import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common'
import type { Request, Response } from 'express'
import {
  XLSX_MIME,
  type DashboardFindingsResponse,
  type DashboardSummary,
  type SitesResponse,
} from '@terreno/shared'
import { AuthGuard } from '../auth/auth.guard'
import type { JwtClaims } from '../auth/auth.types'
import { contentDisposition } from '../http/content-disposition'
import { DashboardService } from './dashboard.service'
import {
  InspectionExportLoteService,
  ZIP_MIME,
} from './inspection-export-lote.service'
import { InspectionExportService } from './inspection-export.service'
import { exigirUuid, type InspectionsResponse } from './dashboard.contract'

type AuthedRequest = Request & { user?: JwtClaims }

function s(v: unknown): string | null {
  if (typeof v !== 'string' || v === '') return null
  return v
}

function int(v: unknown, d: number, max = 200): number {
  const n = Number(v)
  if (!Number.isFinite(n) || n < 0) return d
  return Math.min(Math.floor(n), max)
}

@Controller()
export class DashboardController {
  constructor(
    @Inject(DashboardService) private readonly dashboard: DashboardService,
    @Inject(InspectionExportService) private readonly exportacion: InspectionExportService,
    @Inject(InspectionExportLoteService) private readonly lote: InspectionExportLoteService,
  ) {}

  @UseGuards(AuthGuard)
  @Get('dashboard/summary')
  summary(@Req() req: AuthedRequest, @Query() q: Record<string, unknown>): Promise<DashboardSummary> {
    return this.dashboard.summary(req.user as JwtClaims, {
      site_id: s(q.site_id),
      desde: s(q.desde),
      hasta: s(q.hasta),
    })
  }

  @UseGuards(AuthGuard)
  @Get('dashboard/findings')
  findings(@Req() req: AuthedRequest, @Query() q: Record<string, unknown>): Promise<DashboardFindingsResponse> {
    return this.dashboard.findings(req.user as JwtClaims, {
      site_id: s(q.site_id),
      desde: s(q.desde),
      hasta: s(q.hasta),
      severidad: s(q.severidad),
      estado: s(q.estado),
      autor_id: s(q.autor_id),
      limit: int(q.limit, 50),
      offset: int(q.offset, 0),
    })
  }

  @UseGuards(AuthGuard)
  @Get('sites')
  sites(@Req() req: AuthedRequest): Promise<SitesResponse> {
    return this.dashboard.listSites(req.user as JwtClaims)
  }

  /* --------------------------------------------- inspecciones (TSK-FORM-010) */

  @UseGuards(AuthGuard)
  @Get('dashboard/inspections')
  inspections(
    @Req() req: AuthedRequest,
    @Query() q: Record<string, unknown>,
  ): Promise<InspectionsResponse> {
    return this.exportacion.listar(req.user as JwtClaims, {
      site_id: s(q.site_id),
      desde: s(q.desde),
      hasta: s(q.hasta),
    })
  }

  /**
   * El `.xlsx` original rellenado con las respuestas de la inspección, más la
   * hoja "Evidencias" (FR-019/044). Se sirve como binario con
   * `Content-Disposition` para que el navegador lo guarde con el nombre del
   * documento, no como "download".
   */
  @UseGuards(AuthGuard)
  @Get('dashboard/inspections/:id/export')
  async exportInspection(
    @Req() req: AuthedRequest,
    @Res({ passthrough: true }) res: Response,
    @Param('id') id: string,
  ): Promise<StreamableFile> {
    const archivo = await this.exportacion.exportar(req.user as JwtClaims, exigirUuid(id, 'inspección'))
    res.setHeader('Content-Type', XLSX_MIME)
    res.setHeader('Content-Disposition', contentDisposition(archivo.fileName))
    return new StreamableFile(Buffer.from(archivo.libro))
  }

  /**
   * El mismo `.xlsx` de cada inspección del período, empaquetado en un ZIP
   * (FR-045/046).
   *
   * Va en POST y no en GET porque el filtro viaja en el body: es exactamente el
   * mismo `dashboardFiltrosSchema` que la tabla del período, así que el cliente
   * reutiliza el formulario sin traducir nada y no se abre un segundo contrato
   * de filtros que pueda divergir del primero.
   *
   * Las cabeceras de recuento son para la UI, que necesita avisar "3 de 4 se
   * exportaron" sin abrir el ZIP que el navegador ya se está descargando; el
   * detalle de los motivos viaja en el manifiesto, dentro del propio archivo.
   */
  @UseGuards(AuthGuard)
  @Post('dashboard/inspections/export-lote')
  // Un POST devuelve 201 por defecto, que aquí sería mentir: no se creó ningún
  // recurso, se entregó un archivo. 200 es lo que espera un cliente que
  // descarga, y lo que hace que un `fetch` no crea un recurso que luego espera
  // poder volver a pedir por id.
  @HttpCode(200)
  async exportLote(
    @Req() req: AuthedRequest,
    @Res({ passthrough: true }) res: Response,
    @Body() body: Record<string, unknown>,
  ): Promise<StreamableFile> {
    const lote = await this.lote.exportarLote(req.user as JwtClaims, body)
    res.setHeader('Content-Type', ZIP_MIME)
    res.setHeader('Content-Disposition', contentDisposition(lote.fileName))
    res.setHeader('X-Lote-Id', lote.loteId)
    res.setHeader('X-Lote-Exportadas', String(lote.exportadas))
    res.setHeader('X-Lote-Fallidas', String(lote.fallidas))
    return new StreamableFile(lote.zip)
  }
}