import { resolve } from 'node:path'
import { PostgreSqlContainer } from '@testcontainers/postgresql'
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { Pool } from 'pg'
import { runner } from 'node-pg-migrate'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SITE_A_ID, SITE_B_ID, TENANT_A_ID, TENANT_B_ID, seedDatabase } from '../db/seed'

/**
 * TSK-WS-002 — Aislamiento multi-tenant (FR-002, FR-006, NFR-05, Artículo IV).
 *
 * Corre sobre un PostgreSQL 16 real (Testcontainers): aplica las migraciones,
 * siembra los tenants A/B y consulta como el rol `tc_app` (sujeto a RLS)
 * fijando `app.tenant_id`. Criterio de aceptación: una consulta del tenant A
 * jamás devuelve filas del B — el rechazo ocurre en el motor, no en la app.
 */

const MIGRATIONS_DIR = resolve(process.cwd(), 'db', 'migrations')

let container: StartedPostgreSqlContainer
let adminUrl: string

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

  const pool = new Pool({ connectionString: adminUrl })
  try {
    await seedDatabase(pool)
  } finally {
    await pool.end()
  }
}, 180_000)

afterAll(async () => {
  await container?.stop()
})

/**
 * Consulta como la app real: `SET ROLE tc_app` (rol no owner, NOBYPASSRLS) y
 * `app.tenant_id` de sesión. `tenantId = null` simula una conexión sin contexto.
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

describe('RLS multi-tenant (TSK-WS-002)', () => {
  it('el tenant A solo ve sus faenas y el B solo las suyas', async () => {
    const rowsA = await queryAsTenant<{ id: string }>(TENANT_A_ID, 'SELECT id FROM site ORDER BY id')
    const rowsB = await queryAsTenant<{ id: string }>(TENANT_B_ID, 'SELECT id FROM site ORDER BY id')

    expect(rowsA.map((r) => r.id)).toEqual([SITE_A_ID])
    expect(rowsB.map((r) => r.id)).toEqual([SITE_B_ID])
  })

  it('el tenant A no ve la fila del B aunque la pida por id (rechazo en el motor)', async () => {
    const asA = await queryAsTenant<{ id: string }>(
      TENANT_A_ID,
      `SELECT id FROM site WHERE id = '${SITE_B_ID}'`,
    )
    expect(asA).toHaveLength(0)
  })

  it('sin app.tenant_id no se ve ninguna fila (deny por defecto)', async () => {
    const rows = await queryAsTenant(null, 'SELECT id FROM site')
    expect(rows).toHaveLength(0)
  })

  it('app_user también queda aislado por tenant', async () => {
    const rowsA = await queryAsTenant<{ tenant_id: string | null }>(TENANT_A_ID, 'SELECT tenant_id FROM app_user')
    expect(rowsA.length).toBeGreaterThan(0)
    expect(rowsA.every((r) => r.tenant_id === TENANT_A_ID)).toBe(true)

    const rowsB = await queryAsTenant<{ tenant_id: string | null }>(TENANT_B_ID, 'SELECT tenant_id FROM app_user')
    expect(rowsB.length).toBeGreaterThan(0)
    expect(rowsB.every((r) => r.tenant_id === TENANT_B_ID)).toBe(true)
  })
})
