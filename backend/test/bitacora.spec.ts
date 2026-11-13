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
import { DEMO_PASSWORD, SITE_A_ID, TENANT_A_ID, seedDatabase } from '../db/seed'

/**
 * TSK-REP-009 (FR-063) — la bitácora se lee desde el servidor.
 *
 *  - el turno entrante (trabajador) y la supervisión leen lo que escribió el
 *    equipo, del más reciente al más antiguo, con autor y faena;
 *  - filtros por faena y período;
 *  - otra empresa no ve nada (RLS, Art. IV); plataforma → 403; sin sesión → 401.
 */

const MIGRATIONS_DIR = resolve(process.cwd(), 'db', 'migrations')
let container: StartedPostgreSqlContainer
let ownerPool: Pool
let app: INestApplication
const server = () => request(app.getHttpServer())
const t: Record<string, string> = {}
const ids: Record<string, string> = {}
const como = (q: string) => ({ Authorization: `Bearer ${t[q]}` })

let otraFaena: string
const antigua = randomUUID()
const reciente = randomUUID()
const deOtraFaena = randomUUID()

async function login(email: string) {
  const res = await server().post('/api/v1/auth/login').send({ email, password: DEMO_PASSWORD })
  expect(res.status).toBe(200)
  return { token: res.body.access_token as string, id: res.body.user.id as string }
}

function entrada(id: string, siteId: string, texto: string, capturedAt: string, tags: string[] = []) {
  return {
    entity_type: 'log_entry',
    id,
    tenant_id: TENANT_A_ID,
    client_version: 0,
    captured_at: capturedAt,
    payload: {
      site_id: siteId,
      author_id: ids.workerA,
      entry_text: texto,
      tags,
      shift_date: capturedAt.slice(0, 10),
    },
  }
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
  for (const [k, email] of [
    ['workerA', 'trabajador@minera.cl'],
    ['supA', 'supervisor@minera.cl'],
    ['adminA', 'admin@minera.cl'],
    ['supB', 'supervisor@andes.cl'],
    ['plataforma', 'admin@terreno.local'],
  ] as const) {
    const r = await login(email)
    t[k] = r.token
    ids[k] = r.id
  }

  otraFaena = randomUUID()
  await ownerPool.query(
    `INSERT INTO site (id, tenant_id, name, kind) VALUES ($1, $2, 'Faena Norte (prueba)', 'mining')`,
    [otraFaena, TENANT_A_ID],
  )
  const res = await server()
    .post('/api/v1/sync/batch')
    .set(como('workerA'))
    .send({
      batch_id: randomUUID(),
      device_id: randomUUID(),
      records: [
        entrada(antigua, SITE_A_ID, 'Turno sin novedades', '2026-11-01T08:00:00.000Z'),
        entrada(reciente, SITE_A_ID, 'Pala 3 detenida por mantención', '2026-11-10T20:00:00.000Z', ['Relevo']),
        entrada(deOtraFaena, otraFaena, 'Camino de acceso con barro', '2026-11-09T12:00:00.000Z'),
      ],
    })
  expect(res.status).toBe(200)
  expect(res.body.records_failed).toBe(0)
}, 180_000)

afterAll(async () => {
  await app?.close()
  await ownerPool?.end()
  await container?.stop()
})

describe('GET /api/v1/dashboard/bitacora (FR-063)', () => {
  it('el trabajador lee la bitácora del equipo, más reciente primero, con autor y faena', async () => {
    const res = await server().get('/api/v1/dashboard/bitacora').set(como('workerA'))
    expect(res.status).toBe(200)
    expect(res.body.total).toBe(3)
    expect(res.body.items.map((e: { id: string }) => e.id)).toEqual([reciente, deOtraFaena, antigua])
    expect(res.body.items[0]).toMatchObject({
      faena_id: SITE_A_ID,
      autor_id: ids.workerA,
      autor: 'Pedro Trabajador',
      texto: 'Pala 3 detenida por mantención',
      tags: ['Relevo'],
      fecha_turno: '2026-11-10',
      captured_at: '2026-11-10T20:00:00.000Z',
    })
  })

  it('filtra por faena y por período', async () => {
    const faena = await server().get(`/api/v1/dashboard/bitacora?site_id=${otraFaena}`).set(como('supA'))
    expect(faena.body.items.map((e: { id: string }) => e.id)).toEqual([deOtraFaena])
    expect(faena.body.items[0].faena_nombre).toBe('Faena Norte (prueba)')

    const periodo = await server()
      .get('/api/v1/dashboard/bitacora?desde=2026-11-05T00:00:00.000Z&hasta=2026-11-30T00:00:00.000Z')
      .set(como('adminA'))
    expect(periodo.body.items.map((e: { id: string }) => e.id)).toEqual([reciente, deOtraFaena])
  })

  it('pagina con limit y offset sin perder el total', async () => {
    const res = await server().get('/api/v1/dashboard/bitacora?limit=1&offset=1').set(como('supA'))
    expect(res.body.total).toBe(3)
    expect(res.body.items.map((e: { id: string }) => e.id)).toEqual([deOtraFaena])
  })

  it('otra empresa no ve nada (RLS); plataforma → 403; sin sesión → 401; filtro inválido → 400', async () => {
    const ajena = await server().get('/api/v1/dashboard/bitacora').set(como('supB'))
    expect(ajena.status).toBe(200)
    expect(ajena.body.items.map((e: { id: string }) => e.id)).not.toContain(reciente)
    expect((await server().get('/api/v1/dashboard/bitacora').set(como('plataforma'))).status).toBe(403)
    expect((await server().get('/api/v1/dashboard/bitacora')).status).toBe(401)
    expect((await server().get('/api/v1/dashboard/bitacora?site_id=x').set(como('supA'))).status).toBe(400)
  })
})
