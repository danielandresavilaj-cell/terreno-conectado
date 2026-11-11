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
import { jwtVerify } from 'jose'
import { AppModule } from '../src/app.module'
import { configureApp } from '../src/app.setup'
import { DEMO_PASSWORD, TENANT_B_ID, seedDatabase } from '../db/seed'

/**
 * TSK-AUTH-010 — Login v1: clave temporal con cambio obligatorio, cambio de
 * clave propia, logout que revoca la sesión y refresh que respeta la empresa
 * suspendida. Archivo propio: no comparte el contador de rate-limit por IP con
 * `auth.spec.ts`.
 */

const MIGRATIONS_DIR = resolve(process.cwd(), 'db', 'migrations')
const SECRET = 'test-access-secret-32bytes-long!!!!!'
const NUEVA = 'Clave-Nueva-2026'

let container: StartedPostgreSqlContainer
let ownerPool: Pool
let app: INestApplication

const server = () => request(app.getHttpServer())

function cookies(setCookie: unknown): Map<string, string> {
  const jar = new Map<string, string>()
  const list = (Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : []) as string[]
  for (const line of list) {
    const pair = line.split(';')[0]
    const eq = pair.indexOf('=')
    jar.set(pair.slice(0, eq), pair.slice(eq + 1))
  }
  return jar
}

const login = (email: string, password: string) =>
  server().post('/api/v1/auth/login').send({ email, password })

const conCookies = (jar: Map<string, string>) => `rt=${jar.get('rt')}; csrf=${jar.get('csrf')}`

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').withDatabase('terreno').start()
  const url = container.getConnectionUri()
  await runner({ databaseUrl: url, dir: MIGRATIONS_DIR, direction: 'up', migrationsTable: 'pgmigrations' })
  ownerPool = new Pool({ connectionString: url })
  await seedDatabase(ownerPool)
  await ownerPool.query("ALTER ROLE tc_app LOGIN PASSWORD 'test'")

  process.env.DATABASE_URL = url
  process.env.APP_DATABASE_URL = url.replace('test:test@', 'tc_app:test@')
  process.env.JWT_ACCESS_SECRET = SECRET
  process.env.NODE_ENV = 'test'

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
  app = configureApp(moduleRef.createNestApplication())
  await app.init()
}, 180_000)

afterAll(async () => {
  await app?.close()
  await ownerPool?.end()
  await container?.stop()
})

describe('clave temporal (TSK-AUTH-010)', () => {
  it('el login informa must_change_password y el token sólo sirve para cambiarla', async () => {
    await ownerPool.query(
      "UPDATE app_user SET must_change_password = true WHERE email = 'supervisor@andes.cl'",
    )
    const res = await login('supervisor@andes.cl', DEMO_PASSWORD)
    expect(res.status).toBe(200)
    expect(res.body.user.must_change_password).toBe(true)
    const { payload } = await jwtVerify(res.body.access_token, new TextEncoder().encode(SECRET))
    expect(payload.mcp).toBe(true)

    const token = res.body.access_token as string
    const sitios = await server().get('/api/v1/sites').set('Authorization', `Bearer ${token}`)
    expect(sitios.status).toBe(403)
    expect(sitios.body.code).toBe('password_change_required')

    const perfil = await server().get('/api/v1/me').set('Authorization', `Bearer ${token}`)
    expect(perfil.status).toBe(200)
    expect(perfil.body.must_change_password).toBe(true)
  })

  it('valida la clave actual, el largo mínimo y que la nueva sea distinta', async () => {
    const { body } = await login('supervisor@andes.cl', DEMO_PASSWORD)
    const auth = { Authorization: `Bearer ${body.access_token}` }
    const cambiar = (current_password: string, new_password: string) =>
      server().post('/api/v1/auth/password').set(auth).send({ current_password, new_password })

    expect((await cambiar('incorrecta', NUEVA)).status).toBe(400)
    expect((await cambiar(DEMO_PASSWORD, 'corta')).status).toBe(400)
    expect((await cambiar(DEMO_PASSWORD, DEMO_PASSWORD)).status).toBe(400)
  })

  it('cambiarla libera la cuenta, revoca las otras sesiones y la clave vieja deja de servir', async () => {
    const otro = await login('supervisor@andes.cl', DEMO_PASSWORD)
    const jarOtro = cookies(otro.headers['set-cookie'])
    const res = await login('supervisor@andes.cl', DEMO_PASSWORD)

    const cambio = await server()
      .post('/api/v1/auth/password')
      .set('Authorization', `Bearer ${res.body.access_token}`)
      .send({ current_password: DEMO_PASSWORD, new_password: NUEVA })
    expect(cambio.status).toBe(200)
    expect(cambio.body.user.must_change_password).toBe(false)
    expect(cookies(cambio.headers['set-cookie']).has('rt')).toBe(true)

    const sitios = await server()
      .get('/api/v1/sites')
      .set('Authorization', `Bearer ${cambio.body.access_token}`)
    expect(sitios.status).toBe(200)

    const refreshViejo = await server()
      .post('/api/v1/auth/refresh')
      .set('Cookie', conCookies(jarOtro))
      .set('x-csrf-token', jarOtro.get('csrf') ?? '')
    expect(refreshViejo.status).toBe(401)

    expect((await login('supervisor@andes.cl', DEMO_PASSWORD)).status).toBe(401)
    expect((await login('supervisor@andes.cl', NUEVA)).status).toBe(200)

    const audit = await ownerPool.query(
      "SELECT payload FROM audit_log WHERE action = 'password_changed' AND tenant_id = $1",
      [TENANT_B_ID],
    )
    expect(audit.rows[0]?.payload).toMatchObject({ was_temporary: true })
  })
})

describe('logout (TSK-AUTH-010)', () => {
  it('revoca el refresh token de este dispositivo y borra las cookies', async () => {
    const res = await login('admin@andes.cl', DEMO_PASSWORD)
    const jar = cookies(res.headers['set-cookie'])

    const sinCsrf = await server().post('/api/v1/auth/logout').set('Cookie', conCookies(jar))
    expect(sinCsrf.status).toBe(401)

    const salir = await server()
      .post('/api/v1/auth/logout')
      .set('Cookie', conCookies(jar))
      .set('x-csrf-token', jar.get('csrf') ?? '')
    expect(salir.status).toBe(204)

    const refresh = await server()
      .post('/api/v1/auth/refresh')
      .set('Cookie', conCookies(jar))
      .set('x-csrf-token', jar.get('csrf') ?? '')
    expect(refresh.status).toBe(401)
  })

  it('sin cookie responde 204 (idempotente)', async () => {
    expect((await server().post('/api/v1/auth/logout')).status).toBe(204)
  })
})

describe('sesión reemplazada por otro dispositivo (TSK-AUTH-011)', () => {
  it('el refresh de la sesión anterior responde session_replaced, no reuso', async () => {
    const primera = await login('trabajador@andes.cl', DEMO_PASSWORD)
    const jar = cookies(primera.headers['set-cookie'])
    const segunda = await login('trabajador@andes.cl', DEMO_PASSWORD)
    expect(segunda.status).toBe(200)

    const refresh = await server()
      .post('/api/v1/auth/refresh')
      .set('Cookie', conCookies(jar))
      .set('x-csrf-token', jar.get('csrf') ?? '')
    expect(refresh.status).toBe(401)
    expect(refresh.body.code).toBe('session_replaced')

    // No se trató como robo: la sesión nueva sigue viva.
    const jar2 = cookies(segunda.headers['set-cookie'])
    const sigue = await server()
      .post('/api/v1/auth/refresh')
      .set('Cookie', conCookies(jar2))
      .set('x-csrf-token', jar2.get('csrf') ?? '')
    expect(sigue.status).toBe(200)
  })
})

describe('refresh con empresa suspendida (TSK-AUTH-010)', () => {
  it('deja de renovar la sesión', async () => {
    const res = await login('trabajador@andes.cl', DEMO_PASSWORD)
    const jar = cookies(res.headers['set-cookie'])
    await ownerPool.query("UPDATE tenant SET status = 'suspended' WHERE id = $1", [TENANT_B_ID])
    try {
      const refresh = await server()
        .post('/api/v1/auth/refresh')
        .set('Cookie', conCookies(jar))
        .set('x-csrf-token', jar.get('csrf') ?? '')
      expect(refresh.status).toBe(401)
    } finally {
      await ownerPool.query("UPDATE tenant SET status = 'active' WHERE id = $1", [TENANT_B_ID])
    }
  })
})
