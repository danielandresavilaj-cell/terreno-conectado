/**
 * Exportar inspecciones: Excel consolidado, PDF y Word — TSK-REP-007.
 * Datos sembrados con la plantilla publicada del seed (v1) y una plantilla
 * "hecha a mano" sin original, que el consolidado también tiene que exportar.
 */
import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { mkdtemp } from 'node:fs/promises'
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
import ExcelJS from 'exceljs'
import JSZip from 'jszip'
import { AppModule } from '../src/app.module'
import { configureApp } from '../src/app.setup'
import { DEMO_PASSWORD, SITE_A_ID, TEMPLATE_A_ID, TENANT_A_ID, seedDatabase } from '../db/seed'

const MIGRATIONS_DIR = resolve(process.cwd(), 'db', 'migrations')
let container: StartedPostgreSqlContainer
let pool: Pool
let app: INestApplication
const t: Record<string, string> = {}
let workerId = ''
const MANUAL_ID = randomUUID()
const MANUAL_ITEM = randomUUID()
const ids: string[] = []
let item1 = { id: '', prompt: '' }

const server = () => request(app.getHttpServer())

/** supertest: el cuerpo binario como Buffer. */
function binario(res: request.Response, cb: (err: Error | null, body: Buffer) => void) {
  const partes: Buffer[] = []
  res.on('data', (c: Buffer) => partes.push(c))
  res.on('end', () => cb(null, Buffer.concat(partes)))
}

const exportar = (body: Record<string, unknown>, quien = 'sup') =>
  server().post('/api/v1/dashboard/inspections/exportar').set('Authorization', `Bearer ${t[quien]}`).buffer(true).parse(binario).send(body)

async function inspeccion(template: string, version: number, capturada: string, status = 'submitted') {
  const id = randomUUID()
  await pool.query(
    `INSERT INTO inspection (id, tenant_id, site_id, template_id, template_version, executed_by, status, captured_at, synced_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)`,
    [id, TENANT_A_ID, SITE_A_ID, template, version, workerId, status, capturada],
  )
  return id
}

async function textoPdf(bytes: Buffer): Promise<string> {
  const lib = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const doc = await lib.getDocument({ data: new Uint8Array(bytes), verbosity: 0 }).promise
  let texto = ''
  for (let n = 1; n <= doc.numPages; n++) {
    const c = await (await doc.getPage(n)).getTextContent()
    texto += (c.items as { str?: string }[]).map((i) => i.str ?? '').join(' ') + '\n'
  }
  await doc.destroy()
  return texto
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
  process.env.SYNC_VOLUME = await mkdtemp(join(tmpdir(), 'terreno-report-'))
  process.env.NODE_ENV = 'test'
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
  app = configureApp(moduleRef.createNestApplication())
  await app.init()
  const login = async (email: string) => {
    const r = await server().post('/api/v1/auth/login').send({ email, password: DEMO_PASSWORD })
    expect(r.status).toBe(200)
    return r.body as { access_token: string; user: { id: string } }
  }
  const w = await login('trabajador@minera.cl')
  t.worker = w.access_token
  workerId = w.user.id
  t.sup = (await login('supervisor@minera.cl')).access_token
  t.supB = (await login('supervisor@andes.cl')).access_token

  // Plantilla hecha a mano (sin import): el original rellenado no existe, el consolidado sí.
  await pool.query(`INSERT INTO template (id, tenant_id, name, status) VALUES ($1, $2, 'Charla de seguridad', 'active')`, [MANUAL_ID, TENANT_A_ID])
  await pool.query(
    `INSERT INTO template_revision (id, template_id, tenant_id, version, definition, status, published_at, published_seq)
     VALUES ($1, $2, $3, 1, $4, 'published', now(), nextval('template_revision_published_seq'))`,
    [randomUUID(), MANUAL_ID, TENANT_A_ID, JSON.stringify({ sections: [{ id: randomUUID(), title: 'General', position: 0, items: [{ id: MANUAL_ITEM, prompt: 'Tema tratado', response_type: 'text', props: {} }] }] })],
  )

  const [it] = (await pool.query<{ id: string; prompt: string }>(
    `SELECT ti.id, ti.prompt FROM template_item ti
         JOIN template_section ts ON ts.id = ti.section_id
         JOIN template_revision r ON r.id = ts.revision_id
      WHERE r.template_id = $1 AND r.version = 1 AND ti.response_type = 'ok_nok_na' ORDER BY ts.position, ti.position LIMIT 1`,
    [TEMPLATE_A_ID],
  )).rows
  item1 = it

  const a = await inspeccion(TEMPLATE_A_ID, 1, '2026-11-03T12:00:00Z')
  const b = await inspeccion(TEMPLATE_A_ID, 1, '2026-11-04T12:00:00Z', 'reviewed')
  const c = await inspeccion(MANUAL_ID, 1, '2026-11-05T12:00:00Z')
  ids.push(a, b, c)
  for (const [ins, v] of [[a, 'nok'], [b, 'ok']] as const) {
    await pool.query(
      `INSERT INTO inspection_response (id, inspection_id, template_item_id, tenant_id, value_ok, captured_at) VALUES ($1, $2, $3, $4, $5, now())`,
      [randomUUID(), ins, item1.id, TENANT_A_ID, v],
    )
  }
  await pool.query(
    `INSERT INTO inspection_response (id, inspection_id, template_item_id, tenant_id, value_text, captured_at) VALUES ($1, $2, $3, $4, 'Trabajo en altura', now())`,
    [randomUUID(), c, MANUAL_ITEM, TENANT_A_ID],
  )
  await pool.query(
    `INSERT INTO finding (id, inspection_id, tenant_id, severity, description, status, captured_at) VALUES ($1, $2, $3, 'high', 'Barrera suelta en nivel 3', 'open', now())`,
    [randomUUID(), a, TENANT_A_ID],
  )
}, 180_000)

afterAll(async () => {
  await app?.close()
  await pool?.end()
  await container?.stop()
})

const NOV = { desde: '2026-11-01T00:00:00Z', hasta: '2026-11-30T23:59:59Z' }

describe('exportar inspecciones (TSK-REP-007)', () => {
  it('Excel consolidado: un solo libro con Resumen, una hoja por formulario, Hallazgos y Evidencias', async () => {
    const r = await exportar({ formato: 'xlsx_consolidado', ...NOV })
    expect(r.status).toBe(200)
    expect(r.headers['content-type']).toContain('spreadsheetml')
    expect(r.headers['x-export-exportadas']).toBe('3')
    expect(r.headers['content-disposition']).toContain('inspecciones_varios_2026-11-01_2026-11-30.xlsx')
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(r.body)
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Resumen', 'Charla de seguridad', 'Chequeo de seguridad minera', 'Hallazgos', 'Evidencias'])
    expect(wb.getWorksheet('Resumen')!.getRow(5).getCell(7).value).toBe(1) // 1 No OK en la primera
    const hoja = wb.getWorksheet('Chequeo de seguridad minera')!
    const col = (hoja.getRow(2).values as unknown[]).indexOf(item1.prompt)
    expect([hoja.getRow(3).getCell(col).value, hoja.getRow(4).getCell(col).value]).toEqual(['No OK', 'OK'])
    expect(wb.getWorksheet('Charla de seguridad')!.getRow(3).getCell(6).value).toBe('Trabajo en altura')
    expect(wb.getWorksheet('Hallazgos')!.getRow(2).getCell(6).value).toBe('Barrera suelta en nivel 3')
  })

  it('sólo las elegidas (ids), y un id de otra empresa no entra', async () => {
    const r = await exportar({ formato: 'xlsx_consolidado', ids: [ids[2], randomUUID()] })
    expect(r.status).toBe(200)
    expect(r.headers['x-export-exportadas']).toBe('1')
    const nadie = await exportar({ formato: 'xlsx_consolidado', ids: [ids[0]] }, 'supB')
    expect(nadie.status).toBe(404)
  })

  it('filtros de formulario y estado', async () => {
    const r = await exportar({ formato: 'xlsx_consolidado', template_id: TEMPLATE_A_ID, status: 'reviewed' })
    expect(r.headers['x-export-exportadas']).toBe('1')
    const lista = await server().get(`/api/v1/dashboard/inspections?template_id=${MANUAL_ID}`).set('Authorization', `Bearer ${t.sup}`)
    expect(lista.body.items.map((i: { id: string }) => i.id)).toEqual([ids[2]])
  })

  it('PDF: un informe con todas, con respuestas, No OK y hallazgos', async () => {
    const r = await exportar({ formato: 'pdf', ...NOV })
    expect(r.status).toBe(200)
    expect(r.body.subarray(0, 5).toString()).toBe('%PDF-')
    const texto = await textoPdf(r.body)
    expect(texto).toContain('Informe de inspecciones')
    expect(texto).toContain('No OK')
    expect(texto).toContain('Barrera suelta en nivel 3')
    expect(texto).toContain('Trabajo en altura')
    expect(texto).toMatch(/Página 1 de \d/)
  })

  it('Word: un .docx con las respuestas; y ZIP con un PDF por inspección', async () => {
    const w = await exportar({ formato: 'docx', ids: [ids[0]] })
    expect(w.status).toBe(200)
    const xml = await (await JSZip.loadAsync(w.body)).file('word/document.xml')!.async('string')
    expect(xml).toContain('Barrera suelta en nivel 3')
    expect(xml).toContain('No OK')
    const z = await exportar({ formato: 'pdf', agrupar: 'zip', ...NOV })
    expect(z.headers['content-type']).toContain('zip')
    const zip = await JSZip.loadAsync(z.body)
    expect(Object.keys(zip.files).filter((n) => n.endsWith('.pdf'))).toHaveLength(3)
  })

  it('tope por formato (413), filtro vacío (404), body inválido (400), roles y auditoría', async () => {
    await pool.query(
      `INSERT INTO inspection (id, tenant_id, site_id, template_id, template_version, executed_by, status, captured_at)
       SELECT gen_random_uuid(), $1, $2, $3, 1, $4, 'submitted', '2026-10-15T12:00:00Z' FROM generate_series(1, 101)`,
      [TENANT_A_ID, SITE_A_ID, MANUAL_ID, workerId],
    )
    const tope = await exportar({ formato: 'pdf', desde: '2026-10-01T00:00:00Z', hasta: '2026-10-31T00:00:00Z' })
    expect(tope.status).toBe(413)
    expect((await exportar({ formato: 'xlsx_consolidado', desde: '2020-01-01', hasta: '2020-01-02' })).status).toBe(404)
    expect((await exportar({ formato: 'html' })).status).toBe(400)
    expect((await exportar({ formato: 'pdf', ...NOV }, 'worker')).status).toBe(403)
    const { rows } = await pool.query("SELECT payload FROM audit_log WHERE action = 'inspection_export' ORDER BY occurred_at")
    expect(rows.length).toBeGreaterThanOrEqual(5)
    expect(rows[0].payload.formato).toBe('xlsx_consolidado')
    expect(rows[0].payload.exportadas).toBe(3)
  })
})
