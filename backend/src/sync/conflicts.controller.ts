/**
 * `GET /api/v1/conflicts` — lectura de conflictos LWW para supervisor/admin
 * (FR-023, lo consume el dashboard en TSK-WS-011). Los conflictos son
 * append-only: esta ruta sólo lee, nunca modifica.
 */

import { Controller, Get, Inject, Query, Req, UseGuards } from '@nestjs/common'
import type { Request } from 'express'
import { AuthGuard } from '../auth/auth.guard'
import type { JwtClaims } from '../auth/auth.types'
import { SyncService } from './sync.service'
import type { ListConflictsResponse } from './sync.types'

type AuthedRequest = Request & { user?: JwtClaims }

@Controller('conflicts')
export class ConflictsController {
  constructor(@Inject(SyncService) private readonly sync: SyncService) {}

  @UseGuards(AuthGuard)
  @Get()
  async list(
    @Req() req: AuthedRequest,
    @Query() q: Record<string, unknown>,
  ): Promise<ListConflictsResponse> {
    const num = (v: unknown): number | undefined => {
      if (v === undefined) return undefined
      const n = Number(v)
      return Number.isFinite(n) && n >= 0 ? n : undefined
    }
    return this.sync.listConflicts(req.user as JwtClaims, {
      limit: num(q.limit),
      offset: num(q.offset),
    })
  }
}