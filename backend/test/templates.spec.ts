import 'reflect-metadata'
import { resolve } from 'node:path'
import { PostgreSqlContainer } from '@testcontainers/postgresql'
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { Pool } from 'pg'
import { runner } from 'node-pg-migrate'
import type { INestApplication } from '@nestjs/common'
import { ConflictException } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppModule } from '../src/app.module'
import { configureApp } from '../src/app.setup'
import { TemplatesService } from '../src/templates/templates.service'
import {
  TENANT_A_ID,
  TENANT_B_ID,
  TEMPLATE_A_ID,
  TEMPLATE_A_REVISION_DRAFT_ID,
  TEMPLATE_A_REVISION_PUBLISHED_ID,
  TEMPLATE_B_ID,
  TEMPLATE_B_REVISION_PUBLISHED_ID,
  seedDatabase,
} from '../db/seed'

/**
 * TSK-FORM-002 — Persistencia de TEMPLATE_REVISION + estados inmutables + RLS
 * (FR-007, FR-049, data-model §2.2).
 *
 * Corre sobre PostgreSQL 16 real (Testcontainers): migraciones + seed + rol
 * `tc_app` sujeto a RLS. Verifica:
 *  - aislamiento multi-tenant de plantillas y revisiones (FR-007);
 *  - congelamiento de revisiones publicadas: el motor rechaza UPDATE/DELETE y
 *    el INSERT directo de una revisión `published` desde `tc_app` (FR-049);
 *  - ciclo draft → published → (archived) del servicio con `version` max+1
 *    por plantilla (FR-027).
 */

const MIGRATIONS_DIR = resolve(process.cwd(), 'db', 'migrations')

let container: StartedPostgreSqlContainer
let adminUrl: string
let app: INestApplication
let templates: TemplatesService

/**
 * Consulta como la app real: `SET ROLE tc_app` (NOBYPASSRLS) + `app.tenant_id`.
 * `tenantId = null` simula una conexión sin contexto (deny por defecto).
 */
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

  // La app corre como `tc_app` (sujeto a RLS, Artículo IV); sin este LOGIN el
  // pool de aplicación no puede conectarse.
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

describe('RLS de plantillas y revisiones (FR-007)', () => {
  it('cada tenant ve solo sus plantillas y sus revisiones', async () => {
    const templatesA = await queryAsTenant<{ id: string }>(TENANT_A_ID, 'SELECT id FROM template')
    const templatesB = await queryAsTenant<{ id: string }>(TENANT_B_ID, 'SELECT id FROM template')
    const revsA = await queryAsTenant<{ id: string }>(
      TENANT_A_ID,
      'SELECT id FROM template_revision',
    )
    const revsB = await queryAsTenant<{ id: string }>(
      TENANT_B_ID,
      'SELECT id FROM template_revision',
    )

    expect(templatesA.map((r) => r.id)).toEqual([TEMPLATE_A_ID])
    expect(templatesB.map((r) => r.id)).toEqual([TEMPLATE_B_ID])
    expect(revsA).toHaveLength(2)
    expect(revsA.every((r) => r.id !== TEMPLATE_B_REVISION_PUBLISHED_ID)).toBe(true)
    expect(revsB).toHaveLength(2)
  })

  it('el tenant A no ve la fila del B aunque la pida por id (rechazo en el motor)', async () => {
    const crossTemplate = await queryAsTenant<{ id: string }>(
      TENANT_A_ID,
      `SELECT id FROM template WHERE id = '${TEMPLATE_B_ID}'`,
    )
    const crossRev = await queryAsTenant<{ id: string }>(
      TENANT_A_ID,
      `SELECT id FROM template_revision WHERE id = '${TEMPLATE_B_REVISION_PUBLISHED_ID}'`,
    )
    expect(crossTemplate).toHaveLength(0)
    expect(crossRev).toHaveLength(0)
  })

  it('sin app.tenant_id no se ve ninguna fila (deny por defecto)', async () => {
    const rows = await queryAsTenant<{ id: string }>(
      null,
      'SELECT id FROM template_revision',
    )
    expect(rows).toHaveLength(0)
  })
})

describe('Inmutabilidad de revisiones publicadas (FR-049)', () => {
  it('UPDATE/DELETE de una revisión publicada afectan 0 filas', async () => {
    const updated = await queryAsTenant<{ id: string }>(
      TENANT_A_ID,
      `UPDATE template_revision
       SET definition = '{"sections":[]}'::jsonb
       WHERE id = '${TEMPLATE_A_REVISION_PUBLISHED_ID}'
       RETURNING id`,
    )
    const deleted = await queryAsTenant<{ id: string }>(
      TENANT_A_ID,
      `DELETE FROM template_revision WHERE id = '${TEMPLATE_A_REVISION_PUBLISHED_ID}' RETURNING id`,
    )
    expect(updated).toHaveLength(0)
    expect(deleted).toHaveLength(0)
  })

  it('tc_app no puede insertar directo una revisión published (workflow obliga draft)', async () => {
    await expect(
      queryAsTenant(
        TENANT_A_ID,
        `INSERT INTO template_revision (id, template_id, tenant_id, definition, status)
         VALUES (gen_random_uuid(), '${TEMPLATE_A_ID}', '${TENANT_A_ID}', '{"sections":[]}'::jsonb, 'published')`,
      ),
    ).rejects.toThrow(/row-level security/i)
  })

  it('el borrador sí se edita, inserta y borra (sigue en draft)', async () => {
    const updated = await queryAsTenant<{ id: string }>(
      TENANT_A_ID,
      `UPDATE template_revision
       SET definition = '{"sections":[{"title":"editada"}]}'::jsonb
       WHERE id = '${TEMPLATE_A_REVISION_DRAFT_ID}'
       RETURNING id`,
    )
    expect(updated).toHaveLength(1)

    const inserted = await queryAsTenant<{ id: string }>(
      TENANT_A_ID,
      `INSERT INTO template_revision (id, template_id, tenant_id, definition, status)
       VALUES (gen_random_uuid(), '${TEMPLATE_A_ID}', '${TENANT_A_ID}', '{"sections":[]}'::jsonb, 'draft')
       RETURNING id`,
    )
    expect(inserted).toHaveLength(1)

    const deleted = await queryAsTenant<{ id: string }>(
      TENANT_A_ID,
      `DELETE FROM template_revision WHERE id = '${inserted[0].id}' RETURNING id`,
    )
    expect(deleted).toHaveLength(1)
  })
})

describe('Servicio TemplatesService (TSK-FORM-002)', () => {
  it('crea la cabecera de plantilla y la aísla por tenant', async () => {
    const created = await templates.createTemplate({
      tenantId: TENANT_A_ID,
      name: 'Checklist de emergencia',
      description: 'demo',
    })
    expect(created.tenant_id).toBe(TENANT_A_ID)
    expect(created.status).toBe('active')

    const mine = await templates.listTemplates(TENANT_A_ID)
    const other = await templates.listTemplates(TENANT_B_ID)
    expect(mine.some((t) => t.id === created.id)).toBe(true)
    expect(other.some((t) => t.id === created.id)).toBe(false)
  })

  it('crea y edita un borrador (version NULL; solo draft editable)', async () => {
    const tpl = await templates.createTemplate({ tenantId: TENANT_A_ID, name: 'Borrador editable' })
    const draft = await templates.createDraftRevision({
      tenantId: TENANT_A_ID,
      templateId: tpl.id,
      definition: { sections: [] },
    })
    expect(draft.status).toBe('draft')
    expect(draft.version).toBeNull()

    const edited = await templates.updateDraftRevision({
      tenantId: TENANT_A_ID,
      revisionId: draft.id,
      definition: { sections: [{ title: 'Nueva sección' }] },
    })
    expect(edited.definition).toMatchObject({ sections: [{ title: 'Nueva sección' }] })
  })

  it('publica con version max+1 por plantilla (FR-027) y congela (FR-049)', async () => {
    const tpl = await templates.createTemplate({ tenantId: TENANT_A_ID, name: 'Publicable' })

    const v1 = await templates.createDraftRevision({
      tenantId: TENANT_A_ID,
      templateId: tpl.id,
      definition: { sections: [] },
    })
    const published1 = await templates.publishRevision(TENANT_A_ID, v1.id)
    expect(published1.status).toBe('published')
    expect(published1.version).toBe(1)
    expect(published1.published_at).not.toBeNull()

    // Segunda revisión → version 2 (incremento por publicación).
    const v2 = await templates.createDraftRevision({
      tenantId: TENANT_A_ID,
      templateId: tpl.id,
      definition: { sections: [] },
    })
    const published2 = await templates.publishRevision(TENANT_A_ID, v2.id)
    expect(published2.version).toBe(2)

    // Publicada → ya no es editable ni republicable.
    await expect(
      templates.updateDraftRevision({
        tenantId: TENANT_A_ID,
        revisionId: published1.id,
        definition: { sections: [] },
      }),
    ).rejects.toBeInstanceOf(ConflictException)
    await expect(templates.publishRevision(TENANT_A_ID, published1.id)).rejects.toBeInstanceOf(
      ConflictException,
    )
  })

  it('archiva solo borradores; una publicada no se archiva desde tc_app', async () => {
    const tpl = await templates.createTemplate({ tenantId: TENANT_A_ID, name: 'Archivo' })

    const draft = await templates.createDraftRevision({
      tenantId: TENANT_A_ID,
      templateId: tpl.id,
      definition: { sections: [] },
    })
    const archived = await templates.archiveDraftRevision(TENANT_A_ID, draft.id)
    expect(archived.status).toBe('archived')

    const published = await templates.createDraftRevision({
      tenantId: TENANT_A_ID,
      templateId: tpl.id,
      definition: { sections: [] },
    })
    await templates.publishRevision(TENANT_A_ID, published.id)
    await expect(templates.archiveDraftRevision(TENANT_A_ID, published.id)).rejects.toBeInstanceOf(
      ConflictException,
    )
  })

  it('getRevision devuelve 404 para una revisión de otro tenant', async () => {
    const got = await templates.getRevision(TENANT_A_ID, TEMPLATE_A_REVISION_PUBLISHED_ID)
    expect(got.id).toBe(TEMPLATE_A_REVISION_PUBLISHED_ID)

    await expect(
      templates.getRevision(TENANT_B_ID, TEMPLATE_A_REVISION_PUBLISHED_ID),
    ).rejects.toThrow(/no encontrada/i)
  })
})