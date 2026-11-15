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
import { DEMO_PASSWORD, SITE_A_ID, SITE_B_ID, TENANT_A_ID, TENANT_B_ID, seedDatabase } from '../db/seed'

/**
 * TSK-DOM-009 (FR-069) — alerta reportada desde la bitácora.
 *
 *  - la entrada y su alerta viajan en el mismo lote (la bitácora se procesa
 *    antes que el hallazgo) y la alerta queda ligada a la entrada y a su faena;
 *  - reenviar el lote no duplica nada (FR-021);
 *  - Gerencia la muestra con su faena, su autor y origen "bitacora", y el
 *    filtro por faena la encuentra aunque no tenga inspección;
 *  - asignada, el responsable la ve en "Hallazgos" con su faena;
 *  - una alerta que apunta a la entrada o a la faena de otra empresa se
 *    rechaza (defensa además de RLS, FR-025).
 */

const MIGRATIONS_DIR = resolve(process.cwd(), 'db', 'migrations')
const CAPTURED_AT = '2026-11-14T10:00:00.000Z'

let container: StartedPostgreSqlContainer
let ownerPool: Pool
let app: INestApplication
let syncVolume: string

const server = () => request(app.getHttpServer())
const t: Record<string, string> = {}
const ids: Record<string, string> = {}
const como = (q: string) => ({ Authorization: `Bearer ${t[q]}` })

const entradaId = randomUUID()
const alertaId = randomUUID()

async function login(email: string) {
  const res = await server().post('/api/v1/auth/login').send({ email, password: DEMO_PASSWORD })
  expect(res.status).toBe(200)
  return { token: res.body.access_token as string, id: res.body.user.id as string }
}

function registro(tenant: string, entity_type: string, id: string, payload: Record<string, unknown>) {
  return { entity_type, id, tenant_id: tenant, client_version: 1, captured_at: CAPTURED_AT, payload }
}

function loteAlerta() {
  // A propósito el hallazgo va primero: el servidor ordena el lote y procesa la
  // bitácora antes, así la referencia a la entrada ya existe.
  return {
    batch_id: randomUUID(),
    device_id: randomUUID(),
    records: [
      registro(TENANT_A_ID, 'finding', alertaId, {
        inspection_id: null,
        response_id: null,
        log_entry_id: entradaId,
        site_id: SITE_A_ID,
        severity: 'critical',
        description: 'Correa transportadora sin guarda en el tambor de cola',
        status: 'open',
      }),
      registro(TENANT_A_ID, 'log_entry', entradaId, {
        site_id: SITE_A_ID,
        author_id: ids.workerA,
        entry_text: 'Durante la ronda vi la correa C-2 sin guarda. Se avisó al jefe de turno.',
        tags: ['Seguridad'],
        shift_date: '2026-11-14',
      }),
    ],
  }
}

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').withDatabase('terreno').start()
  const url = container.getConnectionUri()
  await runner({ databaseUrl: url, dir: MIGRATIONS_DIR, direction: 'up', migrationsTable: 'pgmigrations' })
  ownerPool = poolDePrueba(url)
  await seedDatabase(ownerPool)
  await ownerPool.query("ALTER ROLE tc_app LOGIN PASSWORD 'test'")
  syncVolume = await mkdtemp(join(tmpdir(), 'terreno-alerta-bitacora-'))
  process.env.DATABASE_URL = url
  process.env.APP_DATABASE_URL = url.replace('test:test@', 'tc_app:test@')
  process.env.JWT_ACCESS_SECRET = 'test-access-secret-32bytes-long!!!!!'
  process.env.SYNC_VOLUME = syncVolume
  process.env.NODE_ENV = 'test'
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
  app = configureApp(moduleRef.createNestApplication())
  await app.init()
  for (const [k, email] of [
    ['workerA', 'trabajador@minera.cl'],
    ['supA', 'supervisor@minera.cl'],
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

describe('alerta desde la bitácora (TSK-DOM-009)', () => {
  it('la entrada y su alerta llegan en un lote y la alerta queda ligada a la entrada y la faena', async () => {
    const res = await server().post('/api/v1/sync/batch').set(como('workerA')).send(loteAlerta())
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ records_ok: 2, records_failed: 0 })
    const { rows } = await ownerPool.query('SELECT inspection_id, log_entry_id, site_id, severity FROM finding WHERE id = $1', [alertaId])
    expect(rows[0]).toEqual({ inspection_id: null, log_entry_id: entradaId, site_id: SITE_A_ID, severity: 'critical' })
  })

  it('reenviar el mismo lote no duplica la entrada ni la alerta', async () => {
    const res = await server().post('/api/v1/sync/batch').set(como('workerA')).send(loteAlerta())
    expect(res.status).toBe(200)
    expect(res.body.records_failed).toBe(0)
    const { rows } = await ownerPool.query(
      'SELECT (SELECT count(*)::int FROM finding WHERE log_entry_id = $1) AS hallazgos, (SELECT count(*)::int FROM log_entry WHERE id = $1) AS entradas',
      [entradaId],
    )
    expect(rows[0]).toEqual({ hallazgos: 1, entradas: 1 })
  })

  it('Gerencia la muestra con su faena, su autor y origen bitácora, y el filtro por faena la encuentra', async () => {
    const res = await server().get('/api/v1/dashboard/findings').query({ site_id: SITE_A_ID }).set(como('supA'))
    expect(res.status).toBe(200)
    const alerta = res.body.items.find((i: { id: string }) => i.id === alertaId)
    expect(alerta).toMatchObject({ faena_id: SITE_A_ID, autor_id: ids.workerA, origen: 'bitacora', severity: 'critical' })
    expect(alerta.faena_nombre).toBeTruthy()

    const resumen = await server().get('/api/v1/dashboard/summary').query({ site_id: SITE_A_ID }).set(como('supA'))
    expect(resumen.body.hallazgos_por_severidad.critical).toBeGreaterThanOrEqual(1)
    expect(resumen.body.hallazgos_urgentes).toBeGreaterThanOrEqual(1)

    const otraFaena = await server().get('/api/v1/dashboard/findings').query({ site_id: SITE_B_ID }).set(como('supA'))
    expect(otraFaena.body.items.some((i: { id: string }) => i.id === alertaId)).toBe(false)
  })

  it('asignada, el responsable la ve en Hallazgos con su faena y origen', async () => {
    await server().patch(`/api/v1/findings/${alertaId}`).set(como('supA')).send({ assignee_id: ids.workerA }).expect(200)
    const res = await server().get('/api/v1/findings/asignados').set(como('workerA'))
    expect(res.status).toBe(200)
    const alerta = (res.body as Array<{ id: string }>).find((i) => i.id === alertaId) as Record<string, unknown>
    expect(alerta).toMatchObject({ origen: 'bitacora', formulario: null, pregunta: null })
    expect(alerta.faena).toBeTruthy()
    expect(alerta.autor).toBeTruthy()
  })

  it('una alerta que apunta a la entrada o a la faena de otra empresa se rechaza', async () => {
    const ajena = randomUUID()
    const res = await server()
      .post('/api/v1/sync/batch')
      .set(como('workerB'))
      .send({
        batch_id: randomUUID(),
        device_id: randomUUID(),
        records: [
          registro(TENANT_B_ID, 'finding', ajena, {
            inspection_id: null,
            response_id: null,
            log_entry_id: entradaId,
            site_id: SITE_A_ID,
            severity: 'low',
            description: 'Intento de colgar una alerta en otra empresa',
            status: 'open',
          }),
        ],
      })
    expect(res.body.records_failed).toBe(1)
    const { rows } = await ownerPool.query('SELECT count(*)::int AS n FROM finding WHERE id = $1', [ajena])
    expect(rows[0].n).toBe(0)
  })
})
