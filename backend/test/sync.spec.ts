import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
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
 * TSK-WS-007 — Ingesta idempotente `POST /api/v1/sync/batch`
 * (FR-020, FR-021, FR-024, FR-025, NFR-03/FR-040).
 *
 * Corre el backend real contra PostgreSQL 16 (Testcontainers). Verifica:
 *  - lote completo en orden de dependencias → status ok + filas en las 5 tablas
 *  - replay exacto → idempotencia (FR-021): sin duplicar, records_unchanged=5
 *  - registro con referencia inexistente → status partial + errors[]
 *  - registro de OTRO tenant → 409 previo a escritura + incidente en audit_log
 *  - sync_log con totales/estado (FR-024) y inspection.synced_at (latencia NFR-03)
 *  - bytes del adjunto persistidos en SYNC_VOLUME (data-model §2.2 V1)
 */

const MIGRATIONS_DIR = resolve(process.cwd(), 'db', 'migrations')

// PNG 1×1 transparente (67 bytes) — lo mínimo para probar el volumen.
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

let container: StartedPostgreSqlContainer
let ownerUrl: string
let ownerPool: Pool
let app: INestApplication
let access: string
let syncVolume: string
let siteId: string
let userId: string

const server = () => request(app.getHttpServer())

function uuid(): string {
  return randomUUID()
}

function now(): string {
  return new Date().toISOString()
}

function baseBatch() {
  const inspectionId = uuid()
  const responseId = uuid()
  const findingId = uuid()
  const logEntryId = uuid()
  const attachmentId = uuid()
  return {
    inspectionId,
    responseId,
    findingId,
    logEntryId,
    attachmentId,
    batch: {
      batch_id: uuid(),
      device_id: uuid(),
      records: [
        {
          entity_type: 'inspection',
          id: inspectionId,
          tenant_id: TENANT_A_ID,
          client_version: 1,
          captured_at: now(),
          payload: {
            site_id: siteId,
            template_id: uuid(),
            template_version: 1,
            executed_by: userId,
            status: 'in_progress',
          },
        },
        {
          entity_type: 'response',
          id: responseId,
          tenant_id: TENANT_A_ID,
          client_version: 1,
          captured_at: now(),
          payload: {
            inspection_id: inspectionId,
            template_item_id: uuid(),
            value_ok: 'ok',
            value_text: 'Sin observaciones',
            value_number: null,
          },
        },
        {
          entity_type: 'finding',
          id: findingId,
          tenant_id: TENANT_A_ID,
          client_version: 1,
          captured_at: now(),
          payload: {
            inspection_id: inspectionId,
            response_id: responseId,
            severity: 'medium',
            description: 'Fisura superficial en el muro norte',
            status: 'open',
          },
        },
        {
          entity_type: 'log_entry',
          id: logEntryId,
          tenant_id: TENANT_A_ID,
          client_version: 1,
          captured_at: now(),
          payload: {
            site_id: siteId,
            author_id: userId,
            entry_text: 'Turno sin novedad operacional',
            tags: ['turno-a', 'bitacora'],
            shift_date: '2026-10-07',
          },
        },
        {
          entity_type: 'attachment',
          id: attachmentId,
          tenant_id: TENANT_A_ID,
          client_version: 1,
          captured_at: now(),
          payload: {
            owner_type: 'finding',
            owner_id: findingId,
            mime: 'image/png',
            bytes: TINY_PNG.length,
            width: 1,
            height: 1,
            data: TINY_PNG.toString('base64'),
          },
        },
      ],
    },
  }
}

const post = (token: string, body: object) =>
  server().post('/api/v1/sync/batch').set('Authorization', `Bearer ${token}`).send(body)

async function count(sql: string, params: unknown[] = []): Promise<number> {
  const res = await ownerPool.query(sql, params)
  return res.rowCount ?? 0
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

  syncVolume = await mkdtemp(join(tmpdir(), 'terreno-sync-'))

  process.env.DATABASE_URL = ownerUrl
  process.env.APP_DATABASE_URL = ownerUrl.replace('test:test@', 'tc_app:test@')
  process.env.JWT_ACCESS_SECRET = 'test-access-secret-32bytes-long!!!!!'
  process.env.SYNC_VOLUME = syncVolume
  process.env.NODE_ENV = 'test'

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
  app = configureApp(moduleRef.createNestApplication())
  await app.init()

  const loginRes = await server()
    .post('/api/v1/auth/login')
    .send({ email: 'trabajador@minera.cl', password: DEMO_PASSWORD })
  expect(loginRes.status).toBe(200)
  access = loginRes.body.access_token as string

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

describe('lote completo (FR-020, FR-024, NFR-03)', () => {
  it('procesa los 5 registros en orden de dependencias y responde status ok', async () => {
    const { batch } = baseBatch()

    const res = await post(access, batch)
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      batch_id: batch.batch_id,
      status: 'ok',
      records_total: 5,
      records_ok: 5,
      records_failed: 0,
      records_unchanged: 0,
      errors: [],
    })

    const expected: Array<[string, string]> = [
      ['inspection', batch.records[0].id],
      ['inspection_response', batch.records[1].id],
      ['finding', batch.records[2].id],
      ['log_entry', batch.records[3].id],
      ['attachment', batch.records[4].id],
    ]
    for (const [table, id] of expected) {
      expect(await count(`SELECT 1 FROM ${table} WHERE id = $1`, [id])).toBe(1)
    }

    const inspection = await ownerPool.query(
      'SELECT synced_at FROM inspection WHERE id = $1',
      [batch.records[0].id],
    )
    expect(inspection.rows[0].synced_at).not.toBeNull()

    const syncLog = await ownerPool.query(
      'SELECT status, records_total, records_ok, records_failed, started_at, finished_at FROM sync_log WHERE batch_id = $1',
      [batch.batch_id],
    )
    expect(syncLog.rowCount).toBe(1)
    expect(syncLog.rows[0]).toMatchObject({
      status: 'ok',
      records_total: 5,
      records_ok: 5,
      records_failed: 0,
    })
    expect(syncLog.rows[0].started_at).not.toBeNull()
    expect(syncLog.rows[0].finished_at).not.toBeNull()

    const file = await import('node:fs/promises').then((fs) =>
      fs.readFile(join(syncVolume, 'sync', TENANT_A_ID, `${batch.records[4].id}.png`)),
    )
    expect(file.equals(TINY_PNG)).toBe(true)
  })

  it('reenviar el MISMO lote es idempotente: no duplica ni altera filas (FR-021)', async () => {
    const { batch } = baseBatch()
    const first = await post(access, batch)
    expect(first.status).toBe(200)
    expect(first.body.status).toBe('ok')

    const before = await ownerPool.query(
      'SELECT updated_at, client_version FROM inspection WHERE id = $1',
      [batch.records[0].id],
    )

    const replay = await post(access, JSON.parse(JSON.stringify(batch)))
    expect(replay.status).toBe(200)
    expect(replay.body).toMatchObject({
      status: 'ok',
      records_total: 5,
      records_ok: 5,
      records_failed: 0,
      records_unchanged: 5,
    })

    expect(
      await count('SELECT 1 FROM inspection_response WHERE inspection_id = $1', [
        batch.records[0].id,
      ]),
    ).toBe(1)

    const after = await ownerPool.query(
      'SELECT updated_at, client_version FROM inspection WHERE id = $1',
      [batch.records[0].id],
    )
    expect(after.rows[0].updated_at).toEqual(before.rows[0].updated_at)
    expect(after.rows[0].client_version).toEqual(before.rows[0].client_version)

    const logs = await count('SELECT 1 FROM sync_log WHERE batch_id = $1', [batch.batch_id])
    expect(logs).toBe(2)
  })
})

describe('referencias inválidas (FR-021 parcial)', () => {
  it('registro con referencia inexistente → status partial y errors[] acotado', async () => {
    const { batch } = baseBatch()
    // Rompe una referencia de hoja (log_entry → site inexistente): no arrastra
    // a registros dependientes y aísla el fallo a ese registro.
    ;(batch.records[3].payload as { site_id: string }).site_id = uuid()

    const res = await post(access, batch)
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('partial')
    expect(res.body.records_total).toBe(5)
    expect(res.body.records_failed).toBe(1)
    expect(res.body.records_ok).toBe(4)
    expect(res.body.errors).toHaveLength(1)
    expect(res.body.errors[0]).toContain('log_entry:')

    const syncLog = await ownerPool.query(
      'SELECT status, records_failed FROM sync_log WHERE batch_id = $1',
      [batch.batch_id],
    )
    expect(syncLog.rows[0]).toMatchObject({ status: 'partial', records_failed: 1 })
  })
})

describe('aislamiento cross-tenant (FR-025)', () => {
  it('registro con otro tenant_id → 409 previo a escritura + incidente en audit_log', async () => {
    const { batch } = baseBatch()
    batch.records[0].tenant_id = TENANT_B_ID

    const countsBefore = await count('SELECT 1 FROM inspection')
    const res = await post(access, batch)

    expect(res.status).toBe(409)
    expect(String(res.body.message)).toMatch(/tenant distinto/i)

    expect(await count('SELECT 1 FROM inspection')).toBe(countsBefore)
    expect(await count('SELECT 1 FROM sync_log WHERE batch_id = $1', [batch.batch_id])).toBe(0)

    const audit = await ownerPool.query(
      "SELECT payload FROM audit_log WHERE action = 'sync_tenant_mismatch' ORDER BY occurred_at DESC LIMIT 1",
    )
    expect(audit.rowCount ?? 0).toBeGreaterThan(0)
    const payload = audit.rows[0].payload as {
      jwt_tenant_id: string
      foreign_tenant_ids: string[]
    }
    expect(payload.jwt_tenant_id).toBe(TENANT_A_ID)
    expect(payload.foreign_tenant_ids).toEqual([TENANT_B_ID])
  })

  it('sin token → 401', async () => {
    const { batch } = baseBatch()
    const res = await server().post('/api/v1/sync/batch').send(batch)
    expect(res.status).toBe(401)
  })
})
