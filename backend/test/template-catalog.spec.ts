import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { PostgreSqlContainer } from '@testcontainers/postgresql'
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { Pool } from 'pg'
import { runner } from 'node-pg-migrate'
import type { INestApplication } from '@nestjs/common'
import { BadRequestException } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { beforeAll, afterAll, describe, expect, it } from 'vitest'
import { parseTemplateDefinition, type TemplateDefinition } from '@terreno/shared'
import { AppModule } from '../src/app.module'
import { configureApp } from '../src/app.setup'
import { TemplatesService } from '../src/templates/templates.service'
import { TENANT_A_ID, TENANT_B_ID, seedDatabase } from '../db/seed'

/**
 * TSK-FORM-003 — Catálogo de 8 tipos de campo + validación Zod + props JSONB
 * en TEMPLATE_ITEM (FR-036, FR-039; data-model §2.2).
 *
 * Parte 1 (unitaria): el contrato compartido `@terreno/shared` acepta los 8
 * tipos V1 con sus `props` y rechaza props fuera de contrato — el MISMO schema
 * que el dispositivo usará para validar la respuesta antes de encolar (FR-039).
 *
 * Parte 2 (integración PostgreSQL 16 real): al publicar se materializa el
 * catálogo tipado (template_section/template_item) con props JSONB; el RLS
 * aísla por tenant (FR-007) y el catálogo de una revisión publicada es
 * inmutable desde `tc_app` (FR-049, coherente con la `definition` congelada).
 */

const MIGRATIONS_DIR = resolve(process.cwd(), 'db', 'migrations')

let container: StartedPostgreSqlContainer
let adminUrl: string
let app: INestApplication
let templates: TemplatesService

/** Definición demo con los 8 tipos V1 (FR-036). */
function definitionWithItems(): TemplateDefinition {
  return {
    sections: [
      {
        id: randomUUID(),
        title: 'Inspección de seguridad',
        position: 0,
        items: [
          { id: randomUUID(), prompt: '¿Casco puesto?', response_type: 'ok_nok_na', require_finding_on_nok: true },
          { id: randomUUID(), prompt: 'Comentario', response_type: 'text', props: { max_length: 200 } },
          { id: randomUUID(), prompt: 'Temperatura ambiente', response_type: 'numeric', props: { required: true, min: -20, max: 50 } },
          { id: randomUUID(), prompt: 'Fecha de inspección', response_type: 'date', props: { min: '2026-01-01', max: '2026-12-31' } },
          { id: randomUUID(), prompt: 'Hora de inicio', response_type: 'time' },
          { id: randomUUID(), prompt: 'Turno', response_type: 'select_single', props: { options: ['diurno', 'nocturno'] } },
          { id: randomUUID(), prompt: 'EPP en uso', response_type: 'select_multiple', props: { options: ['casco', 'arnés', 'botas'] } },
          { id: randomUUID(), prompt: 'Foto del área', response_type: 'photo', props: { photo_max_kb: 512 } },
        ],
      },
    ],
  }
}

/** Consulta como la app real: `SET ROLE tc_app` (NOBYPASSRLS) + app.tenant_id. */
async function queryAsTenant<T = Record<string, unknown>>(
  tenantId: string | null,
  sql: string,
): Promise<T[]> {
  const pool = new Pool({ connectionString: adminUrl })
  const client = await pool.connect()
  try {
    await client.query('SET ROLE tc_app')
    if (tenantId) {
      await client.query("SELECT set_config('app.tenant_id', $1, false)", [tenantId])
    }
    const result = await client.query(sql)
    return result.rows as T[]
  } finally {
    client.release()
    await pool.end()
  }
}

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('terreno')
    .start()
  adminUrl = container.getConnectionUri()

  await runner({
    databaseUrl: adminUrl,
    dir: MIGRATIONS_DIR,
    direction: 'up',
    migrationsTable: 'pgmigrations',
  })

  const seedPool = new Pool({ connectionString: adminUrl })
  try {
    await seedDatabase(seedPool)
  } finally {
    await seedPool.end()
  }

  const alterPool = new Pool({ connectionString: adminUrl })
  try {
    await alterPool.query("ALTER ROLE tc_app LOGIN PASSWORD 'test'")
  } finally {
    await alterPool.end()
  }

  process.env.DATABASE_URL = adminUrl
  process.env.APP_DATABASE_URL = adminUrl.replace('test:test@', 'tc_app:test@')
  process.env.JWT_ACCESS_SECRET = 'test-access-secret-32bytes-long!!!!!'
  process.env.NODE_ENV = 'test'

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
  app = configureApp(moduleRef.createNestApplication())
  await app.init()
  templates = app.get(TemplatesService)
}, 180_000)

afterAll(async () => {
  await app?.close()
  await container?.stop()
})

/** Crea plantilla + borrador y publica; devuelve la revisión publicada. */
async function publishDemoTemplate(tenantId: string): Promise<{ revisionId: string; definition: TemplateDefinition }> {
  const tpl = await templates.createTemplate({ tenantId, name: 'Checklist demo 003' })
  const definition = definitionWithItems()
  const draft = await templates.createDraftRevision({ tenantId, templateId: tpl.id, definition })
  const published = await templates.publishRevision(tenantId, draft.id)
  return { revisionId: published.id, definition }
}

describe('Contrato Zod de los 8 tipos (FR-036/FR-039)', () => {
  it('acepta los 8 tipos V1 con sus props', () => {
    const parsed = parseTemplateDefinition(definitionWithItems())
    expect(parsed.sections[0].items).toHaveLength(8)
    expect(parsed.sections[0].items.map((i) => i.response_type)).toEqual([
      'ok_nok_na',
      'text',
      'numeric',
      'date',
      'time',
      'select_single',
      'select_multiple',
      'photo',
    ])
  })

  it('acepta una definición sin secciones (plantilla vacía)', () => {
    expect(parseTemplateDefinition({ sections: [] }).sections).toEqual([])
  })

  it('normaliza: descarta claves top-level desconocidas en la definición', () => {
    const parsed = parseTemplateDefinition({ sections: [], title: 'sobra' } as unknown)
    expect(Object.keys(parsed)).toEqual(['sections'])
  })

  it.each(
    [
      { label: 'numeric con options (prop ajena)', item: { response_type: 'numeric', props: { options: ['a'] } } },
      { label: 'select_single sin options', item: { response_type: 'select_single', props: {} } },
      { label: 'select_multiple con options vacías', item: { response_type: 'select_multiple', props: { options: [] } } },
      { label: 'photo con options (prop ajena)', item: { response_type: 'photo', props: { options: ['a'] } } },
      { label: 'numeric min > max', item: { response_type: 'numeric', props: { min: 10, max: 5 } } },
      { label: 'date con formato inválido', item: { response_type: 'date', props: { min: '10/01/2026' } } },
      { label: 'text max_length negativo', item: { response_type: 'text', props: { max_length: -1 } } },
    ],
  )('rechaza: $label', ({ item }) => {
    expect(() =>
      parseTemplateDefinition({
        sections: [{ title: 'S', items: [{ id: randomUUID(), prompt: 'P', ...item }] }],
      }),
    ).toThrow()
  })

  it('rechaza response_type fuera del catálogo y ítems incompletos', () => {
    expect(() =>
      parseTemplateDefinition({
        sections: [{ title: 'S', items: [{ id: randomUUID(), prompt: 'P', response_type: 'checkbox' }] }],
      }),
    ).toThrow()

    expect(() =>
      parseTemplateDefinition({
        sections: [{ title: 'S', items: [{ id: 'no-es-uuid', prompt: 'P', response_type: 'text' }] }],
      }),
    ).toThrow()

    expect(() =>
      parseTemplateDefinition({
        sections: [{ title: 'S', items: [{ id: randomUUID(), response_type: 'text' }] }],
      }),
    ).toThrow()
  })

  it('rechaza sección sin título', () => {
    expect(() =>
      parseTemplateDefinition({ sections: [{ items: [] }] }),
    ).toThrow()
  })
})

describe('Materialización del catálogo al publicar (FR-036)', () => {
  it('crea template_section + template_item con props JSONB, orden por posición', async () => {
    const { revisionId, definition } = await publishDemoTemplate(TENANT_A_ID)

    const items = await templates.listItemsByRevision(TENANT_A_ID, revisionId)
    expect(items).toHaveLength(8)
    expect(items[0].prompt).toBe(definition.sections[0].items[0].prompt)
    expect(items[2].props).toMatchObject({ required: true, min: -20, max: 50 })
    expect(items[5].props).toMatchObject({ options: ['diurno', 'nocturno'] })
    expect(items[7].props).toMatchObject({ photo_max_kb: 512 })

    const sections = await queryAsTenant<{ id: string; title: string; position: number }>(
      TENANT_A_ID,
      `SELECT id, title, position FROM template_section WHERE revision_id = '${revisionId}'`,
    )
    expect(sections).toHaveLength(1)
    expect(sections[0]).toMatchObject({ title: 'Inspección de seguridad', position: 0 })
  })

  it('el borrador aún no tiene filas de catálogo (se materializan al publicar)', async () => {
    const tpl = await templates.createTemplate({ tenantId: TENANT_A_ID, name: 'Draft sin catálogo' })
    const draft = await templates.createDraftRevision({
      tenantId: TENANT_A_ID,
      templateId: tpl.id,
      definition: definitionWithItems(),
    })
    expect(await templates.listItemsByRevision(TENANT_A_ID, draft.id)).toHaveLength(0)
  })
})

describe('RLS e inmutabilidad del catálogo (FR-007/FR-049)', () => {
  it('el catálogo queda aislado por tenant y sin tenant no se ve nada', async () => {
    const { revisionId } = await publishDemoTemplate(TENANT_A_ID)

    expect(await templates.listItemsByRevision(TENANT_A_ID, revisionId)).toHaveLength(8)
    expect(await templates.listItemsByRevision(TENANT_B_ID, revisionId)).toHaveLength(0)

    // Las filas de la revisión publicada en A no se ven desde B (RLS), aunque
    // B tenga su propio fixture materializado por el seed.
    const bRows = await queryAsTenant<{ id: string }>(
      TENANT_B_ID,
      `SELECT i.id FROM template_item i
       JOIN template_section s ON s.id = i.section_id
       WHERE s.revision_id = '${revisionId}'`,
    )
    expect(bRows).toHaveLength(0)

    const bPropias = await queryAsTenant<{ id: string }>(TENANT_B_ID, 'SELECT id FROM template_item')
    expect(bPropias.length).toBeGreaterThan(0)

    const noTenant = await queryAsTenant<{ id: string }>(null, 'SELECT id FROM template_item')
    expect(noTenant).toHaveLength(0)
  })

  it('una revisión publicada no admite UPDATE/DELETE/INSERT de su catálogo (FR-049)', async () => {
    const { revisionId } = await publishDemoTemplate(TENANT_A_ID)
    const [item] = await templates.listItemsByRevision(TENANT_A_ID, revisionId)

    const updated = await queryAsTenant<{ id: string }>(
      TENANT_A_ID,
      `UPDATE template_item SET prompt = 'hackeado' WHERE id = '${item.id}' RETURNING id`,
    )
    const deleted = await queryAsTenant<{ id: string }>(
      TENANT_A_ID,
      `DELETE FROM template_item WHERE id = '${item.id}' RETURNING id`,
    )
    expect(updated).toHaveLength(0)
    expect(deleted).toHaveLength(0)

    const [section] = await queryAsTenant<{ id: string }>(
      TENANT_A_ID,
      'SELECT id FROM template_section',
    )
    await expect(
      queryAsTenant(
        TENANT_A_ID,
        `INSERT INTO template_item (id, section_id, tenant_id, position, prompt, response_type)
         VALUES (gen_random_uuid(), '${section.id}', '${TENANT_A_ID}', 99, 'nuevo', 'text')`,
      ),
    ).rejects.toThrow(/row-level security/i)
  })
})

describe('Validación Zod en el servicio (FR-039 wiring)', () => {
  it('rechaza definición inválida al crear y al editar un borrador (400)', async () => {
    const tpl = await templates.createTemplate({ tenantId: TENANT_A_ID, name: 'Con filtro' })

    const invalid: TemplateDefinition = {
      sections: [{ title: 'S', items: [{ id: randomUUID(), prompt: 'Turno', response_type: 'select_single', props: {} }] }],
    }
    await expect(
      templates.createDraftRevision({ tenantId: TENANT_A_ID, templateId: tpl.id, definition: invalid }),
    ).rejects.toBeInstanceOf(BadRequestException)

    const draft = await templates.createDraftRevision({
      tenantId: TENANT_A_ID,
      templateId: tpl.id,
      definition: definitionWithItems(),
    })
    await expect(
      templates.updateDraftRevision({
        tenantId: TENANT_A_ID,
        revisionId: draft.id,
        definition: {
          sections: [{ title: 'S', items: [{ id: randomUUID(), prompt: 'N', response_type: 'numeric', props: { min: 5, max: 1 } }] }],
        },
      }),
    ).rejects.toBeInstanceOf(BadRequestException)
  })
})