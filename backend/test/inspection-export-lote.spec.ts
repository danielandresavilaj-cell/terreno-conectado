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
import type { Response } from 'supertest'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
// ExcelJS y JSZip entran por el hoisting del monorepo (ExcelJS lo usa `shared`,
// que es quien escribe el libro; JSZip es el empaquetador declarado del lote).
// El test relee lo descargado —celdas e imágenes— porque lo que importa es qué
// quedó escrito de verdad, no lo que el servicio dice.
import ExcelJS from 'exceljs'
import JSZip from 'jszip'
import {
  XLSX_MIME,
  type CampoValor,
  type TemplateDefinition,
  type TemplateItem,
} from '@terreno/shared'
import { leerCuadricula } from '@terreno/shared/xlsx'
import { AppModule } from '../src/app.module'
import { configureApp } from '../src/app.setup'
import {
  loteExportManifiestoSchema,
  type LoteExportManifiesto,
} from '../src/dashboard/dashboard.contract'
import {
  DEMO_PASSWORD,
  SITE_A_ID,
  SITE_B_ID,
  TENANT_A_ID,
  TENANT_B_ID,
  TEMPLATE_A_ID,
  TEMPLATE_B_ID,
  seedDatabase,
} from '../db/seed'

/**
 * TSK-FORM-010 (issue #43) — FR-045/046/047: el supervisor se baja TODAS las
 * inspecciones del período en un ZIP (un `.xlsx` por inspección, cada uno con su
 * hoja "Evidencias"), con tope por lote, nombres trazables y no pisados, salida
 * explícita cuando una inspección falla y una fila de `audit_log` por lote.
 *
 * Todo entra por la API real —import de plantilla por `POST /templates/imports`
 * y captura por `POST /sync/batch`— para que el lote se pruebe sobre el mismo
 * camino que en producción y no sobre un doble del servicio individual.
 */

const MIGRATIONS_DIR = resolve(process.cwd(), 'db', 'migrations')
const RUTA_LOTE = '/api/v1/dashboard/inspections/export-lote'
const ZIP_MIME = 'application/zip'
/** Tope del lote: 51 inspecciones lo superan y tienen que ser rechazadas. */
const TOPE_LOTE = 50

/** PNG 1×1 real: el camino de imagen es el que importa, no el contenido. */
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

const CAPTURED_AT = '2026-10-05T09:00:00.000Z'
/** Fecha reservada al lote que supera el tope, para no mezclar conteos. */
const CAPTURED_LOTE_TOPE = '2027-03-15T12:00:00.000Z'
/** Período vacío por construcción: nadie capturó en 2029. */
const CAPTURED_VACIO = '2029-01-01T00:00:00.000Z'

/** Fecha propia de la inspección que no tiene original: aísla el caso "ninguna
 *  sale" del resto, que comparten `CAPTURED_AT`. */
const CAPTURED_SIN_ORIGINAL = '2026-10-06T09:00:00.000Z'
/** Filtro del lote bueno: las 4 inspecciones del tenant A de ese instante. */
const FILTRO_LOTE_A = {
  site_id: SITE_A_ID,
  desde: CAPTURED_AT,
  hasta: CAPTURED_AT,
}

const NOMBRE_ORIGINAL = 'control-diario-2026.xlsx'
/**
 * Prefijo de 8 caracteres compartido a propósito por dos inspecciones: es lo
 * único que puede hacer que dos nombres de entrada choquen (misma faena, misma
 * fecha, mismo prefijo de id), que es justo lo que hay que desambiguar.
 */
const PREFIJO_COLISION = 'deadbeef'
const ID_COLISION_1 = `${PREFIJO_COLISION}-0001-4000-8000-000000000001`
const ID_COLISION_2 = `${PREFIJO_COLISION}-0002-4000-8000-000000000002`

let container: StartedPostgreSqlContainer
let ownerPool: Pool
let app: INestApplication
let syncVolume: string

let supervisorToken: string
let supervisorBToken: string
let trabajadorToken: string
let adminToken: string
let platformToken: string
let supervisorId: string
let trabajadorId: string

let templateId: string
let items: TemplateItem[]
/** Inspección con respuestas de todos los tipos: la que se compara con su export individual. */
let inspectionBuena: string
/** Las dos de nombres encolisionados (misma faena, mismo día, mismo prefijo). */
let colision1: string
let colision2: string
/** Inspección del tenant A sobre una plantilla sin documento original importado. */
let inspectionSinOriginal: string
let inspectionSinOriginalAislada: string
/** Inspección del tenant B, para comprobar que el lote no cruza tenants. */
let inspectionTenantB: string

const server = () => request(app.getHttpServer())
const auth = (token: string) => ({ Authorization: `Bearer ${token}` })

/** Libro de una hoja: estado, observación y una columna de evidencia. */
function libroOriginal(): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Checklist')
  ws.getCell('A2').value = 'Estado (ok/nok/na)'
  ws.getCell('B2').value = 'Observación (texto)'
  ws.getCell('C2').value = 'Evidencia (foto)'
  // Dos filas de muestra: el parser deriva los `props` de los datos aunque el
  // tipo venga por hint del encabezado.
  for (const fila of [3, 4]) {
    ws.getCell(`A${fila}`).value = 'OK'
    ws.getCell(`B${fila}`).value = 'Sin novedad'
  }
  return wb
}

function itemDe(tipo: TemplateItem['response_type']): TemplateItem {
  const encontrado = items.find((i) => i.response_type === tipo)
  if (!encontrado) throw new Error(`el libro de prueba no produjo un ítem ${tipo}`)
  return encontrado
}

function itemDeTipo(itemId: string): TemplateItem {
  const item = items.find((i) => i.id === itemId)
  if (!item) throw new Error(`ítem desconocido: ${itemId}`)
  return item
}

/** Payload de `inspection_response` con el valor en la columna de su tipo. */
function payloadDeRespuesta(item: TemplateItem, campo: CampoValor): Record<string, unknown> {
  switch (item.response_type) {
    case 'ok_nok_na':
      return { value_ok: campo, value_text: null, value_number: null, value_json: null }
    case 'text':
      return { value_ok: null, value_text: campo as string, value_number: null, value_json: null }
    default:
      // Foto → marcador en `value_text` (FR-037).
      return { value_ok: null, value_text: campo, value_number: null, value_json: null }
  }
}

/**
 * Inspección + respuestas + foto por la ingesta real (FR-021), como las
 * mandaría el dispositivo: si el lote leyera las respuestas por otro camino,
 * esta prueba no lo vería.
 */
async function sembrarInspeccionConRespuestas(): Promise<string> {
  const inspectionId = randomUUID()
  const campos: Record<string, CampoValor> = {
    [itemDe('ok_nok_na').id]: 'nok',
    [itemDe('text').id]: 'Falta señalización en el acceso',
    [itemDe('photo').id]: 'capturada',
  }
  const respuestaFoto = randomUUID()
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
        template_version: 1,
        executed_by: trabajadorId,
        status: 'submitted',
      },
    },
  ]
  for (const [itemId, campo] of Object.entries(campos)) {
    records.push({
      entity_type: 'response',
      id: itemId === itemDe('photo').id ? respuestaFoto : randomUUID(),
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
      owner_id: respuestaFoto,
      mime: 'image/png',
      bytes: PNG_1x1.length,
      width: 1,
      height: 1,
      data: PNG_1x1.toString('base64'),
    },
  })

  const res = await server()
    .post('/api/v1/sync/batch')
    .set(auth(trabajadorToken))
    .send({ batch_id: randomUUID(), device_id: randomUUID(), records })
  expect(res.status).toBe(200)
  expect(res.body.status).toBe('ok')
  return inspectionId
}

/**
 * Inspección sembrada por SQL con un id elegido a mano.
 *
 * Hace falta porque la desambiguación de nombres sólo se puede probar con dos
 * ids que compartan sus primeros 8 caracteres, cosa que `randomUUID()` nunca
 * produce. Lo que consume el export es exactamente esta fila.
 */
async function sembrarInspeccion(
  id: string,
  opciones: {
    tenantId: string
    siteId: string
    templateId: string
    templateVersion: number
    executedBy: string
    capturedAt: string
  },
): Promise<void> {
  await ownerPool.query(
    `INSERT INTO inspection
       (id, tenant_id, site_id, template_id, template_version, executed_by, status, captured_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'submitted', $7)`,
    [
      id,
      opciones.tenantId,
      opciones.siteId,
      opciones.templateId,
      opciones.templateVersion,
      opciones.executedBy,
      opciones.capturedAt,
    ],
  )
}

/** Imágenes incrustadas por hoja, para comparar la paridad también en el peso. */
async function imagenesDe(libro: Uint8Array): Promise<Record<string, number>> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(Buffer.from(libro) as unknown as Parameters<typeof wb.xlsx.load>[0])
  const conteo: Record<string, number> = {}
  for (const hoja of wb.worksheets) conteo[hoja.name] = hoja.getImages().length
  return conteo
}

/** Petición del lote tal como la haría el cliente (JSON: para leer errores). */
function pedirLote(token: string, filtros: Record<string, unknown>): Promise<Response> {
  return server().post(RUTA_LOTE).set(auth(token)).send(filtros)
}

/** El lote que sí se descarga: la respuesta viene en binario. */
function descargarLote(token: string, filtros: Record<string, unknown>): Promise<Response> {
  return server().post(RUTA_LOTE).set(auth(token)).send(filtros).responseType('blob')
}

/** El ZIP descargado, abierto y con el manifiesto ya validado por el contrato. */
async function abrirLote(res: Response): Promise<{
  zip: JSZip
  entradas: string[]
  manifiesto: LoteExportManifiesto
}> {
  const zip = await JSZip.loadAsync(res.body as Buffer)
  const manifiesto = loteExportManifiestoSchema.parse(
    JSON.parse(await zip.file('manifesto.json')!.async('string')),
  )
  return { zip, entradas: Object.keys(zip.files), manifiesto }
}

/** Bytes de una entrada del ZIP ya descargado. */
async function entradaDe(zip: JSZip, nombre: string): Promise<Uint8Array> {
  const archivo = zip.file(nombre)
  if (!archivo) throw new Error(`la entrada ${nombre} no está en el ZIP`)
  return new Uint8Array(await archivo.async('uint8array'))
}

async function filasDeAudit(loteId?: string): Promise<Array<Record<string, unknown>>> {
  const { rows } = await ownerPool.query(
    `SELECT actor_id, tenant_id, action, entity_type, entity_id, payload
       FROM audit_log
      WHERE action = 'inspection_export_lote'
        AND ($1::text IS NULL OR payload->>'lote_id' = $1)
      ORDER BY occurred_at`,
    [loteId ?? null],
  )
  return rows as Array<Record<string, unknown>>
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

  syncVolume = await mkdtemp(join(tmpdir(), 'terreno-lote-'))

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
  supervisorToken = await login('supervisor@minera.cl')
  supervisorBToken = await login('supervisor@andes.cl')
  trabajadorToken = await login('trabajador@minera.cl')
  adminToken = await login('admin@minera.cl')
  platformToken = await login('admin@terreno.local')

  const usuario = async (email: string): Promise<string> => {
    const { rows } = await ownerPool.query(`SELECT id FROM app_user WHERE email = $1`, [email])
    return rows[0].id as string
  }
  supervisorId = await usuario('supervisor@minera.cl')
  trabajadorId = await usuario('trabajador@minera.cl')

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
  templateId = confirm.body.template_id as string
  const definition = confirm.body.definition as TemplateDefinition
  items = definition.sections.flatMap((s) => s.items)
  expect(items.length).toBe(3)

  /* ── Las inspecciones del tenant A ─────────────────────────────────────── */

  inspectionBuena = await sembrarInspeccionConRespuestas()

  colision1 = ID_COLISION_1
  colision2 = ID_COLISION_2
  for (const id of [colision1, colision2]) {
    await sembrarInspeccion(id, {
      tenantId: TENANT_A_ID,
      siteId: SITE_A_ID,
      templateId,
      templateVersion: 1,
      executedBy: trabajadorId,
      capturedAt: CAPTURED_AT,
    })
  }

  // 51 inspecciones en una fecha que no usa ningún otro test: es el caso del
  // tope, y tiene que estar sembrado antes de que se pida ese lote.
  await ownerPool.query(
    `INSERT INTO inspection
       (id, tenant_id, site_id, template_id, template_version, executed_by, status, captured_at)
     SELECT gen_random_uuid(), $1, $2, $3, 1, $4, 'submitted', $5
       FROM generate_series(1, $6)`,
    [TENANT_A_ID, SITE_A_ID, templateId, trabajadorId, CAPTURED_LOTE_TOPE, TOPE_LOTE + 1],
  )

  // Inspección del tenant A sobre la plantilla del seed: tiene revisión
  // publicada pero ningún documento original importado, que es el fallo que
  // hace UNA inspección sin tirar el lote.
  inspectionSinOriginal = randomUUID()
  await sembrarInspeccion(inspectionSinOriginal, {
    tenantId: TENANT_A_ID,
    siteId: SITE_A_ID,
    templateId: TEMPLATE_A_ID,
    templateVersion: 1,
    executedBy: trabajadorId,
    capturedAt: CAPTURED_AT,
  })

  // Otra inspección sin documento original, esta vez en una fecha propia: sirve
  // para el filtro donde TODAS fallan.
  inspectionSinOriginalAislada = randomUUID()
  await sembrarInspeccion(inspectionSinOriginalAislada, {
    tenantId: TENANT_A_ID,
    siteId: SITE_A_ID,
    templateId: TEMPLATE_A_ID,
    templateVersion: 1,
    executedBy: trabajadorId,
    capturedAt: CAPTURED_SIN_ORIGINAL,
  })

  // Inspección del tenant B: sirve para ver qué devuelve un lote de otro tenant
  // con el mismo filtro.
  inspectionTenantB = randomUUID()
  await sembrarInspeccion(inspectionTenantB, {
    tenantId: TENANT_B_ID,
    siteId: SITE_B_ID,
    templateId: TEMPLATE_B_ID,
    templateVersion: 1,
    executedBy: trabajadorId,
    capturedAt: CAPTURED_AT,
  })
}, 180_000)

afterAll(async () => {
  await app?.close()
  await ownerPool?.end()
  await container?.stop()
})

describe('POST /api/v1/dashboard/inspections/export-lote (FR-045/046)', () => {
  it('devuelve un ZIP con un .xlsx por inspección del período y su manifiesto', async () => {
    const res = await descargarLote(supervisorToken, FILTRO_LOTE_A)
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toBe(ZIP_MIME)
    expect(res.headers['content-disposition']).toContain('attachment')
    // El nombre del ZIP dice el período: en la carpeta de descargas, un
    // `lote.zip` no dice qué es.
    expect(res.headers['content-disposition']).toContain(
      'inspecciones-2026-10-05_2026-10-05.zip',
    )

    const { zip, entradas, manifiesto } = await abrirLote(res)
    const exportadas = entradas.filter((n) => n.endsWith('.xlsx'))
    // 4 inspecciones en el período: 3 exportadas + la que no tiene original.
    expect(manifiesto.pedidas).toBe(4)
    expect(manifiesto.exportadas).toBe(3)
    expect(manifiesto.fallidas).toBe(1)
    expect(exportadas).toHaveLength(3)
    expect(entradas).toHaveLength(4)
    expect(res.headers['x-lote-exportadas']).toBe('3')
    expect(res.headers['x-lote-fallidas']).toBe('1')
    expect(manifiesto.lote_id).toBe(res.headers['x-lote-id'])

    // Cada entrada es un `.xlsx` real con su hoja "Evidencias" (FR-046).
    for (const nombre of exportadas) {
      const libro = await entradaDe(zip, nombre)
      // Firma ZIP: un `.xlsx` es un OOXML empaquetado, no el HTML de un 4xx.
      expect(Array.from(libro.subarray(0, 2))).toEqual([0x50, 0x4b])
      const hojas = (await leerCuadricula(libro)).map((h) => h.nombre)
      expect(hojas).toContain('Evidencias')
      expect(hojas).toContain('Checklist')
    }
  })

  it('los nombres de las entradas son trazables y no se pisan entre sí', async () => {
    const res = await descargarLote(supervisorToken, FILTRO_LOTE_A)
    const { entradas, manifiesto } = await abrirLote(res)

    const base = `Faena-El-Roble_${CAPTURED_AT.slice(0, 10)}_${PREFIJO_COLISION}`
    // Las dos inspecciones que comparten faena, fecha y prefijo de id.
    expect(entradas).toContain(`${base}.xlsx`)
    expect(entradas).toContain(`${base}-2.xlsx`)

    const nombres = entradas.filter((n) => n.endsWith('.xlsx'))
    expect(new Set(nombres).size).toBe(nombres.length)

    const exportadas = manifiesto.entradas.filter((e) => e.estado === 'exportada')
    expect(exportadas).toHaveLength(3)
    // Cada nombre existe dentro del ZIP y lleva el id corto de su inspección:
    // del archivo al registro y del registro al archivo.
    for (const e of exportadas) {
      expect(entradas).toContain(e.archivo)
      expect(e.archivo).toContain(e.inspeccion_id.slice(0, 8))
      expect(e.archivo).toContain('Faena-El-Roble')
    }
    const buena = exportadas.find((e) => e.inspeccion_id === inspectionBuena)
    expect(buena?.archivo).toContain(inspectionBuena.slice(0, 8))
  })

  it('tope: 51 inspecciones → 413 diciendo el límite y lo pedido', async () => {
    const res = await pedirLote(supervisorToken, {
      desde: CAPTURED_LOTE_TOPE,
      hasta: CAPTURED_LOTE_TOPE,
    })
    expect(res.status).toBe(413)
    expect(res.body.message).toMatch(new RegExp(String(TOPE_LOTE)))
    expect(res.body.message).toMatch(/51/)
    expect(res.body.message).toMatch(/acota el período/i)
    // Rechazo antes de construir nada: la respuesta no es un ZIP.
    expect(res.headers['content-type']).not.toBe(ZIP_MIME)
  })

  it('una inspección que falla no tira el lote: sale el ZIP y se ve el motivo', async () => {
    const res = await descargarLote(supervisorToken, FILTRO_LOTE_A)
    expect(res.status).toBe(200)
    const { entradas, manifiesto } = await abrirLote(res)

    // El ZIP sale igual, con las otras inspecciones dentro.
    expect(entradas.filter((n) => n.endsWith('.xlsx')).length).toBe(3)

    const fallida = manifiesto.entradas.find((e) => e.inspeccion_id === inspectionSinOriginal)
    expect(fallida).toBeDefined()
    expect(fallida?.estado).toBe('fallida')
    expect(fallida?.archivo).toBeNull()
    // El motivo viaja en el manifiesto, que es lo que acompaña al archivo.
    expect(fallida?.motivo).toMatch(/no hay documento original/i)

    // Y en las cabeceras, que es lo que la UI puede mostrar sin abrir el ZIP.
    expect(res.headers['x-lote-fallidas']).toBe('1')
  })

  it('si NINGUNA inspección sale → 422 con los motivos, no un ZIP vacío', async () => {
    // Todas las inspecciones del filtro son la que no tiene documento original,
    // así que ninguna puede exportarse. Devolver el ZIP obligaría al supervisor
    // a descargar un archivo vacío para leer dentro que no salió nada.
    const res = await pedirLote(supervisorToken, {
      desde: CAPTURED_SIN_ORIGINAL,
      hasta: CAPTURED_SIN_ORIGINAL,
    })
    expect(res.status).toBe(422)
    expect(res.headers['content-type']).not.toBe(ZIP_MIME)
    expect(res.body.message).toMatch(/no se pudo exportar ninguna/i)
    expect(res.body.message).toMatch(/no hay documento original/i)

    // Aun así queda auditado: alguien pidió una exportación y no se generó.
    // Se filtra por el período del lote porque el fichero comparte `audit_log`
    // con los lotes de los casos anteriores.
    const delPeriodo = (await filasDeAudit()).filter((f) =>
      String(f.entity_id).includes(CAPTURED_SIN_ORIGINAL),
    )
    expect(delPeriodo).toHaveLength(1)
    expect(delPeriodo[0].actor_id).toBeTruthy()
    expect(JSON.stringify(delPeriodo[0].payload)).toMatch(/no hay documento original/i)
  })

  it('filtro sin inspecciones → error explícito, no un ZIP vacío', async () => {
    const res = await pedirLote(supervisorToken, {
      desde: CAPTURED_VACIO,
      hasta: CAPTURED_VACIO,
    })
    expect(res.status).toBe(404)
    expect(res.body.message).toMatch(/no trae ninguna inspección/i)
    expect(res.headers['content-type']).not.toBe(ZIP_MIME)
  })

  it('filtros inválidos → 400 con el contrato de filtros del dashboard', async () => {
    const faena = await pedirLote(supervisorToken, { site_id: 'abc' })
    expect(faena.status).toBe(400)
    expect(faena.body.message).toMatch(/faena inválida/i)

    const fecha = await pedirLote(supervisorToken, { desde: 'no-es-fecha' })
    expect(fecha.status).toBe(400)
    expect(fecha.body.message).toMatch(/desde inválido/i)
  })

  it('roles: field_worker y platform_admin → 403, anónimo → 401', async () => {
    expect((await pedirLote(trabajadorToken, FILTRO_LOTE_A)).status).toBe(403)
    expect((await pedirLote(platformToken, FILTRO_LOTE_A)).status).toBe(403)
    expect((await server().post(RUTA_LOTE).send(FILTRO_LOTE_A)).status).toBe(401)
  })

  it('aislamiento por tenant (RLS): el B no ve ni exporta las inspecciones del A', async () => {
    // El mismo filtro que trae las inspecciones del A: para el B no hay nada.
    const delA = await pedirLote(supervisorBToken, FILTRO_LOTE_A)
    expect(delA.status).toBe(404)
    expect(delA.body.message).toMatch(/no trae ninguna inspección/i)

    // Su propio lote sólo intenta las suyas. El tenant B del seed no tiene
    // ningún documento original importado, así que su lote termina en 422 —que
    // además es el caso que no puede "colarse" nada del A, porque no hay ZIP.
    // Lo que se comprueba es que ni los motivos ni la auditoría nombren ids
    // del tenant A.
    const propio = await pedirLote(supervisorBToken, {})
    expect(propio.status).toBe(422)
    expect(JSON.stringify(propio.body)).not.toContain(inspectionBuena)
    expect(JSON.stringify(propio.body)).not.toContain(colision1)

    // `entity_id` es el PERÍODO del lote (para encontrar la fila); las ids de
    // inspección que intentó van en el payload.
    const filaB = (await filasDeAudit()).find((f) =>
      JSON.stringify(f.payload ?? {}).includes(inspectionTenantB),
    )
    expect(filaB).toBeDefined()
    expect(JSON.stringify(filaB)).toContain(inspectionTenantB)
    expect(JSON.stringify(filaB)).not.toContain(inspectionBuena)
  })

  it('paridad: la entrada del ZIP es el mismo artefacto que su export individual', async () => {
    const res = await descargarLote(supervisorToken, FILTRO_LOTE_A)
    const { zip, manifiesto } = await abrirLote(res)

    const entrada = manifiesto.entradas.find((e) => e.inspeccion_id === inspectionBuena)
    if (!entrada?.archivo) throw new Error('la inspección buena no quedó en el manifiesto')
    const delLote = await entradaDe(zip, entrada.archivo)

    const individual = await server()
      .get(`/api/v1/dashboard/inspections/${inspectionBuena}/export`)
      .set(auth(supervisorToken))
      .responseType('blob')
    expect(individual.status).toBe(200)
    const delIndividual = new Uint8Array(individual.body as Buffer)

    // Mismo criterio que la paridad servidor/dispositivo (FR-044): hoja por hoja
    // y celda por celda con el normalizador del parser, no byte a byte — los
    // metadatos del contenedor OOXML no son parte de lo que se promete.
    expect(await leerCuadricula(delLote)).toEqual(await leerCuadricula(delIndividual))
    expect(await imagenesDe(delLote)).toEqual(await imagenesDe(delIndividual))
    // La foto pequeña va embebida en los dos (FR-046).
    expect((await imagenesDe(delLote))['Evidencias']).toBe(1)
  })
})

describe('POST /api/v1/dashboard/inspections/export-lote — auditoría (FR-047)', () => {
  it('una fila por lote, con actor, tenant y el detalle del payload', async () => {
    const res = await descargarLote(supervisorToken, FILTRO_LOTE_A)
    expect(res.status).toBe(200)
    const loteId = res.headers['x-lote-id'] as string

    const filas = await filasDeAudit(loteId)
    // Una sola fila por lote, aunque haya una inspección fallida dentro.
    expect(filas).toHaveLength(1)
    const fila = filas[0]
    expect(fila.actor_id).toBe(supervisorId)
    expect(fila.tenant_id).toBe(TENANT_A_ID)
    expect(fila.action).toBe('inspection_export_lote')
    expect(fila.entity_type).toBe('inspection_export_batch')
    // El período exportado es lo que hace falta para encontrar la fila leyendo
    // el log, sin saber de antemano el id del lote.
    expect(fila.entity_id).toContain(SITE_A_ID)
    expect(fila.entity_id).toContain(CAPTURED_AT)

    const payload = fila.payload as Record<string, unknown>
    expect(payload.lote_id).toBe(loteId)
    expect(payload.pedidas).toBe(4)
    expect(payload.exportadas).toBe(3)
    expect(payload.fallidas).toBe(1)
    const exportadas = payload.inspecciones_exportadas as string[]
    expect(exportadas).toContain(inspectionBuena)
    expect(exportadas).toContain(colision1)
    expect(exportadas).toContain(colision2)
    // Y el motivo de la que falló, no sólo el número.
    const fallos = payload.fallos as Array<{ inspeccionId: string; motivo: string }>
    expect(fallos).toHaveLength(1)
    expect(fallos[0].inspeccionId).toBe(inspectionSinOriginal)
    expect(fallos[0].motivo).toMatch(/no hay documento original/i)
  })

  it('la fila del tenant B no mezcla con la del A', async () => {
    // Sin documento original importado, el lote del B no llega a exportar, pero
    // sí queda auditado: lo que importa es que la fila sea del tenant B y no
    // mencione al A.
    const propio = await pedirLote(supervisorBToken, {
      site_id: SITE_B_ID,
      desde: CAPTURED_AT,
      hasta: CAPTURED_AT,
    })
    expect(propio.status).toBe(422)
    // Se acota por la faena del filtro: el fichero pide lote del B en dos casos
    // y ambos dejan fila.
    const filas = (await filasDeAudit()).filter(
      (f) => f.tenant_id === TENANT_B_ID && String(f.entity_id ?? '').includes(SITE_B_ID),
    )
    expect(filas).toHaveLength(1)
    expect(filas[0].tenant_id).toBe(TENANT_B_ID)
    expect(filas[0].entity_id).toContain(SITE_B_ID)
    expect(JSON.stringify(filas[0])).not.toContain(inspectionBuena)
  })

  it('un lote que no llegó a exportar (tope o filtro vacío) no deja fila', async () => {
    const antes = (await filasDeAudit()).length
    await pedirLote(supervisorToken, { desde: CAPTURED_LOTE_TOPE, hasta: CAPTURED_LOTE_TOPE })
    await pedirLote(supervisorToken, { desde: CAPTURED_VACIO, hasta: CAPTURED_VACIO })
    expect((await filasDeAudit()).length).toBe(antes)
  })
})
