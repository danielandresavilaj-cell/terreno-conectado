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
import { inspectionDetalleSchema } from '../src/dashboard/dashboard.contract'
import { SyncVolumeService } from '../src/storage/sync-volume.service'
import { DEMO_PASSWORD, SITE_A_ID, TEMPLATE_A_ID, TENANT_A_ID, seedDatabase } from '../db/seed'

/**
 * TSK-REP-008 (FR-062) — la evidencia fotográfica se ve en supervisión.
 *
 *  - `GET /dashboard/attachments/:id` entrega los MISMOS bytes que subió el
 *    dispositivo, con tipo de imagen explícito;
 *  - sólo supervisión/administración de la empresa dueña: otro rol → 403, otra
 *    empresa → 404 (RLS, Art. IV), sin sesión → 401;
 *  - el detalle de la inspección nombra la foto de cada respuesta y de cada
 *    hallazgo, para que la pantalla sepa qué pedir.
 */

const MIGRATIONS_DIR = resolve(process.cwd(), 'db', 'migrations')

/** PNG 1×1 real. */
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)
/** Ítems de la plantilla sembrada del tenant A (`backend/db/seed.ts`). */
const ITEM_BARRERAS = '01890000-0000-7000-8000-00000000f101'
const ITEM_SENALIZACION = '01890000-0000-7000-8000-00000000f102'

let container: StartedPostgreSqlContainer
let ownerPool: Pool
let app: INestApplication
let syncVolume: string

const server = () => request(app.getHttpServer())
const t: Record<string, string> = {}
const ids: Record<string, string> = {}
const como = (q: string) => ({ Authorization: `Bearer ${t[q]}` })

const inspectionId = randomUUID()
const respuestaNokId = randomUUID()
const respuestaFotoId = randomUUID()
const hallazgoId = randomUUID()
const fotoHallazgoId = randomUUID()
const fotoRespuestaId = randomUUID()
const CAPTURED_AT = '2026-11-10T09:00:00.000Z'

async function login(email: string) {
  const res = await server().post('/api/v1/auth/login').send({ email, password: DEMO_PASSWORD })
  expect(res.status).toBe(200)
  return { token: res.body.access_token as string, id: res.body.user.id as string }
}

function registro(entity_type: string, id: string, payload: Record<string, unknown>) {
  return { entity_type, id, tenant_id: TENANT_A_ID, client_version: 1, captured_at: CAPTURED_AT, payload }
}

function foto(id: string, ownerType: 'finding' | 'response', ownerId: string) {
  return registro('attachment', id, {
    owner_type: ownerType,
    owner_id: ownerId,
    mime: 'image/png',
    bytes: PNG_1x1.length,
    width: 1,
    height: 1,
    data: PNG_1x1.toString('base64'),
  })
}

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').withDatabase('terreno').start()
  const url = container.getConnectionUri()
  await runner({ databaseUrl: url, dir: MIGRATIONS_DIR, direction: 'up', migrationsTable: 'pgmigrations' })
  ownerPool = new Pool({ connectionString: url })
  await seedDatabase(ownerPool)
  await ownerPool.query("ALTER ROLE tc_app LOGIN PASSWORD 'test'")
  syncVolume = await mkdtemp(join(tmpdir(), 'terreno-adjuntos-'))
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
    ['adminA', 'admin@minera.cl'],
    ['supB', 'supervisor@andes.cl'],
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
        registro('response', respuestaNokId, {
          inspection_id: inspectionId,
          template_item_id: ITEM_BARRERAS,
          value_ok: 'nok',
          value_text: null,
          value_number: null,
        }),
        registro('response', respuestaFotoId, {
          inspection_id: inspectionId,
          template_item_id: ITEM_SENALIZACION,
          value_ok: 'ok',
          value_text: null,
          value_number: null,
        }),
        registro('finding', hallazgoId, {
          inspection_id: inspectionId,
          response_id: respuestaNokId,
          severity: 'high',
          description: 'Barrera dura desplazada en el acceso norte',
          status: 'open',
        }),
        foto(fotoHallazgoId, 'finding', hallazgoId),
        foto(fotoRespuestaId, 'response', respuestaFotoId),
      ],
    })
  expect(res.status).toBe(200)
  expect(res.body.errors).toEqual([])
  expect(res.body.records_failed).toBe(0)
}, 180_000)

afterAll(async () => {
  await app?.close()
  await ownerPool?.end()
  await container?.stop()
  if (syncVolume) await rm(syncVolume, { recursive: true, force: true })
})

describe('GET /api/v1/dashboard/attachments/:id — ver la evidencia (FR-062)', () => {
  it('entrega al supervisor los mismos bytes que subió el dispositivo, como imagen', async () => {
    const res = await server()
      .get(`/api/v1/dashboard/attachments/${fotoHallazgoId}`)
      .set(como('supA'))
      .buffer(true)
      .parse((r, cb) => {
        const partes: Buffer[] = []
        r.on('data', (c: Buffer) => partes.push(c))
        r.on('end', () => cb(null, Buffer.concat(partes)))
      })

    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toBe('image/png')
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['cache-control']).toBe('private, max-age=3600')
    expect(Buffer.compare(res.body as Buffer, PNG_1x1)).toBe(0)
  })

  it('también sirve la foto de una respuesta y al administrador de la empresa', async () => {
    const res = await server().get(`/api/v1/dashboard/attachments/${fotoRespuestaId}`).set(como('adminA'))
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toBe('image/png')
  })

  it('otra empresa no la ve: 404, igual que un id que no existe (RLS)', async () => {
    const ajena = await server().get(`/api/v1/dashboard/attachments/${fotoHallazgoId}`).set(como('supB'))
    expect(ajena.status).toBe(404)
    const inventada = await server().get(`/api/v1/dashboard/attachments/${randomUUID()}`).set(como('supA'))
    expect(inventada.status).toBe(404)
    expect(inventada.body.message).toBe(ajena.body.message)
  })

  it('roles: trabajador y plataforma → 403, sin sesión → 401, id inválido → 400', async () => {
    const ruta = `/api/v1/dashboard/attachments/${fotoHallazgoId}`
    expect((await server().get(ruta).set(como('workerA'))).status).toBe(403)
    expect((await server().get(ruta).set(como('plataforma'))).status).toBe(403)
    expect((await server().get(ruta)).status).toBe(401)
    expect((await server().get('/api/v1/dashboard/attachments/no-es-uuid').set(como('supA'))).status).toBe(400)
  })

  it('no sirve el documento original de un import por esta ruta', async () => {
    const id = randomUUID()
    await ownerPool.query(
      `INSERT INTO attachment (id, tenant_id, owner_type, owner_id, file_key, mime, bytes, captured_at)
       VALUES ($1, $2, 'template_import', $3, $4, 'image/png', 1, now())`,
      [id, TENANT_A_ID, randomUUID(), `sync/${TENANT_A_ID}/${fotoHallazgoId}.png`],
    )
    const res = await server().get(`/api/v1/dashboard/attachments/${id}`).set(como('supA'))
    expect(res.status).toBe(404)
  })

  it('si el archivo falta en el volumen responde 404 con el motivo, no un 500', async () => {
    const id = randomUUID()
    await ownerPool.query(
      `INSERT INTO attachment (id, tenant_id, owner_type, owner_id, file_key, mime, bytes, captured_at)
       VALUES ($1, $2, 'finding', $3, $4, 'image/jpeg', 1, now())`,
      [id, TENANT_A_ID, hallazgoId, `sync/${TENANT_A_ID}/${id}.jpg`],
    )
    const res = await server().get(`/api/v1/dashboard/attachments/${id}`).set(como('supA'))
    expect(res.status).toBe(404)
    expect(res.body.message).toMatch(/no está disponible/i)
    // El volumen de la prueba es el temporal, no el del repositorio.
    expect(app.get(SyncVolumeService).raiz()).toBe(resolve(syncVolume))
    await ownerPool.query('DELETE FROM attachment WHERE id = $1', [id])
  })
})

describe('GET /api/v1/dashboard/inspections/:id — el detalle nombra la evidencia', () => {
  it('cada respuesta y cada hallazgo traen el id de su foto', async () => {
    const res = await server().get(`/api/v1/dashboard/inspections/${inspectionId}`).set(como('supA'))

    expect(res.status).toBe(200)
    expect(inspectionDetalleSchema.safeParse(res.body).success).toBe(true)
    const respuestas = (res.body.secciones as Array<{ respuestas: Array<{ id: string; foto_id: string | null }> }>).flatMap(
      (s) => s.respuestas,
    )
    expect(respuestas.find((r) => r.id === ITEM_SENALIZACION)?.foto_id).toBe(fotoRespuestaId)
    expect(respuestas.find((r) => r.id === ITEM_BARRERAS)?.foto_id).toBeNull()
    expect(res.body.hallazgos).toEqual([
      {
        id: hallazgoId,
        item_id: ITEM_BARRERAS,
        severity: 'high',
        description: 'Barrera dura desplazada en el acceso norte',
        status: 'open',
        foto_id: fotoHallazgoId,
      },
    ])
  })
})
