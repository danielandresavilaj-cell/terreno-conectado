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
import { DEMO_PASSWORD, SITE_A_ID, TEMPLATE_A_ID, TENANT_A_ID, seedDatabase } from '../db/seed'

/**
 * TSK-DOM-005 — integridad y ciclo de supervisión:
 *  - la autoría de inspección/bitácora la fija el JWT (no el cliente);
 *  - un trabajador no puede declarar `reviewed` desde su cola;
 *  - FR-031/032: revisar inspección y cambiar estado de hallazgo, con RLS;
 *  - revisión persistente de conflictos;
 *  - FR-024: un lote rechazado deja rastro en sync_log;
 *  - RLS estricta: una empresa no lee filas de plataforma en audit_log.
 */

const MIGRATIONS_DIR = resolve(process.cwd(), 'db', 'migrations')
let container: StartedPostgreSqlContainer
let ownerPool: Pool
let app: INestApplication
const server = () => request(app.getHttpServer())
const t: Record<string, string> = {}
const ids: Record<string, string> = {}

async function login(email: string) {
  const res = await server().post('/api/v1/auth/login').send({ email, password: DEMO_PASSWORD })
  expect(res.status).toBe(200)
  return { token: res.body.access_token as string, id: res.body.user.id as string }
}
const como = (q: string) => ({ Authorization: `Bearer ${t[q]}` })

async function insertarInspeccion(status: string): Promise<string> {
  const id = randomUUID()
  await ownerPool.query(
    `INSERT INTO inspection (id, tenant_id, site_id, template_id, template_version, executed_by, status, captured_at)
     VALUES ($1, $2, $3, $4, 1, $5, $6, now())`,
    [id, TENANT_A_ID, SITE_A_ID, TEMPLATE_A_ID, ids.workerA, status],
  )
  return id
}

function lote(records: unknown[]) {
  return { batch_id: randomUUID(), device_id: randomUUID(), records }
}

function inspeccionWire(executedBy: string, status = 'submitted') {
  return {
    entity_type: 'inspection',
    id: randomUUID(),
    tenant_id: TENANT_A_ID,
    client_version: 1,
    captured_at: new Date().toISOString(),
    payload: {
      site_id: SITE_A_ID,
      template_id: TEMPLATE_A_ID,
      template_version: 1,
      executed_by: executedBy,
      status,
      location: null,
      requires_supervisor_signature: false,
    },
  }
}

function firmaWire(inspectionId: string, signerId: string, signerRole: 'inspector' | 'supervisor' = 'inspector') {
  return {
    entity_type: 'inspection_signature',
    id: randomUUID(),
    tenant_id: TENANT_A_ID,
    client_version: 0,
    captured_at: new Date().toISOString(),
    payload: {
      inspection_id: inspectionId,
      signer_id: signerId,
      signer_role: signerRole,
      strokes: [{ points: [{ x: 100, y: 100 }, { x: 200, y: 200 }] }],
      content_hash: 'a'.repeat(64),
      declaration_version: 'v1',
      signed_at: new Date().toISOString(),
    },
  }
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
  for (const [k, email] of [
    ['workerA', 'trabajador@minera.cl'],
    ['supA', 'supervisor@minera.cl'],
    ['supB', 'supervisor@andes.cl'],
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
})

describe('autoría desde el JWT (TSK-DOM-005)', () => {
  it('rechaza sólo el registro a nombre de otro usuario; el resto del lote entra', async () => {
    const propia = inspeccionWire(ids.workerA)
    const ajena = inspeccionWire(ids.supA)
    const res = await server().post('/api/v1/sync/batch').set(como('workerA')).send(lote([propia, ajena]))
    expect(res.status).toBe(200)
    expect(res.body.records_ok).toBe(1)
    expect(res.body.records_failed).toBe(1)
    expect(res.body.errors[0]).toContain(ajena.id)
    const { rows } = await ownerPool.query('SELECT id FROM inspection WHERE id = ANY($1)', [[propia.id, ajena.id]])
    expect(rows.map((r) => r.id)).toEqual([propia.id])
  })

  it('un trabajador no puede declarar la inspección como revisada', async () => {
    const rec = inspeccionWire(ids.workerA, 'reviewed')
    const res = await server().post('/api/v1/sync/batch').set(como('workerA')).send(lote([rec]))
    expect(res.body.records_failed).toBe(1)
  })
})

describe('ciclo de supervisión (FR-031/032)', () => {
  it('exige firma del inspector y cofirma configurada antes de revisar', async () => {
    const inspeccion = inspeccionWire(ids.workerA) as ReturnType<typeof inspeccionWire> & {
      payload: { signature_required?: boolean }
    }
    inspeccion.payload.requires_supervisor_signature = true
    // La app que firma lo declara (FR-056); sin esto la inspección es de la app anterior.
    inspeccion.payload.signature_required = true
    const firma = firmaWire(inspeccion.id, ids.workerA)
    const ingreso = await server().post('/api/v1/sync/batch').set(como('workerA')).send(lote([inspeccion, firma]))
    expect(ingreso.status).toBe(200)
    expect(ingreso.body.records_ok).toBe(2)
    expect((await server().patch(`/api/v1/inspections/${inspeccion.id}/review`).set(como('supA'))).status).toBe(409)

    const cofirma = await server()
      .post(`/api/v1/inspections/${inspeccion.id}/signature`)
      .set(como('supA'))
      .send({ strokes: [{ points: [{ x: 200, y: 100 }, { x: 500, y: 400 }] }] })
    expect(cofirma.status).toBe(201)
    expect((await server().patch(`/api/v1/inspections/${inspeccion.id}/review`).set(como('supA'))).status).toBe(200)
    const firmas = await ownerPool.query(
      'SELECT signer_role FROM inspection_signature WHERE inspection_id = $1 ORDER BY signer_role',
      [inspeccion.id],
    )
    expect(firmas.rows.map((f) => f.signer_role)).toEqual(['inspector', 'supervisor'])
  })

  it('una inspección de la app anterior (sin firma declarada) sigue siendo revisable', async () => {
    const inspeccion = inspeccionWire(ids.workerA)
    const ingreso = await server().post('/api/v1/sync/batch').set(como('workerA')).send(lote([inspeccion]))
    expect(ingreso.status).toBe(200)
    expect((await server().patch(`/api/v1/inspections/${inspeccion.id}/review`).set(como('supA'))).status).toBe(200)
  })

  it('revisa una inspección enviada; el trabajador no puede', async () => {
    const id = await insertarInspeccion('submitted')
    expect((await server().patch(`/api/v1/inspections/${id}/review`).set(como('workerA'))).status).toBe(403)
    const res = await server().patch(`/api/v1/inspections/${id}/review`).set(como('supA'))
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('reviewed')
    const { rows } = await ownerPool.query('SELECT status FROM inspection WHERE id = $1', [id])
    expect(rows[0].status).toBe('reviewed')
  })

  it('no revisa borradores ni inspecciones de otra empresa', async () => {
    const borrador = await insertarInspeccion('in_progress')
    expect((await server().patch(`/api/v1/inspections/${borrador}/review`).set(como('supA'))).status).toBe(409)
    const otra = await insertarInspeccion('submitted')
    expect((await server().patch(`/api/v1/inspections/${otra}/review`).set(como('supB'))).status).toBe(404)
  })

  it('cambia el estado de un hallazgo y lo audita', async () => {
    const ins = await insertarInspeccion('submitted')
    const hallazgo = randomUUID()
    await ownerPool.query(
      `INSERT INTO finding (id, inspection_id, tenant_id, severity, description, status, captured_at)
       VALUES ($1, $2, $3, 'high', 'baranda suelta', 'open', now())`,
      [hallazgo, ins, TENANT_A_ID],
    )
    const res = await server().patch(`/api/v1/findings/${hallazgo}`).set(como('supA')).send({ status: 'resolved' })
    expect(res.status).toBe(200)
    expect((await server().patch(`/api/v1/findings/${hallazgo}`).set(como('supA')).send({ status: 'x' })).status).toBe(400)
    const audit = await ownerPool.query(
      "SELECT payload FROM audit_log WHERE action = 'finding_status_changed' AND entity_id = $1",
      [hallazgo],
    )
    expect(audit.rows[0].payload).toMatchObject({ from: 'open', to: 'resolved' })
  })
})

describe('revisión persistente de conflictos (TSK-DOM-005)', () => {
  it('guarda quién revisó y deja de contar como pendiente', async () => {
    const id = randomUUID()
    await ownerPool.query(
      `INSERT INTO conflict_record (id, tenant_id, entity_type, entity_id, winner_payload, loser_payload)
       VALUES ($1, $2, 'inspection', $3, '{}', '{}')`,
      [id, TENANT_A_ID, randomUUID()],
    )
    const antes = await server().get('/api/v1/dashboard/summary').set(como('supA'))
    const res = await server().patch(`/api/v1/conflicts/${id}/review`).set(como('supA'))
    expect(res.status).toBe(200)
    expect(res.body.reviewed_by).toBe(ids.supA)
    const lista = await server().get('/api/v1/conflicts').set(como('supA'))
    expect(lista.body.items.find((c: { id: string }) => c.id === id).reviewed_at).toBeTruthy()
    const despues = await server().get('/api/v1/dashboard/summary').set(como('supA'))
    expect(despues.body.conflictos_pendientes).toBe(antes.body.conflictos_pendientes - 1)
  })
})

describe('FR-024 y RLS estricta (TSK-DOM-005)', () => {
  it('un lote rechazado queda en sync_log como failed', async () => {
    const body = lote([{ ...inspeccionWire(ids.workerA), tenant_id: 'no-es-uuid' }])
    const res = await server().post('/api/v1/sync/batch').set(como('workerA')).send(body)
    expect(res.status).toBeGreaterThanOrEqual(400)
    const { rows } = await ownerPool.query('SELECT status FROM sync_log WHERE batch_id = $1', [body.batch_id])
    expect(rows[0]?.status).toBe('failed')
  })

  it('TSK-OFF-018: el motivo del rechazo queda y la supervisión lo ve agrupado', async () => {
    const deviceId = randomUUID()
    const firmaInvalida = {
      entity_type: 'inspection_signature',
      id: randomUUID(),
      tenant_id: TENANT_A_ID,
      client_version: 0,
      captured_at: new Date().toISOString(),
      payload: {
        inspection_id: randomUUID(),
        signer_id: ids.workerA,
        signer_role: 'inspector',
        // Un toque suelto: lo que guardaba el pad anterior.
        strokes: [{ points: [{ x: 10, y: 10 }] }],
        content_hash: 'a'.repeat(64),
        declaration_version: 'v1',
        signed_at: new Date().toISOString(),
      },
    }
    for (let i = 0; i < 2; i++) {
      const res = await server()
        .post('/api/v1/sync/batch')
        .set(como('workerA'))
        .send({ batch_id: randomUUID(), device_id: deviceId, records: [firmaInvalida] })
      expect(res.status).toBe(400)
    }
    const { rows } = await ownerPool.query(
      'SELECT error_message FROM sync_log WHERE device_id = $1',
      [deviceId],
    )
    expect(rows).toHaveLength(2)
    expect(rows[0].error_message).toMatch(/payload\.strokes/)
    // El motivo es el texto de validación, nunca el contenido del registro.
    expect(rows[0].error_message).not.toMatch(/"x"/)

    const lista = await server().get('/api/v1/conflicts/rechazos').set(como('supA'))
    expect(lista.status).toBe(200)
    const grupo = lista.body.items.find((r: { device_id: string }) => r.device_id === deviceId)
    expect(grupo).toMatchObject({ intentos: 2, motivo: expect.stringMatching(/payload\.strokes/) })
    expect(grupo.usuario).toBeTruthy()

    // Otra empresa no lo ve (RLS) y el trabajador no tiene acceso.
    const ajena = await server().get('/api/v1/conflicts/rechazos').set(como('supB'))
    expect(ajena.status).toBe(200)
    expect(ajena.body.items.some((r: { device_id: string }) => r.device_id === deviceId)).toBe(false)
    expect((await server().get('/api/v1/conflicts/rechazos').set(como('workerA'))).status).toBe(403)
    expect((await server().get('/api/v1/conflicts/rechazos')).status).toBe(401)
  })

  it('el rol de la app no ve filas de plataforma en audit_log', async () => {
    await ownerPool.query(
      `INSERT INTO audit_log (id, actor_id, tenant_id, action, entity_type, entity_id, payload)
       VALUES ($1, NULL, NULL, 'evento_plataforma', 'x', 'x', '{}')`,
      [randomUUID()],
    )
    const app = new Pool({ connectionString: process.env.APP_DATABASE_URL })
    const c = await app.connect()
    try {
      await c.query('BEGIN')
      await c.query("SELECT set_config('app.tenant_id', $1, true)", [TENANT_A_ID])
      const { rows } = await c.query('SELECT count(*)::int AS n FROM audit_log WHERE tenant_id IS NULL')
      expect(rows[0].n).toBe(0)
      await c.query('ROLLBACK')
    } finally {
      c.release()
      await app.end()
    }
  })
})
