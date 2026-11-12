/**
 * Importar plantillas con IA — TSK-FORM-021 (Enmienda 006).
 *
 * De punta a punta por la API real, con un analizador de IA FALSO inyectado
 * en lugar de Claude: la CI nunca llama a la API ni gasta crédito. Se prueban
 * el flujo (foto, PDF escaneado, reintento), los topes, los errores y la
 * auditoría; el mapeo de la salida del modelo se prueba en shared.
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
import PDFDocument from 'pdfkit'
import { propuestaDesdeIA } from '@terreno/shared/importar'
import type { ParseResult } from '@terreno/shared/xlsx'
import { AppModule } from '../src/app.module'
import { configureApp } from '../src/app.setup'
import { ANALIZADOR_IA, AnalizadorClaude, type AnalizadorIA, type EntradaIA } from '../src/templates/importar-ia'
import { DEMO_PASSWORD, seedDatabase } from '../db/seed'

const MIGRATIONS_DIR = resolve(process.cwd(), 'db', 'migrations')
// PNG 1×1: basta la firma; el analizador falso no mira la imagen.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

/** Analizador falso: guarda lo que recibe y responde lo que el test fije. */
class IAFalsa implements AnalizadorIA {
  activa = true
  llamadas: EntradaIA[] = []
  respuesta: () => ParseResult = () =>
    propuestaDesdeIA(
      {
        secciones: [
          {
            titulo: 'Equipo',
            items: [
              { pregunta: 'Extintor cargado', tipo: 'ok_nok_na', obligatorio: true, opciones: null, minimo: null, maximo: null },
              { pregunta: 'Presión (bar)', tipo: 'numeric', obligatorio: true, opciones: null, minimo: 0, maximo: 20 },
              { pregunta: 'Observaciones', tipo: 'text', obligatorio: false, opciones: null, minimo: null, maximo: null },
            ],
          },
        ],
        advertencias: ['La esquina inferior está borrosa.'],
      },
      'pauta',
      'png',
    )
  disponible() {
    return this.activa
  }
  async analizar(e: EntradaIA) {
    this.llamadas.push(e)
    return { resultado: this.respuesta(), modelo: 'claude-haiku-5-5', tokens_entrada: 1500, tokens_salida: 400 }
  }
}

let container: StartedPostgreSqlContainer
let pool: Pool
let app: INestApplication
let admin = ''
let supervisor = ''
const ia = new IAFalsa()
const server = () => request(app.getHttpServer())
const auth = (t: string) => ({ Authorization: `Bearer ${t}` })

function subir(bytes: Buffer, nombre: string, motor?: 'reglas' | 'ia') {
  const r = server().post('/api/v1/templates/imports').set(auth(admin)).attach('file', bytes, { filename: nombre, contentType: 'application/octet-stream' })
  return motor ? r.field('motor', motor) : r
}

/** PDF escaneado: sólo una imagen (un rectángulo), sin texto que leer. */
function pdfEscaneado(): Promise<Buffer> {
  return new Promise((res, rej) => {
    const d = new PDFDocument({ size: 'A4' })
    const partes: Buffer[] = []
    d.on('data', (b: Buffer) => partes.push(b))
    d.on('end', () => res(Buffer.concat(partes)))
    d.on('error', rej)
    d.rect(50, 50, 400, 300).fill('#cccccc')
    d.end()
  })
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
  process.env.SYNC_VOLUME = await mkdtemp(join(tmpdir(), 'terreno-import-ia-'))
  process.env.NODE_ENV = 'test'
  process.env.IA_TOPE_DIARIO = '100'
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(ANALIZADOR_IA).useValue(ia).compile()
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
  delete process.env.IA_TOPE_DIARIO
  await app?.close()
  await pool?.end()
  await container?.stop()
})

describe('importar con IA (TSK-FORM-021)', () => {
  it('foto de una pauta: sin IA 415; con IA propone, se confirma y queda auditada', async () => {
    const sinIA = await subir(PNG, 'pauta.png')
    expect(sinIA.status).toBe(415)
    expect(sinIA.body.message).toMatch(/Analizar con IA/)

    const up = await subir(PNG, 'pauta.png', 'ia')
    expect(up.status).toBe(201)
    expect(up.body).toMatchObject({ status: 'proposed', formato: 'png', motor: 'ia' })
    expect(ia.llamadas.at(-1)).toMatchObject({ formato: 'png', nombre_archivo: 'pauta.png' })
    const items = up.body.proposed_schema.secciones[0].items.map((i: { prompt: string; response_type: string }) => [i.prompt, i.response_type])
    expect(items).toEqual([
      ['Extintor cargado', 'ok_nok_na'],
      ['Presión (bar)', 'numeric'],
      ['Observaciones', 'text'],
    ])
    expect(up.body.proposed_schema.advertencias).toContain('La esquina inferior está borrosa.')

    const conf = await server().post(`/api/v1/templates/imports/${up.body.id}/confirm`).set(auth(admin)).send({ name: 'Extintores (foto)', publish: true })
    expect(conf.status).toBe(201)

    const { rows: archivo } = await pool.query('SELECT i.file_key, a.mime FROM template_imports i JOIN attachment a ON a.owner_id = i.id WHERE i.id = $1', [up.body.id])
    expect(archivo[0].file_key).toMatch(/\.png$/)
    expect(archivo[0].mime).toBe('image/png')
    const { rows: audit } = await pool.query("SELECT payload FROM audit_log WHERE action = 'template_import_ia' AND entity_id = $1", [up.body.id])
    expect(audit).toHaveLength(1)
    expect(audit[0].payload).toMatchObject({ formato: 'png', modelo: 'claude-haiku-5-5', tokens_entrada: 1500, tokens_salida: 400, ok: true })
  })

  it('PDF escaneado: las reglas fallan y "Reintentar con IA" lo resuelve con el archivo guardado', async () => {
    const up = await subir(await pdfEscaneado(), 'scan.pdf')
    expect(up.status).toBe(201)
    expect(up.body).toMatchObject({ status: 'failed', motor: 'reglas' })

    const re = await server().post(`/api/v1/templates/imports/${up.body.id}/analizar-ia`).set(auth(admin))
    expect(re.status).toBe(200)
    expect(re.body).toMatchObject({ status: 'proposed', motor: 'ia', error: null })
    expect(ia.llamadas.at(-1)?.formato).toBe('pdf')
    expect(Buffer.from(ia.llamadas.at(-1)!.bytes).subarray(0, 5).toString()).toBe('%PDF-')

    // Ya confirmado, no se vuelve a analizar.
    await server().post(`/api/v1/templates/imports/${up.body.id}/confirm`).set(auth(admin)).send({ name: 'Escaneado' }).expect(201)
    const otra = await server().post(`/api/v1/templates/imports/${up.body.id}/analizar-ia`).set(auth(admin))
    expect(otra.status).toBe(409)
  })

  it('respuesta de la IA con error o inválida: queda failed con el motivo, sin guardar basura', async () => {
    ia.respuesta = () => ({ ok: false, error: 'Se acabó el crédito de IA. Avisa al administrador; mientras tanto usa las reglas.' })
    const sinCredito = await subir(PNG, 'a.png', 'ia')
    expect(sinCredito.body).toMatchObject({ status: 'failed', error: expect.stringContaining('crédito'), proposed_schema: null })

    ia.respuesta = () => ({
      ok: true,
      propuesta: {
        nombre_archivo: 'b.png',
        formato: 'png',
        secciones: [{ titulo: 'X', items: [{ prompt: 'Turno', response_type: 'select_single', required: true, props: {}, opcionesConteo: {}, muestra: [], filasConDato: 0 }] }],
        resumen: { secciones: 1, items: 1, filasDatos: 0 },
      },
    })
    const invalida = await subir(PNG, 'b.png', 'ia')
    expect(invalida.body).toMatchObject({ status: 'failed', proposed_schema: null })
    expect(invalida.body.error).toMatch(/propuesta inválida/)
    ia.respuesta = new IAFalsa().respuesta
  })

  it('capacidades y tope diario por empresa (429)', async () => {
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM audit_log WHERE action = 'template_import_ia'")
    const usados = rows[0].n as number
    process.env.IA_TOPE_DIARIO = String(usados + 1)
    try {
      const cap = await server().get('/api/v1/templates/imports/capacidades').set(auth(admin))
      expect(cap.status).toBe(200)
      expect(cap.body).toEqual({ ia: true, restantes_hoy: 1, tope_diario: usados + 1 })

      await subir(PNG, 'ultimo.png', 'ia').expect(201)
      const tope = await subir(PNG, 'otro.png', 'ia')
      expect(tope.status).toBe(429)
      expect(tope.body.message).toMatch(/máximo de \d+ análisis/)
      const cap2 = await server().get('/api/v1/templates/imports/capacidades').set(auth(admin))
      expect(cap2.body.restantes_hoy).toBe(0)
    } finally {
      process.env.IA_TOPE_DIARIO = '100'
    }
  })

  it('Excel con IA → 400; sin IA configurada → capacidades false y 503; supervisor → 403', async () => {
    // Un .xlsx mínimo no hace falta: basta la firma ZIP con la parte del libro.
    const xlsx = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('xl/workbook.xml')])
    const conIA = await subir(xlsx, 'libro.xlsx', 'ia')
    expect(conIA.status).toBe(400)
    expect(conIA.body.message).toMatch(/Excel se importa con las reglas/)

    const motorMalo = await subir(PNG, 'x.png').field('motor', 'magia')
    expect(motorMalo.status).toBe(400)

    ia.activa = false
    try {
      const cap = await server().get('/api/v1/templates/imports/capacidades').set(auth(admin))
      expect(cap.body).toMatchObject({ ia: false, restantes_hoy: 0 })
      expect((await subir(PNG, 'x.png', 'ia')).status).toBe(503)
    } finally {
      ia.activa = true
    }

    expect((await server().get('/api/v1/templates/imports/capacidades').set(auth(supervisor))).status).toBe(403)
    const { rows } = await pool.query('SELECT id FROM template_imports LIMIT 1')
    expect((await server().post(`/api/v1/templates/imports/${rows[0].id}/analizar-ia`).set(auth(supervisor))).status).toBe(403)
  })

  it('el analizador real sin clave queda apagado y no llama a la API', async () => {
    const real = new AnalizadorClaude('', undefined)
    expect(real.disponible()).toBe(false)
    expect(real.modelo).toBe('claude-haiku-5-5')
    const r = await real.analizar({ bytes: PNG, formato: 'png', nombre_archivo: 'x.png' })
    expect(r.resultado).toEqual({ ok: false, error: expect.stringContaining('no está configurada') })
    expect(new AnalizadorClaude('sk-falsa', 'claude-opus-5-5').modelo).toBe('claude-opus-5-5')
  })
})
