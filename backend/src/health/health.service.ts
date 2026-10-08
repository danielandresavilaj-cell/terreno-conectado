import { Inject, Injectable } from '@nestjs/common'
import { DbService } from '../db/db.service'
import { APP_VERSION } from '../version'
import type { HealthResult, HealthResponse } from './health.types'

/**
 * Estado de salud del proceso (FR-052): uptime, versión de la app y
 * conectividad a PostgreSQL. Sin dependencias de negocio; es el único
 * endpoint público del backend (no exige sesión).
 */
@Injectable()
export class HealthService {
  constructor(@Inject(DbService) private readonly db: DbService) {}

  async read(): Promise<HealthResult> {
    const dbUp = await this.db.ping()
    const body: HealthResponse = {
      status: dbUp ? 'ok' : 'degraded',
      uptime_s: Math.floor(process.uptime()),
      version: APP_VERSION,
      db: dbUp ? 'up' : 'down',
    }
    return { ok: dbUp, body }
  }
}