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
import {
  DEMO_PASSWORD,
  SITE_B_ID,
  TENANT_A_ID,
  TENANT_B_ID,
  seedDatabase,
} from '../db/seed'

/**
 * TSK-WS-011 — Dashboard mínimo del supervisor (spec 005, FR-035/040/043).
 *
 * Verifica el consumo read-only REST:
 *  - `GET /api/v1/sites` devuelve sólo las faenas/obras del tenant.
 *  - `GET /api/v1/dashboard/summary` agrega inspecciones/hallazgos, urgentes,
 *    latencia media + p95 (captured_at→synced_at) y separa por tenant (RLS).
 *  - `GET /api/v1/dashboard/findings` lista con filtros (faena, rango,
 *    severidad, estado) y la foto más reciente (metadata).
 *  - Aurorización: supervisor/tenant_admin OK; field_worker y platform_admin
 *    → 403; sin sesión → 401. Inputs inválidos → 400.
 */

const MIGRATIONS_DIR = resolve(process.cwd(), 'db', 'migrations')

let container: StartedPostgreSqlContainer
let ownerPool: Pool
let app: INestApplication

let trabajadorToken: string
let supervisorToken: string
let adminToken: string
let supervisorBTok: string
let platformToken: string

let siteA: string
let siteB: string
let workerA: string
let workerB: string

const server = () => request(app.getHttpServer())

const uuid = () => randomUUID()

const batcher = (token: () => string) => (records: Array<Record<string, unknown>>) =>
  server()
    .post('/api/v1/sync/batch')
    .set('Authorization', `Bearer ${token()}`)
    .send({ batch_id: uuid(), device_id: uuid(), records })

const syncBatchA = batcher(() => trabajadorToken as string)
const syncBatchB = batcher(() => supervisorBTok as string)

const get = (token: string, path: string) =>
  server().get(path).set('Authorization', `Bearer ${token}`)
const getQuery = (token: string, path: string, query: Record<string, string>) =>
  get(token, `${path}?${new URLSearchParams(query)}`)

async function count(sql: string, params: unknown[] = []): Promise<number> {
  const res = await ownerPool.query(sql, params)
  return Number(res.rows[0]?.n ?? 0)
}

/** Envía un lote demo con inspección, respuesta, hallazgo y foto ligados. */
function buildDemoBatch(tenantId: string, site: string, worker: string) {
  const inspectionId = uuid()
  const responseId = uuid()
  const findingId = uuid()
  const attachmentId = uuid()
  const capturedAt = '2026-10-05T09:00:00.000Z'

  const inspection = {
    entity_type: 'inspection',
    id: inspectionId,
    tenant_id: tenantId,
    client_version: 1,
    captured_at: capturedAt,
    payload: {
      site_id: site,
      template_id: uuid(),
      template_version: 1,
      executed_by: worker,
      status: 'submitted',
    },
  }
  const response = {
    entity_type: 'response',
    id: responseId,
    tenant_id: tenantId,
    client_version: 1,
    captured_at: capturedAt,
    payload: {
      inspection_id: inspectionId,
      template_item_id: uuid(),
      value_ok: 'nok',
      value_text: 'Conexión a tierra sin continuidad',
      value_number: null,
    },
  }
  const finding = {
    entity_type: 'finding',
    id: findingId,
    tenant_id: tenantId,
    client_version: 1,
    captured_at: capturedAt,
    payload: {
      inspection_id: inspectionId,
      response_id: responseId,
      severity: 'high',
      description: 'Conexión a tierra del tablero sin continuidad',
      status: 'open',
    },
  }
  const attachment = {
    entity_type: 'attachment',
    id: attachmentId,
    tenant_id: tenantId,
    client_version: 1,
    captured_at: capturedAt,
    payload: {
      owner_type: 'finding',
      owner_id: findingId,
      mime: 'image/jpeg',
      bytes: 5,
      width: 1280,
      height: 720,
      data: 'aGVsbG8=', // no se persiste: los bytes van al volumen (sync.service)
    },
  }
  return {
    records: [inspection, response, finding, attachment],
    ids: { inspectionId, responseId, findingId, attachmentId },
    capturedAt,
  }
}

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('terreno')
    .start()

  const ownerUrl = container.getConnectionUri()
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

  const login = async (email: string) => {
    const res = await server()
      .post('/api/v1/auth/login')
      .send({ email, password: DEMO_PASSWORD })
    expect(res.status).toBe(200)
    return res.body.access_token as string
  }

  trabajadorToken = await login('trabajador@minera.cl')
  supervisorToken = await login('supervisor@minera.cl')
  adminToken = await login('admin@minera.cl')
  supervisorBTok = await login('supervisor@andes.cl')
  platformToken = await login('admin@terreno.local')

  const siteRows = await ownerPool.query('SELECT id, name FROM site ORDER BY name')
  siteA = siteRows.rows[0].id
  siteB = SITE_B_ID
  const workerRows = await ownerPool.query(
    "SELECT id FROM app_user WHERE tenant_id = $1 AND email = 'trabajador@minera.cl'",
    [TENANT_A_ID],
  )
  workerA = workerRows.rows[0].id
  const workerBRows = await ownerPool.query(
    "SELECT id FROM app_user WHERE tenant_id = $1 AND email = 'trabajador@andes.cl'",
    [TENANT_B_ID],
  )
  workerB = workerBRows.rows[0].id
}, 180_000)

afterAll(async () => {
  await app?.close()
  await ownerPool?.end()
  await container?.stop()
})

describe('ingesta demo de ambos tenants', () => {
  it('el lote del tenant A y del tenant B se aplican', async () => {
    const a = buildDemoBatch(TENANT_A_ID, siteA, workerA)
    const res = await syncBatchA(a.records)
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('ok')

    const b = buildDemoBatch(TENANT_B_ID, siteB, workerB)
    const resB = await syncBatchB(b.records)
    expect(resB.status).toBe(200)
    expect(resB.body.status).toBe('ok')

    expect(await count('SELECT count(*)::int AS n FROM finding')).toBe(2)
  })
})

describe('GET /api/v1/sites (FR-006, identidad offline)', () => {
  it('un field_worker ve sólo las faenas/obras de su tenant + su identidad', async () => {
    const res = await get(trabajadorToken, '/api/v1/sites')
    expect(res.status).toBe(200)
    const names = (res.body.items as Array<{ nombre: string }>).map((s) => s.nombre)
    expect(names).toContain('Faena El Roble')
    expect(names).not.toContain('Obra Costanera')
    // TSK-WS-011: el nombre del tenant viaja en la respuesta (bootstrapea la
    // identidad offline, FR-006).
    expect(res.body.tenant).toMatchObject({ nombre: 'Minera El Cobre SpA' })
  })

  it('platform_admin sin tenant → 403', async () => {
    expect((await get(platformToken, '/api/v1/sites')).status).toBe(403)
  })
})

describe('GET /api/v1/dashboard/summary (FR-035/040/043)', () => {
  it('agrega las métricas del tenant A y aísla al tenant B (RLS)', async () => {
    const res = await get(supervisorToken, '/api/v1/dashboard/summary')
    expect(res.status).toBe(200)
    const body = res.body as {
      faenas: Array<{ id: string }>
      inspecciones_por_estado: Record<string, number>
      hallazgos_por_severidad: Record<string, number>
      hallazgos_total: number
      hallazgos_urgentes: number
      latencia_media_seg: number | null
      latencia_p95_seg: number | null
    }
    expect(body.inspecciones_por_estado.submitted).toBe(1)
    expect(body.hallazgos_por_severidad.high).toBe(1)
    expect(body.hallazgos_total).toBe(1)
    expect(body.hallazgos_urgentes).toBe(1)
    // FR-040: latencia captura → disponibilidad en segundos, p95 incluido.
    expect(body.latencia_media_seg).toBeGreaterThan(0)
    expect(body.latencia_p95_seg).toBeGreaterThan(0)
    // RLS: no filtra hallazgos del tenant B.
    expect(body.hallazgos_total).not.toBe(2)
    expect(body.faenas.length).toBe(1)
  })

  it('filtra por faena y rango de fechas', async () => {
    const res = await getQuery(supervisorToken, '/api/v1/dashboard/summary', {
      site_id: siteA,
      desde: '2026-10-04T00:00:00.000Z',
      hasta: '2026-10-06T00:00:00.000Z',
    })
    expect(res.status).toBe(200)
    expect(res.body.inspecciones_por_estado.submitted).toBe(1)

    // Fuera de rango → vacío.
    const fuera = await getQuery(supervisorToken, '/api/v1/dashboard/summary', {
      desde: '2026-09-01T00:00:00.000Z',
      hasta: '2026-09-30T00:00:00.000Z',
    })
    expect(fuera.status).toBe(200)
    expect(fuera.body.hallazgos_total).toBe(0)
    expect(fuera.body.inspecciones_por_estado.submitted).toBe(0)
  })

  it('rechaza filtros inválidos (400)', async () => {
    expect((await getQuery(supervisorToken, '/api/v1/dashboard/summary', { site_id: 'abc' })).status).toBe(400)
    expect((await getQuery(supervisorToken, '/api/v1/dashboard/summary', { desde: 'no-es-fecha' })).status).toBe(400)
  })

  it('roles: field_worker y platform_admin → 403, anónimo → 401', async () => {
    expect((await get(trabajadorToken, '/api/v1/dashboard/summary')).status).toBe(403)
    expect((await get(platformToken, '/api/v1/dashboard/summary')).status).toBe(403)
    expect((await server().get('/api/v1/dashboard/summary')).status).toBe(401)
  })

  it('un tenant_admin del tenant también consume el dashboard', async () => {
    const res = await get(adminToken, '/api/v1/dashboard/summary')
    expect(res.status).toBe(200)
    expect(res.body.faenas.length).toBe(1)
  })
})

describe('GET /api/v1/dashboard/findings (FR-040)', () => {
  it('lista hallazgos con autor, faena y metadata de la foto', async () => {
    const res = await get(supervisorToken, '/api/v1/dashboard/findings')
    expect(res.status).toBe(200)
    const item = (res.body.items as Array<Record<string, unknown>>)[0]
    expect(item).toMatchObject({
      severity: 'high',
      status: 'open',
      description: 'Conexión a tierra del tablero sin continuidad',
      autor: 'Pedro Trabajador',
      faena_nombre: 'Faena El Roble',
      foto_mime: 'image/jpeg',
      foto_bytes: 5,
      foto_ancho: 1280,
      foto_alto: 720,
    })
    expect(item?.foto_id).toBeTypeOf('string')
    expect(res.body.total).toBe(1)
  })

  it('filtra por severidad, estado y faena', async () => {
    const sev = await getQuery(supervisorToken, '/api/v1/dashboard/findings', { severidad: 'critical' })
    expect(sev.status).toBe(200)
    expect(sev.body.total).toBe(0)

    const est = await getQuery(supervisorToken, '/api/v1/dashboard/findings', { estado: 'open' })
    expect(est.body.total).toBe(1)

    const faenaB = await getQuery(supervisorToken, '/api/v1/dashboard/findings', { site_id: siteA })
    expect(faenaB.body.total).toBe(1)
    expect(faenaB.body.items[0].faena_nombre).toBe('Faena El Roble')
  })

  it('un supervisor del tenant B no ve hallazgos del A (RLS)', async () => {
    const res = await get(supervisorBTok, '/api/v1/dashboard/findings')
    expect(res.status).toBe(200)
    expect(res.body.total).toBe(1)
    expect(res.body.items[0].faena_nombre).toBe('Obra Costanera')
  })

  it('field_worker → 403', async () => {
    expect((await get(trabajadorToken, '/api/v1/dashboard/findings')).status).toBe(403)
  })
})