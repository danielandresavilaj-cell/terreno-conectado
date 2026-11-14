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
import { DEMO_PASSWORD, TEMPLATE_A_ID, TEMPLATE_A_REVISION_PUBLISHED_ID, seedDatabase } from '../db/seed'

/**
 * TSK-FORM-024 (FR-066) — archivar y restaurar formularios.
 *
 *  - archivado, el formulario deja de llegar al trabajador y de listarse para
 *    el administrador; aparece en `GET /templates/archivadas`;
 *  - restaurarlo lo devuelve con sus asignaciones intactas;
 *  - sólo `tenant_admin`; otra empresa → 404 (RLS); cada cambio va a audit_log.
 */

const MIGRATIONS_DIR = resolve(process.cwd(), 'db', 'migrations')
let container: StartedPostgreSqlContainer
let ownerPool: Pool
let app: INestApplication
const server = () => request(app.getHttpServer())
const t: Record<string, string> = {}
const como = (q: string) => ({ Authorization: `Bearer ${t[q]}` })
const revisiones = async (quien: string) =>
  ((await server().get('/api/v1/templates').set(como(quien))).body.items as Array<{ revision_id: string }>).map(
    (i) => i.revision_id,
  )

async function login(email: string) {
  const res = await server().post('/api/v1/auth/login').send({ email, password: DEMO_PASSWORD })
  expect(res.status).toBe(200)
  return res.body.access_token as string
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
  t.workerA = await login('trabajador@minera.cl')
  t.adminA = await login('admin@minera.cl')
  t.supA = await login('supervisor@minera.cl')
  t.adminB = await login('admin@andes.cl')
}, 180_000)

afterAll(async () => {
  await app?.close()
  await ownerPool?.end()
  await container?.stop()
})

describe('PATCH /api/v1/templates/:templateId/estado (FR-066)', () => {
  it('antes de archivar, el trabajador y el admin ven el formulario', async () => {
    expect(await revisiones('workerA')).toContain(TEMPLATE_A_REVISION_PUBLISHED_ID)
    expect(await revisiones('adminA')).toContain(TEMPLATE_A_REVISION_PUBLISHED_ID)
  })

  it('archivar lo oculta a todos, lo lista como archivado y lo audita', async () => {
    const res = await server()
      .patch(`/api/v1/templates/${TEMPLATE_A_ID}/estado`)
      .set(como('adminA'))
      .send({ status: 'archived' })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ template_id: TEMPLATE_A_ID, status: 'archived' })

    expect(await revisiones('workerA')).not.toContain(TEMPLATE_A_REVISION_PUBLISHED_ID)
    expect(await revisiones('adminA')).not.toContain(TEMPLATE_A_REVISION_PUBLISHED_ID)
    const arch = await server().get('/api/v1/templates/archivadas').set(como('adminA'))
    expect(arch.status).toBe(200)
    expect((arch.body.items as Array<{ template_id: string }>).map((i) => i.template_id)).toEqual([TEMPLATE_A_ID])

    const audit = await ownerPool.query(
      "SELECT count(*)::int AS n FROM audit_log WHERE action = 'template_archived' AND entity_id = $1",
      [TEMPLATE_A_ID],
    )
    expect(audit.rows[0].n).toBe(1)
    // Las asignaciones se conservan.
    const asign = await ownerPool.query(
      'SELECT count(*)::int AS n FROM template_assignment WHERE template_revision_id = $1',
      [TEMPLATE_A_REVISION_PUBLISHED_ID],
    )
    expect(asign.rows[0].n).toBeGreaterThan(0)
  })

  it('archivar dos veces no duplica la auditoría', async () => {
    await server().patch(`/api/v1/templates/${TEMPLATE_A_ID}/estado`).set(como('adminA')).send({ status: 'archived' })
    const audit = await ownerPool.query(
      "SELECT count(*)::int AS n FROM audit_log WHERE action = 'template_archived' AND entity_id = $1",
      [TEMPLATE_A_ID],
    )
    expect(audit.rows[0].n).toBe(1)
  })

  it('restaurar lo devuelve al trabajador con su asignación', async () => {
    const res = await server()
      .patch(`/api/v1/templates/${TEMPLATE_A_ID}/estado`)
      .set(como('adminA'))
      .send({ status: 'active' })
    expect(res.status).toBe(200)
    expect(await revisiones('workerA')).toContain(TEMPLATE_A_REVISION_PUBLISHED_ID)
    const arch = await server().get('/api/v1/templates/archivadas').set(como('adminA'))
    expect(arch.body.items).toEqual([])
  })

  it('sólo tenant_admin; otra empresa → 404; datos inválidos → 400', async () => {
    const ruta = `/api/v1/templates/${TEMPLATE_A_ID}/estado`
    expect((await server().patch(ruta).set(como('supA')).send({ status: 'archived' })).status).toBe(403)
    expect((await server().get('/api/v1/templates/archivadas').set(como('workerA'))).status).toBe(403)
    expect((await server().patch(ruta).set(como('adminB')).send({ status: 'archived' })).status).toBe(404)
    expect((await server().patch(ruta).set(como('adminA')).send({ status: 'borrado' })).status).toBe(400)
    expect((await server().patch(ruta).set(como('adminA')).send({ status: 'archived', name: 'x' })).status).toBe(400)
    expect((await server().patch('/api/v1/templates/no-es-uuid/estado').set(como('adminA')).send({ status: 'archived' })).status).toBe(400)
    expect((await server().patch(`/api/v1/templates/${randomUUID()}/estado`).set(como('adminA')).send({ status: 'archived' })).status).toBe(404)
  })
})
