import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
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
 * TSK-DOM-008 (FR-067) — el responsable de un hallazgo se entera y avanza.
 *
 *  - `GET /findings/asignados` devuelve sólo los hallazgos de quien consulta
 *    (RLS por empresa y filtro por responsable), con faena, formulario,
 *    pregunta y fotos para entenderlos sin señal;
 *  - `PATCH /findings/:id/avance` lo empieza o lo reporta, nunca lo resuelve;
 *    uno ajeno, resuelto o de otra empresa → 404; todo queda auditado;
 *  - supervisión ve el reporte; reabrir quita el "listo para revisar" y
 *    reasignar borra el avance del responsable anterior;
 *  - el responsable ve las fotos de SUS hallazgos y de ningún otro;
 *  - una corrección que llega por sync no borra el avance.
 */

const MIGRATIONS_DIR = resolve(process.cwd(), 'db', 'migrations')
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)
/** Ítem de la plantilla sembrada del tenant A (`backend/db/seed.ts`). */
const ITEM_BARRERAS = '01890000-0000-7000-8000-00000000f101'

let container: StartedPostgreSqlContainer
let ownerPool: Pool
let app: INestApplication
let syncVolume: string

const server = () => request(app.getHttpServer())
const t: Record<string, string> = {}
const ids: Record<string, string> = {}
const como = (q: string) => ({ Authorization: `Bearer ${t[q]}` })

const inspectionId = randomUUID()
const respuestaId = randomUUID()
/** Asignado al trabajador, sale de una respuesta y tiene foto. */
const h1 = randomUUID()
/** Asignado al trabajador, hallazgo general (sin pregunta). */
const h2 = randomUUID()
/** Asignado a la supervisora: el trabajador no lo ve. */
const h3 = randomUUID()
const fotoH1 = randomUUID()
const fotoH3 = randomUUID()
const CAPTURED_AT = '2026-11-10T09:00:00.000Z'

async function login(email: string) {
  const res = await server().post('/api/v1/auth/login').send({ email, password: DEMO_PASSWORD })
  expect(res.status).toBe(200)
  return { token: res.body.access_token as string, id: res.body.user.id as string }
}

function registro(entity_type: string, id: string, payload: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return { entity_type, id, tenant_id: TENANT_A_ID, client_version: 1, captured_at: CAPTURED_AT, payload, ...extra }
}

function hallazgo(id: string, responseId: string | null, description: string) {
  return registro('finding', id, {
    inspection_id: inspectionId,
    response_id: responseId,
    severity: 'high',
    description,
    status: 'open',
  })
}

function foto(id: string, ownerId: string) {
  return registro('attachment', id, {
    owner_type: 'finding',
    owner_id: ownerId,
    mime: 'image/png',
    bytes: PNG_1x1.length,
    width: 1,
    height: 1,
    data: PNG_1x1.toString('base64'),
  })
}

async function asignar(id: string, assignee: string) {
  const res = await server().patch(`/api/v1/findings/${id}`).set(como('supA')).send({ assignee_id: assignee })
  expect(res.status).toBe(200)
  return res
}

const asignados = (q: string) => server().get('/api/v1/findings/asignados').set(como(q))
const avance = (q: string, id: string, body: unknown) =>
  server().patch(`/api/v1/findings/${id}/avance`).set(como(q)).send(body as object)

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').withDatabase('terreno').start()
  const url = container.getConnectionUri()
  await runner({ databaseUrl: url, dir: MIGRATIONS_DIR, direction: 'up', migrationsTable: 'pgmigrations' })
  ownerPool = new Pool({ connectionString: url })
  await seedDatabase(ownerPool)
  await ownerPool.query("ALTER ROLE tc_app LOGIN PASSWORD 'test'")
  syncVolume = await mkdtemp(join(tmpdir(), 'terreno-asignados-'))
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
    ['plataforma', 'admin@terreno.local'],
  ] as const) {
    const r = await login(email)
    t[k] = r.token
    ids[k] = r.id
  }

  const res = await server()
    .post('/api/v1/sync/batch')
    .set(como('workerA'))
    .send({
      batch_id: randomUUID(),
      device_id: randomUUID(),
      records: [
        registro('inspection', inspectionId, {
          site_id: SITE_A_ID,
          template_id: TEMPLATE_A_ID,
          template_version: 1,
          executed_by: ids.workerA,
          status: 'submitted',
          location: null,
          requires_supervisor_signature: false,
        }),
        registro('response', respuestaId, {
          inspection_id: inspectionId,
          template_item_id: ITEM_BARRERAS,
          value_ok: 'nok',
          value_text: null,
          value_number: null,
        }),
        hallazgo(h1, respuestaId, 'Barrera dura desplazada en el acceso norte'),
        hallazgo(h2, null, 'Derrame de aceite junto al estanque'),
        hallazgo(h3, null, 'Extintor vencido en la sala eléctrica'),
        foto(fotoH1, h1),
        foto(fotoH3, h3),
      ],
    })
  expect(res.status).toBe(200)
  expect(res.body.records_failed).toBe(0)

  await asignar(h1, ids.workerA)
  await server().patch(`/api/v1/findings/${h1}`).set(como('supA')).send({ due_date: '2026-11-20' }).expect(200)
  await asignar(h2, ids.workerA)
  await asignar(h3, ids.supA)
}, 180_000)

afterAll(async () => {
  await app?.close()
  await ownerPool?.end()
  await container?.stop()
  if (syncVolume) await rm(syncVolume, { recursive: true, force: true })
})

describe('GET /api/v1/findings/asignados — lo que me toca (FR-067)', () => {
  it('el trabajador ve sólo sus hallazgos, con lo necesario para entenderlos', async () => {
    const res = await asignados('workerA')
    expect(res.status).toBe(200)
    const lista = res.body as Array<Record<string, unknown>>
    expect(lista.map((h) => h.id).sort()).toEqual([h1, h2].sort())

    const uno = lista.find((h) => h.id === h1)!
    expect(uno).toMatchObject({
      severity: 'high',
      status: 'open',
      description: 'Barrera dura desplazada en el acceso norte',
      due_date: '2026-11-20',
      faena: 'Faena El Roble',
      autor: 'Pedro Trabajador',
      fotos_ids: [fotoH1],
      progress_note: null,
      reported_at: null,
    })
    expect(typeof uno.formulario).toBe('string')
    expect(typeof uno.pregunta).toBe('string')
    expect(Number.isNaN(Date.parse(String(uno.assigned_at)))).toBe(false)
    // El plazo más próximo primero: h1 tiene plazo, h2 no.
    expect(lista[0].id).toBe(h1)

    const general = lista.find((h) => h.id === h2)!
    expect(general.pregunta).toBeNull()
  })

  it('otra empresa no ve nada (RLS); plataforma → 403; sin sesión → 401', async () => {
    const ajena = await asignados('workerB')
    expect(ajena.status).toBe(200)
    expect(ajena.body).toEqual([])
    expect((await asignados('plataforma')).status).toBe(403)
    expect((await server().get('/api/v1/findings/asignados')).status).toBe(401)
  })
})

describe('PATCH /api/v1/findings/:id/avance — empezar y reportar (FR-067)', () => {
  it('empezar lo pasa a en curso y queda auditado', async () => {
    const res = await avance('workerA', h1, { accion: 'iniciar' })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ id: h1, status: 'in_progress', reported_at: null })
    const audit = await ownerPool.query(
      "SELECT actor_id, payload FROM audit_log WHERE action = 'finding_progress' AND entity_id = $1",
      [h1],
    )
    expect(audit.rows).toHaveLength(1)
    expect(audit.rows[0].actor_id).toBe(ids.workerA)
    expect(audit.rows[0].payload).toMatchObject({ accion: 'iniciar', status: { de: 'open', a: 'in_progress' } })
  })

  it('reportar exige contar qué se hizo', async () => {
    expect((await avance('workerA', h1, { accion: 'reportar' })).status).toBe(400)
    expect((await avance('workerA', h1, { accion: 'reportar', nota: '   ' })).status).toBe(400)
    expect((await avance('workerA', h1, { accion: 'resolver' })).status).toBe(400)
    expect((await avance('workerA', h1, { accion: 'reportar', nota: 'x'.repeat(2001) })).status).toBe(400)
  })

  it('reportar deja la nota y la hora, y supervisión lo ve como listo para revisar', async () => {
    const res = await avance('workerA', h1, { accion: 'reportar', nota: '  Se reinstaló la barrera y se ancló al piso  ' })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      id: h1,
      status: 'in_progress',
      progress_note: 'Se reinstaló la barrera y se ancló al piso',
    })
    expect(Number.isNaN(Date.parse(res.body.reported_at))).toBe(false)

    const panel = await server().get('/api/v1/dashboard/findings').set(como('supA'))
    expect(panel.status).toBe(200)
    const fila = (panel.body.items as Array<Record<string, unknown>>).find((h) => h.id === h1)!
    expect(fila).toMatchObject({ status: 'in_progress', progress_note: 'Se reinstaló la barrera y se ancló al piso' })
    expect(fila.reported_at).toBe(res.body.reported_at)
  })

  it('uno ajeno, de otra empresa o con id inválido no se puede avanzar', async () => {
    expect((await avance('workerA', h3, { accion: 'iniciar' })).status).toBe(404)
    expect((await avance('workerB', h1, { accion: 'iniciar' })).status).toBe(404)
    expect((await avance('workerA', 'no-es-uuid', { accion: 'iniciar' })).status).toBe(400)
    expect((await avance('plataforma', h1, { accion: 'iniciar' })).status).toBe(403)
  })
})

describe('fotos del hallazgo para su responsable (FR-062 + FR-067)', () => {
  it('el responsable ve la foto de su hallazgo y no la de otro', async () => {
    const propia = await server().get(`/api/v1/dashboard/attachments/${fotoH1}`).set(como('workerA'))
    expect(propia.status).toBe(200)
    expect(propia.headers['content-type']).toBe('image/png')
    expect((await server().get(`/api/v1/dashboard/attachments/${fotoH3}`).set(como('workerA'))).status).toBe(403)
    expect((await server().get(`/api/v1/dashboard/attachments/${fotoH1}`).set(como('workerB'))).status).toBe(403)
    expect((await server().get(`/api/v1/dashboard/attachments/${fotoH1}`).set(como('supA'))).status).toBe(200)
  })
})

describe('supervisión cierra el ciclo (FR-064 + FR-067)', () => {
  it('reabrir quita el "listo para revisar" y conserva la nota', async () => {
    const res = await server().patch(`/api/v1/findings/${h1}`).set(como('supA')).send({ status: 'open' })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ status: 'open', reported_at: null, progress_note: 'Se reinstaló la barrera y se ancló al piso' })
  })

  it('una corrección que llega por sync no borra la nota ni el responsable', async () => {
    const res = await server()
      .post('/api/v1/sync/batch')
      .set(como('workerA'))
      .send({
        batch_id: randomUUID(),
        device_id: randomUUID(),
        records: [
          {
            ...hallazgo(h1, respuestaId, 'Barrera dura desplazada en el acceso norte (corregido)'),
            client_version: 2,
            captured_at: '2026-11-10T09:05:00.000Z',
          },
        ],
      })
    expect(res.status).toBe(200)
    expect(res.body.records_failed).toBe(0)
    const { rows } = await ownerPool.query(
      'SELECT description, progress_note, reported_at, assignee_id FROM finding WHERE id = $1',
      [h1],
    )
    expect(rows[0].description).toMatch(/corregido/)
    expect(rows[0].progress_note).toBe('Se reinstaló la barrera y se ancló al piso')
    expect(rows[0].assignee_id).toBe(ids.workerA)
  })

  it('reasignar borra el avance del responsable anterior y sale de su lista', async () => {
    const antes = await ownerPool.query('SELECT assigned_at FROM finding WHERE id = $1', [h1])
    const res = await asignar(h1, ids.supA)
    expect(res.body).toMatchObject({ assignee_id: ids.supA, progress_note: null, reported_at: null })
    const despues = await ownerPool.query('SELECT assigned_at FROM finding WHERE id = $1', [h1])
    expect(new Date(despues.rows[0].assigned_at).getTime()).toBeGreaterThan(new Date(antes.rows[0].assigned_at).getTime())
    const lista = (await asignados('workerA')).body as Array<{ id: string }>
    expect(lista.map((h) => h.id)).toEqual([h2])
  })

  it('un hallazgo resuelto sigue a la vista del responsable, pero ya no se puede avanzar', async () => {
    await server()
      .patch(`/api/v1/findings/${h2}`)
      .set(como('supA'))
      .send({ status: 'resolved', resolution_note: 'Se limpió el derrame' })
      .expect(200)
    const lista = (await asignados('workerA')).body as Array<{ id: string; status: string; resolution_note: string }>
    expect(lista).toHaveLength(1)
    expect(lista[0]).toMatchObject({ id: h2, status: 'resolved', resolution_note: 'Se limpió el derrame' })
    expect((await avance('workerA', h2, { accion: 'reportar', nota: 'otra vez' })).status).toBe(404)
  })
})
