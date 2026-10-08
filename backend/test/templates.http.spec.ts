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
import { parseTemplateDefinition, RESPONSE_TYPES } from '@terreno/shared'
import { AppModule } from '../src/app.module'
import { configureApp } from '../src/app.setup'
import {
  DEMO_PASSWORD,
  TEMPLATE_A_REVISION_DRAFT_ID,
  TEMPLATE_A_REVISION_PUBLISHED_ID,
  TEMPLATE_B_REVISION_PUBLISHED_ID,
  TENANT_A_ID,
  seedDatabase,
} from '../db/seed'

/**
 * TSK-FORM-001 — endpoints de lectura de plantillas para el renderer
 * (FR-018, FR-027, FR-036, FR-048/049).
 *
 * Corre sobre PostgreSQL 16 real (Testcontainers): migraciones + seed con la
 * definición de 8 tipos + RLS. Verifica:
 *  - `GET /templates` devuelve la revisión publicada del tenant con su
 *    `definition` renderizable y los 8 `response_type` (FR-036);
 *  - el delta `since=` filtra por `version` y reporta `latest_version` (FR-027);
 *  - aislamiento por tenant (FR-007) y rol: borradores sólo para
 *    `tenant_admin`; platform_admin/sin sesión → 403/401;
 *  - el catálogo materializado del seed es legible (base de import/export).
 */

const MIGRATIONS_DIR = resolve(process.cwd(), 'db', 'migrations')

let container: StartedPostgreSqlContainer
let ownerPool: Pool
let app: INestApplication

let trabajadorToken: string
let adminToken: string
let supervisorBToken: string
let platformToken: string

const server = () => request(app.getHttpServer())
const get = (token: string | null, path: string) =>
  token
    ? server().get(path).set('Authorization', `Bearer ${token}`)
    : server().get(path)

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
  adminToken = await login('admin@minera.cl')
  supervisorBToken = await login('supervisor@andes.cl')
  platformToken = await login('admin@terreno.local')
}, 180_000)

afterAll(async () => {
  await app?.close()
  await ownerPool?.end()
  await container?.stop()
})

describe('GET /api/v1/templates', () => {
  it('devuelve la revisión publicada del tenant con los 8 tipos renderizables', async () => {
    const res = await get(trabajadorToken, '/api/v1/templates')
    expect(res.status).toBe(200)
    expect(res.body.items).toHaveLength(1)

    const [pub] = res.body.items
    expect(pub.name).toBe('Chequeo de seguridad minera')
    expect(pub.version).toBe(1)
    expect(pub.revision_id).toBe(TEMPLATE_A_REVISION_PUBLISHED_ID)
    expect(res.body.latest_version).toBe(1)

    // La definición pasa por el MISMO contrato que validó al guardarla
    // (FR-039): "plantilla guardada ⇒ render válida" es una invariante.
    const def = parseTemplateDefinition(pub.definition)
    const tipos = def.sections.flatMap((s) => s.items.map((i) => i.response_type))
    expect(new Set(tipos)).toEqual(new Set(RESPONSE_TYPES))
    expect(def.sections.flatMap((s) => s.items)).toHaveLength(9)
  })

  it('el delta since= filtra versiones y reporta latest_version', async () => {
    const desdeCero = await get(trabajadorToken, '/api/v1/templates?since=0')
    expect(desdeCero.status).toBe(200)
    expect(desdeCero.body.items).toHaveLength(1)
    // El caché offline del dispositivo filtra por este tenant_id (FR-007).
    expect(desdeCero.body.items[0].tenant_id).toBe(TENANT_A_ID)

    const yaDescargado = await get(trabajadorToken, '/api/v1/templates?since=1')
    expect(yaDescargado.status).toBe(200)
    expect(yaDescargado.body.items).toHaveLength(0)
    expect(yaDescargado.body.latest_version).toBe(1)
  })

  it('rechaza un since no entero con 400', async () => {
    const res = await get(trabajadorToken, '/api/v1/templates?since=abc')
    expect(res.status).toBe(400)
  })

  it('aisla por tenant: el supervisor de B sólo ve la plantilla de B', async () => {
    const res = await get(supervisorBToken, '/api/v1/templates')
    expect(res.status).toBe(200)
    expect(res.body.items).toHaveLength(1)
    expect(res.body.items[0].name).toBe('Inspección de obra')
    expect(res.body.items[0].revision_id).toBe(TEMPLATE_B_REVISION_PUBLISHED_ID)
  })

  it('platform_admin no lee plantillas de tenant (403) y sin sesión da 401', async () => {
    const plat = await get(platformToken, '/api/v1/templates')
    expect(plat.status).toBe(403)
    const anon = await get(null, '/api/v1/templates')
    expect(anon.status).toBe(401)
  })
})

describe('GET /api/v1/templates/revisions/:id', () => {
  it('devuelve una revisión publicada a cualquier miembro del tenant', async () => {
    const res = await get(trabajadorToken, `/api/v1/templates/revisions/${TEMPLATE_A_REVISION_PUBLISHED_ID}`)
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('published')
    expect(res.body.version).toBe(1)
    expect(parseTemplateDefinition(res.body.definition).sections.length).toBeGreaterThan(0)
  })

  it('el borrador lo lee sólo tenant_admin (FR-048): worker 403, admin 200', async () => {
    const worker = await get(trabajadorToken, `/api/v1/templates/revisions/${TEMPLATE_A_REVISION_DRAFT_ID}`)
    expect(worker.status).toBe(403)
    const admin = await get(adminToken, `/api/v1/templates/revisions/${TEMPLATE_A_REVISION_DRAFT_ID}`)
    expect(admin.status).toBe(200)
    expect(admin.body.status).toBe('draft')
    expect(admin.body.version).toBeNull()
  })

  it('no expone revisiones de otro tenant (404 vía RLS, FR-007)', async () => {
    const res = await get(trabajadorToken, `/api/v1/templates/revisions/${TEMPLATE_B_REVISION_PUBLISHED_ID}`)
    expect(res.status).toBe(404)
  })
})

describe('catálogo materializado del seed (fixture TSK-FORM-001)', () => {
  it('publica 9 ítems tipados en template_item para import/export', async () => {
    const { rows } = await ownerPool.query(
      `SELECT COUNT(*)::int AS n FROM template_item i
       JOIN template_section s ON s.id = i.section_id
       WHERE s.revision_id = $1`,
      [TEMPLATE_A_REVISION_PUBLISHED_ID],
    )
    expect(rows[0].n).toBe(9)
  })
})
