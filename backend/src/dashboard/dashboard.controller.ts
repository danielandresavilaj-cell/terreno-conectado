/**
 * Endpoints de lectura del dashboard del supervisor (spec 005, TSK-WS-011).
 *
 *  · `GET /api/v1/dashboard/summary`  — métricas agregadas (FR-035/040/043)
 *  · `GET /api/v1/dashboard/findings` — detalle de hallazgos (FR-040)
 *  · `GET /api/v1/sites`              — faenas/obras del tenant (FR-006)
 *
 * Sólo lecturas: el dashboard NUNCA escribe (el flujo es Captura → Sync →
 * Dashboard; el app Web es un visor).
 */

import { Controller, Get, Inject, Query, Req, UseGuards } from '@nestjs/common'
import type { Request } from 'express'
import { AuthGuard } from '../auth/auth.guard'
import type { JwtClaims } from '../auth/auth.types'
import { DashboardService } from './dashboard.service'
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
  constructor(@Inject(DashboardService) private readonly dashboard: DashboardService) {}

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
}