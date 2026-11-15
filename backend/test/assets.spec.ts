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
import { createHash } from 'node:crypto'
import { DEMO_PASSWORD, SITE_A_ID, SITE_B_ID, TEMPLATE_A_ID, TENANT_A_ID, TENANT_B_ID, seedDatabase } from '../db/seed'

/**
 * TSK-OPS-003-C (FR-060/061) — activos y QR, tramo 1 (servidor).
 *
 *  - administración crea un activo y recibe el QR una sola vez; la base guarda
 *    sólo su SHA-256 y el alta queda auditada;
 *  - quien está asignado a esa faena y rol lo resuelve; otra empresa, un QR
 *    revocado o regenerado, un formulario sin asignación o una faena fuera de
 *    las de la cuenta responden 404 igual que un QR inexistente;
 *  - sólo `tenant_admin` gestiona activos; una faena de otra empresa se rechaza.
 */

const sha = (qr: string) => createHash('sha256').update(qr, 'utf8').digest('hex')

async function crearActivo(nombre = 'Camioneta CA-12', templateId = TEMPLATE_A_ID, siteId = SITE_A_ID) {
  const res = await server()
    .post('/api/v1/assets')
    .set(como('adminA'))
    .send({ name: nombre, kind: 'vehicle', site_id: siteId, template_id: templateId })
  expect(res.status).toBe(201)
  return res.body as { id: string; qr: string; status: string }
}

const resolver = (quien: string, qr: string) => server().get(`/api/v1/assets/resolver/${sha(qr)}`).set(como(quien))

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
  syncVolume = await mkdtemp(join(tmpdir(), 'terreno-assets-'))
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
    ['supA', 'supervisor@minera.cl'],
    ['adminB', 'admin@andes.cl'],
    ['workerB', 'trabajador@andes.cl'],
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

describe('activos y QR (TSK-OPS-003-C)', () => {
  it('crea el activo, entrega el QR una vez y guarda sólo su hash', async () => {
    const activo = await crearActivo()
    expect(activo.qr).toMatch(/^tc1:[A-Za-z0-9_-]{22}$/)
    const { rows } = await ownerPool.query('SELECT qr_token_hash, status FROM asset WHERE id = $1', [activo.id])
    expect(rows[0]).toEqual({ qr_token_hash: sha(activo.qr), status: 'active' })
    expect(JSON.stringify(rows[0])).not.toContain(activo.qr.slice(4))
    const audit = await ownerPool.query("SELECT payload FROM audit_log WHERE action = 'asset_created' AND entity_id = $1", [activo.id])
    expect(audit.rows).toHaveLength(1)
    expect(JSON.stringify(audit.rows[0].payload)).not.toContain(activo.qr.slice(4))
    const lista = await server().get('/api/v1/assets').set(como('adminA'))
    const enLista = lista.body.items.find((a: { id: string }) => a.id === activo.id)
    expect(enLista).toMatchObject({ name: 'Camioneta CA-12', kind: 'vehicle', site_id: SITE_A_ID, status: 'active' })
    expect(enLista).not.toHaveProperty('qr')
  })

  it('el trabajador y la supervisión asignados lo resuelven al formulario publicado', async () => {
    const activo = await crearActivo('Grúa horquilla GH-3')
    for (const quien of ['workerA', 'supA']) {
      const res = await resolver(quien, activo.qr)
      expect(res.status).toBe(200)
      expect(res.body).toMatchObject({ asset_id: activo.id, site_id: SITE_A_ID, template_id: TEMPLATE_A_ID })
      expect(res.body.revision_id).toBeTruthy()
    }
  })

  it('otra empresa no lo resuelve ni lo ve, y no puede colgarlo de una faena ajena', async () => {
    const activo = await crearActivo('Extintor E-7')
    expect((await resolver('workerB', activo.qr)).status).toBe(404)
    const listaB = await server().get('/api/v1/assets').set(como('adminB'))
    expect(listaB.body.items.some((a: { id: string }) => a.id === activo.id)).toBe(false)
    const ajena = await server()
      .post('/api/v1/assets')
      .set(como('adminA'))
      .send({ name: 'Intruso', kind: 'location', site_id: SITE_B_ID, template_id: TEMPLATE_A_ID })
    expect(ajena.status).toBe(400)
    const regenerarAjeno = await server().post(`/api/v1/assets/${activo.id}/regenerar`).set(como('adminB'))
    expect(regenerarAjeno.status).toBe(404)
  })

  it('sólo administración gestiona activos', async () => {
    expect((await server().get('/api/v1/assets').set(como('workerA'))).status).toBe(403)
    expect((await server().get('/api/v1/assets').set(como('supA'))).status).toBe(403)
    const res = await server()
      .post('/api/v1/assets')
      .set(como('supA'))
      .send({ name: 'X', kind: 'vehicle', site_id: SITE_A_ID, template_id: TEMPLATE_A_ID })
    expect(res.status).toBe(403)
  })

  it('regenerar invalida el QR anterior; revocar lo deja sin efecto y reactivar lo devuelve', async () => {
    const activo = await crearActivo('Andamio A-2')
    const nuevo = await server().post(`/api/v1/assets/${activo.id}/regenerar`).set(como('adminA'))
    expect(nuevo.status).toBe(201)
    expect(nuevo.body.qr).not.toBe(activo.qr)
    expect((await resolver('workerA', activo.qr)).status).toBe(404)
    expect((await resolver('workerA', nuevo.body.qr)).status).toBe(200)

    const revocado = await server().patch(`/api/v1/assets/${activo.id}/estado`).set(como('adminA')).send({ status: 'revoked' })
    expect(revocado.body.status).toBe('revoked')
    expect((await resolver('workerA', nuevo.body.qr)).status).toBe(404)
    await server().patch(`/api/v1/assets/${activo.id}/estado`).set(como('adminA')).send({ status: 'active' }).expect(200)
    expect((await resolver('workerA', nuevo.body.qr)).status).toBe(200)
    const acciones = await ownerPool.query('SELECT action FROM audit_log WHERE entity_id = $1 ORDER BY occurred_at', [activo.id])
    expect(acciones.rows.map((r) => r.action)).toEqual(['asset_created', 'asset_qr_regenerated', 'asset_revoked', 'asset_restored'])
  })

  it('un formulario sin asignación a la faena y rol no se abre por QR (administración sí lo ve)', async () => {
    const creada = await server()
      .post('/api/v1/templates')
      .set(como('adminA'))
      .send({ name: 'Sin asignar', definition: { sections: [{ title: 'S', items: [{ id: randomUUID(), prompt: 'P', response_type: 'ok_nok_na' }] }] } })
    expect([200, 201]).toContain((await server().post(`/api/v1/templates/revisions/${creada.body.id}/publish`).set(como('adminA'))).status)
    const activo = await crearActivo('Bodega B-1', creada.body.template_id as string)
    expect((await resolver('workerA', activo.qr)).status).toBe(404)
    expect((await resolver('adminA', activo.qr)).status).toBe(200)
  })

  it('una faena fuera de las asignadas a la cuenta no se abre (FR-065)', async () => {
    const otraFaena = randomUUID()
    await ownerPool.query("INSERT INTO site (id, tenant_id, name, kind) VALUES ($1, $2, 'Faena Norte', 'mining')", [otraFaena, TENANT_A_ID])
    const activo = await crearActivo('Generador G-1')
    await ownerPool.query('INSERT INTO user_site (tenant_id, user_id, site_id) VALUES ($1, $2, $3)', [TENANT_A_ID, ids.workerA, otraFaena])
    try {
      expect((await resolver('workerA', activo.qr)).status).toBe(404)
    } finally {
      await ownerPool.query('DELETE FROM user_site WHERE user_id = $1', [ids.workerA])
    }
    expect((await resolver('workerA', activo.qr)).status).toBe(200)
  })

  it('RLS: con el rol de la app y el tenant B no se ven ni se insertan activos de A', async () => {
    await crearActivo('Compresor C-4')
    const appPool = poolDePrueba(process.env.APP_DATABASE_URL as string)
    const cliente = await appPool.connect()
    try {
      await cliente.query('BEGIN')
      await cliente.query("SELECT set_config('app.tenant_id', $1, true)", [TENANT_B_ID])
      const visto = await cliente.query('SELECT count(*)::int AS n FROM asset')
      expect(visto.rows[0].n).toBe(0)
      await expect(
        cliente.query(
          "INSERT INTO asset (id, tenant_id, site_id, template_id, name, kind, qr_token_hash) VALUES ($1, $2, $3, $4, 'x', 'location', $5)",
          [randomUUID(), TENANT_A_ID, SITE_A_ID, TEMPLATE_A_ID, 'f'.repeat(64)],
        ),
      ).rejects.toThrow(/row-level security/)
      await cliente.query('ROLLBACK')
    } finally {
      cliente.release()
      await appPool.end()
    }
  })

  it('un hash mal formado es 400 y uno desconocido 404', async () => {
    expect((await server().get('/api/v1/assets/resolver/xyz').set(como('workerA'))).status).toBe(400)
    expect((await resolver('workerA', 'tc1:no-existe-este-codigo-0000')).status).toBe(404)
  })
})
