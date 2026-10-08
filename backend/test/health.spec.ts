import 'reflect-metadata'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { PostgreSqlContainer } from '@testcontainers/postgresql'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppModule } from '../src/app.module'
import { configureApp } from '../src/app.setup'

/**
 * TSK-WS-012 - GET /health (FR-052, NFR-09).
 *  - 200 con uptime/version/db:up cuando la DB responde.
 *  - 503 con db:down cuando la DB no alcanza (app con URL invalida).
 *  - Vive en la raiz, fuera del prefijo /api/v1 (lo consume el uptime monitor).
 */

let container: StartedPostgreSqlContainer
let app: INestApplication

const server = () => request(app.getHttpServer())

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').withDatabase('terreno').start()
  const url = container.getConnectionUri()
  process.env.DATABASE_URL = url
  process.env.APP_DATABASE_URL = url
  process.env.JWT_ACCESS_SECRET = 'test-access-secret-32bytes-long!!!!!'
  process.env.NODE_ENV = 'test'

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
  app = configureApp(moduleRef.createNestApplication())
  await app.init()
}, 180_000)

afterAll(async () => {
  await app?.close()
  await container?.stop()
})

describe('GET /health (FR-052)', () => {
  it('responde 200 con uptime, version y db up', async () => {
    const res = await server().get('/health')
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('ok')
    expect(res.body.db).toBe('up')
    expect(res.body.uptime_s).toBeGreaterThanOrEqual(0)
    expect(typeof res.body.version).toBe('string')
    expect(res.body.version).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('vive fuera del prefijo /api/v1 (sin auth, para el monitor de uptime)', async () => {
    expect((await server().get('/api/v1/health')).status).toBe(404)
  })

  it('responde 503 con db down cuando la DB no alcanza', async () => {
    process.env.APP_DATABASE_URL = 'postgres://tc_app:localdev@127.0.0.1:59999/terreno'
    const badRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
    const badApp = configureApp(badRef.createNestApplication())
    await badApp.init()
    try {
      const res = await request(badApp.getHttpServer()).get('/health')
      expect(res.status).toBe(503)
      expect(res.body.status).toBe('degraded')
      expect(res.body.db).toBe('down')
      expect(res.body.uptime_s).toBeGreaterThanOrEqual(0)
    } finally {
      await badApp.close()
    }
  })
})