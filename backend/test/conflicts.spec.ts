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
import { DEMO_PASSWORD, TENANT_A_ID, TENANT_B_ID, seedDatabase } from '../db/seed'

/**
 * TSK-WS-009 — Resolución LWW + CONFLICT_RECORD (FR-023, Artículo III).
 *
 * Tie-breaker determinista (plan §3.1): gana mayor `captured_at`; si empatan,
 * mayor `client_version`; si aún empatan, mayor UUIDv7 (lexicográfico).
 *
 * Corre el backend real contra PostgreSQL 16 (Testcontainers). Verifica:
 *  - edición concurrente → gana `captured_at` más reciente; AMBAS versiones
 *    en CONFLICT_RECORD (winner/loser), enlazadas al sync_log del batch.
 *  - `captured_at` iguales → gana mayor `client_version`.
 *  - reintento de un registro PERDEDOR es idempotente (dedupe del par): el
 *    conflicto no se duplica ni se altera la fila.
 *  - el conflicto es visible para supervisor y tenant_admin; prohibido para
 *    field_worker y platform_admin, con aislamiento tenant vía RLS.
 */

const MIGRATIONS_DIR = resolve(process.cwd(), 'db', 'migrations')

let container: StartedPostgreSqlContainer
let ownerUrl: string
let ownerPool: Pool
let app: INestApplication
let trabajadorToken: string
let supervisorToken: string
let tenantAdminToken: string
let platformToken: string
let siteId: string
let userId: string

const server = () => request(app.getHttpServer())

function uuid(): string {
  return randomUUID()
}

function inspectionRecord(opts: {
  id: string
  clientVersion: number
  capturedAt: string
  status: 'draft' | 'in_progress' | 'submitted' | 'reviewed'
}) {
  return {
    entity_type: 'inspection',
    id: opts.id,
    tenant_id: TENANT_A_ID,
    client_version: opts.clientVersion,
    captured_at: opts.capturedAt,
    payload: {
      site_id: siteId,
      template_id: uuid(),
      template_version: 1,
      executed_by: userId,
      status: opts.status,
    },
  }
}

function singleBatch(record: ReturnType<typeof inspectionRecord>) {
  return { batch_id: uuid(), device_id: uuid(), records: [record] }
}

const post = (token: string, body: object) =>
  server().post('/api/v1/sync/batch').set('Authorization', `Bearer ${token}`).send(body)

const getConflicts = (token: string, query = '') =>
  server().get(`/api/v1/conflicts${query}`).set('Authorization', `Bearer ${token}`)

async function count(sql: string, params: unknown[] = []): Promise<number> {
  const res = await ownerPool.query(sql, params)
  return Number(res.rows[0]?.n ?? 0)
}

async function conflictForEntity(entityId: string) {
  const res = await ownerPool.query(
    `SELECT entity_type, entity_id, winner_payload, loser_payload, resolution, resolved_at, sync_log_id
     FROM conflict_record WHERE entity_id = $1 ORDER BY resolved_at DESC`,
    [entityId],
  )
  return res.rows[0] ?? null
}

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('terreno')
    .start()

  ownerUrl = container.getConnectionUri()
  await runner({
    databaseUrl: ownerUrl,
    dir: MIGRATIONS_DIR,
    direction: 'up',
    migrationsTable: 'pgmigrations',
  })

  ownerPool = new Pool({ connectionString: ownerUrl })
  await seedDatabase(ownerPool)
  await ownerPool.query("ALTER ROLE tc_app LOGIN PASSWORD 'test'")

  process.env.DATABASE_URL = ownerUrl
  process.env.APP_DATABASE_URL = ownerUrl.replace('test:test@', 'tc_app:test@')
  process.env.JWT_ACCESS_SECRET = 'test-access-secret-32bytes-long!!!!!'
  process.env.NODE_ENV = 'test'

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
  app = configureApp(moduleRef.createNestApplication())
  await app.init()

  const loginTrabajador = await server()
    .post('/api/v1/auth/login')
    .send({ email: 'trabajador@minera.cl', password: DEMO_PASSWORD })
  expect(loginTrabajador.status).toBe(200)
  trabajadorToken = loginTrabajador.body.access_token as string

  const loginSupervisor = await server()
    .post('/api/v1/auth/login')
    .send({ email: 'supervisor@minera.cl', password: DEMO_PASSWORD })
  expect(loginSupervisor.status).toBe(200)
  supervisorToken = loginSupervisor.body.access_token as string

  const loginTenantAdmin = await server()
    .post('/api/v1/auth/login')
    .send({ email: 'admin@minera.cl', password: DEMO_PASSWORD })
  expect(loginTenantAdmin.status).toBe(200)
  tenantAdminToken = loginTenantAdmin.body.access_token as string

  const loginPlatform = await server()
    .post('/api/v1/auth/login')
    .send({ email: 'admin@terreno.local', password: DEMO_PASSWORD })
  expect(loginPlatform.status).toBe(200)
  platformToken = loginPlatform.body.access_token as string

  const sites = await ownerPool.query('SELECT id FROM site WHERE tenant_id = $1 LIMIT 1', [
    TENANT_A_ID,
  ])
  siteId = (sites.rows[0] as { id: string }).id
  const users = await ownerPool.query(
    "SELECT id FROM app_user WHERE tenant_id = $1 AND email = 'trabajador@minera.cl'",
    [TENANT_A_ID],
  )
  userId = (users.rows[0] as { id: string }).id
}, 180_000)

afterAll(async () => {
  await app?.close()
  await ownerPool?.end()
  await container?.stop()
})

describe('golpe de capturas concurrentes (FR-023)', () => {
  it('gana la edición con captured_at más reciente y conserva ambas versiones', async () => {
    const id = uuid()
    const v1 = inspectionRecord({
      id,
      clientVersion: 1,
      capturedAt: '2026-10-06T10:00:00.000Z',
      status: 'in_progress',
    })
    const v2 = inspectionRecord({
      id,
      clientVersion: 1,
      capturedAt: '2026-10-06T11:00:00.000Z',
      status: 'submitted',
    })

    const first = await post(trabajadorToken, singleBatch(v1))
    expect(first.status).toBe(200)
    expect(first.body.status).toBe('ok')
    // Registro nuevo: aún no hay conflicto (nada que resolver).
    expect(await count('SELECT count(*)::int AS n FROM conflict_record WHERE entity_id = $1', [id])).toBe(0)

    const second = await post(trabajadorToken, singleBatch(v2))
    expect(second.status).toBe(200)
    expect(second.body.status).toBe('ok')

    const row = await ownerPool.query('SELECT status FROM inspection WHERE id = $1', [id])
    expect(row.rows[0].status).toBe('submitted')

    const conflict = await conflictForEntity(id)
    expect(conflict).not.toBeNull()
    expect(conflict.entity_type).toBe('inspection')
    expect(conflict.resolution).toBe('lww')
    expect((conflict.winner_payload as { status: string }).status).toBe('submitted')
    expect((conflict.loser_payload as { status: string }).status).toBe('in_progress')
    expect(conflict.resolved_at).not.toBeNull()

    // El conflicto está enlazado al lote que lo detectó (FR-024, sync_log_id).
    const log = await ownerPool.query(
      'SELECT status, records_ok, records_failed, finished_at FROM sync_log WHERE id = $1',
      [conflict.sync_log_id],
    )
    expect(log.rows[0]).toMatchObject({ status: 'ok', records_ok: 1, records_failed: 0 })
    expect(log.rows[0].finished_at).not.toBeNull()
  })

  it('captured_at empatados → gana mayor client_version', async () => {
    const id = uuid()
    const capturedAt = '2026-10-06T12:00:00.000Z'
    const earlier = inspectionRecord({ id, clientVersion: 1, capturedAt, status: 'in_progress' })
    const later = inspectionRecord({ id, clientVersion: 3, capturedAt, status: 'submitted' })

    await post(trabajadorToken, singleBatch(earlier))
    const res = await post(trabajadorToken, singleBatch(later))
    expect(res.status).toBe(200)

    const row = await ownerPool.query('SELECT status FROM inspection WHERE id = $1', [id])
    expect(row.rows[0].status).toBe('submitted')

    const conflict = await conflictForEntity(id)
    expect((conflict.winner_payload as { status: string }).status).toBe('submitted')
    expect((conflict.loser_payload as { status: string }).status).toBe('in_progress')
  })

  it('reintento de un PERDEDOR es idempotente: no duplica conflictos ni altera la fila', async () => {
    const id = uuid()
    const vieja = inspectionRecord({
      id,
      clientVersion: 1,
      capturedAt: '2026-10-06T13:00:00.000Z',
      status: 'in_progress',
    })
    const nueva = inspectionRecord({
      id,
      clientVersion: 1,
      capturedAt: '2026-10-06T14:00:00.000Z',
      status: 'submitted',
    })

    await post(trabajadorToken, singleBatch(vieja))
    await post(trabajadorToken, singleBatch(nueva))
    expect(await count('SELECT count(*)::int AS n FROM conflict_record WHERE entity_id = $1', [id])).toBe(1)

    const replayVieja = await post(trabajadorToken, singleBatch(vieja))
    expect(replayVieja.status).toBe(200)
    expect(replayVieja.body.records_unchanged).toBe(1)

    expect(await count('SELECT count(*)::int AS n FROM conflict_record WHERE entity_id = $1', [id])).toBe(1)
    const row = await ownerPool.query('SELECT status FROM inspection WHERE id = $1', [id])
    expect(row.rows[0].status).toBe('submitted')
  })
})

describe('visibilidad para el supervisor (FR-023)', () => {
  it('GET /api/v1/conflicts devuelve los conflictos del tenant al supervisor', async () => {
    const id = uuid()
    const v1 = inspectionRecord({
      id,
      clientVersion: 1,
      capturedAt: '2026-10-06T15:00:00.000Z',
      status: 'in_progress',
    })
    const v2 = inspectionRecord({
      id,
      clientVersion: 2,
      capturedAt: '2026-10-06T16:00:00.000Z',
      status: 'submitted',
    })
    await post(trabajadorToken, singleBatch(v1))
    await post(trabajadorToken, singleBatch(v2))

    const res = await getConflicts(supervisorToken)
    expect(res.status).toBe(200)
    expect(res.body.total).toBeGreaterThanOrEqual(1)
    const row = (res.body.items as Array<{ entity_id: string; winner_payload: { status: string } }>).find(
      (r) => r.entity_id === id,
    )
    expect(row).toBeDefined()
    expect(row?.winner_payload.status).toBe('submitted')
  })

  it('tenant_admin ve conflictos de su tenant y nunca los de otro tenant', async () => {
    const ownId = uuid()
    const v1 = inspectionRecord({
      id: ownId,
      clientVersion: 1,
      capturedAt: '2026-10-06T17:00:00.000Z',
      status: 'in_progress',
    })
    const v2 = inspectionRecord({
      id: ownId,
      clientVersion: 2,
      capturedAt: '2026-10-06T18:00:00.000Z',
      status: 'submitted',
    })
    await post(trabajadorToken, singleBatch(v1))
    await post(trabajadorToken, singleBatch(v2))

    // La fila B se inserta con la conexión owner para probar que RLS filtra
    // incluso si existe un conflicto ajeno; el token A nunca debe verla.
    const foreignId = uuid()
    await ownerPool.query(
      `INSERT INTO conflict_record
         (id, tenant_id, entity_type, entity_id, winner_payload, loser_payload)
       VALUES ($1, $2, 'inspection', $3, '{"status":"submitted"}', '{"status":"in_progress"}')`,
      [uuid(), TENANT_B_ID, foreignId],
    )

    const res = await getConflicts(tenantAdminToken)
    expect(res.status).toBe(200)
    const ids = (res.body.items as Array<{ entity_id: string }>).map((item) => item.entity_id)
    expect(ids).toContain(ownId)
    expect(ids).not.toContain(foreignId)
  })

  it('field_worker y platform_admin no pueden ver conflictos (403); sin sesión → 401', async () => {
    expect((await getConflicts(trabajadorToken)).status).toBe(403)
    expect((await getConflicts(platformToken)).status).toBe(403)
    expect((await server().get('/api/v1/conflicts')).status).toBe(401)
  })
})
