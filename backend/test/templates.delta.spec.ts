import 'reflect-metadata'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, readFile } from 'node:fs/promises'
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
import { templatesDeltaResponseSchema, XLSX_MIME } from '@terreno/shared'
import { AppModule } from '../src/app.module'
import { configureApp } from '../src/app.setup'
import { TemplatesService } from '../src/templates/templates.service'
import {
  DEMO_PASSWORD,
  SITE_A_ID,
  TEMPLATE_A_REVISION_PUBLISHED_ID,
  TEMPLATE_B_ID,
  TENANT_A_ID,
  TENANT_B_ID,
  seedDatabase,
} from '../db/seed'

/**
 * TSK-FORM-009 — Delta de plantillas por SECUENCIA GLOBAL de publicación
 * (FR-018/027/028) + descarga del documento original `.xlsx` (FR-019/044).
 *
 * `version` se asigna por plantilla (max+1 dentro de su `template_id`) pero el
 * delta compara contra un único cursor: con la plantilla A en v3 y la B en v1,
 * un umbral global sobre `version` jamás entregaría la v2 de B y el dispositivo
 * se quedaría sin respuesta completa. `published_seq` es monotónica entre
 * publicaciones, con huecos tolerados (dos tenants consumen la secuencia y cada
 * uno ve sólo la suya).
 *
 * Corre sobre PostgreSQL 16 real (Testcontainers): migraciones + seed. El seed
 * publica directo como owner saltándose `publishRevision`, así que la primera
 * batería comprueba que esa vía también sella secuencia.
 */

const MIGRATIONS_DIR = resolve(process.cwd(), 'db', 'migrations')
/** Libro real del spike del módulo 007: el mismo binario que el importador acepta. */
const XLSX_FIXTURE = resolve(process.cwd(), '..', 'shared', 'fixtures', 'xlsx', 'spike-referencia.xlsx')

let container: StartedPostgreSqlContainer
let ownerPool: Pool
let app: INestApplication
let templates: TemplatesService
let syncVolume: string

let trabajadorToken: string
let adminToken: string
let supervisorBToken: string
let platformToken: string

interface DeltaItem {
  revision_id: string
  template_id: string
  version: number
  published_seq: number
}
interface Delta {
  items: DeltaItem[]
  latest_seq: number | null
}
/** Detalle de revisión que devuelve el endpoint de publicación. */
interface Publicada {
  id: string
  template_id: string
  version: number | null
  status: string
}

const server = () => request(app.getHttpServer())
const auth = (token: string) => ({ Authorization: `Bearer ${token}` })

function definicionValida() {
  return {
    sections: [
      {
        title: 'Sección',
        position: 0,
        items: [{ id: randomUUID(), prompt: '¿Cumple?', response_type: 'ok_nok_na', props: {} }],
      },
    ],
  }
}

/** Crea plantilla + borrador vía API (sólo `tenant_admin`) y publica la v1. */
async function crearYPublicar(): Promise<{ templateId: string; revisionId: string }> {
  const created = await server()
    .post('/api/v1/templates')
    .set(auth(adminToken))
    .send({ name: 'Plantilla de prueba', definition: definicionValida() })
  expect([200, 201]).toContain(created.status)
  const pub = await publicar(created.body.id as string)
  return { templateId: created.body.template_id as string, revisionId: pub.id }
}

/**
 * Nueva versión de una plantilla existente. El alta de borradores sobre una
 * plantilla ya creada no tiene endpoint propio: se usa el servicio, que es la
 * misma ruta que el controlador usa para publicar.
 */
async function nuevaVersionYPublicar(templateId: string): Promise<Publicada> {
  const draft = await templates.createDraftRevision({
    tenantId: TENANT_A_ID,
    templateId,
    definition: definicionValida(),
  })
  return publicar(draft.id)
}

async function publicar(revisionId: string): Promise<Publicada> {
  const res = await server()
    .post(`/api/v1/templates/revisions/${revisionId}/publish`)
    .set(auth(adminToken))
  expect(res.status).toBe(200)
  expect(res.body.status).toBe('published')
  return res.body as Publicada
}

async function delta(token: string, since?: number): Promise<Delta> {
  const query = since === undefined ? '' : `?since=${since}`
  const res = await server().get(`/api/v1/templates${query}`).set(auth(token))
  expect(res.status).toBe(200)
  return res.body as Delta
}

/** Secuencia de una revisión concreta, leída como owner (para asserts de DB). */
async function seqDe(revisionId: string): Promise<string | null> {
  const { rows } = await ownerPool.query(
    `SELECT published_seq::text AS seq FROM template_revision WHERE id = $1`,
    [revisionId],
  )
  return rows[0]?.seq ?? null
}

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('terreno')
    .start()

  const ownerUrl = container.getConnectionUri()
  await runner({
    databaseUrl: ownerUrl,
    dir: MIGRATIONS_DIR,
    direction: 'up',
    migrationsTable: 'pgmigrations',
  })

  ownerPool = new Pool({ connectionString: ownerUrl })
  await seedDatabase(ownerPool)
  await ownerPool.query("ALTER ROLE tc_app LOGIN PASSWORD 'test'")

  syncVolume = await mkdtemp(join(tmpdir(), 'terreno-templates-'))

  process.env.DATABASE_URL = ownerUrl
  process.env.APP_DATABASE_URL = ownerUrl.replace('test:test@', 'tc_app:test@')
  process.env.JWT_ACCESS_SECRET = 'test-access-secret-32bytes-long!!!!!'
  process.env.SYNC_VOLUME = syncVolume
  process.env.NODE_ENV = 'test'

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
  app = configureApp(moduleRef.createNestApplication())
  await app.init()
  templates = app.get(TemplatesService)

  const login = async (email: string) => {
    const res = await server()
      .post('/api/v1/auth/login')
      .send({ email, password: DEMO_PASSWORD })
    expect(res.status).toBe(200)
    return res.body.access_token as string
  }

  trabajadorToken = await login('trabajador@minera.cl')
  adminToken = await login('admin@minera.cl')
  supervisorBToken = await login('supervisor@andes.cl')
  platformToken = await login('admin@terreno.local')
}, 180_000)

afterAll(async () => {
  await app?.close()
  await ownerPool?.end()
  await container?.stop()
})

describe('delta por published_seq: la regresión de version vs secuencia (FR-027)', () => {
it('con la plantilla A en v3, la v2 de B igual llega con el cursor del delta', async () => {
    const alta = await crearYPublicar()
    // Se publican dos versiones más: `version` de A queda por encima de la que
    // tendrá B, que es exactamente el escenario que rompía el delta.
    await nuevaVersionYPublicar(alta.templateId)
    await nuevaVersionYPublicar(alta.templateId)
    const baja = await crearYPublicar()

    const antes = await delta(adminToken)
    const cursor = antes.latest_seq as number
    const versionMax = Math.max(...antes.items.map((i) => i.version))
    expect(versionMax).toBeGreaterThanOrEqual(3)

    const nuevaBaja = await nuevaVersionYPublicar(baja.templateId)
    expect(nuevaBaja.version).toBe(2)

    const despues = await delta(adminToken, cursor)
    expect(despues.items.map((i) => i.revision_id)).toEqual([nuevaBaja.id])
    expect(despues.latest_seq).toBeGreaterThan(cursor)
    // La respuesta cumple el contrato compartido que valida el dispositivo.
    expect(templatesDeltaResponseSchema.safeParse(despues).success).toBe(true)
  })

  it('toda revisión publicada tiene published_seq (el seed salta publishRevision)', async () => {
    const { rows } = await ownerPool.query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'published')::int AS publicadas,
         COUNT(*) FILTER (WHERE status = 'published' AND published_seq IS NULL)::int AS sin_seq
       FROM template_revision`,
    )
    expect(rows[0].publicadas).toBeGreaterThan(0)
    expect(rows[0].sin_seq).toBe(0)
  })

  it('el backfill deja la secuencia estrictamente creciente según published_at', async () => {
    const { rows } = await ownerPool.query(
      `SELECT published_at, published_seq::int AS seq, id
         FROM template_revision
        WHERE status = 'published'
        ORDER BY published_at, id`,
    )
    expect(rows.length).toBeGreaterThan(1)
    rows.forEach((r: { seq: number }) => expect(r.seq).toBeGreaterThanOrEqual(1))
    for (let i = 1; i < rows.length; i += 1) {
      expect(rows[i].seq).toBeGreaterThan(rows[i - 1].seq)
    }
  })

  it('los borradores nunca aparecen en el delta ni tienen published_seq', async () => {
    const created = await server()
      .post('/api/v1/templates')
      .set(auth(adminToken))
      .send({ name: 'Sólo borrador', definition: definicionValida() })
    expect([200, 201]).toContain(created.status)
    const draftId = created.body.id as string

    const todo = await delta(adminToken, 0)
    expect(todo.items.map((i) => i.revision_id)).not.toContain(draftId)
    expect(await seqDe(draftId)).toBeNull()
  })

  it('un since por encima del techo devuelve items vacío y latest_seq intacto', async () => {
    const actual = await delta(adminToken)
    const techo = actual.latest_seq as number

    const res = await delta(adminToken, techo + 1000)
    expect(res.items).toEqual([])
    expect(res.latest_seq).toBe(techo)
  })

  it('publicar en otro tenant consume secuencia sin romper el delta de A (huecos)', async () => {
    const antes = await delta(adminToken)
    const cursor = antes.latest_seq as number

    const draftB = await templates.createDraftRevision({
      tenantId: TENANT_B_ID,
      templateId: TEMPLATE_B_ID,
      definition: definicionValida(),
    })
    const publicadaB = await templates.publishRevision(TENANT_B_ID, draftB.id)

    // La secuencia de B es global pero su fila no es visible para A: el hueco
    // no aparece en el delta de A ni mueve su techo.
    const despuesB = await delta(adminToken, cursor)
    expect(despuesB.items).toEqual([])
    expect(despuesB.latest_seq).toBe(cursor)

    // La siguiente publicación de A sí ve el hueco saltado y sigue llegando.
    const nuevaA = await crearYPublicar()
    const conHueco = await delta(adminToken, cursor)
    expect(conHueco.items.map((i) => i.revision_id)).toEqual([nuevaA.revisionId])
    expect(Number(publicadaB.published_seq)).toBeGreaterThan(cursor)
    expect(conHueco.items[0].published_seq).toBeGreaterThan(Number(publicadaB.published_seq))
  })
})

describe('GET /api/v1/templates/revisions/:id/original (FR-019/044)', () => {
  let revisionImportada: string
  let bytesXlsx: Buffer

  beforeAll(async () => {
    bytesXlsx = await readFile(XLSX_FIXTURE)
    const upload = await server()
      .post('/api/v1/templates/imports')
      .set(auth(adminToken))
      .attach('file', bytesXlsx, { filename: 'spike-referencia.xlsx', contentType: XLSX_MIME })
    expect(upload.status).toBe(201)
    const confirm = await server()
      .post(`/api/v1/templates/imports/${upload.body.id}/confirm`)
      .set(auth(adminToken))
      .send({ publish: true })
    expect(confirm.status).toBe(201)
    expect(confirm.body.status).toBe('published')
    revisionImportada = confirm.body.id as string
  })

  it('el tenant_admin descarga los bytes idénticos al .xlsx subido', async () => {
    const res = await server()
      .get(`/api/v1/templates/revisions/${revisionImportada}/original`)
      .set(auth(adminToken))
      .responseType('blob')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toBe(XLSX_MIME)
    expect(res.headers['content-disposition']).toContain('attachment')
    expect(res.headers['x-file-name']).toBe(encodeURIComponent('spike-referencia.xlsx'))

    const body = res.body as Buffer
    expect(body.length).toBe(bytesXlsx.length)
    expect(createHash('sha256').update(body).digest('hex')).toBe(
      createHash('sha256').update(bytesXlsx).digest('hex'),
    )
  })

  it('el rol operativo sin asignación recibe 404, no 403 (no enumerable)', async () => {
    const sinSite = await server()
      .get(`/api/v1/templates/revisions/${revisionImportada}/original`)
      .set(auth(trabajadorToken))
    expect(sinSite.status).toBe(404)

    const conSite = await server()
      .get(`/api/v1/templates/revisions/${revisionImportada}/original?site_id=${SITE_A_ID}`)
      .set(auth(trabajadorToken))
    expect(conSite.status).toBe(404)
  })

  it('asignada a su faena, el mismo worker sí descarga el original', async () => {
    const assign = await server()
      .post('/api/v1/templates/assignments')
      .set(auth(adminToken))
      .send({ revision_id: revisionImportada, site_id: SITE_A_ID, role: 'field_worker' })
    expect(assign.status).toBe(200)

    const res = await server()
      .get(`/api/v1/templates/revisions/${revisionImportada}/original?site_id=${SITE_A_ID}`)
      .set(auth(trabajadorToken))
      .responseType('blob')
    expect(res.status).toBe(200)
    expect((res.body as Buffer).length).toBe(bytesXlsx.length)
  })

  it('una revisión creada a mano (sin import) responde 404 con mensaje claro', async () => {
    const res = await server()
      .get(`/api/v1/templates/revisions/${TEMPLATE_A_REVISION_PUBLISHED_ID}/original`)
      .set(auth(adminToken))
    expect(res.status).toBe(404)
    expect(res.body.message).toMatch(/no hay documento original/i)
  })

  it('otro tenant no lee el original (404 por RLS) y platform_admin 403', async () => {
    const otroTenant = await server()
      .get(`/api/v1/templates/revisions/${revisionImportada}/original`)
      .set(auth(supervisorBToken))
    expect(otroTenant.status).toBe(404)

    const plataforma = await server()
      .get(`/api/v1/templates/revisions/${revisionImportada}/original`)
      .set(auth(platformToken))
    expect(plataforma.status).toBe(403)
  })

  it('un id inexistente responde 404 y sin sesión 401', async () => {
    const fantasma = await server()
      .get(`/api/v1/templates/revisions/${randomUUID()}/original`)
      .set(auth(adminToken))
    expect(fantasma.status).toBe(404)

    const anonimo = await server().get(
      `/api/v1/templates/revisions/${revisionImportada}/original`,
    )
    expect(anonimo.status).toBe(401)
  })

  it('el archivo fuente quedó dentro del volumen configurado por SYNC_VOLUME', async () => {
    const { rows } = await ownerPool.query(
      `SELECT i.file_key FROM template_revision r
         JOIN template_imports i ON i.id = r.source_import_id
        WHERE r.id = $1`,
      [revisionImportada],
    )
    const fileKey = rows[0].file_key as string
    expect(fileKey.startsWith(`template_imports/${TENANT_A_ID}/`)).toBe(true)
    expect(resolve(syncVolume, fileKey).startsWith(resolve(syncVolume) + '/')).toBe(true)
  })
})