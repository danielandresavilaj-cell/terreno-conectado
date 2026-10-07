/**
 * `POST /api/v1/sync/batch` — ingesta idempotente por lotes (TSK-WS-007, FR-020).
 *
 * Autenticación: Bearer JWT (AuthGuard) — el tenant se toma SIEMPRE de las
 * claims, nunca del body. El 200 es el código de éxito: el desenlace
 * ok|partial|failed viaja en el cuerpo (FR-021), `409` sólo para cruce de
 * tenant previo a escritura (FR-025).
 */

import { Body, Controller, HttpCode, Inject, Post, Req, UseGuards } from '@nestjs/common'
import type { Request } from 'express'
import { AuthGuard } from '../auth/auth.guard'
import type { JwtClaims } from '../auth/auth.types'
import { SyncService } from './sync.service'
import type { SyncBatchRequest, SyncBatchResponse } from './sync.types'

type AuthedRequest = Request & { user?: JwtClaims }

@Controller('sync')
export class SyncController {
  constructor(@Inject(SyncService) private readonly sync: SyncService) {}

  @UseGuards(AuthGuard)
  @Post('batch')
  @HttpCode(200)
  async batch(
    @Req() req: AuthedRequest,
    @Body() body: SyncBatchRequest,
  ): Promise<SyncBatchResponse> {
    return this.sync.batch(req.user as JwtClaims, body)
  }
}