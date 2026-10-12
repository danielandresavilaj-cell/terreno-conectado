/**
 * Endpoints de lectura del dashboard del supervisor (spec 005, TSK-WS-011) y de
 * la exportación de inspecciones (TSK-FORM-010, FR-044).
 *
 *  · `GET /api/v1/dashboard/summary`  — métricas agregadas (FR-035/040/043)
 *  · `GET /api/v1/dashboard/findings` — detalle de hallazgos (FR-040)
 *  · `GET /api/v1/dashboard/inspections` — inspecciones del período (FR-044)
 *  · `GET /api/v1/dashboard/inspections/:id/export` — el `.xlsx` original
 *    rellenado + hoja "Evidencias" (FR-019/044)
 *  · `GET /api/v1/sites`              — faenas/obras del tenant (FR-006)
 *
 * Sólo lecturas: el dashboard NUNCA escribe (el flujo es Captura → Sync →
 * Dashboard; el app Web es un visor).
 */

import { Controller, Get, Inject, Param, Query, Req, Res, StreamableFile, UseGuards } from '@nestjs/common'
import type { Request, Response } from 'express'
import { XLSX_MIME } from '@terreno/shared'
import { AuthGuard } from '../auth/auth.guard'
import type { JwtClaims } from '../auth/auth.types'
import { contentDisposition } from '../http/content-disposition'
import { DashboardService } from './dashboard.service'
import { InspectionExportService } from './inspection-export.service'
import { exigirUuid, type InspectionsResponse } from './dashboard.contract'
import type {
  DashboardFindingsResponse,
  DashboardSummary,
  SitesResponse,
} from './dashboard.types'

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
}