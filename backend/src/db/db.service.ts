import type { OnModuleDestroy } from '@nestjs/common'
import { Inject, Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Pool } from 'pg'

/**
 * DS que abstrae las dos rutas de acceso a PostgreSQL (ver DbModule).
 *
 * queryAsTenant ejecuta dentro de una transacción que fija
 * `app.tenant_id` (SET LOCAL): al hacer COMMIT/ROLLBACK el rol no "contamina"
 * la conexión al volver al pool. Sin `app.tenant_id` la política RLS devuelve
 * 0 filas (deny por defecto).
 */
@Injectable()
export class DbService implements OnModuleDestroy {
  private readonly owner: Pool
  private readonly app: Pool

  constructor(@Inject(ConfigService) config: ConfigService) {
    this.owner = new Pool({
      connectionString: config.getOrThrow<string>('DATABASE_URL'),
      max: 10,
    })
    this.app = new Pool({
      connectionString: config.getOrThrow<string>('APP_DATABASE_URL'),
      max: 10,
    })
  }

  async queryOwner<T = Record<string, unknown>>(
    sql: string,
    params: unknown[] = [],
  ): Promise<T[]> {
    const result = await this.owner.query(sql, params)
    return result.rows as T[]
  }

  async queryAsTenant<T = Record<string, unknown>>(
    tenantId: string,
    sql: string,
    params: unknown[] = [],
  ): Promise<T[]> {
    const client = await this.app.connect()
    try {
      await client.query('BEGIN')
      await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId])
      const result = await client.query(sql, params)
      await client.query('COMMIT')
      return result.rows as T[]
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([this.owner.end(), this.app.end()])
  }
}