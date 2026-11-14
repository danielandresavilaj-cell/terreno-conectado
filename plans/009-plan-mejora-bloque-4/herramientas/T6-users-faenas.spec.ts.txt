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
import { DEMO_PASSWORD, SITE_A_ID, SITE_B_ID, TENANT_A_ID, seedDatabase } from '../db/seed'

/**
 * TSK-ADM-003 (FR-065) — faenas por cuenta.
 *
 *  - sin asignación, la cuenta ve todas las faenas de su empresa en `GET /sites`;
 *  - con asignación, sólo las suyas; `[]` vuelve a "todas";
 *  - el resumen del panel no se restringe;
 *  - sólo `tenant_admin`; faena o cuenta de otra empresa → 400/404; auditoría.
 */

const MIGRATIONS_DIR = resolve(process.cwd(), 'db', 'migrations')
let container: StartedPostgreSqlContainer
let ownerPool: Pool
let app: INestApplication
const server = () => request(app.getHttpServer())
const t: Record<string, string> = {}
const ids: Record<string, string> = {}
const como = (q: string) => ({ Authorization: `Bearer ${t[q]}` })
let faenaNorte: string

async function login(email: string) {
  const res = await server().post('/api/v1/auth/login').send({ email, password: DEMO_PASSWORD })
  expect(res.status).toBe(200)
  return { token: res.body.access_token as string, id: res.body.user.id as string }
}
const faenasDe = async (quien: string) =>
  ((await server().get('/api/v1/sites').set(como(quien))).body.items as Array<{ id: string }>).map((s) => s.id).sort()

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
    ['adminB', 'admin@andes.cl'],
    ['workerB', 'trabajador@andes.cl'],
  ] as const) {
    const r = await login(email)
    t[k] = r.token
    ids[k] = r.id
  }
  faenaNorte = randomUUID()
  await ownerPool.query(`INSERT INTO site (id, tenant_id, name, kind) VALUES ($1, $2, 'Faena Norte (prueba)', 'mining')`, [
    faenaNorte,
    TENANT_A_ID,
  ])
}, 180_000)

afterAll(async () => {
  await app?.close()
  await ownerPool?.end()
  await container?.stop()
})

describe('PUT /api/v1/users/:id/faenas (FR-065)', () => {
  it('sin asignación, la cuenta ve todas las faenas de su empresa', async () => {
    expect(await faenasDe('workerA')).toEqual([SITE_A_ID, faenaNorte].sort())
  })

  it('con asignación ve sólo las suyas, y el listado de Equipo la muestra', async () => {
    const res = await server()
      .put(`/api/v1/users/${ids.workerA}/faenas`)
      .set(como('adminA'))
      .send({ faena_ids: [faenaNorte, faenaNorte] })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ id: ids.workerA, faena_ids: [faenaNorte] })

    expect(await faenasDe('workerA')).toEqual([faenaNorte])
    const equipo = await server().get('/api/v1/users').set(como('adminA'))
    const cuenta = (equipo.body as Array<{ id: string; faena_ids: string[] }>).find((u) => u.id === ids.workerA)
    expect(cuenta?.faena_ids).toEqual([faenaNorte])

    const audit = await ownerPool.query(
      "SELECT payload FROM audit_log WHERE action = 'user_sites_updated' AND entity_id = $1",
      [ids.workerA],
    )
    expect(audit.rows[0].payload).toEqual({ antes: [], despues: [faenaNorte] })
  })

  it('el supervisor sin asignación y el resumen del panel siguen viendo todas', async () => {
    expect(await faenasDe('supA')).toEqual([SITE_A_ID, faenaNorte].sort())
    const resumen = await server().get('/api/v1/dashboard/summary').set(como('supA'))
    expect((resumen.body.faenas as Array<{ id: string }>).map((f) => f.id).sort()).toEqual([SITE_A_ID, faenaNorte].sort())
  })

  it('una lista vacía vuelve a "todas"', async () => {
    const res = await server().put(`/api/v1/users/${ids.workerA}/faenas`).set(como('adminA')).send({ faena_ids: [] })
    expect(res.status).toBe(200)
    expect(await faenasDe('workerA')).toEqual([SITE_A_ID, faenaNorte].sort())
  })

  it('rechaza faenas o cuentas de otra empresa y datos inválidos', async () => {
    const ruta = `/api/v1/users/${ids.workerA}/faenas`
    const ajena = await server().put(ruta).set(como('adminA')).send({ faena_ids: [SITE_B_ID] })
    expect(ajena.status).toBe(400)
    expect(ajena.body.message).toMatch(/no existe en tu empresa/)
    expect((await server().put(`/api/v1/users/${ids.workerB}/faenas`).set(como('adminA')).send({ faena_ids: [] })).status).toBe(404)
    expect((await server().put(ruta).set(como('adminA')).send({ faena_ids: ['x'] })).status).toBe(400)
    expect((await server().put(ruta).set(como('adminA')).send({ faena_ids: [], extra: 1 })).status).toBe(400)
    expect((await server().put(ruta).set(como('adminA')).send({})).status).toBe(400)
  })

  it('sólo el administrador de la empresa', async () => {
    const ruta = `/api/v1/users/${ids.workerA}/faenas`
    expect((await server().put(ruta).set(como('supA')).send({ faena_ids: [] })).status).toBe(403)
    expect((await server().put(ruta).set(como('workerA')).send({ faena_ids: [] })).status).toBe(403)
    expect((await server().put(ruta).set(como('adminB')).send({ faena_ids: [] })).status).toBe(404)
  })
})
