import 'reflect-metadata'
import { resolve } from 'node:path'
import { PostgreSqlContainer } from '@testcontainers/postgresql'
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { Pool } from 'pg'
import { runner } from 'node-pg-migrate'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppModule } from '../src/app.module'
import { configureApp } from '../src/app.setup'
import { DbService } from '../src/db/db.service'
import { HealthModule } from '../src/health/health.module'

/**
 * TSK-WS-012 — `GET /health` (FR-052).
 *
 *  - `/health` responde 200 con estado de DB verificado (ping real a
 *    PostgreSQL) y fuera del prefijo `/api/v1` (lo consume un uptime monitor
 *    sin ruta de API).
 *  - Con la DB caída (ping → false) responde 503 con `db: 'down'`.
 *  - Shape: status / uptime_s / version / db.
 */

const MIGRATIONS_DIR = resolve(process.cwd(), 'db', 'migrations')

let container: StartedPostgreSqlContainer
let ownerPool: Pool
let app: INestApplication

const server = () => request(app.getHttpServer())

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('terreno')
    .start()
  const url = container.getConnectionUri()
  await runner({
    databaseUrl: url,
    dir: MIGRATIONS_DIR,
    direction: 'up',
    migrationsTable: 'pgmigrations',
  })

  ownerPool = new Pool({ connectionString: url })
  await ownerPool.query("ALTER ROLE tc_app LOGIN PASSWORD 'test'")

  process.env.NODE_ENV = 'test'
  process.env.DATABASE_URL = url
  process.env.APP_DATABASE_URL = url.replace('test:test@', 'tc_app:test@')

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
  app = configureApp(moduleRef.createNestApplication())
  await app.init()
}, 180_000)

afterAll(async () => {
  await app?.close()
  await ownerPool?.end()
  await container?.stop()
})

describe('GET /health (FR-052)', () => {
  it('responde 200 con DB verificada y está fuera del prefijo /api/v1', async () => {
    const res = await server().get('/health')

    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('application/json')
    expect(res.body.status).toBe('ok')
    expect(res.body.db).toBe('up')
    expect(res.body.version).toMatch(/^\d+\.\d+\.\d+$/)
    expect(typeof res.body.uptime_s).toBe('number')
    expect(res.body.uptime_s).toBeGreaterThanOrEqual(0)
  })

  it('si la DB está caída → 503 con db down', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [HealthModule],
    })
      .overrideProvider(DbService)
      .useValue({ ping: async () => false })
      .compile()
    const down = configureApp(moduleRef.createNestApplication())
    await down.init()

    const res = await request(down.getHttpServer()).get('/health')
    expect(res.status).toBe(503)
    expect(res.body.status).toBe('degraded')
    expect(res.body.db).toBe('down')

    await down.close()
  })
})