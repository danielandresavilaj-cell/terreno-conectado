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
// El `.xlsx` que se sube por la API real se genera aquí para que el documento
// original que se exporta sea exactamente el que subiría el admin.
import ExcelJS from 'exceljs'
import {
  XLSX_MIME,
  type CampoValor,
  type TemplateDefinition,
  type TemplateItem,
} from '@terreno/shared'
import { leerCuadricula } from '@terreno/shared/xlsx'
import { AppModule } from '../src/app.module'
import { configureApp } from '../src/app.setup'
import { TemplatesService } from '../src/templates/templates.service'
import { DEMO_PASSWORD, SITE_A_ID, TENANT_A_ID, seedDatabase } from '../db/seed'

/**
 * TSK-FORM-011 (issue #44) — pruebas de caos del módulo 007 (`test-plan.md` §4.1).
 *
 * Escenarios 8–11 con el invariante del módulo: `0 duplicados ∧ 0 versiones
 * inconsistentes ∧ 0 fugas cross-tenant`.
 *
 *  · #8  corte a mitad del delta de plantillas → reconectar con el cursor
 *        previo no pierde ni salta revisiones (FR-027/028).
 *  · #9  doble import (replay de red) → un único `TEMPLATE_IMPORT` confirmado,
 *        cero duplicación (FR-029).
 *  · #10 edición concurrente de un borrador → se publica una sola versión
 *        (FR-047/049).
 *  · #11 versión en vuelo → la inspección en curso re-exporta con su versión
 *        congelada, no con la nueva (FR-028/038).
 *
 * El escenario #8 se cubre además por unit en el cliente
 * (`frontend/test/plantillas.delta.test.ts`); aquí se fija el lado servidor del
 * delta. Corre sobre PostgreSQL 16 real (Testcontainers) con migraciones + seed
 * y `tc_app` sujeto a RLS.
 */

const MIGRATIONS_DIR = resolve(process.cwd(), 'db', 'migrations')
const NOMBRE_ORIGINAL = 'checklist-caos-2026.xlsx'
/** Hoja del libro de prueba; el parser la convierte en el título de la sección. */
const HOJA = 'Checklist'
const CAPTURED_AT = '2026-10-05T09:00:00.000Z'
const TRABAJADOR_A_ID = '01890000-0000-7000-8000-0000000000a3'
/** Supervisor del tenant A, promocionado a `tenant_admin` para el doble admin. */
const SUPERVISOR_A_ID = '01890000-0000-7000-8000-0000000000a4'

let container: StartedPostgreSqlContainer
let ownerPool: Pool
let app: INestApplication
let templates: TemplatesService
let syncVolume: string

let adminToken: string
let admin2Token: string
let trabajadorToken: string

const server = () => request(app.getHttpServer())
const auth = (token: string) => ({ Authorization: `Bearer ${token}` })

/** Libro de una hoja con texto corta/ok-nok-na, texto libre y foto. */
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

/** Definición válida de una sección con ítems de texto (contrato Zod FR-039). */
function definicionDe(prompts: string[]): TemplateDefinition {
  return {
    sections: [
      {
        id: randomUUID(),
        title: 'Borrador',
        position: 0,
        items: prompts.map((prompt) => ({
          id: randomUUID(),
          prompt,
          response_type: 'text' as const,
          require_finding_on_nok: false,
          props: {},
        })),
      },
    ],
  }
}

/** Sube el `.xlsx` por la API real de importación (TSK-FORM-006/007). */
async function subirOriginal(token: string = adminToken): Promise<string> {
  const generado = await libroOriginal().xlsx.writeBuffer()
  const res = await server()
    .post('/api/v1/templates/imports')
    .set(auth(token))
    .attach('file', Buffer.from(generado), { filename: NOMBRE_ORIGINAL, contentType: XLSX_MIME })
  expect(res.status).toBe(201)
  expect(res.body.status).toBe('proposed')
  return res.body.id as string
}

function confirmar(importId: string, body: Record<string, unknown>, token: string = adminToken): Promise<Response> {
  return server()
    .post(`/api/v1/templates/imports/${importId}/confirm`)
    .set(auth(token))
    .send(body)
}

async function confirmarOK(importId: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await confirmar(importId, body)
  expect(res.status).toBe(201)
  return res.body as Record<string, unknown>
}

const itemsDe = (definition: TemplateDefinition): TemplateItem[] =>
  definition.sections.flatMap((s) => s.items)

/** Fila de `template_imports` tal como quedó en la base. */
async function importEn(id: string): Promise<Record<string, unknown>> {
  const { rows } = await ownerPool.query(`SELECT * FROM template_imports WHERE id = $1`, [id])
  expect(rows).toHaveLength(1)
  return rows[0]
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
      return { ...vacio, value_text: campo }
    case 'text':
      return { ...vacio, value_text: campo as string }
    default:
      return { ...vacio, value_json: campo }
  }
}

/** Inspección + respuestas por la ingesta real (FR-021), con la versión congelada. */
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
    const item = params.items.find((i) => i.id === itemId)
    if (!item) throw new Error(`ítem desconocido en el lote: ${itemId}`)
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

/** Todo el texto legible de un `.xlsx` exportado (para comprobar su contenido). */
async function textosDeLibro(bytes: Uint8Array): Promise<string[]> {
  const hojas = await leerCuadricula(bytes)
  const out: string[] = []
  for (const hoja of hojas) {
    for (const fila of hoja.filas) {
      for (const celda of fila) if (celda) out.push(celda.texto)
    }
  }
  return out
}

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').withDatabase('terreno').start()

  const ownerUrl = container.getConnectionUri()
  await runner({ databaseUrl: ownerUrl, dir: MIGRATIONS_DIR, direction: 'up', migrationsTable: 'pgmigrations' })

  ownerPool = new Pool({ connectionString: ownerUrl })
  await seedDatabase(ownerPool)
  await ownerPool.query("ALTER ROLE tc_app LOGIN PASSWORD 'test'")

  syncVolume = await mkdtemp(join(tmpdir(), 'terreno-caos-007-'))

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

  // El escenario #10 necesita DOS `tenant_admin` en el mismo tenant: el seed
  // sólo trae uno, así que se promociona al supervisor del tenant A.
  await ownerPool.query(`UPDATE app_user SET role = 'tenant_admin' WHERE id = $1`, [SUPERVISOR_A_ID])
  admin2Token = await login('supervisor@minera.cl')
}, 180_000)

afterAll(async () => {
  await app?.close()
  await ownerPool?.end()
  await container?.stop()
})

describe('caos #8 — corte a mitad del delta de plantillas (FR-027/028)', () => {
  it('reconectar con el cursor previo trae exactamente lo perdido, sin saltos', async () => {
    const tpl = await templates.createTemplate({ tenantId: TENANT_A_ID, name: `Delta caos 8 ${randomUUID()}` })

    // Tres publicaciones consecutivas de la misma plantilla → tres secuencias
    // globales crecientes. Es la "ventana" que el dispositivo iba a integrar.
    const revisiones: Array<{ id: string; seq: number }> = []
    for (let i = 0; i < 3; i++) {
      const draft = await templates.createDraftRevision({
        tenantId: TENANT_A_ID,
        templateId: tpl.id,
        definition: definicionDe([`Ítem ${i}`]),
      })
      const published = await templates.publishRevision(TENANT_A_ID, draft.id)
      revisiones.push({ id: published.id, seq: Number(published.published_seq) })
    }

    // El dispositivo se cortó después de integrar sólo la primera: reconecta
    // con `since=<seq1>` y el delta debe traer la 2ª y la 3ª, nunca la 1ª.
    const delta = await server()
      .get(`/api/v1/templates?since=${revisiones[0].seq}`)
      .set(auth(adminToken))
    expect(delta.status).toBe(200)

    const ids = (delta.body.items as Array<{ revision_id: string }>).map((i) => i.revision_id)
    expect(ids).toContain(revisiones[1].id)
    expect(ids).toContain(revisiones[2].id)
    expect(ids).not.toContain(revisiones[0].id)
    expect(delta.body.latest_seq).toBeGreaterThanOrEqual(revisiones[2].seq)

    // Un segundo intento con el MISMO cursor devuelve lo mismo: nada se perdió
    // entre el corte y la reconexión (delta resumible, sin huecos).
    const reintento = await server()
      .get(`/api/v1/templates?since=${revisiones[0].seq}`)
      .set(auth(adminToken))
    expect((reintento.body.items as Array<{ revision_id: string }>).map((i) => i.revision_id)).toEqual(
      ids,
    )

    // Y por encima del techo, la plantilla ya no vuelve a aparecer.
    const alDia = await server()
      .get(`/api/v1/templates?since=${revisiones[2].seq}`)
      .set(auth(adminToken))
    const idsAlDia = (alDia.body.items as Array<{ revision_id: string }>).map((i) => i.revision_id)
    expect(idsAlDia).not.toContain(revisiones[2].id)
  })
})

describe('caos #9 — doble import de plantilla (FR-029)', () => {
  it('el replay del confirm de un import confirmado no duplica nada', async () => {
    const importId = await subirOriginal()

    await confirmarOK(importId, { publish: true })

    // Replay de red del MISMO confirm: cada reintento es un conflicto de estado,
    // no una segunda plantilla ni una segunda revisión (FR-029).
    for (let intento = 0; intento < 3; intento++) {
      const replay = await confirmar(importId, { publish: true })
      expect(replay.status).toBe(409)
      expect(replay.body.message).toMatch(/no está en estado proposed/i)
    }

    // Una sola revisión atada al import, una sola plantilla y una sola fila de
    // auditoría: el replay fue idempotente en la base, no sólo en la respuesta.
    const { rows: revisiones } = await ownerPool.query(
      `SELECT id, template_id FROM template_revision WHERE source_import_id = $1`,
      [importId],
    )
    expect(revisiones).toHaveLength(1)
    const { rows: plantillas } = await ownerPool.query(`SELECT id FROM template WHERE id = $1`, [
      revisiones[0].template_id,
    ])
    expect(plantillas).toHaveLength(1)
    const { rows: auditoria } = await ownerPool.query(
      `SELECT id FROM audit_log WHERE action = 'template_import_confirmed' AND entity_id = $1`,
      [importId],
    )
    expect(auditoria).toHaveLength(1)
    expect((await importEn(importId)).status).toBe('confirmed')
  })

  it('subir el mismo libro otra vez es un import NUEVO, independiente del confirmado', async () => {
    const primero = await subirOriginal()
    const rev1 = await confirmarOK(primero, { publish: true })

    // Un segundo POST /templates/imports es un import distinto (no un replay del
    // confirm), así que nace `proposed` y no toca lo ya confirmado.
    const segundo = await subirOriginal()
    expect(segundo).not.toBe(primero)
    expect((await importEn(segundo)).status).toBe('proposed')

    const rev2 = await confirmarOK(segundo, { publish: true })
    // Tal como FR-029 exige al motor por lotes: los dos imports viven aislados,
    // sin compartir catálogo ni plantilla.
    expect(rev2.template_id).not.toBe(rev1.template_id)
    const { rows: secciones } = await ownerPool.query(
      `SELECT id FROM template_section WHERE revision_id = ANY($1::uuid[])`,
      [[rev1.id, rev2.id]],
    )
    expect(new Set(secciones.map((s) => s.id)).size).toBe(secciones.length)
  })
})

describe('caos #10 — edición concurrente de revisión (FR-047/049)', () => {
  it('dos tenant_admin editan el mismo borrador y se publica UNA sola versión', async () => {
    const creada = await server()
      .post('/api/v1/templates')
      .set(auth(adminToken))
      .send({ name: `Concurrente caos 10 ${randomUUID()}`, definition: definicionDe(['Inicial']) })
    expect(creada.status).toBe(201)
    const revisionId = creada.body.id as string
    const templateId = creada.body.template_id as string

    // Los dos admins editan el mismo borrador a la vez. Ambos entran: editar un
    // draft es válido (FR-049 sólo congela lo publicado).
    const [a, b] = await Promise.all([
      server()
        .patch(`/api/v1/templates/revisions/${revisionId}`)
        .set(auth(adminToken))
        .send({ definition: definicionDe(['Admin A']) }),
      server()
        .patch(`/api/v1/templates/revisions/${revisionId}`)
        .set(auth(admin2Token))
        .send({ definition: definicionDe(['Admin B']) }),
    ])
    expect(a.status).toBe(200)
    expect(b.status).toBe(200)
    expect(a.body.status).toBe('draft')
    expect(b.body.status).toBe('draft')

    // Sigue habiendo UN borrador: la concurrencia no crea revisiones paralelas.
    const { rows: drafts } = await ownerPool.query(
      `SELECT id FROM template_revision WHERE template_id = $1`,
      [templateId],
    )
    expect(drafts).toHaveLength(1)

    // Se publica una sola vez → una sola versión.
    const publicada = await server()
      .post(`/api/v1/templates/revisions/${revisionId}/publish`)
      .set(auth(admin2Token))
      .send({})
    expect(publicada.status).toBe(200)
    expect(publicada.body.status).toBe('published')
    expect(publicada.body.version).toBe(1)

    const { rows: publicadas } = await ownerPool.query(
      `SELECT id FROM template_revision WHERE template_id = $1 AND status = 'published'`,
      [templateId],
    )
    expect(publicadas).toHaveLength(1)

    // Republicar (segundo admin) y editar la publicada: ambos son conflictos, no
    // segundas versiones (FR-049).
    const republicar = await server()
      .post(`/api/v1/templates/revisions/${revisionId}/publish`)
      .set(auth(adminToken))
      .send({})
    expect(republicar.status).toBe(409)

    const editarPublicada = await server()
      .patch(`/api/v1/templates/revisions/${revisionId}`)
      .set(auth(adminToken))
      .send({ definition: definicionDe(['Tarde']) })
    expect(editarPublicada.status).toBe(409)

    // La versión publicada conserva la definición de UNO de los dos admins, no
    // una mezcla.
    const titulo = (publicada.body.definition as TemplateDefinition).sections[0].items[0].prompt
    expect(['Admin A', 'Admin B']).toContain(titulo)
  })
})

describe('caos #11 — versión en vuelo (FR-028/038)', () => {
  it('una inspección en v1 re-exporta con su versión congelada tras publicarse v2', async () => {
    const importId = await subirOriginal()
    const v1 = await confirmarOK(importId, { publish: true })
    const templateId = v1.template_id as string
    const itemsV1 = itemsDe(v1.definition as TemplateDefinition)

    // Inspección ejecutada y firmada contra la v1.
    const inspectionId = await sembrarInspeccion({
      templateId,
      templateVersion: 1,
      items: itemsV1,
      campos: {
        [itemsV1.find((i) => i.response_type === 'ok_nok_na')!.id]: 'nok',
        [itemsV1.find((i) => i.response_type === 'text')!.id]: 'Falta señalización en el acceso',
      },
    })

    // Export de referencia con la v1 vigente.
    const antes = await server()
      .get(`/api/v1/dashboard/inspections/${inspectionId}/export`)
      .set(auth(adminToken))
      .responseType('blob')
    expect(antes.status).toBe(200)
    expect((await textosDeLibro(new Uint8Array(antes.body as Buffer))).join('|')).toContain(
      'Falta señalización en el acceso',
    )

    // Se publica una v2 (otra definición, sin documento original asociado) con
    // la plantilla AÚN en vuelo de la inspección.
    const draftV2 = await templates.createDraftRevision({
      tenantId: TENANT_A_ID,
      templateId,
      definition: definicionDe(['MARCA-V2-no-debe-salir']),
    })
    const v2 = await templates.publishRevision(TENANT_A_ID, draftV2.id)
    expect(v2.version).toBe(2)

    // La inspección NO se re-encuadra: su export sigue resolviendo `(template_id,
    // version=1)`. Si el servidor usara la última publicada, la v2 no tiene
    // documento original y esto respondería 404.
    const despues = await server()
      .get(`/api/v1/dashboard/inspections/${inspectionId}/export`)
      .set(auth(adminToken))
      .responseType('blob')
    expect(despues.status).toBe(200)

    const texto = (await textosDeLibro(new Uint8Array(despues.body as Buffer))).join('|')
    expect(texto).toContain('Falta señalización en el acceso')
    expect(texto).not.toContain('MARCA-V2-no-debe-salir')

    // El registro congelado del turno sigue apuntando a la v1 (FR-028).
    const { rows } = await ownerPool.query(
      `SELECT template_version FROM inspection WHERE id = $1`,
      [inspectionId],
    )
    expect(Number(rows[0].template_version)).toBe(1)
  })
})
