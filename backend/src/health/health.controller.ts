import { Controller, Get, ServiceUnavailableException } from '@nestjs/common'
import { HealthService, type HealthReport } from './health.service'

/**
 * GET /health — publico y fuera del prefijo /api/v1 (lo consume el monitor de
 * uptime, sin auth). 200 con db up; 503 con db down (FR-052).
 */
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  async check(): Promise<HealthReport> {
    const report = await this.health.check()
    if (report.db === 'down') {
      throw new ServiceUnavailableException(report)
    }
    return report
  }
}