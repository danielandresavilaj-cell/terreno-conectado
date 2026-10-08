import { Controller, Get, Res } from '@nestjs/common'
import type { Response } from 'express'
import { HealthService } from './health.service'
import type { HealthResponse } from './health.types'

/**
 * `GET /health` (FR-052) — fuera del prefijo `/api/v1` (ver app.setup) para
 * que un uptime monitor externo lo consuma sin ruta de API.
 *
 * Códigos intencionales para el monitor:
 *  - 200 si el proceso responde Y la DB está arriba → `status: 'ok'`
 *  - 503 si la DB está caída → `status: 'degraded'`
 */
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  async read(@Res({ passthrough: true }) res: Response): Promise<HealthResponse> {
    const result = await this.health.read()
    res.status(result.ok ? 200 : 503)
    return result.body
  }
}