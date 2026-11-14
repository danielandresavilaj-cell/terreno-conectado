import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
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
import { DEMO_PASSWORD, SITE_A_ID, TEMPLATE_A_ID, TENANT_A_ID, seedDatabase } from '../db/seed'

/**
 * TSK-REP-012 (FR-040) — tendencia semanal en el resumen del dashboard.
 *
 *  - 8 semanas, de la más antigua a la actual, cada una con su lunes;
 *  - cuenta inspecciones y hallazgos de la semana, filtra por faena y no por el
 *    período elegido;
 *  - otra empresa no ve los datos (RLS).
 */

const MIGRATIONS_DIR = resolve(process.cwd(), 'db', 'migrations')
let container: StartedPostgreSqlContainer
let ownerPool: Pool
let app: INestApplication
const server = () => request(app.getHttpServer())
const t: Record<string, string> = {}
const como = (q: string) => ({ Authorization: `Bearer ${t[q]}` })
let otraFaena: string

async function login(email: string) {
  const res = await server().post('/api/v1/auth/login').send({ email, password: DEMO_PASSWORD })
  expect(res.status).toBe(200)
  return { token: res.body.access_token as string, id: res.body.user.id as string }
}

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').withDatabase('terreno').start()
  const url = container.getConnectionUri()
  await runner({ databaseUrl: url, dir: MIGRATIONS_DIR, direction: 'up', migrationsTable: 'pgmigrations' })
  ownerPool = new Pool({ connectionString: url })
  await seedDatabase(ownerPool)
  await ownerPool.query("ALTER ROLE tc_app LOGIN PASSWORD 'test'")
  process.env.DATABASE_URL = url
  process.env.APP_DATABASE_URL = url.replace('test:test@', 'tc_app:test@')
  process.env.JWT_ACCESS_SECRET = 'test-access-secret-32bytes-long!!!!!'
  process.env.NODE_ENV = 'test'
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
  app = configureApp(moduleRef.createNestApplication())
  await app.init()
  const worker = await login('trabajador@minera.cl')
  t.supA = (await login('supervisor@minera.cl')).token
  t.supB = (await login('supervisor@andes.cl')).token

  otraFaena = randomUUID()
  await ownerPool.query(`INSERT INTO site (id, tenant_id, name, kind) VALUES ($1, $2, 'Faena Sur (prueba)', 'mining')`, [
    otraFaena,
    TENANT_A_ID,
  ])
  // Dos inspecciones esta semana (una en cada faena) y un hallazgo en la de SITE_A.
  const insertar = async (siteId: string) => {
    const id = randomUUID()
    await ownerPool.query(
      `INSERT INTO inspection (id, tenant_id, site_id, template_id, template_version, executed_by, status, captured_at)
       VALUES ($1, $2, $3, $4, 1, $5, 'submitted', now())`,
      [id, TENANT_A_ID, siteId, TEMPLATE_A_ID, worker.id],
    )
    return id
  }
  const enA = await insertar(SITE_A_ID)
  await insertar(otraFaena)
  await ownerPool.query(
    `INSERT INTO finding (id, tenant_id, inspection_id, severity, description, status, captured_at)
     VALUES ($1, $2, $3, 'medium', 'Señalética caída', 'open', now())`,
    [randomUUID(), TENANT_A_ID, enA],
  )
}, 180_000)

afterAll(async () => {
  await app?.close()
  await ownerPool?.end()
  await container?.stop()
})

describe('GET /api/v1/dashboard/summary — tendencia_semanal (FR-040)', () => {
  it('trae 8 semanas consecutivas, de la más antigua a la actual', async () => {
    const res = await server().get('/api/v1/dashboard/summary').set(como('supA'))
    expect(res.status).toBe(200)
    const semanas = res.body.tendencia_semanal as Array<{ semana: string }>
    expect(semanas).toHaveLength(8)
    const fechas = semanas.map((s) => Date.parse(`${s.semana}T00:00:00Z`))
    for (let i = 1; i < fechas.length; i++) expect(fechas[i] - fechas[i - 1]).toBe(7 * 24 * 3600 * 1000)
    // Cada semana empieza en lunes.
    expect(semanas.every((s) => new Date(`${s.semana}T00:00:00Z`).getUTCDay() === 1)).toBe(true)
  })

  it('la semana actual cuenta lo de todas las faenas, o sólo la filtrada', async () => {
    const todas = await server().get('/api/v1/dashboard/summary').set(como('supA'))
    const actual = todas.body.tendencia_semanal.at(-1)
    expect(actual).toMatchObject({ inspecciones: 2, hallazgos: 1 })

    const sur = await server().get(`/api/v1/dashboard/summary?site_id=${otraFaena}`).set(como('supA'))
    expect(sur.body.tendencia_semanal.at(-1)).toMatchObject({ inspecciones: 1, hallazgos: 0 })
  })

  it('no se recorta por el período elegido', async () => {
    const res = await server()
      .get('/api/v1/dashboard/summary?desde=2020-01-01T00:00:00.000Z&hasta=2020-01-02T00:00:00.000Z')
      .set(como('supA'))
    expect(res.body.tendencia_semanal.at(-1)).toMatchObject({ inspecciones: 2 })
  })

  it('otra empresa no ve estos datos (RLS)', async () => {
    const res = await server().get('/api/v1/dashboard/summary').set(como('supB'))
    expect(res.status).toBe(200)
    expect(res.body.tendencia_semanal.at(-1)).toMatchObject({ inspecciones: 0, hallazgos: 0 })
  })
})
