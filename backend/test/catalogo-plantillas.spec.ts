import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
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
import { CATALOGO_PLANTILLAS, type TemplateDefinition } from '@terreno/shared'
import { DEMO_PASSWORD, seedDatabase } from '../db/seed'

/**
 * TSK-FORM-025 (FR-070) — catálogo de plantillas de inicio.
 *
 * Lo que la app manda al usar una plantilla del catálogo (la definición con ids
 * nuevos) el servidor lo acepta y lo publica por el camino normal, para las
 * ocho plantillas; y sólo administración puede hacerlo.
 */

/** Igual que `duplicarDefinicion` del frontend: ids nuevos para todo. */
function copia(def: TemplateDefinition): TemplateDefinition {
  return {
    ...def,
    sections: def.sections.map((s) => ({ ...s, id: randomUUID(), items: s.items.map((i) => ({ ...i, id: randomUUID() })) })),
  }
}

const MIGRATIONS_DIR = resolve(process.cwd(), 'db', 'migrations')

let container: StartedPostgreSqlContainer
let ownerPool: Pool
let app: INestApplication
let syncVolume: string

const server = () => request(app.getHttpServer())
const t: Record<string, string> = {}
const ids: Record<string, string> = {}
const como = (q: string) => ({ Authorization: `Bearer ${t[q]}` })

async function login(email: string) {
  const res = await server().post('/api/v1/auth/login').send({ email, password: DEMO_PASSWORD })
  expect(res.status).toBe(200)
  return { token: res.body.access_token as string, id: res.body.user.id as string }
}

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').withDatabase('terreno').start()
  const url = container.getConnectionUri()
  await runner({ databaseUrl: url, dir: MIGRATIONS_DIR, direction: 'up', migrationsTable: 'pgmigrations' })
  ownerPool = poolDePrueba(url)
  await seedDatabase(ownerPool)
  await ownerPool.query("ALTER ROLE tc_app LOGIN PASSWORD 'test'")
  syncVolume = await mkdtemp(join(tmpdir(), 'terreno-catalogo-'))
  process.env.DATABASE_URL = url
  process.env.APP_DATABASE_URL = url.replace('test:test@', 'tc_app:test@')
  process.env.JWT_ACCESS_SECRET = 'test-access-secret-32bytes-long!!!!!'
  process.env.SYNC_VOLUME = syncVolume
  process.env.NODE_ENV = 'test'
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
  app = configureApp(moduleRef.createNestApplication())
  await app.init()
  for (const [k, email] of [
    ['adminA', 'admin@minera.cl'],
    ['workerA', 'trabajador@minera.cl'],
  ] as const) {
    const r = await login(email)
    t[k] = r.token
    ids[k] = r.id
  }
}, 180_000)

afterAll(async () => {
  await app?.close()
  await ownerPool?.end()
  await container?.stop()
  if (syncVolume) await rm(syncVolume, { recursive: true, force: true })
})

describe('catálogo de plantillas (TSK-FORM-025)', () => {
  it.each(CATALOGO_PLANTILLAS.map((p) => [p.nombre, p] as const))('«%s» se crea y publica en la empresa', async (_n, p) => {
    const creada = await server()
      .post('/api/v1/templates')
      .set(como('adminA'))
      .send({ name: p.nombre, definition: copia(p.definition) })
    expect([200, 201]).toContain(creada.status)
    const pub = await server().post(`/api/v1/templates/revisions/${creada.body.id}/publish`).set(como('adminA'))
    expect([200, 201]).toContain(pub.status)
    const { rows } = await ownerPool.query(
      "SELECT r.definition FROM template_revision r JOIN template t ON t.id = r.template_id WHERE t.name = $1 AND r.status = 'published'",
      [p.nombre],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].definition.closing ?? {}).toEqual(p.definition.closing ?? {})
  })

  it('un trabajador no puede crear formularios desde el catálogo', async () => {
    const p = CATALOGO_PLANTILLAS[0]
    const res = await server()
      .post('/api/v1/templates')
      .set(como('workerA'))
      .send({ name: 'Intento', definition: copia(p.definition) })
    expect(res.status).toBe(403)
  })
})
