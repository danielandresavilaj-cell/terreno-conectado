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
import type { Response } from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import {
  XLSX_MIME,
  type CampoValor,
  type ResponseType,
  type TemplateDefinition,
  type TemplateItem,
} from '@terreno/shared'
import { leerCuadricula, proponerImport } from '@terreno/shared/xlsx'
import { AppModule } from '../src/app.module'
import { configureApp } from '../src/app.setup'
import { TemplatesService } from '../src/templates/templates.service'
import { DEMO_PASSWORD, SITE_A_ID, TENANT_A_ID, seedDatabase } from '../db/seed'

/**
 * TSK-FORM-011 (issue #44) — matriz de libros `.xlsx` reales anonimizados.
 *
 * Los libros de un cliente real son irregulares: títulos fusionados, hileras de
 * encabezado con y sin hint de tipo, varias hojas por libro, celdas vacías y
 * valores que sólo se distinguen por su forma. Aquí se arma una **matriz**
 * determinista de esos casos (datos anónimos, `test-plan.md` §6) y se exige que
 * cada libro: (1) parsee con los tipos esperados, (2) importe y publique por la
 * API real y (3) materialice su catálogo tipado. El libro más completo cierra
 * además el ciclo import → publicación → captura → export rellenado (FR-019/044).
 *
 * Nada de esto usa datos reales de faenas (informe APT §3.5): son libros
 * sintéticos con la forma de los de terreno.
 */

const MIGRATIONS_DIR = resolve(process.cwd(), 'db', 'migrations')
const CAPTURED_AT = '2026-10-05T09:00:00.000Z'
const TRABAJADOR_A_ID = '01890000-0000-7000-8000-0000000000a3'

interface HojaSpec {
  nombre: string
  /** Fila de título fusionada que precede al encabezado real (se ignora). */
  titulo?: string
  encabezados: string[]
  filas: (string | number | null)[][]
}

interface CasoLibro {
  nombre: string
  hojas: HojaSpec[]
  secciones: number
  tipos: ResponseType[]
}

/**
 * La matriz: un libro con los 8 tipos, otro con varias hojas (una sección por
 * hoja) y otro con encabezados sin hint que obligan a la detección automática.
 */
const MATRIZ: CasoLibro[] = [
  {
    nombre: 'checklist-minero-2026.xlsx',
    secciones: 1,
    tipos: ['ok_nok_na', 'numeric', 'date', 'time', 'select_single', 'select_multiple', 'text', 'photo'],
    hojas: [
      {
        nombre: 'Checklist Diario',
        titulo: 'CHECKLIST DIARIO — FAENA LOS ANDES',
        encabezados: [
          'Revisión inicial (ok/nok/na)',
          'Avance (%) (número)',
          'Fecha (fecha)',
          'Hora de inicio (hora)',
          'Turno (lista)',
          'Riesgos (multi)',
          'Observación (texto)',
          'Evidencia (foto)',
        ],
        filas: [
          ['OK', 10, '2026-10-01', '08:00', 'Día', 'Ruido;Polvo', 'Sin novedad', null],
          ['NOK', 25, '2026-10-02', '15:30', 'Noche', 'Polvo', 'Falta señalización', null],
          ['OK', 40, '2026-10-03', '09:15', 'Día', 'Ruido', 'Todo en orden', null],
        ],
      },
    ],
  },
  {
    nombre: 'obra-multiseccion.xlsx',
    secciones: 2,
    tipos: ['ok_nok_na', 'text', 'ok_nok_na', 'ok_nok_na'],
    hojas: [
      {
        nombre: 'Aseo',
        titulo: 'ASEO Y ORDEN',
        encabezados: ['Cumple (ok/nok/na)', 'Detalle (texto)'],
        filas: [
          ['OK', 'Sin basura'],
          ['NOK', 'Escombros en acceso'],
        ],
      },
      {
        nombre: 'EPP',
        titulo: 'ELEMENTOS DE PROTECCIÓN PERSONAL',
        encabezados: ['Casco (ok/nok/na)', 'Arnés (ok/nok/na)'],
        filas: [
          ['OK', 'NOK'],
          ['OK', 'OK'],
        ],
      },
    ],
  },
  {
    nombre: 'datos-irregulares.xlsx',
    secciones: 1,
    tipos: ['numeric', 'date', 'text', 'ok_nok_na', 'select_single'],
    hojas: [
      {
        nombre: 'Reporte',
        encabezados: ['Cantidad', 'Fecha reporte', 'Comentario', 'Estado', 'Semáforo'],
        filas: [
          [3, '2026-01-05', 'Observación uno', 'OK', 'Verde'],
          [7, '2026-02-10', 'Observación dos', 'NOK', 'Amarillo'],
          [null, '2026-03-15', null, 'OK', 'Verde'],
        ],
      },
    ],
  },
]

let container: StartedPostgreSqlContainer
let ownerPool: Pool
let app: INestApplication
let templates: TemplatesService
let syncVolume: string
let adminToken: string
let trabajadorToken: string

const server = () => request(app.getHttpServer())
const auth = (token: string) => ({ Authorization: `Bearer ${token}` })

/** Arma el `.xlsx` desde la especificación, con el título fusionado si lo hay. */
function construirLibro(caso: CasoLibro): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook()
  for (const hoja of caso.hojas) {
    const ws = wb.addWorksheet(hoja.nombre)
    let filaEncabezado = 1
    if (hoja.titulo !== undefined) {
      ws.getCell(1, 1).value = hoja.titulo
      ws.mergeCells(1, 1, 1, hoja.encabezados.length)
      filaEncabezado = 2
    }
    hoja.encabezados.forEach((h, i) => {
      ws.getCell(filaEncabezado, i + 1).value = h
    })
    hoja.filas.forEach((fila, r) => {
      fila.forEach((valor, c) => {
        if (valor !== null) ws.getCell(filaEncabezado + 1 + r, c + 1).value = valor
      })
    })
  }
  return wb
}

async function subirLibro(bytes: Uint8Array, nombre: string): Promise<string> {
  const res = await server()
    .post('/api/v1/templates/imports')
    .set(auth(adminToken))
    .attach('file', Buffer.from(bytes), { filename: nombre, contentType: XLSX_MIME })
  expect(res.status).toBe(201)
  expect(res.body.status).toBe('proposed')
  return res.body.id as string
}

function confirmarOK(importId: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  return server()
    .post(`/api/v1/templates/imports/${importId}/confirm`)
    .set(auth(adminToken))
    .send(body)
    .then((res: Response) => {
      expect(res.status).toBe(201)
      return res.body as Record<string, unknown>
    })
}

const itemsDe = (definition: TemplateDefinition): TemplateItem[] =>
  definition.sections.flatMap((s) => s.items)

/** Reparto del valor en la columna de `value_*` según el tipo del ítem (FR-036). */
function payloadDeRespuesta(item: TemplateItem, campo: CampoValor): Record<string, unknown> {
  const vacio = { value_ok: null, value_text: null, value_number: null, value_json: null }
  switch (item.response_type) {
    case 'ok_nok_na':
      return { ...vacio, value_ok: campo }
    case 'text':
      return { ...vacio, value_text: campo as string }
    default:
      return { ...vacio, value_json: campo }
  }
}

async function sembrarInspeccion(
  templateId: string,
  templateVersion: number,
  items: TemplateItem[],
  campos: Record<string, CampoValor>,
): Promise<string> {
  const inspectionId = randomUUID()
  const records: Array<Record<string, unknown>> = [
    {
      entity_type: 'inspection',
      id: inspectionId,
      tenant_id: TENANT_A_ID,
      client_version: 1,
      captured_at: CAPTURED_AT,
      payload: {
        site_id: SITE_A_ID,
        template_id: templateId,
        template_version: templateVersion,
        executed_by: TRABAJADOR_A_ID,
        status: 'submitted',
      },
    },
  ]
  for (const [itemId, campo] of Object.entries(campos)) {
    const item = items.find((i) => i.id === itemId)
    if (!item) throw new Error(`ítem desconocido en el lote: ${itemId}`)
    records.push({
      entity_type: 'response',
      id: randomUUID(),
      tenant_id: TENANT_A_ID,
      client_version: 1,
      captured_at: CAPTURED_AT,
      payload: { inspection_id: inspectionId, template_item_id: itemId, ...payloadDeRespuesta(item, campo) },
    })
  }
  const res = await server()
    .post('/api/v1/sync/batch')
    .set(auth(trabajadorToken))
    .send({ batch_id: randomUUID(), device_id: randomUUID(), records })
  expect(res.status).toBe(200)
  expect(res.body.status).toBe('ok')
  return inspectionId
}

async function textosDeLibro(bytes: Uint8Array): Promise<string> {
  const hojas = await leerCuadricula(bytes)
  const out: string[] = []
  for (const hoja of hojas) {
    for (const fila of hoja.filas) {
      for (const celda of fila) if (celda) out.push(celda.texto)
    }
  }
  return out.join('|')
}

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').withDatabase('terreno').start()

  const ownerUrl = container.getConnectionUri()
  await runner({ databaseUrl: ownerUrl, dir: MIGRATIONS_DIR, direction: 'up', migrationsTable: 'pgmigrations' })

  ownerPool = new Pool({ connectionString: ownerUrl })
  await seedDatabase(ownerPool)
  await ownerPool.query("ALTER ROLE tc_app LOGIN PASSWORD 'test'")

  syncVolume = await mkdtemp(join(tmpdir(), 'terreno-libros-reales-'))

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
    const res = await server().post('/api/v1/auth/login').send({ email, password: DEMO_PASSWORD })
    expect(res.status).toBe(200)
    return res.body.access_token as string
  }
  adminToken = await login('admin@minera.cl')
  trabajadorToken = await login('trabajador@minera.cl')
}, 180_000)

afterAll(async () => {
  await app?.close()
  await ownerPool?.end()
  await container?.stop()
})

describe('matriz de libros .xlsx reales anonimizados', () => {
  for (const caso of MATRIZ) {
    it(`parsea, importa y publica "${caso.nombre}" con los tipos esperados`, async () => {
      const bytes = new Uint8Array(await construirLibro(caso).xlsx.writeBuffer())

      // 1) El parser propone los tipos correctos para la forma del libro real.
      const parseo = await proponerImport(bytes, caso.nombre)
      expect(parseo.ok).toBe(true)
      if (!parseo.ok) throw new Error(parseo.error)
      expect(parseo.propuesta.secciones).toHaveLength(caso.secciones)
      expect(parseo.propuesta.secciones.flatMap((s) => s.items.map((i) => i.response_type))).toEqual(
        caso.tipos,
      )

      // 2) Import + publicación por la API real.
      const importId = await subirLibro(bytes, caso.nombre)
      const rev = await confirmarOK(importId, { publish: true })
      expect(rev.status).toBe('published')
      const items = itemsDe(rev.definition as TemplateDefinition)
      expect(items.map((i) => i.response_type)).toEqual(caso.tipos)

      // 3) El catálogo materializado conserva los tipos (FR-036/039).
      const catalogo = await templates.listItemsByRevision(TENANT_A_ID, rev.id as string)
      expect(catalogo.map((i) => i.response_type).sort()).toEqual([...caso.tipos].sort())
    })
  }

  it('el libro minero completo cierra el ciclo import → publish → captura → export', async () => {
    const caso = MATRIZ[0]
    const origen = new Uint8Array(await construirLibro(caso).xlsx.writeBuffer())

    const importId = await subirLibro(origen, caso.nombre)
    const rev = await confirmarOK(importId, { publish: true })
    const templateId = rev.template_id as string
    const items = itemsDe(rev.definition as TemplateDefinition)

    // Captura firmada contra la v1 recién publicada.
    const okNok = items.find((i) => i.response_type === 'ok_nok_na')!
    const texto = items.find((i) => i.response_type === 'text')!
    const inspectionId = await sembrarInspeccion(templateId, 1, items, {
      [okNok.id]: 'nok',
      [texto.id]: 'Falta señalización en el acceso',
    })

    // El export rellena el documento ORIGINAL con las respuestas y añade la hoja
    // de evidencias (FR-019/044).
    const res = await server()
      .get(`/api/v1/dashboard/inspections/${inspectionId}/export`)
      .set(auth(adminToken))
      .responseType('blob')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toBe(XLSX_MIME)

    const libro = new Uint8Array(res.body as Buffer)
    expect(Array.from(libro.subarray(0, 2))).toEqual([0x50, 0x4b])

    const textoExportado = await textosDeLibro(libro)
    expect(textoExportado).toContain('NOK')
    expect(textoExportado).toContain('Falta señalización en el acceso')
  })
})
