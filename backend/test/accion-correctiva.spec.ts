import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { PostgreSqlContainer } from '@testcontainers/postgresql'
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import type { Pool } from 'pg'
import { poolDePrueba } from './helpers/pool'
import { runner } from 'node-pg-migrate'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppModule } from '../src/app.module'
import { configureApp } from '../src/app.setup'
import { DEMO_PASSWORD, SITE_A_ID, TEMPLATE_A_ID, TENANT_A_ID, seedDatabase } from '../db/seed'

/**
 * TSK-DOM-007 (FR-064) — el hallazgo como acción correctiva.
 *
 *  - supervisión asigna responsable y plazo y cierra con una nota; cada cambio
 *    queda en audit_log con su antes y después;
 *  - el responsable debe ser una cuenta activa de la misma empresa;
 *  - otra empresa no puede gestionar el hallazgo (RLS); el trabajador tampoco;
 *  - una corrección del hallazgo que llega por sync no borra la asignación;
 *  - el listado del dashboard muestra responsable, plazo y nota.
 */

const MIGRATIONS_DIR = resolve(process.cwd(), 'db', 'migrations')
const ITEM_BARRERAS = '01890000-0000-7000-8000-00000000f101'
let container: StartedPostgreSqlContainer
let ownerPool: Pool
let app: INestApplication
const server = () => request(app.getHttpServer())
const t: Record<string, string> = {}
const ids: Record<string, string> = {}
const como = (q: string) => ({ Authorization: `Bearer ${t[q]}` })

const inspeccionId = randomUUID()
const respuestaId = randomUUID()
const hallazgoId = randomUUID()

async function login(email: string) {
  const res = await server().post('/api/v1/auth/login').send({ email, password: DEMO_PASSWORD })
  expect(res.status).toBe(200)
  return { token: res.body.access_token as string, id: res.body.user.id as string }
}

function hallazgoWire(clientVersion: number, descripcion: string) {
  return {
    entity_type: 'finding',
    id: hallazgoId,
    tenant_id: TENANT_A_ID,
    client_version: clientVersion,
    captured_at: new Date(Date.UTC(2026, 10, 10, 9, clientVersion)).toISOString(),
    payload: { inspection_id: inspeccionId, response_id: respuestaId, severity: 'high', description: descripcion, status: 'open' },
  }
}

const lote = (records: unknown[]) => ({ batch_id: randomUUID(), device_id: randomUUID(), records })

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').withDatabase('terreno').start()
  const url = container.getConnectionUri()
  await runner({ databaseUrl: url, dir: MIGRATIONS_DIR, direction: 'up', migrationsTable: 'pgmigrations' })
  ownerPool = poolDePrueba(url)
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
  ] as const) {
    const r = await login(email)
    t[k] = r.token
    ids[k] = r.id
  }
  const res = await server()
    .post('/api/v1/sync/batch')
    .set(como('workerA'))
    .send(
      lote([
        {
          entity_type: 'inspection',
          id: inspeccionId,
          tenant_id: TENANT_A_ID,
          client_version: 1,
          captured_at: '2026-11-10T09:00:00.000Z',
          payload: {
            site_id: SITE_A_ID,
            template_id: TEMPLATE_A_ID,
            template_version: 1,
            executed_by: ids.workerA,
            status: 'submitted',
            location: null,
            requires_supervisor_signature: false,
          },
        },
        {
          entity_type: 'response',
          id: respuestaId,
          tenant_id: TENANT_A_ID,
          client_version: 1,
          captured_at: '2026-11-10T09:00:00.000Z',
          payload: { inspection_id: inspeccionId, template_item_id: ITEM_BARRERAS, value_ok: 'nok', value_text: null, value_number: null },
        },
        hallazgoWire(1, 'Barrera desplazada'),
      ]),
    )
  expect(res.body.records_failed).toBe(0)
}, 180_000)

afterAll(async () => {
  await app?.close()
  await ownerPool?.end()
  await container?.stop()
})

describe('PATCH /api/v1/findings/:id — acción correctiva (FR-064)', () => {
  it('lista a quién se puede asignar: cuentas activas de la empresa', async () => {
    const res = await server().get('/api/v1/findings/responsables').set(como('supA'))
    expect(res.status).toBe(200)
    const nombres = (res.body as Array<{ id: string }>).map((p) => p.id)
    expect(nombres).toContain(ids.workerA)
    expect(nombres).not.toContain(ids.supB)
    expect((await server().get('/api/v1/findings/responsables').set(como('workerA'))).status).toBe(403)
  })

  it('asigna responsable y plazo, y lo audita con antes y después', async () => {
    const res = await server()
      .patch(`/api/v1/findings/${hallazgoId}`)
      .set(como('supA'))
      .send({ assignee_id: ids.workerA, due_date: '2026-11-20' })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      id: hallazgoId,
      status: 'open',
      assignee_id: ids.workerA,
      responsable: 'Pedro Trabajador',
      due_date: '2026-11-20',
      resolution_note: null,
    })
    const audit = await ownerPool.query(
      "SELECT payload FROM audit_log WHERE action = 'finding_assigned' AND entity_id = $1",
      [hallazgoId],
    )
    expect(audit.rows[0].payload).toEqual({
      assignee_id: { de: null, a: ids.workerA },
      due_date: { de: null, a: '2026-11-20' },
    })
  })

  it('el dashboard muestra responsable y plazo', async () => {
    const res = await server().get('/api/v1/dashboard/findings').set(como('supA'))
    const item = (res.body.items as Array<Record<string, unknown>>).find((i) => i.id === hallazgoId)
    expect(item).toMatchObject({ assignee_id: ids.workerA, responsable: 'Pedro Trabajador', due_date: '2026-11-20' })
  })

  it('una corrección del hallazgo que llega por sync no borra la asignación', async () => {
    const res = await server().post('/api/v1/sync/batch').set(como('workerA')).send(lote([hallazgoWire(2, 'Barrera desplazada 2 m')]))
    expect(res.body.records_failed).toBe(0)
    const { rows } = await ownerPool.query(
      "SELECT description, assignee_id, to_char(due_date, 'YYYY-MM-DD') AS due_date FROM finding WHERE id = $1",
      [hallazgoId],
    )
    expect(rows[0]).toEqual({ description: 'Barrera desplazada 2 m', assignee_id: ids.workerA, due_date: '2026-11-20' })
  })

  it('cierra con nota: resuelto, resolved_at y nota guardados', async () => {
    const res = await server()
      .patch(`/api/v1/findings/${hallazgoId}`)
      .set(como('adminA'))
      .send({ status: 'resolved', resolution_note: '  Barrera reinstalada y anclada.  ' })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ status: 'resolved', resolution_note: 'Barrera reinstalada y anclada.' })
    const { rows } = await ownerPool.query('SELECT resolved_at FROM finding WHERE id = $1', [hallazgoId])
    expect(rows[0].resolved_at).not.toBeNull()
    const estados = await ownerPool.query(
      "SELECT count(*)::int AS n FROM audit_log WHERE action = 'finding_status_changed' AND entity_id = $1",
      [hallazgoId],
    )
    expect(estados.rows[0].n).toBe(1)
  })

  it('rechaza responsables ajenos, fechas inválidas, campos desconocidos y cuerpos vacíos', async () => {
    const ruta = `/api/v1/findings/${hallazgoId}`
    const ajeno = await server().patch(ruta).set(como('supA')).send({ assignee_id: ids.supB })
    expect(ajeno.status).toBe(400)
    expect(ajeno.body.message).toMatch(/cuenta activa de tu empresa/)
    expect((await server().patch(ruta).set(como('supA')).send({ due_date: '20-11-2026' })).status).toBe(400)
    expect((await server().patch(ruta).set(como('supA')).send({ severity: 'low' })).status).toBe(400)
    expect((await server().patch(ruta).set(como('supA')).send({})).status).toBe(400)
  })

  it('otra empresa no puede gestionarlo (404, RLS) y el trabajador tampoco (403)', async () => {
    const ruta = `/api/v1/findings/${hallazgoId}`
    expect((await server().patch(ruta).set(como('supB')).send({ due_date: '2026-12-01' })).status).toBe(404)
    expect((await server().patch(ruta).set(como('workerA')).send({ due_date: '2026-12-01' })).status).toBe(403)
  })
})

describe('GET /api/v1/dashboard/summary — plazos vencidos (TSK-REP-011)', () => {
  it('cuenta los hallazgos abiertos con plazo pasado y deja de contarlos al resolverlos', async () => {
    const id = randomUUID()
    await ownerPool.query(
      `INSERT INTO finding (id, tenant_id, inspection_id, severity, description, status, captured_at, due_date)
       VALUES ($1, $2, $3, 'medium', 'Señalética caída', 'open', now(), current_date - 2)`,
      [id, TENANT_A_ID, inspeccionId],
    )
    const antes = await server().get('/api/v1/dashboard/summary').set(como('supA'))
    expect(antes.status).toBe(200)
    expect(antes.body.hallazgos_vencidos).toBe(1)

    await server().patch(`/api/v1/findings/${id}`).set(como('supA')).send({ status: 'resolved', resolution_note: 'Repuesta' })
    const despues = await server().get('/api/v1/dashboard/summary').set(como('supA'))
    expect(despues.body.hallazgos_vencidos).toBe(0)
  })
})
