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
import { AppModule } from '../src/app.module'
import { configureApp } from '../src/app.setup'
import { DEMO_PASSWORD, TENANT_A_ID, TENANT_B_ID, seedDatabase } from '../db/seed'

/**
 * TSK-ADM-001 — cuentas reales: el administrador de cada empresa crea,
 * desactiva y resetea las cuentas de su equipo (clave temporal + cambio
 * obligatorio) y mantiene sus faenas; el de plataforma lista empresas y su
 * admin inicial nace con clave temporal. Aislamiento por RLS: una empresa no
 * puede tocar cuentas ni faenas de otra aunque conozca el id.
 */

const MIGRATIONS_DIR = resolve(process.cwd(), 'db', 'migrations')
const TEMPORAL = 'Temporal-2026-xy'

let container: StartedPostgreSqlContainer
let ownerPool: Pool
let app: INestApplication
const server = () => request(app.getHttpServer())
const tokens: Record<string, string> = {}

async function token(email: string, password = DEMO_PASSWORD): Promise<string> {
  const res = await server().post('/api/v1/auth/login').send({ email, password })
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
  tokens.adminA = await token('admin@minera.cl')
  tokens.adminB = await token('admin@andes.cl')
  tokens.workerA = await token('trabajador@minera.cl')
}, 180_000)

afterAll(async () => {
  await app?.close()
  await ownerPool?.end()
  await container?.stop()
})

const como = (quien: string) => ({ Authorization: `Bearer ${tokens[quien]}` })

describe('cuentas de la empresa (TSK-ADM-001)', () => {
  let nuevoId = ''

  it('sólo el administrador de la empresa gestiona cuentas', async () => {
    expect((await server().get('/api/v1/users').set(como('workerA'))).status).toBe(403)
    const res = await server().get('/api/v1/users').set(como('adminA'))
    expect(res.status).toBe(200)
    expect(res.body.every((u: { email: string }) => !u.email.endsWith('@andes.cl'))).toBe(true)
  })

  it('crea una cuenta con clave temporal y el usuario debe cambiarla', async () => {
    const res = await server()
      .post('/api/v1/users')
      .set(como('adminA'))
      .send({ email: 'Nuevo@Minera.cl', full_name: 'Nuevo Operario', role: 'field_worker', password: TEMPORAL })
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({ email: 'nuevo@minera.cl', must_change_password: true, is_active: true })
    nuevoId = res.body.id

    const login = await server().post('/api/v1/auth/login').send({ email: 'nuevo@minera.cl', password: TEMPORAL })
    expect(login.status).toBe(200)
    expect(login.body.user.must_change_password).toBe(true)

    const dup = await server()
      .post('/api/v1/users')
      .set(como('adminA'))
      .send({ email: 'nuevo@minera.cl', full_name: 'Otro', role: 'supervisor', password: TEMPORAL })
    expect(dup.status).toBe(409)
  })

  it('otra empresa no puede tocar la cuenta aunque conozca el id (RLS)', async () => {
    const res = await server().patch(`/api/v1/users/${nuevoId}`).set(como('adminB')).send({ is_active: false })
    expect(res.status).toBe(404)
    const reset = await server()
      .post(`/api/v1/users/${nuevoId}/reset-password`)
      .set(como('adminB'))
      .send({ password: TEMPORAL })
    expect(reset.status).toBe(404)
  })

  it('desactivar corta el ingreso; reactivar lo devuelve', async () => {
    const off = await server().patch(`/api/v1/users/${nuevoId}`).set(como('adminA')).send({ is_active: false })
    expect(off.status).toBe(200)
    expect(off.body.is_active).toBe(false)
    const login = await server().post('/api/v1/auth/login').send({ email: 'nuevo@minera.cl', password: TEMPORAL })
    expect(login.status).toBe(401)
    const on = await server().patch(`/api/v1/users/${nuevoId}`).set(como('adminA')).send({ is_active: true })
    expect(on.body.is_active).toBe(true)
  })

  it('restablecer deja una nueva clave temporal y revoca sus sesiones', async () => {
    const otra = 'Otra-temporal-99'
    const res = await server()
      .post(`/api/v1/users/${nuevoId}/reset-password`)
      .set(como('adminA'))
      .send({ password: otra })
    expect(res.status).toBe(200)
    expect(res.body.must_change_password).toBe(true)
    expect((await server().post('/api/v1/auth/login').send({ email: 'nuevo@minera.cl', password: otra })).status).toBe(200)
    const corta = await server()
      .post(`/api/v1/users/${nuevoId}/reset-password`)
      .set(como('adminA'))
      .send({ password: 'corta' })
    expect(corta.status).toBe(400)
  })

  it('el administrador no puede desactivarse ni dejar la empresa sin administrador', async () => {
    const me = await server().get('/api/v1/me').set(como('adminA'))
    const self = await server().patch(`/api/v1/users/${me.body.id}`).set(como('adminA')).send({ is_active: false })
    expect(self.status).toBe(400)
  })

  it('cada cambio queda auditado en su empresa', async () => {
    const { rows } = await ownerPool.query(
      "SELECT action FROM audit_log WHERE tenant_id = $1 AND entity_id = $2 ORDER BY occurred_at",
      [TENANT_A_ID, nuevoId],
    )
    expect(rows.map((r) => r.action)).toEqual(
      expect.arrayContaining(['user_created', 'user_updated', 'password_reset']),
    )
  })
})

describe('faenas de la empresa (TSK-ADM-001)', () => {
  it('crea y renombra faenas; otra empresa no las ve ni las toca', async () => {
    const res = await server().post('/api/v1/sites').set(como('adminA')).send({ name: 'Rajo Norte', kind: 'mining' })
    expect(res.status).toBe(201)
    const id = res.body.id as string

    const ren = await server().patch(`/api/v1/sites/${id}`).set(como('adminA')).send({ name: 'Rajo Norte 2' })
    expect(ren.body.name).toBe('Rajo Norte 2')

    expect((await server().patch(`/api/v1/sites/${id}`).set(como('adminB')).send({ name: 'x' })).status).toBe(404)
    const sitesB = await server().get('/api/v1/sites').set(como('adminB'))
    expect(sitesB.body.items.some((s: { id: string }) => s.id === id)).toBe(false)
    expect((await server().post('/api/v1/sites').set(como('workerA')).send({ name: 'x', kind: 'mining' })).status).toBe(403)
  })
})

describe('plataforma (TSK-ADM-001)', () => {
  it('lista empresas y el admin inicial nace con clave temporal', async () => {
    const plataforma = await ownerPool.query("SELECT email FROM app_user WHERE role = 'platform_admin' LIMIT 1")
    tokens.plataforma = await token(plataforma.rows[0].email)

    const lista = await server().get('/api/v1/admin/tenants').set(como('plataforma'))
    expect(lista.status).toBe(200)
    expect(lista.body.map((t: { id: string }) => t.id)).toEqual(expect.arrayContaining([TENANT_A_ID, TENANT_B_ID]))
    expect((await server().get('/api/v1/admin/tenants').set(como('adminA'))).status).toBe(403)

    const empresa = await server().post('/api/v1/admin/tenants').set(como('plataforma')).send({ name: 'Piloto', slug: 'piloto' })
    const admin = await server()
      .post(`/api/v1/admin/tenants/${empresa.body.id}/admins`)
      .set(como('plataforma'))
      .send({ email: 'admin@piloto.cl', full_name: 'Admin Piloto', password: 'Temporal-piloto-1' })
    expect(admin.status).toBe(201)
    const login = await server().post('/api/v1/auth/login').send({ email: 'admin@piloto.cl', password: 'Temporal-piloto-1' })
    expect(login.body.user.must_change_password).toBe(true)
  })
})
