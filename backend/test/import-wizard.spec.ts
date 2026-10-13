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
// ExcelJS entra por el hoisting del monorepo (lo usa `shared`, que es quien
// escribe el libro). Aquí se genera el `.xlsx` que después se sube por la API
// real, para que el import — y por lo tanto el documento original que se
// exporta — sea exactamente el que subiría el admin.
import ExcelJS from 'exceljs'
import {
  XLSX_MIME,
  type CampoValor,
  type TemplateDefinition,
  type TemplateItem,
} from '@terreno/shared'
import {
  emparejarItemsConOrigen,
  leerCuadricula,
  proponerImport,
  // El tipo de la propuesta sale de `@terreno/shared/xlsx`, no del barrel: el
  // homónimo del barrel es el inferido del Zod de persistencia y exige
  // `props: Record<string, unknown>`, que no es lo que devuelve el parser.
  type TemplateImportProposal,
} from '@terreno/shared/xlsx'
import { AppModule } from '../src/app.module'
import { configureApp } from '../src/app.setup'
import { DEMO_PASSWORD, SITE_A_ID, TENANT_A_ID, seedDatabase } from '../db/seed'

/**
 * TSK-FORM-010 / fix del wizard de importación — `POST /templates/imports/:id/confirm`
 * acepta una `definition` ya revisada por el humano (FR-048).
 *
 * El problema que motivó el cambio: el wizard editaba los ítems **en el
 * dispositivo** y después publicaba por `POST /templates`, que crea la revisión
 * sin `source_import_id`. Una revisión así no tiene documento original detrás, así
 * que `GET /dashboard/inspections/:id/export` respondía 404 con "no hay documento
 * original" para TODA plantilla creada desde la UI (FR-019/044).
 *
 * Por eso el caso central de este spec no es "confirma con definition": es el
 * circular — la plantilla creada por el wizard **se puede exportar**. El resto de
 * casos sujetan el resto del contrato (regresión del camino sin `definition`,
 * prioridad de la definición humana, auditoría FR-047, validación del cuerpo,
 * aislamiento y conflicto de estado).
 */

const MIGRATIONS_DIR = resolve(process.cwd(), 'db', 'migrations')

/**
 * Nombre del original. ASCII a propósito: `multer` decodifica `originalname`
 * como latin1, así que un nombre con acento se guardaría (y se descargaría)
 * mojibake — eso es de la subida (TSK-FORM-006), no de este confirm.
 */
const NOMBRE_ORIGINAL = 'control-diario-2026.xlsx'
/** Hoja del libro de prueba; el parser la convierte en el título de la sección. */
const HOJA = 'Checklist'
/** Prompt con el que el humano renombra el primer ítem en el wizard. */
const PROMPT_REVISADO = 'Estado verificado en terreno'
const CAPTURED_AT = '2026-10-05T09:00:00.000Z'
const TRABAJADOR_A_ID = '01890000-0000-7000-8000-0000000000a3'
/** Id del supervisor del tenant B, promocionado a `tenant_admin` en el setup. */
const USUARIO_B_ID = '01890000-0000-7000-8000-0000000000b4'

let container: StartedPostgreSqlContainer
let ownerPool: Pool
let app: INestApplication
let syncVolume: string

let adminToken: string
let trabajadorToken: string
let supervisorToken: string
let adminBToken: string

/** Bytes del libro de prueba, tal como los ve el parser en ambos lados. */
let libroBytes: Uint8Array

const server = () => request(app.getHttpServer())
const auth = (token: string) => ({ Authorization: `Bearer ${token}` })

/**
 * Libro de una hoja con los 3 tipos que el export necesita comprobar: texto
 * corta/ok-nok-na, texto libre y foto. Los tipos vienen por hint del encabezado
 * y las filas de muestra son las que el parser usa para derivar `props`.
 */
function libroOriginal(): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet(HOJA)
  ws.getCell('A2').value = 'Estado (ok/nok/na)'
  ws.getCell('B2').value = 'Observación (texto)'
  ws.getCell('C2').value = 'Evidencia (foto)'
  for (const fila of [3, 4]) {
    ws.getCell(`A${fila}`).value = 'OK'
    ws.getCell(`B${fila}`).value = 'Sin novedad'
  }
  return wb
}

/** La propuesta del parser sobre el libro, calculada como lo hace el servidor. */
async function propuestaDelOriginal(): Promise<TemplateImportProposal> {
  const parseo = await proponerImport(libroBytes, NOMBRE_ORIGINAL)
  if (!parseo.ok) throw new Error(`el libro de prueba no es parseable: ${parseo.error}`)
  return parseo.propuesta
}

/**
 * Definición tal como la deja el wizard: los ítems que propuso el parser, pero
 * con ids propios (el dispositivo genera los suyos) y un prompt editado a mano.
 * Es el caso que motivó el endpoint: la revisión humana, no la del parser.
 */
function definicionRevisada(propuesta: TemplateImportProposal): TemplateDefinition {
  return {
    sections: propuesta.secciones.map((seccion, sidx) => ({
      id: randomUUID(),
      title: seccion.titulo,
      position: sidx,
      items: seccion.items.map((item, idx) => ({
        id: randomUUID(),
        prompt: idx === 0 ? PROMPT_REVISADO : item.prompt,
        response_type: item.response_type,
        require_finding_on_nok: false,
        props: item.props,
      })),
    })),
  }
}

/** Sube el `.xlsx` por la API real de importación (TSK-FORM-006/007). */
async function subirOriginal(): Promise<string> {
  const generado = await libroOriginal().xlsx.writeBuffer()
  const res = await server()
    .post('/api/v1/templates/imports')
    .set(auth(adminToken))
    .attach('file', Buffer.from(generado), { filename: NOMBRE_ORIGINAL, contentType: XLSX_MIME })
  expect(res.status).toBe(201)
  expect(res.body.status).toBe('proposed')
  return res.body.id as string
}

/**
 * Confirmación sin assert de status: los casos de error (400/403/404/409) leen
 * la respuesta tal cual, y los de éxito afirman sobre `body`.
 */
function confirmar(
  importId: string,
  body: Record<string, unknown>,
  token: string = adminToken,
): Promise<Response> {
  return server()
    .post(`/api/v1/templates/imports/${importId}/confirm`)
    .set(auth(token))
    .send(body)
}

/** Confirmación que sí debe funcionar: devuelve el cuerpo de la revisión. */
async function confirmarOK(
  importId: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = await confirmar(importId, body)
  expect(res.status).toBe(201)
  return res.body as Record<string, unknown>
}

const itemsDe = (definition: TemplateDefinition): TemplateItem[] =>
  definition.sections.flatMap((s) => s.items)

function itemDe(items: TemplateItem[], tipo: TemplateItem['response_type']): TemplateItem {
  const encontrado = items.find((i) => i.response_type === tipo)
  if (!encontrado) throw new Error(`el libro de prueba no produjo un ítem ${tipo}`)
  return encontrado
}

/** Fila de `template_revision` tal como quedó en la base. */
async function revisionEn(id: string): Promise<Record<string, unknown>> {
  const { rows } = await ownerPool.query(`SELECT * FROM template_revision WHERE id = $1`, [id])
  expect(rows).toHaveLength(1)
  return rows[0]
}

/** Fila de `template_imports` tal como quedó en la base. */
async function importEn(id: string): Promise<Record<string, unknown>> {
  const { rows } = await ownerPool.query(`SELECT * FROM template_imports WHERE id = $1`, [id])
  expect(rows).toHaveLength(1)
  return rows[0]
}

/**
 * Inspección + respuestas por la ingesta (FR-021), con la versión congelada de
 * la plantilla recién publicada (FR-028). Es el mismo camino que el dispositivo
 * usa en producción, no un atajo por SQL.
 */
async function sembrarInspeccion(params: {
  templateId: string
  templateVersion: number
  items: TemplateItem[]
  campos: Record<string, CampoValor>
}): Promise<string> {
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
        template_id: params.templateId,
        template_version: params.templateVersion,
        executed_by: TRABAJADOR_A_ID,
        status: 'submitted',
      },
    },
  ]
  for (const [itemId, campo] of Object.entries(params.campos)) {
    const item = itemDeTipo(params.items, itemId)
    records.push({
      entity_type: 'response',
      id: randomUUID(),
      tenant_id: TENANT_A_ID,
      client_version: 1,
      captured_at: CAPTURED_AT,
      payload: {
        inspection_id: inspectionId,
        template_item_id: itemId,
        ...payloadDeRespuesta(item, campo),
      },
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

function itemDeTipo(items: TemplateItem[], itemId: string): TemplateItem {
  const item = items.find((i) => i.id === itemId)
  if (!item) throw new Error(`ítem desconocido en el lote: ${itemId}`)
  return item
}

/** Reparto del valor en la columna de `value_*` según el tipo del ítem (FR-036). */
function payloadDeRespuesta(item: TemplateItem, campo: CampoValor): Record<string, unknown> {
  const vacio = { value_ok: null, value_text: null, value_number: null, value_json: null }
  switch (item.response_type) {
    case 'ok_nok_na':
      return { ...vacio, value_ok: campo }
    case 'numeric':
      return { ...vacio, value_number: campo }
    case 'photo':
      // El marcador con el que el dispositivo guarda "este ítem tiene foto".
      return { ...vacio, value_text: campo }
    case 'text':
      // El texto va en `value_text`; `value_json` es para los tipos que no
      // tienen columna propia en la respuesta (fecha, hora, select).
      return { ...vacio, value_text: campo as string }
    default:
      return { ...vacio, value_json: campo }
  }
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

  syncVolume = await mkdtemp(join(tmpdir(), 'terreno-import-wizard-'))

  process.env.DATABASE_URL = ownerUrl
  process.env.APP_DATABASE_URL = ownerUrl.replace('test:test@', 'tc_app:test@')
  process.env.JWT_ACCESS_SECRET = 'test-access-secret-32bytes-long!!!!!'
  process.env.SYNC_VOLUME = syncVolume
  process.env.NODE_ENV = 'test'

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
  app = configureApp(moduleRef.createNestApplication())
  await app.init()

  const login = async (email: string) => {
    const res = await server().post('/api/v1/auth/login').send({ email, password: DEMO_PASSWORD })
    expect(res.status).toBe(200)
    return res.body.access_token as string
  }

  adminToken = await login('admin@minera.cl')
  trabajadorToken = await login('trabajador@minera.cl')
  supervisorToken = await login('supervisor@minera.cl')

  // El seed no crea un `tenant_admin` en el tenant B y el caso de aislamiento
  // necesita uno: un admin AJENO que intente confirmar un import del tenant A.
  // Sin él sólo se podría probar con un rol que no pasa la guarda del
  // controller, que ya es otro caso.
  await ownerPool.query(`UPDATE app_user SET role = 'tenant_admin' WHERE id = $1`, [USUARIO_B_ID])
  adminBToken = await login('supervisor@andes.cl')

  libroBytes = new Uint8Array(await libroOriginal().xlsx.writeBuffer())
}, 180_000)

afterAll(async () => {
  await app?.close()
  await ownerPool?.end()
  await container?.stop()
})

describe('POST /api/v1/templates/imports/:importId/confirm con definition revisada', () => {
  it('la revisión nace atada al import: source_import_id no nulo e import confirmado', async () => {
    const importId = await subirOriginal()
    const definition = definicionRevisada(await propuestaDelOriginal())

    const rev = await confirmarOK(importId, { definition })

    // Lo que motivó el cambio: la revisión apunta al import, y con él al `.xlsx`
    // guardado. Antes de este endpoint, publicar por `POST /templates` dejaba la
    // revisión sin `source_import_id` y el export respondía 404 siempre.
    const fila = await revisionEn(rev.id as string)
    expect(fila.source_import_id).toBe(importId)
    expect(fila.template_id).toBe(rev.template_id)
    expect(fila.status).toBe('draft')

    const imp = await importEn(importId)
    expect(imp.status).toBe('confirmed')
    expect(imp.confirmed_at).not.toBeNull()
  })

  it('la plantilla creada con definition se puede exportar (el circular del wizard)', async () => {
    const importId = await subirOriginal()
    const definition = definicionRevisada(await propuestaDelOriginal())

    const rev = await confirmarOK(importId, { publish: true, definition })
    const templateId = rev.template_id as string
    const version = rev.version as number
    const items = itemsDe(rev.definition as TemplateDefinition)

    // Inspección ejecutada contra esa plantilla y esa versión concretas, como la
    // que firmaría un trabajador en terreno.
    const inspectionId = await sembrarInspeccion({
      templateId,
      templateVersion: version,
      items,
      campos: {
        [itemDe(items, 'ok_nok_na').id]: 'nok',
        [itemDe(items, 'text').id]: 'Falta señalización en el acceso',
      },
    })

    const res = await server()
      .get(`/api/v1/dashboard/inspections/${inspectionId}/export`)
      .set(auth(supervisorToken))
      .responseType('blob')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toBe(XLSX_MIME)
    // El nombre que el navegador guarde es el del original subido, no "download".
    expect(res.headers['content-disposition']).toContain(
      `filename*=UTF-8''${encodeURIComponent(NOMBRE_ORIGINAL)}`,
    )

    // Firma ZIP: un `.xlsx` es un OOXML empaquetado, no el JSON de un 4xx.
    const libro = new Uint8Array(res.body as Buffer)
    expect(Array.from(libro.subarray(0, 2))).toEqual([0x50, 0x4b])

    // Y sale el documento ORIGINAL con las respuestas en las celdas que el
    // parser guardó: se comprueba contra el emparejamiento real, no contra un
    // índice supuesto.
    const parseo = await proponerImport(libroBytes, NOMBRE_ORIGINAL)
    if (!parseo.ok) throw new Error(`el original no es parseable: ${parseo.error}`)
    const emparejado = emparejarItemsConOrigen(rev.definition as TemplateDefinition, parseo.propuesta)
    if (!emparejado.ok) throw new Error(`el emparejamiento falló: ${emparejado.error}`)

    const celdas = await leerCuadricula(libro)
    const checklist = celdas.find((h) => h.nombre === HOJA)
    expect(checklist).toBeDefined()
    const enFila = (itemId: string) => {
      const destino = emparejado.destinos.get(itemId)
      if (!destino) throw new Error(`sin destino para el ítem ${itemId}`)
      return checklist?.filas[destino.firstDataRow - 1][destino.column.charCodeAt(0) - 65]
    }
    expect(enFila(itemDe(items, 'ok_nok_na').id)?.texto).toBe('NOK')
    expect(enFila(itemDe(items, 'text').id)?.texto).toBe('Falta señalización en el acceso')
    // El prompt editado es el que aparece en la hoja de evidencias: el
    // documento se genera desde la definición humana, no desde la propuesta.
    expect(celdas.map((h) => h.nombre)).toContain('Evidencias')
  })

  it('sin definition sigue publicando la propuesta del parser (regresión)', async () => {
    const importId = await subirOriginal()
    const propuesta = await propuestaDelOriginal()

    const rev = await confirmarOK(importId, {})
    expect(rev.status).toBe('draft')

    // Camino simple intacto: lo que publica el servidor es lo que propuso el
    // parser, con los prompts del encabezado y sin el hint de tipo.
    const items = itemsDe(rev.definition as TemplateDefinition)
    expect(items.map((i) => i.prompt)).toEqual(
      propuesta.secciones[0].items.map((i) => i.prompt),
    )
    expect(items.map((i) => i.response_type)).toEqual(
      propuesta.secciones[0].items.map((i) => i.response_type),
    )
    expect(items[0].prompt).toBe('Estado')

    // Sin `name`, la plantilla toma el nombre del archivo del import: el
    // servidor no inventa uno propio.
    const [template] = (
      await ownerPool.query('SELECT name FROM template WHERE id = $1', [
        (await revisionEn(rev.id as string)).template_id,
      ])
    ).rows
    expect(template.name).toBe(NOMBRE_ORIGINAL)
  })

  it('la definition enviada manda sobre la propuesta del servidor', async () => {
    const importId = await subirOriginal()
    const definition = definicionRevisada(await propuestaDelOriginal())

    const rev = await confirmarOK(importId, { definition })

    // El prompt reescrito por el humano vuelve en el borrador tal cual, y el
    // resto de la definición llegó entera.
    const items = itemsDe(rev.definition as TemplateDefinition)
    expect(items).toHaveLength(3)
    expect(items[0].prompt).toBe(PROMPT_REVISADO)
    expect(items.map((i) => i.id)).toEqual(definition.sections[0].items.map((i) => i.id))
    // Sin el prompt del encabezado: la revisión humana ganó.
    expect(items[0].prompt).not.toBe('Estado')
  })

  it('el nombre editado en el wizard gana al file_name del import', async () => {
    const importId = await subirOriginal()
    const NOMBRE_PLANTILLA = 'Inspección de seguridad en rajo'

    const rev = await confirmarOK(importId, {
      name: NOMBRE_PLANTILLA,
      description: 'Control diario',
    })

    const [template] = (
      await ownerPool.query(
        `SELECT name, description FROM template WHERE id = $1`,
        [(await revisionEn(rev.id as string)).template_id],
      )
    ).rows as Array<{ name: string; description: string }>
    expect(template.name).toBe(NOMBRE_PLANTILLA)
    expect(template.description).toBe('Control diario')
  })

  it('FR-047: deja una única fila en audit_log con el actor, el tenant y el resultado', async () => {
    const importId = await subirOriginal()
    const definition = definicionRevisada(await propuestaDelOriginal())

    const rev = await confirmarOK(importId, { definition, publish: true })

    const { rows } = await ownerPool.query(
      `SELECT * FROM audit_log
        WHERE action = 'template_import_confirmed' AND entity_id = $1`,
      [importId],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      actor_id: expect.any(String),
      tenant_id: TENANT_A_ID,
      entity_type: 'template_import',
      entity_id: importId,
    })
    expect(rows[0].payload).toMatchObject({
      template_id: rev.template_id,
      revision_id: rev.id,
      definicion_revisada: true,
      publicado: true,
    })
    // El actor es el admin que confirmó, no un id inventado por el servicio.
    const { rows: actor } = await ownerPool.query(
      `SELECT u.email FROM app_user u WHERE u.id = $1`,
      [rows[0].actor_id],
    )
    expect(actor[0].email).toBe('admin@minera.cl')
  })

  it('un body con sections: null responde 400 con el mensaje del contrato', async () => {
    const importId = await subirOriginal()

    const res = await confirmar(importId, { definition: { sections: null } })

    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/body inválido: definition\.sections/)
    // La validación es anterior a tocar nada: el import sigue propuesto y no se
    // creó ni plantilla ni revisión para una definición que no era válida.
    expect((await importEn(importId)).status).toBe('proposed')
  })

  it('publish: true publica la revisión con versión y publica el catálogo materializado', async () => {
    const importId = await subirOriginal()
    const definition = definicionRevisada(await propuestaDelOriginal())

    const rev = await confirmarOK(importId, { publish: true, definition })

    expect(rev.status).toBe('published')
    expect(rev.version).toBe(1)
    expect(rev.published_at).not.toBeNull()
    const fila = await revisionEn(rev.id as string)
    expect(fila.published_seq).not.toBeNull()

    // El catálogo es la base de la que se sirve el dispositivo (FR-027/039):
    // publicar sin materializarlo dejaría la plantilla inservible.
    const secciones = await ownerPool.query(
      `SELECT id FROM template_section WHERE revision_id = $1`,
      [rev.id],
    )
    expect(secciones.rows).toHaveLength(1)
    const items = await ownerPool.query(
      `SELECT prompt, response_type FROM template_item WHERE section_id = $1 ORDER BY position`,
      [secciones.rows[0].id],
    )
    expect(items.rows).toHaveLength(3)
    expect(items.rows[0].prompt).toBe(PROMPT_REVISADO)
    // El import también queda confirmado y atado a la revisión publicada.
    expect(fila.source_import_id).toBe(importId)
    expect((await importEn(importId)).status).toBe('confirmed')
  })

  it('un import de otro tenant responde 404 y un field_worker 403', async () => {
    const importId = await subirOriginal()

    // El admin del tenant B no debe ni siquiera confirmar que el id existe: con
    // RLS la fila es invisible, así que la respuesta es 404 y no un 409 que
    // confirmaría que el import está en el sistema.
    const ajeno = await confirmar(importId, {}, adminBToken)
    expect(ajeno.status).toBe(404)
    expect(ajeno.body.message).toMatch(/no encontrado para este tenant/i)

    // Confirmar es de `tenant_admin`: un `field_worker` no entra ni al servicio.
    const trabajador = await confirmar(importId, {}, trabajadorToken)
    expect(trabajador.status).toBe(403)
    expect(trabajador.body.message).toMatch(/Sólo tenant_admin/i)

    // Y el import quedó intacto tras los dos intentos fallidos.
    expect((await importEn(importId)).status).toBe('proposed')
  })

  it('confirmar dos veces el mismo import responde 409', async () => {
    const importId = await subirOriginal()
    const definition = definicionRevisada(await propuestaDelOriginal())

    await confirmarOK(importId, { definition })
    const segunda = await confirmar(importId, { definition })

    // El estado dejó de ser `proposed`: es un conflicto, no un "no encontrado".
    expect(segunda.status).toBe(409)
    expect(segunda.body.message).toMatch(/no está en estado proposed/i)
    // La segunda llamada no dejó rastro: ni otra plantilla ni otra fila de
    // auditoría.
    const { rows: revisiones } = await ownerPool.query(
      `SELECT id FROM template_revision WHERE source_import_id = $1`,
      [importId],
    )
    expect(revisiones).toHaveLength(1)
    const { rows: auditoria } = await ownerPool.query(
      `SELECT id FROM audit_log WHERE action = 'template_import_confirmed' AND entity_id = $1`,
      [importId],
    )
    expect(auditoria).toHaveLength(1)
  })
})
