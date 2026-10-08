import { Injectable } from '@nestjs/common'
import { appVersion } from '../app.version'
import { DbService } from '../db/db.service'

export type HealthStatus = 'ok' | 'degraded'
export type DbState = 'up' | 'down'

export interface HealthReport {
  status: HealthStatus
  uptime_s: number
  version: string
  db: DbState
}

/**
 * GET /health (FR-052): uptime del proceso, version de la aplicacion y estado
 * de la conexion a PostgreSQL. El monitor de uptime (research.md §6 - Uptime
 * Kuma/Betterstack free) usa el 503 para alertar (NFR-09).
 */
@Injectable()
export class HealthService {
  constructor(private readonly db: DbService) {}

  async check(): Promise<HealthReport> {
    let db: DbState = 'up'
    try {
      await this.db.ping()
    } catch {
      db = 'down'
    }

    return {
      status: db === 'up' ? 'ok' : 'degraded',
      uptime_s: Math.round(process.uptime() * 100) / 100,
      version: appVersion(),
      db,
    }
  }
}