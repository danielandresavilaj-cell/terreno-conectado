import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { PostgreSqlContainer } from '@testcontainers/postgresql'
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { Pool } from 'pg'
import { runner } from 'node-pg-migrate'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
// ExcelJS entra por el hoisting del monorepo (lo usa `shared`, que es quien
// escribe el libro). El test necesita releer el `.xlsx` descargado para
// comprobar qué quedó escrito de verdad, no lo que el servicio dice.
import ExcelJS from 'exceljs'
import {
  XLSX_MIME,
  type CampoValor,
  type TemplateDefinition,
  type TemplateItem,
} from '@terreno/shared'
import {
  INDICADOR_EVIDENCIA,
  UMBRAL_EVIDENCIA_BYTES,
  construirRespuestas,
  emparejarItemsConOrigen,
  evidenciaSeIncrusta,
  leerCuadricula,
  proponerImport,
  rellenarOriginal,
  type EvidenciaRellenable,
} from '@terreno/shared/xlsx'
import { AppModule } from '../src/app.module'
import { configureApp } from '../src/app.setup'
import { inspectionsResponseSchema } from '../src/dashboard/dashboard.contract'
import {
  DEMO_PASSWORD,
  SITE_A_ID,
  SITE_B_ID,
  TENANT_A_ID,
  TEMPLATE_A_ID,
  seedDatabase,
} from '../db/seed'

/**
 * TSK-FORM-010 (issue #43) — FR-044: el supervisor descarga una inspección como
 * el `.xlsx` original rellenado + hoja "Evidencias", generado en servidor y con
 * el MISMO formato que produce el dispositivo (FR-019).
 *
 * El caso central no es "devuelve 200": es que **el artefacto del servidor y el
 * del dispositivo sean el mismo**. Por eso el `.xlsx` de prueba entra por la API
 * real (`POST /templates/imports` → confirm) y las respuestas por
 * `POST /sync/batch`: el servicio resuelve definición, celdas y evidencias por
 * los mismos caminos que en producción, y el test reconstruye el artefacto del
 * dispositivo con el módulo compartido para comparar.
 *
 * El libro se genera con ExcelJS (como en los tests de `shared`) en vez de usar
 * un binario del repo: el tipo de cada columna sale del hint del encabezado, así
 * que el test no depende del contenido de la fila de muestra.
 */

const MIGRATIONS_DIR = resolve(process.cwd(), 'db', 'migrations')

/** PNG 1×1 real: el camino de imagen es el que importa, no el contenido. */
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)
/** Tamaño de la foto que debe quedar REFERENCIADA (FR-046). */
const BYTES_FOTO_GRANDE = UMBRAL_EVIDENCIA_BYTES + 1024
const CAPTURED_AT = '2026-10-05T09:00:00.000Z'
/**
 * Nombre del original. ASCII a propósito: `multer` decodifica `originalname`
 * como latin1, así que un nombre con acento se guarda (y se descargaría)
 * mojibake — eso es de la subida (TSK-FORM-006), no de este export. La rama
 * UTF-8 de la cabecera la cubre `templates.delta.spec.ts`.
 */
const NOMBRE_ORIGINAL = 'control-diario-2026.xlsx'
const TRABAJADOR_A_ID = '01890000-0000-7000-8000-0000000000a3'

let container: StartedPostgreSqlContainer
let ownerPool: Pool
let app: INestApplication
let syncVolume: string

let trabajadorToken: string
let supervisorToken: string
let adminToken: string
let supervisorBToken: string
let platformToken: string

/** Bytes del original tal como quedaron guardados en el volumen de sync. */
let originalBytes: Uint8Array
let definition: TemplateDefinition
let templateId: string
let revisionId: string
/** Ítems con los ids reales que generó la importación, en orden de render. */
let items: TemplateItem[]

/** Inspección "de paridad": todos los tipos de campo + la foto pequeña. */
let inspectionParidad: string
/** Inspección "de evidencias": además, la foto grande que se referencia. */
let inspectionEvidencias: string
/** Inspección sobre una plantilla creada a mano (sin documento original). */
let inspectionSinOriginal: string
/** `file_key` de la foto grande sembrada (la referencia de la hoja). */
let fileKeyGrande: string

const server = () => request(app.getHttpServer())
const auth = (token: string) => ({ Authorization: `Bearer ${token}` })

/** Libro de una hoja: un ítem por tipo de campo y una segunda columna de foto. */
function libroOriginal(): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Checklist')
  ws.getCell('A2').value = 'Estado (ok/nok/na)'
  ws.getCell('B2').value = 'Observación (texto)'
  ws.getCell('C2').value = 'Cantidad (número)'
  ws.getCell('D2').value = 'Fecha (fecha)'
  ws.getCell('E2').value = 'Hora (hora)'
  ws.getCell('F2').value = 'Turno (lista)'
  ws.getCell('G2').value = 'Áreas (multi)'
  ws.getCell('H2').value = 'Evidencia (foto)'
  ws.getCell('I2').value = 'Evidencia panorámica (foto)'
  // Dos filas de muestra: el parser necesita datos para derivar `props`
  // (options, min/max) aunque el tipo venga por hint.
  for (const fila of [3, 4]) {
    ws.getCell(`A${fila}`).value = 'OK'
    ws.getCell(`B${fila}`).value = 'Sin novedad'
    ws.getCell(`C${fila}`).value = fila
    ws.getCell(`D${fila}`).value = '2026-03-01'
    ws.getCell(`E${fila}`).value = '08:00'
    ws.getCell(`F${fila}`).value = fila === 3 ? 'Día' : 'Noche'
    ws.getCell(`G${fila}`).value = fila === 3 ? 'Perimetral; Tajones' : 'Perimetral; Bajada'
  }
  return wb
}

function itemDe(tipo: TemplateItem['response_type']): TemplateItem {
  const encontrado = items.find((i) => i.response_type === tipo)
  if (!encontrado) throw new Error(`el libro de prueba no produjo un ítem ${tipo}`)
  return encontrado
}

/** Opciones que el parser dedujo de las filas de muestra del libro. */
function opcionesDe(tipo: TemplateItem['response_type']): string[] {
  const opciones = (itemDe(tipo).props as { options?: unknown } | undefined)?.options
  if (!Array.isArray(opciones) || opciones.length === 0) {
    throw new Error(`el ítem ${tipo} no quedó con opciones`)
  }
  return opciones.map(String)
}

/** Los ítems `photo`, en orden: el índice es el número de foto del nombre. */
function fotos(): TemplateItem[] {
  return items.filter((i) => i.response_type === 'photo')
}
const foto1 = () => fotos()[0]
const foto2 = () => fotos()[1]

/** Valores capturados, ya válidos contra el tipo del ítem. */
function camposRespuestos(conFotoGrande: boolean): Record<string, CampoValor> {
  const campos: Record<string, CampoValor> = {
    [itemDe('ok_nok_na').id]: 'nok',
    [itemDe('text').id]: 'Falta señalización en el acceso',
    [itemDe('numeric').id]: 7,
    [itemDe('date').id]: '2026-03-05',
    [itemDe('time').id]: '08:30',
    [itemDe('select_single').id]: opcionesDe('select_single')[0],
    [itemDe('select_multiple').id]: opcionesDe('select_multiple').slice(0, 2),
    [foto1().id]: 'capturada',
  }
  if (conFotoGrande) campos[foto2().id] = 'capturada'
  return campos
}

/**
 * Payload de `inspection_response` con el valor en la columna que le toca al
 * tipo del ítem — el mismo reparto que hace el dispositivo al persistir
 * (`frontend/src/lib/valores.ts`, `columnasDesdeValor`). Si este reparto se
 * desalinea con el que lee el export, la respuesta no aparece en el documento.
 */
function payloadDeRespuesta(item: TemplateItem, campo: CampoValor): Record<string, unknown> {
  switch (item.response_type) {
    case 'ok_nok_na':
      return { value_ok: campo, value_text: null, value_number: null, value_json: null }
    case 'numeric':
      return { value_ok: null, value_text: null, value_number: campo, value_json: null }
    case 'select_multiple':
      return { value_ok: null, value_text: null, value_number: null, value_json: campo }
    case 'text':
      return { value_ok: null, value_text: campo as string, value_number: null, value_json: null }
    default:
      // date/time/select_single → `value_json`; foto → marcador en `value_text`.
      if (item.response_type === 'photo') {
        return { value_ok: null, value_text: campo, value_number: null, value_json: null }
      }
      return { value_ok: null, value_text: null, value_number: null, value_json: campo }
  }
}

/** Inspección + respuestas + foto pequeña, como los enviaría el dispositivo. */
function loteDeInspeccion(campos: Record<string, CampoValor>): {
  inspectionId: string
  records: Array<Record<string, unknown>>
} {
  const inspectionId = randomUUID()
  const respuestas = new Map<string, string>()

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
        // Versión congelada del turno (FR-028): la del import recién publicado.
        template_version: 1,
        executed_by: TRABAJADOR_A_ID,
        status: 'submitted',
      },
    },
  ]

  for (const [itemId, campo] of Object.entries(campos)) {
    const id = randomUUID()
    respuestas.set(itemId, id)
    records.push({
      entity_type: 'response',
      id,
      tenant_id: TENANT_A_ID,
      client_version: 1,
      captured_at: CAPTURED_AT,
      payload: {
        inspection_id: inspectionId,
        template_item_id: itemId,
        ...payloadDeRespuesta(itemDeTipo(itemId), campo),
      },
    })
  }

  records.push({
    entity_type: 'attachment',
    id: randomUUID(),
    tenant_id: TENANT_A_ID,
    client_version: 1,
    captured_at: CAPTURED_AT,
    payload: {
      owner_type: 'response',
      owner_id: respuestas.get(foto1().id),
      mime: 'image/png',
      bytes: PNG_1x1.length,
      width: 1,
      height: 1,
      data: PNG_1x1.toString('base64'),
    },
  })

  return { inspectionId, records }
}

function itemDeTipo(itemId: string): TemplateItem {
  const item = items.find((i) => i.id === itemId)
  if (!item) throw new Error(`ítem desconocido en el lote: ${itemId}`)
  return item
}

/**
 * Siembra el adjunto grande como lo haría `SyncService` (fila + archivo en el
 * volumen). No puede entrar por `POST /sync/batch`: el base64 de 600 kB supera
 * el límite de cuerpo de express. Lo que el export consume es exactamente esto
 * —la fila y el archivo—, así que sembrarlo es sembrar el estado real.
 */
async function sembrarFotoGrande(responseId: string): Promise<string> {
  const attachmentId = randomUUID()
  const fileKey = `sync/${TENANT_A_ID}/${attachmentId}.jpg`
  const path = join(syncVolume, fileKey)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, Buffer.alloc(BYTES_FOTO_GRANDE, 7))
  await ownerPool.query(
    `INSERT INTO attachment
       (id, tenant_id, owner_type, owner_id, file_key, mime, bytes, width, height,
        captured_at, client_version)
     VALUES ($1, $2, 'response', $3, $4, 'image/jpeg', $5, 1280, 720, $6, 1)`,
    [attachmentId, TENANT_A_ID, responseId, fileKey, BYTES_FOTO_GRANDE, CAPTURED_AT],
  )
  return fileKey
}

/**
 * A qué celda le toca a cada ítem, según el PARSER. Es la referencia contra la
 * que se comprueba lo que el export escribió: el servicio no puede elegir el
 * destino, sólo obedecer al emparejamiento.
 */
async function destinosDelParser() {
  const parseo = await proponerImport(originalBytes, NOMBRE_ORIGINAL)
  if (!parseo.ok) throw new Error(`el original no es parseable: ${parseo.error}`)
  const emparejado = emparejarItemsConOrigen(definition, parseo.propuesta)
  if (!emparejado.ok) throw new Error(`el emparejamiento falló: ${emparejado.error}`)
  return emparejado.destinos
}

/** Imágenes incrustadas por hoja (sólo "Evidencias" debería llevar alguna). */
async function imagenesDe(libro: Uint8Array): Promise<Record<string, number>> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(Buffer.from(libro) as unknown as Parameters<typeof wb.xlsx.load>[0])
  const conteo: Record<string, number> = {}
  for (const hoja of wb.worksheets) conteo[hoja.name] = hoja.getImages().length
  return conteo
}

async function syncBatch(records: Array<Record<string, unknown>>) {
  const res = await server()
    .post('/api/v1/sync/batch')
    .set(auth(trabajadorToken))
    .send({ batch_id: randomUUID(), device_id: randomUUID(), records })
  expect(res.status).toBe(200)
  expect(res.body.status).toBe('ok')
}

/** Descarga el export y devuelve los bytes con el status esperado. */
async function descargar(token: string, inspectionId: string): Promise<Uint8Array> {
  const res = await server()
    .get(`/api/v1/dashboard/inspections/${inspectionId}/export`)
    .set(auth(token))
    .responseType('blob')
  expect(res.status).toBe(200)
  expect(res.headers['content-type']).toBe(XLSX_MIME)
  return new Uint8Array(res.body as Buffer)
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

  syncVolume = await mkdtemp(join(tmpdir(), 'terreno-export-'))

  process.env.DATABASE_URL = ownerUrl
  process.env.APP_DATABASE_URL = ownerUrl.replace('test:test@', 'tc_app:test@')
  process.env.JWT_ACCESS_SECRET = 'test-access-secret-32bytes-long!!!!!'
  process.env.SYNC_VOLUME = syncVolume
  process.env.NODE_ENV = 'test'

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
  app = configureApp(moduleRef.createNestApplication())
  await app.init()

  const login = async (email: string) => {
    const res = await server()
      .post('/api/v1/auth/login')
      .send({ email, password: DEMO_PASSWORD })
    expect(res.status).toBe(200)
    return res.body.access_token as string
  }

  trabajadorToken = await login('trabajador@minera.cl')
  supervisorToken = await login('supervisor@minera.cl')
  adminToken = await login('admin@minera.cl')
  supervisorBToken = await login('supervisor@andes.cl')
  platformToken = await login('admin@terreno.local')

  /* ── El original entra por la API real de importación (TSK-FORM-006/007) ── */

  const generado = await libroOriginal().xlsx.writeBuffer()
  const upload = await server()
    .post('/api/v1/templates/imports')
    .set(auth(adminToken))
    .attach('file', Buffer.from(generado), { filename: NOMBRE_ORIGINAL, contentType: XLSX_MIME })
  expect(upload.status).toBe(201)
  const importId = upload.body.id as string

  const confirm = await server()
    .post(`/api/v1/templates/imports/${importId}/confirm`)
    .set(auth(adminToken))
    .send({ publish: true })
  expect(confirm.status).toBe(201)
  expect(confirm.body.status).toBe('published')
  revisionId = confirm.body.id as string
  templateId = confirm.body.template_id as string
  definition = confirm.body.definition as TemplateDefinition
  items = definition.sections.flatMap((s) => s.items)
  // 8 tipos de campo + la segunda columna de foto.
  expect(items.length).toBe(9)
  expect(fotos().length).toBe(2)

  // El mismo archivo que el export va a leer del volumen.
  originalBytes = new Uint8Array(
    await readFile(join(syncVolume, `template_imports/${TENANT_A_ID}/${importId}.xlsx`)),
  )

  /* ── Las inspecciones entran por la ingesta (FR-021, idempotente) ────────── */

  const paridad = loteDeInspeccion(camposRespuestos(false))
  await syncBatch(paridad.records)
  inspectionParidad = paridad.inspectionId

  const evidencias = loteDeInspeccion(camposRespuestos(true))
  await syncBatch(evidencias.records)
  inspectionEvidencias = evidencias.inspectionId
  const { rows } = await ownerPool.query(
    `SELECT id FROM inspection_response WHERE inspection_id = $1 AND template_item_id = $2`,
    [inspectionEvidencias, foto2().id],
  )
  fileKeyGrande = await sembrarFotoGrande(rows[0].id as string)

  // Inspección sobre la plantilla del seed, creada a mano: no tiene documento
  // original importado, así que su export debe explicar eso y no fallar raro.
  inspectionSinOriginal = randomUUID()
  await syncBatch([
    {
      entity_type: 'inspection',
      id: inspectionSinOriginal,
      tenant_id: TENANT_A_ID,
      client_version: 1,
      captured_at: CAPTURED_AT,
      payload: {
        site_id: SITE_A_ID,
        template_id: TEMPLATE_A_ID,
        template_version: 1,
        executed_by: TRABAJADOR_A_ID,
        status: 'reviewed',
      },
    },
  ])
}, 180_000)

afterAll(async () => {
  await app?.close()
  await ownerPool?.end()
  await container?.stop()
})

describe('GET /api/v1/dashboard/inspections (FR-044)', () => {
  it('lista el período con faena, plantilla, versión, autor, estado y nº de respuestas', async () => {
    const res = await server().get('/api/v1/dashboard/inspections').set(auth(supervisorToken))
    expect(res.status).toBe(200)
    expect(inspectionsResponseSchema.safeParse(res.body).success).toBe(true)

    const item = (res.body.items as Array<Record<string, unknown>>).find(
      (i) => i.id === inspectionParidad,
    )
    expect(item).toMatchObject({
      faena_id: SITE_A_ID,
      faena_nombre: 'Faena El Roble',
      template_id: templateId,
      template_version: 1,
      ejecutado_por: 'Pedro Trabajador',
      status: 'submitted',
      // 8 respuestas: los 8 tipos, la foto grande no se respondió en esta.
      respuestas: 8,
    })
    expect(item?.captured_at).toBe(CAPTURED_AT)
    // El nombre de la plantilla es el archivo que el admin importó.
    expect(item?.template_nombre).toBe(NOMBRE_ORIGINAL)
  })

  it('no filtra por estado: se muestran todas para que el supervisor decida', async () => {
    const res = await server().get('/api/v1/dashboard/inspections').set(auth(supervisorToken))
    const estados = (res.body.items as Array<Record<string, unknown>>).map((i) => i.status)
    expect(estados).toContain('submitted')
    // La del seed quedó en `reviewed` y también aparece: el registro es
    // inmutable (FR-049) y ocultarla sería perder trazabilidad.
    expect(estados).toContain('reviewed')
  })

  it('filtra por faena y por período', async () => {
    const otraFaena = await server()
      .get(`/api/v1/dashboard/inspections?site_id=${SITE_B_ID}`)
      .set(auth(supervisorToken))
    expect(otraFaena.status).toBe(200)
    expect(otraFaena.body.items).toEqual([])

    const enRango = await server()
      .get('/api/v1/dashboard/inspections')
      .query({ desde: '2026-10-04T00:00:00.000Z', hasta: '2026-10-06T00:00:00.000Z' })
      .set(auth(supervisorToken))
    expect(enRango.status).toBe(200)
    const enRangoIds = (enRango.body.items as Array<{ id: string }>).map((i) => i.id)
    expect(enRangoIds).toContain(inspectionParidad)
    expect(enRangoIds).toContain(inspectionEvidencias)

    const fuera = await server()
      .get('/api/v1/dashboard/inspections')
      .query({ desde: '2026-09-01T00:00:00.000Z', hasta: '2026-09-30T00:00:00.000Z' })
      .set(auth(supervisorToken))
    expect(fuera.status).toBe(200)
    expect(fuera.body.items).toEqual([])
  })

  it('filtros inválidos → 400 con el contrato de filtros del dashboard', async () => {
    const faena = await server()
      .get('/api/v1/dashboard/inspections?site_id=abc')
      .set(auth(supervisorToken))
    expect(faena.status).toBe(400)
    expect(faena.body.message).toMatch(/faena inválida/i)

    const fecha = await server()
      .get('/api/v1/dashboard/inspections?desde=no-es-fecha')
      .set(auth(supervisorToken))
    expect(fecha.status).toBe(400)
    expect(fecha.body.message).toMatch(/desde inválido/i)
  })

  it('roles: field_worker y platform_admin → 403, anónimo → 401', async () => {
    const ruta = '/api/v1/dashboard/inspections'
    expect((await server().get(ruta).set(auth(trabajadorToken))).status).toBe(403)
    expect((await server().get(ruta).set(auth(platformToken))).status).toBe(403)
    expect((await server().get(ruta)).status).toBe(401)
  })

  it('el supervisor del tenant B no ve las inspecciones del A (RLS)', async () => {
    const res = await server().get('/api/v1/dashboard/inspections').set(auth(supervisorBToken))
    expect(res.status).toBe(200)
    const ids = (res.body.items as Array<{ id: string }>).map((i) => i.id)
    expect(ids).not.toContain(inspectionParidad)
  })
})

describe('GET /api/v1/dashboard/inspections/:id/export (FR-019/044)', () => {
  it('el supervisor descarga un .xlsx válido con las respuestas en las celdas del parser', async () => {
    const res = await server()
      .get(`/api/v1/dashboard/inspections/${inspectionParidad}/export`)
      .set(auth(supervisorToken))
      .responseType('blob')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toBe(XLSX_MIME)
    // El nombre viaja en la cabecera para que el navegador guarde el documento
    // con el nombre del original y no como "download".
    expect(res.headers['content-disposition']).toContain('attachment')
    expect(res.headers['content-disposition']).toContain(
      `filename*=UTF-8''${encodeURIComponent(NOMBRE_ORIGINAL)}`,
    )

    const libro = new Uint8Array(res.body as Buffer)
    // Firma ZIP: un `.xlsx` es un OOXML empaquetado, no el HTML de un 4xx.
    expect(Array.from(libro.subarray(0, 2))).toEqual([0x50, 0x4b])

    const destinos = await destinosDelParser()
    const celdas = await leerCuadricula(libro)
    const checklist = celdas.find((h) => h.nombre === 'Checklist')
    expect(checklist).toBeDefined()
    // Valor de la celda destino de un ítem: columna 1-based del parser.
    const enFila = (itemId: string) => {
      const destino = destinos.get(itemId)
      if (!destino) throw new Error(`sin destino para el ítem ${itemId}`)
      return checklist?.filas[destino.firstDataRow - 1][destino.column.charCodeAt(0) - 65]
    }

    expect(enFila(itemDe('ok_nok_na').id)?.texto).toBe('NOK')
    expect(enFila(itemDe('text').id)?.texto).toBe('Falta señalización en el acceso')
    expect(enFila(itemDe('numeric').id)?.numero).toBe(7)
    expect(enFila(itemDe('date').id)?.fecha).toBe('2026-03-05')
    expect(enFila(itemDe('time').id)?.hora).toBe('08:30')
    expect(enFila(itemDe('select_single').id)?.texto).toBe(opcionesDe('select_single')[0])
    expect(enFila(itemDe('select_multiple').id)?.texto).toBe(
      opcionesDe('select_multiple').slice(0, 2).join('; '),
    )
    // La celda de la foto NO lleva los bytes: dice que la evidencia está en la
    // hoja (FR-019/037), que es lo que escribe el dispositivo.
    expect(enFila(foto1().id)?.texto).toBe(INDICADOR_EVIDENCIA)
    // El ítem sin respuesta no se inventa: su celda queda como estaba.
    expect(enFila(foto2().id)).toBeNull()

    expect(celdas.map((h) => h.nombre)).toContain('Evidencias')
    const evidencias = celdas.find((h) => h.nombre === 'Evidencias')
    expect(evidencias?.filas[0]).toEqual([
      { texto: 'Ítem' },
      { texto: 'Evidencia' },
      { texto: 'Adjunto' },
      { texto: 'MIME' },
      { texto: 'Capturado' },
    ])
    expect(evidencias?.filas[1][0]?.texto).toBe(foto1().id)
    expect(evidencias?.filas[1][1]?.texto).toBe(`1. ${foto1().prompt}`)
    expect(evidencias?.filas[1][2]?.texto).toBe('embebida')
    expect(evidencias?.filas[1][3]?.texto).toBe('image/png')
    expect(evidencias?.filas[1][4]?.texto).toBe(CAPTURED_AT)
  })

  /**
   * El criterio de FR-044: **el servidor y el dispositivo producen el mismo
   * archivo**. Se compara hoja por hoja y celda por celda con `leerCuadricula`,
   * el mismo normalizador que usa el parser, en vez de comparar bytes.
   *
   * Por qué no byte a byte: ExcelJS escribe metadatos del contenedor OOXML
   * (`docProps`, sellos de tiempo de las entradas del ZIP) que no forman parte de
   * lo que FR-044 promete —el documento con las respuestas y su hoja de
   * evidencias— y que cambian entre versiones de la librería y entre sistemas.
   * Compararlos volvería esta una prueba del serializador de ExcelJS, que es
   * justo lo que no hay que atar a este contrato.
   */
  it('el artefacto del servidor es el mismo que el que genera el dispositivo', async () => {
    const delServidor = await descargar(supervisorToken, inspectionParidad)

    // El "dispositivo": el mismo original cacheado, la misma definición y el
    // mismo estado de captura, pasados por el módulo compartido sin tocar la
    // base de datos.
    const parseo = await proponerImport(originalBytes, NOMBRE_ORIGINAL)
    if (!parseo.ok) throw new Error(`el original no es parseable: ${parseo.error}`)
    const { respuestas, omitidas } = construirRespuestas(items, camposRespuestos(false))
    const evidencias: EvidenciaRellenable[] = [
      {
        itemId: foto1().id,
        nombre: `1. ${foto1().prompt}`.slice(0, 60),
        mime: 'image/png',
        bytesLength: PNG_1x1.length,
        bytes: new Uint8Array(PNG_1x1),
        // El dispositivo no tiene `file_key`: su hoja embebe la foto y no
        // referencia ningún archivo del servidor.
        fileKey: null,
        capturadoAt: CAPTURED_AT,
      },
    ]
    const relleno = await rellenarOriginal({
      original: originalBytes,
      definition,
      propuesta: parseo.propuesta,
      respuestas,
      evidencias,
    })
    if (!relleno.ok) throw new Error(`el relleno del dispositivo falló: ${relleno.error}`)
    expect(omitidas).toEqual([])

    expect(await leerCuadricula(delServidor)).toEqual(await leerCuadricula(relleno.libro))
    // Y la foto va incrustada en los dos: mismo número de imágenes por hoja.
    expect(await imagenesDe(delServidor)).toEqual(await imagenesDe(relleno.libro))
    expect((await imagenesDe(delServidor))['Evidencias']).toBe(1)
  })

  it('la foto pequeña va embebida y la grande referenciada por su file_key (FR-046)', async () => {
    const libro = await descargar(supervisorToken, inspectionEvidencias)
    const hoja = (await leerCuadricula(libro)).find((h) => h.nombre === 'Evidencias')

    // Dos fotos: la que cabe y la que no.
    expect(hoja?.filas).toHaveLength(3)
    expect(hoja?.filas[1][2]?.texto).toBe('embebida')
    expect(hoja?.filas[2][0]?.texto).toBe(foto2().id)
    expect(hoja?.filas[2][2]?.texto).toBe(`referenciada (${fileKeyGrande})`)
    expect(hoja?.filas[2][3]?.texto).toBe('image/jpeg')

    // Sólo se incrusta la que cabe: una imagen en la hoja, no dos.
    expect((await imagenesDe(libro))['Evidencias']).toBe(1)
    // Y la decisión es la del módulo compartido, no una del servicio: se
    // comprueba contra el mismo umbral para que un cambio en FR-046 (ADR-003
    // Enmienda 2) no se note en un solo lado.
    expect(evidenciaSeIncrusta(PNG_1x1.length)).toBe(true)
    expect(evidenciaSeIncrusta(BYTES_FOTO_GRANDE)).toBe(false)
  })

  it('el tenant_admin también descarga (mismo rol de negocio que el supervisor)', async () => {
    const libro = await descargar(adminToken, inspectionParidad)
    expect(libro.length).toBeGreaterThan(0)
  })

  it('roles: field_worker y platform_admin → 403, anónimo → 401', async () => {
    const ruta = `/api/v1/dashboard/inspections/${inspectionParidad}/export`
    expect((await server().get(ruta).set(auth(trabajadorToken))).status).toBe(403)
    expect((await server().get(ruta).set(auth(platformToken))).status).toBe(403)
    expect((await server().get(ruta)).status).toBe(401)
  })

  it('una inspección de otro tenant responde 404 y no filtra información', async () => {
    const res = await server()
      .get(`/api/v1/dashboard/inspections/${inspectionParidad}/export`)
      .set(auth(supervisorBToken))
    expect(res.status).toBe(404)
    expect(res.body.message).toMatch(/no encontrada para este tenant/i)
  })

  it('un id inexistente o mal formado responde 404 / 400 sin filtrar', async () => {
    const fantasma = await server()
      .get(`/api/v1/dashboard/inspections/${randomUUID()}/export`)
      .set(auth(supervisorToken))
    expect(fantasma.status).toBe(404)

    const malformado = await server()
      .get('/api/v1/dashboard/inspections/no-es-uuid/export')
      .set(auth(supervisorToken))
    expect(malformado.status).toBe(400)
  })

  it('una inspección sin documento original importado responde 404 con el motivo', async () => {
    const res = await server()
      .get(`/api/v1/dashboard/inspections/${inspectionSinOriginal}/export`)
      .set(auth(supervisorToken))
    expect(res.status).toBe(404)
    expect(res.body.message).toMatch(/no hay documento original/i)
  })

  /**
   * FR-049: archivar la revisión no borra el registro. La inspección ejecutada
   * con ella sigue exportándose, porque el documento firmado es parte del
   * histórico. Va al final porque deja la revisión archivada.
   */
  it('una revisión archivada sigue exportándose (el registro es inmutable)', async () => {
    await ownerPool.query(`UPDATE template_revision SET status = 'archived' WHERE id = $1`, [
      revisionId,
    ])
    const libro = await descargar(supervisorToken, inspectionParidad)
    expect(libro.length).toBeGreaterThan(0)
  })
})
