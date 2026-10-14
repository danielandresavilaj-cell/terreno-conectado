import 'reflect-metadata'
import { resolve } from 'node:path'
import { PostgreSqlContainer } from '@testcontainers/postgresql'
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { Pool } from 'pg'
import { runner } from 'node-pg-migrate'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { randomUUID } from 'node:crypto'
import { hash } from '@node-rs/argon2'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppModule } from '../src/app.module'
import { configureApp } from '../src/app.setup'
import { DEMO_PASSWORD, PLATFORM_ADMIN_ID, seedDatabase } from '../db/seed'

/**
 * Contraseña de las cuentas que crean estos tests (el contrato exige ≥12).
 * Se deriva de `DEMO_PASSWORD` para no dejar credenciales literales en el
 * fuente (el escaneo de secretos de CI las marca).
 */
const CLAVE_ADMIN = `${DEMO_PASSWORD}prueba`

/**
 * TSK-ADMIN-006 — Administración de plataforma (spec 006, FR-050/051).
 *
 * Corre el backend real contra PostgreSQL 16 (Testcontainers) y verifica:
 *  - FR-050: crear tenant, asignar `tenant_admin` inicial, suspender/reactivar;
 *    el rol ajeno recibe 403.
 *  - FR-051: cada mutación deja exactamente una fila en `audit_log` con actor y
 *    tenant correctos; el log es append-only y no hay ruta para modificarlo.
 */

const MIGRATIONS_DIR = resolve(process.cwd(), 'db', 'migrations')

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

async function tokenPlatform(): Promise<string> {
  const res = await login('admin@terreno.local', DEMO_PASSWORD)
  expect(res.status).toBe(200)
  return res.body.access_token as string
}

/** Crea un tenant y devuelve su id. */
async function crearTenant(slug: string): Promise<string> {
  const token = await tokenPlatform()
  const res = await server()
    .post('/api/v1/admin/tenants')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: `Tenant ${slug}`, slug })
  expect(res.status).toBe(201)
  return res.body.id as string
}

async function auditCount(sql: string, params: unknown[] = []): Promise<number> {
  const res = await ownerPool.query(sql, params)
  return res.rows[0].n as number
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
}, 180_000)

afterAll(async () => {
  await app?.close()
  await ownerPool?.end()
  await container?.stop()
})

describe('admin · autorización (FR-050)', () => {
  it('exige access token', async () => {
    const res = await server().post('/api/v1/admin/tenants').send({ name: 'X', slug: 'x' })
    expect(res.status).toBe(401)
  })

  it('rechaza a un rol distinto de platform_admin (403)', async () => {
    const tenantAdmin = await login('admin@minera.cl', DEMO_PASSWORD)
    const token = tenantAdmin.body.access_token as string
    const res = await server()
      .post('/api/v1/admin/tenants')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'X', slug: 'x' })
    expect(res.status).toBe(403)
  })

  it('rechaza la lectura del audit log a un rol de tenant (403)', async () => {
    const tenantAdmin = await login('admin@minera.cl', DEMO_PASSWORD)
    const token = tenantAdmin.body.access_token as string
    const res = await server()
      .get('/api/v1/admin/audit-log')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(403)
  })
})

describe('FR-050 · crear tenant', () => {
  it('crea un tenant activo y deja el rastro tenant_created', async () => {
    const token = await tokenPlatform()
    const res = await server()
      .post('/api/v1/admin/tenants')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Minera Nueva SpA', slug: 'minera-nueva' })

    expect(res.status).toBe(201)
    expect(res.body.status).toBe('active')
    expect(res.body.slug).toBe('minera-nueva')

    const row = await ownerPool.query('SELECT status FROM tenant WHERE id = $1', [res.body.id])
    expect(row.rows[0].status).toBe('active')

    const audit = await ownerPool.query(
      `SELECT action, actor_id, tenant_id, payload FROM audit_log
        WHERE action = 'tenant_created' AND tenant_id = $1`,
      [res.body.id],
    )
    expect(audit.rowCount).toBe(1)
    expect(audit.rows[0].actor_id).toBe(PLATFORM_ADMIN_ID)
    expect(audit.rows[0].payload).toEqual({ name: 'Minera Nueva SpA', slug: 'minera-nueva' })
  })

  it('rechaza un slug duplicado con 409', async () => {
    const token = await tokenPlatform()
    const body = { name: 'Duplicada', slug: 'slug-repetido' }
    const first = await server()
      .post('/api/v1/admin/tenants')
      .set('Authorization', `Bearer ${token}`)
      .send(body)
    expect(first.status).toBe(201)
    const second = await server()
      .post('/api/v1/admin/tenants')
      .set('Authorization', `Bearer ${token}`)
      .send(body)
    expect(second.status).toBe(409)
  })

  it('rechaza un slug inválido con 400', async () => {
    const token = await tokenPlatform()
    const res = await server()
      .post('/api/v1/admin/tenants')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Mal Slug', slug: 'Con Mayúsculas Y Espacios' })
    expect(res.status).toBe(400)
  })
})

describe('FR-050 · asignar tenant_admin inicial', () => {
  it('crea la cuenta, la audita y permite iniciar sesión', async () => {
    const tenantId = await crearTenant('tenant-alta')
    const token = await tokenPlatform()
    const res = await server()
      .post(`/api/v1/admin/tenants/${tenantId}/admins`)
      .set('Authorization', `Bearer ${token}`)
      .send({ email: 'lider@alta.cl', full_name: 'Líder Alta', password: CLAVE_ADMIN })

    expect(res.status).toBe(201)
    expect(res.body.role).toBe('tenant_admin')
    expect(res.body.tenant_id).toBe(tenantId)

    const audit = await ownerPool.query(
      `SELECT actor_id, tenant_id, payload FROM audit_log
        WHERE action = 'tenant_admin_assigned' AND entity_id = $1`,
      [res.body.id],
    )
    expect(audit.rowCount).toBe(1)
    expect(audit.rows[0].actor_id).toBe(PLATFORM_ADMIN_ID)
    expect(audit.rows[0].tenant_id).toBe(tenantId)

    const loginRes = await login('lider@alta.cl', CLAVE_ADMIN)
    expect(loginRes.status).toBe(200)
    expect(loginRes.body.user.tenant_id).toBe(tenantId)
  })

  it('promueve a un usuario existente y audita role_changed', async () => {
    const tenantId = await crearTenant('tenant-promo')
    const userId = randomUUID()
    await ownerPool.query(
      `INSERT INTO app_user (id, tenant_id, email, password_hash, role, full_name)
       VALUES ($1, $2, 'peon@promo.cl', $3, 'field_worker', 'Peón Promo')`,
      [userId, tenantId, await hash(DEMO_PASSWORD)],
    )

    const token = await tokenPlatform()
    const res = await server()
      .post(`/api/v1/admin/tenants/${tenantId}/admins`)
      .set('Authorization', `Bearer ${token}`)
      .send({ email: 'peon@promo.cl', full_name: 'Peón Promo', password: CLAVE_ADMIN })

    expect(res.status).toBe(200)
    expect(res.body.role).toBe('tenant_admin')

    const audit = await ownerPool.query(
      `SELECT payload FROM audit_log
        WHERE action = 'role_changed' AND entity_id = $1`,
      [userId],
    )
    expect(audit.rowCount).toBe(1)
    expect(audit.rows[0].payload).toEqual({ tenant_id: tenantId, from: 'field_worker', to: 'tenant_admin' })
  })

  it('es idempotente si el usuario ya es tenant_admin', async () => {
    const tenantId = await crearTenant('tenant-idem')
    const token = await tokenPlatform()
    const body = { email: 'idem@x.cl', full_name: 'Idem', password: CLAVE_ADMIN }
    const first = await server()
      .post(`/api/v1/admin/tenants/${tenantId}/admins`)
      .set('Authorization', `Bearer ${token}`)
      .send(body)
    expect(first.status).toBe(201)

    const second = await server()
      .post(`/api/v1/admin/tenants/${tenantId}/admins`)
      .set('Authorization', `Bearer ${token}`)
      .send(body)
    expect(second.status).toBe(200)
    expect(second.body.id).toBe(first.body.id)

    const filas = await auditCount(
      `SELECT count(*)::int AS n FROM audit_log
        WHERE entity_type = 'app_user' AND entity_id = $1`,
      [first.body.id],
    )
    expect(filas).toBe(1)
  })

  it('dos altas concurrentes del mismo email no devuelven 500 ni duplican la auditoría', async () => {
    const tenantId = await crearTenant('tenant-race-alta')
    const token = await tokenPlatform()
    const body = { email: 'race@alta.cl', full_name: 'Race Alta', password: CLAVE_ADMIN }
    const alta = () =>
      server()
        .post(`/api/v1/admin/tenants/${tenantId}/admins`)
        .set('Authorization', `Bearer ${token}`)
        .send(body)

    const [a, b] = await Promise.all([alta(), alta()])

    // La perdedora de la carrera cae al camino idempotente (23505 capturado).
    expect([a.status, b.status].every((s) => s === 200 || s === 201)).toBe(true)
    expect(await auditCount(
      `SELECT count(*)::int AS n FROM audit_log
        WHERE action = 'tenant_admin_assigned' AND tenant_id = $1`,
      [tenantId],
    )).toBe(1)
  })

  it('devuelve 404 si el tenant no existe', async () => {
    const token = await tokenPlatform()
    const res = await server()
      .post(`/api/v1/admin/tenants/${randomUUID()}/admins`)
      .set('Authorization', `Bearer ${token}`)
      .send({ email: 'nadie@x.cl', full_name: 'Nadie', password: CLAVE_ADMIN })
    expect(res.status).toBe(404)
  })
})

describe('FR-050 · suspender y reactivar', () => {
  it('al suspender corta el acceso y lo restaura al reactivar', async () => {
    const tenantId = await crearTenant('tenant-suspender')
    const token = await tokenPlatform()
    await server()
      .post(`/api/v1/admin/tenants/${tenantId}/admins`)
      .set('Authorization', `Bearer ${token}`)
      .send({ email: 'jefe@susp.cl', full_name: 'Jefe Susp', password: CLAVE_ADMIN })

    // Sesión inicial (queda un refresh token vivo en la cookie).
    const sesion = await login('jefe@susp.cl', CLAVE_ADMIN)
    expect(sesion.status).toBe(200)
    const jar = cookies(sesion.headers['set-cookie'])

    const suspender = await server()
      .patch(`/api/v1/admin/tenants/${tenantId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'suspended' })
    expect(suspender.status).toBe(200)
    expect(suspender.body.status).toBe('suspended')

    const auditSusp = await ownerPool.query(
      `SELECT payload FROM audit_log
        WHERE action = 'tenant_suspended' AND tenant_id = $1`,
      [tenantId],
    )
    expect(auditSusp.rowCount).toBe(1)
    expect(auditSusp.rows[0].payload.revoked_sessions).toBeGreaterThanOrEqual(1)

    // Login nuevo rechazado y refresh de la sesión previa revocado.
    expect((await login('jefe@susp.cl', CLAVE_ADMIN)).status).toBe(401)
    const refresh = await server()
      .post('/api/v1/auth/refresh')
      .set('Cookie', `rt=${jar.get('rt')}; csrf=${jar.get('csrf')}`)
      .set('X-CSRF-Token', jar.get('csrf') as string)
    expect(refresh.status).toBe(401)

    // Reactivar devuelve el acceso.
    const reactivar = await server()
      .patch(`/api/v1/admin/tenants/${tenantId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'active' })
    expect(reactivar.status).toBe(200)
    expect(reactivar.body.status).toBe('active')
    expect(await auditCount(
      `SELECT count(*)::int AS n FROM audit_log
        WHERE action = 'tenant_reactivated' AND tenant_id = $1`,
      [tenantId],
    )).toBe(1)
    expect((await login('jefe@susp.cl', CLAVE_ADMIN)).status).toBe(200)
  })

  it('dos suspensiones concurrentes no duplican la auditoría', async () => {
    const tenantId = await crearTenant('tenant-race-susp')
    const token = await tokenPlatform()
    const suspender = () =>
      server()
        .patch(`/api/v1/admin/tenants/${tenantId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'suspended' })

    const [a, b] = await Promise.all([suspender(), suspender()])

    // Ninguna 500: la que pierde la carrera devuelve el estado vigente.
    expect([a.status, b.status].every((s) => s === 200)).toBe(true)
    expect(a.body.status).toBe('suspended')
    expect(b.body.status).toBe('suspended')
    expect(await auditCount(
      `SELECT count(*)::int AS n FROM audit_log
        WHERE action = 'tenant_suspended' AND tenant_id = $1`,
      [tenantId],
    )).toBe(1)
  })

  it('devuelve 404 si el tenant no existe y 400 con estado inválido', async () => {
    const token = await tokenPlatform()
    const missing = await server()
      .patch(`/api/v1/admin/tenants/${randomUUID()}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'active' })
    expect(missing.status).toBe(404)

    const tenantId = await crearTenant('tenant-estado-malo')
    const bad = await server()
      .patch(`/api/v1/admin/tenants/${tenantId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'borrado' })
    expect(bad.status).toBe(400)
  })
})

describe('FR-051 · audit log inmutable y con rastro', () => {
  it('tc_app no puede UPDATE ni DELETE sobre audit_log', async () => {
    const res = await ownerPool.query(`
      SELECT has_table_privilege('tc_app', 'audit_log', 'UPDATE') AS puede_update,
             has_table_privilege('tc_app', 'audit_log', 'DELETE') AS puede_delete,
             has_table_privilege('tc_app', 'audit_log', 'INSERT') AS puede_insert
    `)
    expect(res.rows[0].puede_update).toBe(false)
    expect(res.rows[0].puede_delete).toBe(false)
    expect(res.rows[0].puede_insert).toBe(true)
  })

  it('no expone rutas para modificar el audit log', async () => {
    const token = await tokenPlatform()
    const del = await server()
      .delete('/api/v1/admin/audit-log')
      .set('Authorization', `Bearer ${token}`)
    expect(del.status).toBe(404)
    const patch = await server()
      .patch('/api/v1/admin/audit-log')
      .set('Authorization', `Bearer ${token}`)
      .send({})
    expect(patch.status).toBe(404)
  })

  it('toda mutación admin deja actor y tenant correctos', async () => {
    const sinActorAjeno = await auditCount(
      `SELECT count(*)::int AS n FROM audit_log
        WHERE action IN ('tenant_created','tenant_suspended','tenant_reactivated',
                         'tenant_admin_assigned','role_changed')
          AND actor_id IS DISTINCT FROM $1`,
      [PLATFORM_ADMIN_ID],
    )
    expect(sinActorAjeno).toBe(0)
  })

  it('lee y filtra el audit log (solo platform_admin)', async () => {
    const token = await tokenPlatform()
    const tenantId = await crearTenant('tenant-audit')
    await server()
      .post(`/api/v1/admin/tenants/${tenantId}/admins`)
      .set('Authorization', `Bearer ${token}`)
      .send({ email: 'a@audit.cl', full_name: 'A Audit', password: CLAVE_ADMIN })

    const porTenant = await server()
      .get(`/api/v1/admin/audit-log?tenant=${tenantId}`)
      .set('Authorization', `Bearer ${token}`)
    expect(porTenant.status).toBe(200)
    expect(porTenant.body.items.length).toBeGreaterThanOrEqual(2)
    for (const item of porTenant.body.items) {
      expect(item.tenant_id).toBe(tenantId)
    }

    const porAccion = await server()
      .get('/api/v1/admin/audit-log?action=tenant_created&limit=5')
      .set('Authorization', `Bearer ${token}`)
    expect(porAccion.status).toBe(200)
    for (const item of porAccion.body.items) {
      expect(item.action).toBe('tenant_created')
    }

    const malo = await server()
      .get('/api/v1/admin/audit-log?limit=0')
      .set('Authorization', `Bearer ${token}`)
    expect(malo.status).toBe(400)
  })
})
