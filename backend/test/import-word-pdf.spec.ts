/**
 * Importar plantillas desde Word y PDF — TSK-FORM-020 (Enmienda 005).
 *
 * De punta a punta por la API real: subir → propuesta → confirmar → publicar.
 * El `.docx` se genera con la librería `docx` (un Word de verdad, con estilos
 * y tablas) y el PDF con pdfkit.
 */
import 'reflect-metadata'
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
import { Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow } from 'docx'
import PDFDocument from 'pdfkit'
import { AppModule } from '../src/app.module'
import { configureApp } from '../src/app.setup'
import { DEMO_PASSWORD, seedDatabase } from '../db/seed'

const MIGRATIONS_DIR = resolve(process.cwd(), 'db', 'migrations')
let container: StartedPostgreSqlContainer
let pool: Pool
let app: INestApplication
let admin = ''
let supervisor = ''
const server = () => request(app.getHttpServer())

const celdas = (textos: string[]) => new TableRow({ children: textos.map((t) => new TableCell({ children: [new Paragraph(t)] })) })

async function wordPauta(): Promise<Buffer> {
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({ text: 'Chequeo de extintores', heading: HeadingLevel.TITLE }),
          new Paragraph('Fecha: __________'),
          new Paragraph({ text: 'Estado del equipo', heading: HeadingLevel.HEADING_1 }),
          new Table({
            rows: [
              celdas(['Ítem', 'Sí', 'No', 'N/A']),
              celdas(['Manómetro en verde', '', '', '']),
              celdas(['Sello intacto', '', '', '']),
            ],
          }),
          new Paragraph('Firma responsable: ____________'),
        ],
      },
    ],
  })
  return Packer.toBuffer(doc)
}

function pdfPauta(): Promise<Buffer> {
  return new Promise((res, rej) => {
    const d = new PDFDocument({ size: 'A4' })
    const partes: Buffer[] = []
    d.on('data', (b: Buffer) => partes.push(b))
    d.on('end', () => res(Buffer.concat(partes)))
    d.on('error', rej)
    d.initForm()
    d.fontSize(18).text('Permiso de trabajo en altura', 50, 50)
    d.fontSize(10).text('Trabajador', 50, 100)
    d.formText('trabajador', 160, 96, 200, 16)
    d.text('Arnés inspeccionado', 50, 130)
    d.formCheckbox('arnes', 160, 126, 12, 12)
    d.end()
  })
}

async function subir(bytes: Buffer, nombre: string, mime = 'application/octet-stream') {
  return server().post('/api/v1/templates/imports').set('Authorization', `Bearer ${admin}`).attach('file', bytes, { filename: nombre, contentType: mime })
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
  process.env.SYNC_VOLUME = await mkdtemp(join(tmpdir(), 'terreno-import-doc-'))
  process.env.NODE_ENV = 'test'
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
  app = configureApp(moduleRef.createNestApplication())
  await app.init()
  const login = async (email: string) => {
    const r = await server().post('/api/v1/auth/login').send({ email, password: DEMO_PASSWORD })
    expect(r.status).toBe(200)
    return r.body.access_token as string
  }
  admin = await login('admin@minera.cl')
  supervisor = await login('supervisor@minera.cl')
}, 180_000)

afterAll(async () => {
  await app?.close()
  await pool?.end()
  await container?.stop()
})

describe('importar Word y PDF (TSK-FORM-020)', () => {
  it('Word: propone la pauta, se confirma, se publica y no ofrece Excel original', async () => {
    // El MIME del navegador no importa: manda la firma de los bytes.
    const up = await subir(await wordPauta(), 'extintores.docx')
    expect(up.status).toBe(201)
    expect(up.body.status).toBe('proposed')
    expect(up.body.formato).toBe('docx')
    const prop = up.body.proposed_schema
    expect(prop.formato).toBe('docx')
    const items = prop.secciones.flatMap((s: { items: { prompt: string; response_type: string }[] }) => s.items.map((i) => [i.prompt, i.response_type]))
    expect(items).toEqual([
      ['Fecha', 'date'],
      ['Manómetro en verde', 'ok_nok_na'],
      ['Sello intacto', 'ok_nok_na'],
    ])
    expect(prop.advertencias.some((a: string) => a.includes('Firma'))).toBe(true)

    const conf = await server().post(`/api/v1/templates/imports/${up.body.id}/confirm`).set('Authorization', `Bearer ${admin}`).send({ name: 'Chequeo de extintores', publish: true })
    expect(conf.status).toBe(201)
    expect(conf.body.version).toBe(1)

    const { rows } = await pool.query('SELECT i.file_key, a.mime FROM template_imports i JOIN attachment a ON a.owner_id = i.id WHERE i.id = $1', [up.body.id])
    expect(rows[0].file_key).toMatch(/\.docx$/)
    expect(rows[0].mime).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document')

    // Sólo un .xlsx tiene celdas que rellenar: el original "rellenable" responde 404 claro.
    const orig = await server().get(`/api/v1/templates/revisions/${conf.body.id}/original`).set('Authorization', `Bearer ${admin}`)
    expect(orig.status).toBe(404)
    expect(orig.body.message).toMatch(/Word/)
  })

  it('Word como NUEVA VERSIÓN de una plantilla existente (sin duplicar el formulario)', async () => {
    const [{ id: templateId }] = (await pool.query("SELECT id FROM template WHERE name = 'Chequeo de extintores'")).rows
    const up = await subir(await wordPauta(), 'extintores-v2.docx')
    const conf = await server()
      .post(`/api/v1/templates/imports/${up.body.id}/confirm`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ template_id: templateId, publish: true })
    expect(conf.status).toBe(201)
    expect(conf.body.template_id).toBe(templateId)
    expect(conf.body.version).toBe(2)
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM template WHERE name = 'Chequeo de extintores'")
    expect(rows[0].n).toBe(1)
  })

  it('PDF rellenable: campos con su tipo', async () => {
    const up = await subir(await pdfPauta(), 'altura.pdf', 'application/pdf')
    expect(up.status).toBe(201)
    expect(up.body.formato).toBe('pdf')
    const items = up.body.proposed_schema.secciones.flatMap((s: { items: { prompt: string; response_type: string }[] }) => s.items.map((i) => [i.prompt, i.response_type]))
    expect(items).toEqual([
      ['Trabajador', 'text'],
      ['Arnés inspeccionado', 'ok_nok_na'],
    ])
  })

  it('rechaza lo que no es Excel, Word ni PDF (415) aunque diga serlo', async () => {
    const r = await subir(Buffer.from('esto no es un pdf'), 'falso.pdf', 'application/pdf')
    expect(r.status).toBe(415)
  })

  it('Word de más de 5 MB → 413; sólo tenant_admin importa', async () => {
    const grande = Buffer.concat([await wordPauta(), Buffer.alloc(5 * 1024 * 1024 + 1)])
    const r = await subir(grande, 'grande.docx')
    expect(r.status).toBe(413)
    const s = await server().post('/api/v1/templates/imports').set('Authorization', `Bearer ${supervisor}`).attach('file', await wordPauta(), 'x.docx')
    expect(s.status).toBe(403)
  })
})
