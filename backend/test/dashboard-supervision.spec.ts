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
import type { DashboardSupervision } from '@terreno/shared'
import { AppModule } from '../src/app.module'
import { configureApp } from '../src/app.setup'
import { DEMO_PASSWORD, SITE_A_ID, TEMPLATE_A_ID, TENANT_A_ID, seedDatabase } from '../db/seed'

/**
 * TSK-REP-006 — dashboard de supervisión. Cada métrica se verifica con datos
 * sembrados a fechas controladas. La espera sin señal se mide con un solo
 * reloj (el del dispositivo), así que un reloj desfasado no la altera.
 */

const MIGRATIONS_DIR = resolve(process.cwd(), 'db', 'migrations')
let container: StartedPostgreSqlContainer
let pool: Pool
let app: INestApplication
const server = () => request(app.getHttpServer())
const t: Record<string, string> = {}
let workerA = ''

const haceHoras = (h: number) => new Date(Date.now() - h * 3600_000).toISOString()

async function login(email: string) {
  const r = await server().post('/api/v1/auth/login').send({ email, password: DEMO_PASSWORD })
  expect(r.status).toBe(200)
  return r.body as { access_token: string; user: { id: string } }
}

async function inspeccion(status: string, capturada: string, sincronizada: string | null = capturada) {
  const id = randomUUID()
  await pool.query(
    `INSERT INTO inspection (id, tenant_id, site_id, template_id, template_version, executed_by, status, captured_at, synced_at)
     VALUES ($1, $2, $3, $4, 1, $5, $6, $7, $8)`,
    [id, TENANT_A_ID, SITE_A_ID, TEMPLATE_A_ID, workerA, status, capturada, sincronizada],
  )
  return id
}

async function hallazgo(ins: string, sev: string, capturado: string, resuelto: string | null = null) {
  await pool.query(
    `INSERT INTO finding (id, inspection_id, tenant_id, severity, description, status, captured_at, resolved_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [randomUUID(), ins, TENANT_A_ID, sev, `hallazgo ${sev}`, resuelto ? 'resolved' : 'open', capturado, resuelto],
  )
}

async function supervision(quien: string, query = ''): Promise<DashboardSupervision> {
  const r = await server().get(`/api/v1/dashboard/supervision${query}`).set('Authorization', `Bearer ${t[quien]}`)
  expect(r.status).toBe(200)
  return r.body as DashboardSupervision
}

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').withDatabase('terreno').start()
  const url = container.getConnectionUri()
  await runner({ databaseUrl: url, dir: MIGRATIONS_DIR, direction: 'up', migrationsTable: 'pgmigrations', log: () => {} })
  pool = new Pool({ connectionString: url })
  await seedDatabase(pool)
  await pool.query("ALTER ROLE tc_app LOGIN PASSWORD 'test'")
  process.env.DATABASE_URL = url
  process.env.APP_DATABASE_URL = url.replace('test:test@', 'tc_app:test@')
  process.env.JWT_ACCESS_SECRET = 'test-access-secret-32bytes-long!!!!!'
  process.env.NODE_ENV = 'test'
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
  app = configureApp(moduleRef.createNestApplication())
  await app.init()
  const w = await login('trabajador@minera.cl')
  t.worker = w.access_token
  workerA = w.user.id
  t.sup = (await login('supervisor@minera.cl')).access_token
  t.supB = (await login('supervisor@andes.cl')).access_token
}, 180_000)

afterAll(async () => {
  await app?.close()
  await pool?.end()
  await container?.stop()
})

describe('dashboard de supervisión (TSK-REP-006)', () => {
  it('hallazgos: antigüedad de abiertos, críticos y tiempo de cierre', async () => {
    const ins = await inspeccion('submitted', haceHoras(300))
    await hallazgo(ins, 'critical', haceHoras(240)) // 10 días abierto
    await hallazgo(ins, 'medium', haceHoras(72)) // 3 días
    await hallazgo(ins, 'low', haceHoras(3)) // 3 horas
    await hallazgo(ins, 'high', haceHoras(30), haceHoras(6)) // resuelto en 24 h

    const d = await supervision('sup', `?desde=${encodeURIComponent(haceHoras(48))}`)
    expect(d.hallazgos.abiertos_por_antiguedad).toEqual({ hasta_1d: 1, de_1_a_7d: 1, mas_de_7d: 1 })
    expect(d.hallazgos.criticos_abiertos.map((c) => [c.severidad, c.dias_abierto])).toEqual([['critical', 10]])
    expect(d.hallazgos.resueltos_periodo).toBe(1)
    expect(d.hallazgos.cierre_horas_media).toBeCloseTo(24, 0)
  })

  it('top de ítems con más "No OK" desde las respuestas reales', async () => {
    const items = await pool.query<{ id: string; prompt: string }>(
      'SELECT id, prompt FROM template_item WHERE tenant_id = $1 ORDER BY prompt LIMIT 2',
      [TENANT_A_ID],
    )
    const [a, b] = items.rows
    for (const valores of [['nok', 'ok'], ['nok', 'nok'], ['ok', 'nok']]) {
      const ins = await inspeccion('submitted', haceHoras(2))
      for (const [k, item] of [a, b].entries()) {
        await pool.query(
          `INSERT INTO inspection_response (id, inspection_id, template_item_id, tenant_id, value_ok, captured_at)
           VALUES ($1, $2, $3, $4, $5, now())`,
          [randomUUID(), ins, item.id, TENANT_A_ID, valores[k]],
        )
      }
    }
    const d = await supervision('sup', `?desde=${encodeURIComponent(haceHoras(5))}`)
    const top = Object.fromEntries(d.hallazgos.top_nok.map((x) => [x.prompt, [x.nok, x.respondidas]]))
    expect(top[a.prompt]).toEqual([2, 3])
    expect(top[b.prompt]).toEqual([2, 3])
  })

  it('pendientes de revisión: cuántas y desde hace cuánto (desde que llegaron)', async () => {
    await pool.query("UPDATE inspection SET status = 'reviewed' WHERE tenant_id = $1", [TENANT_A_ID])
    await inspeccion('submitted', haceHoras(200), haceHoras(126)) // llegó hace 5,25 días
    await inspeccion('submitted', haceHoras(30), haceHoras(24)) // llegó hace 1 día
    const d = await supervision('sup')
    expect(d.revision.pendientes).toBe(2)
    expect(Math.round(d.revision.dias_mas_antigua ?? 0)).toBe(5)
    expect(d.revision.mas_antiguas[0].dias_esperando).toBe(5)
  })

  it('actividad: serie diaria con días en cero y faenas sin actividad', async () => {
    const d = await supervision('sup', `?desde=${encodeURIComponent(haceHoras(24 * 6))}`)
    expect(d.actividad.por_dia.length).toBeGreaterThanOrEqual(7)
    expect(d.actividad.por_dia.some((x) => x.inspecciones === 0)).toBe(true)
    expect(d.actividad.por_faena.find((f) => f.faena_id === SITE_A_ID)?.inspecciones).toBeGreaterThan(0)
  })

  it('espera sin señal: igual aunque el reloj del dispositivo esté desfasado', async () => {
    // Reloj del dispositivo adelantado 3 horas: encoló y envió 90 min después.
    const desfase = 3 * 3600_000
    const encolado = new Date(Date.now() + desfase - 90 * 60_000).toISOString()
    const enviado = new Date(Date.now() + desfase).toISOString()
    const id = randomUUID()
    const res = await server()
      .post('/api/v1/sync/batch')
      .set('Authorization', `Bearer ${t.worker}`)
      .send({
        batch_id: randomUUID(),
        device_id: randomUUID(),
        sent_at: enviado,
        records: [
          {
            entity_type: 'inspection',
            id,
            tenant_id: TENANT_A_ID,
            client_version: 1,
            captured_at: encolado,
            queued_at: encolado,
            payload: { site_id: SITE_A_ID, template_id: TEMPLATE_A_ID, template_version: 1, executed_by: workerA, status: 'submitted', location: null },
          },
        ],
      })
    expect(res.status).toBe(200)
    expect(res.body.records_ok).toBe(1)
    const d = await supervision('sup', `?desde=${encodeURIComponent(haceHoras(1))}`)
    expect(d.sincronizacion.muestras_espera).toBe(1)
    expect(d.sincronizacion.espera_sin_senal_p50_seg).toBeCloseTo(90 * 60, -1)
    expect(d.sincronizacion.lotes).toBeGreaterThanOrEqual(1)
    expect(d.sincronizacion.procesamiento_p95_seg).toBeLessThan(60)
  })

  it('equipos sin sincronizar hace más de 24 h', async () => {
    const device = randomUUID()
    await pool.query(
      `INSERT INTO sync_log (id, tenant_id, user_id, device_id, batch_id, records_total, records_ok, records_failed, started_at, finished_at, status)
       VALUES ($1, $2, $3, $4, $5, 1, 1, 0, $6, $6, 'ok')`,
      [randomUUID(), TENANT_A_ID, workerA, device, randomUUID(), haceHoras(30)],
    )
    const d = await supervision('sup')
    const inactivo = d.sincronizacion.equipos_inactivos.find((e) => e.device_id === device)
    expect(inactivo?.horas_sin_sync).toBe(30)
  })

  it('aislamiento: otra empresa no ve nada de esta; el trabajador no accede', async () => {
    const b = await supervision('supB')
    expect(b.revision.pendientes).toBe(0)
    expect(b.hallazgos.criticos_abiertos).toHaveLength(0)
    expect(b.sincronizacion.equipos_activos_30d).toBe(0)
    const r = await server().get('/api/v1/dashboard/supervision').set('Authorization', `Bearer ${t.worker}`)
    expect(r.status).toBe(403)
  })
})
