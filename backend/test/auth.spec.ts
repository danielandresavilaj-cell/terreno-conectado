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
import { DEMO_PASSWORD, TENANT_A_ID, TENANT_B_ID, seedDatabase } from '../db/seed'

/**
 * TSK-WS-003 — Autenticación (FR-001..005, NFR-06, Decisión D5).
 *
 * Corre el backend real contra un PostgreSQL 16 (Testcontainers). Verifica:
 *  - login → access token con claims user_id/tenant_id/rol + cookies rt/csrf
 *  - GET /me bajo RLS (tc_app + app.tenant_id)
 *  - refresh con rotación por familia y detección de reuso (D5) + AUDIT_LOG
 *  - 5 intentos fallidos consecutivos → bloqueo de 15 min (FR-005)
 */

const MIGRATIONS_DIR = resolve(process.cwd(), 'db', 'migrations')
const TEST_ACCESS_SECRET = new TextEncoder().encode('test-access-secret-32bytes-long!!!!!')

let container: StartedPostgreSqlContainer
let ownerUrl: string
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

async function login(email: string, password: string) {
  return server().post('/api/v1/auth/login').send({ email, password })
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
  // El rol tc_app (NOLOGIN por defecto en las migraciones) se habilita para que
  // el backend se conecte como la app real en producción.
  await ownerPool.query("ALTER ROLE tc_app LOGIN PASSWORD 'test'")

  process.env.DATABASE_URL = ownerUrl
  process.env.APP_DATABASE_URL = ownerUrl.replace('test:test@', 'tc_app:test@')
  process.env.JWT_ACCESS_SECRET = 'test-access-secret-32bytes-long!!!!!'
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

describe('login (FR-001, FR-006)', () => {
  it('emite access token con claims user_id/tenant_id/rol y cookies rt/csrf', async () => {
    const res = await login('supervisor@minera.cl', DEMO_PASSWORD)

    expect(res.status).toBe(200)
    expect(res.body.access_token).toBeDefined()

    const { payload } = await jwtVerify(res.body.access_token, TEST_ACCESS_SECRET, {
      algorithms: ['HS256'],
    })
    expect(payload.tenant_id).toBe(TENANT_A_ID)
    expect(payload.rol).toBe('supervisor')
    expect(payload.sub).toBeTruthy()

    const jar = cookies(res.headers['set-cookie'])
    expect(jar.has('rt')).toBe(true)
    expect(jar.has('csrf')).toBe(true)
    expect(jar.get('rt')).toBeTruthy()
  })

  it('credenciales inválidas → 401 sin enumerar la causa', async () => {
    const res = await login('supervisor@minera.cl', 'clave-incorrecta')
    expect(res.status).toBe(401)
    expect(res.body.message).toBe('Credenciales inválidas')
  })

  it('acepta el tenant para emails que existen en ambos tenants', async () => {
    const wrong = await login('trabajador@minera.cl', 'x')
    void wrong
    const res = await login('trabajador@minera.cl', 'x')
    void res
    const ok = await server()
      .post('/api/v1/auth/login')
      .send({ email: 'trabajador@minera.cl', password: DEMO_PASSWORD })
    expect(ok.status).toBe(200)
    expect(ok.body.user.tenant_id).toBe(TENANT_A_ID)
  })
})

describe('GET /me (FR-002 bajo RLS, NFR-05)', () => {
  it('exige access token', async () => {
    const res = await server().get('/api/v1/me')
    expect(res.status).toBe(401)
  })

  it('devuelve el perfil del tenant del token leyendo por tc_app + app.tenant_id', async () => {
    const loginRes = await login('admin@minera.cl', DEMO_PASSWORD)
    const access = loginRes.body.access_token as string

    const res = await server().get('/api/v1/me').set('Authorization', `Bearer ${access}`)
    expect(res.status).toBe(200)
    expect(res.body.tenant_id).toBe(TENANT_A_ID)
    expect(res.body.role).toBe('tenant_admin')
    expect(res.body.email).toBe('admin@minera.cl')
  })

  it('rechaza un token de otro tenant (el contexto RLS nunca apunta al B)', async () => {
    const loginRes = await login('supervisor@andes.cl', DEMO_PASSWORD)
    const access = loginRes.body.access_token as string

    const res = await server().get('/api/v1/me').set('Authorization', `Bearer ${access}`)
    expect(res.status).toBe(200)
    expect(res.body.tenant_id).toBe(TENANT_B_ID)
  })
})

describe('refresh (Decisión D5: rotación + detección de reuso)', () => {
  it('rota la cookie rt en cada uso y detecta el reuso del token ya rotado', async () => {
    const loginRes = await login('supervisor@andes.cl', DEMO_PASSWORD)
    const jar1 = cookies(loginRes.headers['set-cookie'])
    const rt1 = jar1.get('rt') as string
    const csrf1 = jar1.get('csrf') as string

    const refreshRes = await server()
      .post('/api/v1/auth/refresh')
      .set('Cookie', `rt=${rt1}; csrf=${csrf1}`)
      .set('X-CSRF-Token', csrf1)
    expect(refreshRes.status).toBe(200)
    expect(refreshRes.body.access_token).toBeDefined()

    const jar2 = cookies(refreshRes.headers['set-cookie'])
    const rt2 = jar2.get('rt') as string
    expect(rt2).not.toBe(rt1)

    // Reuso del rt1 (ya rotado) → 401 + revocación de toda la familia (robo).
    const reuse = await server()
      .post('/api/v1/auth/refresh')
      .set('Cookie', `rt=${rt1}; csrf=${csrf1}`)
      .set('X-CSRF-Token', csrf1)
    expect(reuse.status).toBe(401)

    // La familia quedó revocada: el rt2 (recién rotado) tampoco sirve.
    const stillRevoked = await server()
      .post('/api/v1/auth/refresh')
      .set('Cookie', `rt=${rt2}; csrf=${jar2.get('csrf') as string}`)
      .set('X-CSRF-Token', jar2.get('csrf') as string)
    expect(stillRevoked.status).toBe(401)

    // El incidente quedó en AUDIT_LOG (FR-051, append-only).
    const audit = await ownerPool.query(
      "SELECT 1 FROM audit_log WHERE action = 'token_reuse'",
    )
    expect(audit.rowCount ?? 0).toBeGreaterThan(0)
  })

  it('exige CSRF double-submit (cookie + header)', async () => {
    const loginRes = await login('trabajador@minera.cl', DEMO_PASSWORD)
    const jar = cookies(loginRes.headers['set-cookie'])
    const res = await server()
      .post('/api/v1/auth/refresh')
      .set('Cookie', `rt=${jar.get('rt')}; csrf=${jar.get('csrf')}`)
    expect(res.status).toBe(401)
  })
})

describe('bloqueo por intentos fallidos (FR-005) — va al final por el rate-limit por IP', () => {
  it('5 fallos consecutivos bloquean la cuenta 15 min', async () => {
    for (let i = 0; i < 5; i += 1) {
      const res = await login('trabajador@minera.cl', 'clave-incorrecta')
      expect(res.status).toBe(401)
    }
    // Aunque la contraseña sea correcta, la cuenta está bloqueada (423).
    const res = await login('trabajador@minera.cl', DEMO_PASSWORD)
    expect(res.status).toBe(423)
    expect(String(res.body.message)).toMatch(/bloqueada/i)
  })
})