import { Pool } from 'pg'
import { hash } from '@node-rs/argon2'

/**
 * Datos semilla de la demo académica (data-model.md §5, FR-006).
 *
 * Crea dos tenants para probar el aislamiento multi-tenant:
 *  - Tenant A "Minera El Cobre SpA" (faena minera)
 *  - Tenant B "Constructora Andes SpA" (obra)
 *
 * El seed debe ejecutarse con la conexión **admin/owner** (bypassa RLS). El rol
 * de aplicación `tc_app` no puede sembrar datos cross-tenant por diseño.
 *
 * Contraseña demo (solo desarrollo académico, NFR-06): argon2id real vía
 * @node-rs/argon2. Se puede sobreescribir con `DEMO_PASSWORD` en el entorno.
 */

/** Contraseña de todas las cuentas demo (documentada en el README). */
export const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? 'TcDemo2026!'

export const TENANT_A_ID = '01890000-0000-7000-8000-0000000000a1'
export const TENANT_B_ID = '01890000-0000-7000-8000-0000000000b1'
export const SITE_A_ID = '01890000-0000-7000-8000-0000000000a2'
export const SITE_B_ID = '01890000-0000-7000-8000-0000000000b2'
export const PLATFORM_ADMIN_ID = '01890000-0000-7000-8000-0000000000c1'

interface SeedQueryable {
  query: (text: string, values?: unknown[]) => Promise<unknown>
}

export async function seedDatabase(db: SeedQueryable): Promise<void> {
  const passwordHash = await hash(DEMO_PASSWORD)

  const tenants: Array<[string, string, string]> = [
    [TENANT_A_ID, 'Minera El Cobre SpA', 'minera-el-cobre'],
    [TENANT_B_ID, 'Constructora Andes SpA', 'constructora-andes'],
  ]
  for (const [id, name, slug] of tenants) {
    await db.query(
      `INSERT INTO tenant (id, name, slug) VALUES ($1, $2, $3)
       ON CONFLICT (id) DO NOTHING`,
      [id, name, slug],
    )
  }

  const sites: Array<[string, string, string, string]> = [
    [SITE_A_ID, TENANT_A_ID, 'Faena El Roble', 'mining'],
    [SITE_B_ID, TENANT_B_ID, 'Obra Costanera', 'construction'],
  ]
  for (const [id, tenantId, name, kind] of sites) {
    await db.query(
      `INSERT INTO site (id, tenant_id, name, kind) VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO NOTHING`,
      [id, tenantId, name, kind],
    )
  }

  const users: Array<[string, string | null, string, string, string]> = [
    [PLATFORM_ADMIN_ID, null, 'admin@terreno.local', 'platform_admin', 'Admin Plataforma'],
    ['01890000-0000-7000-8000-0000000000a3', TENANT_A_ID, 'trabajador@minera.cl', 'field_worker', 'Pedro Trabajador'],
    ['01890000-0000-7000-8000-0000000000a4', TENANT_A_ID, 'supervisor@minera.cl', 'supervisor', 'Sofía Supervisora'],
    ['01890000-0000-7000-8000-0000000000a5', TENANT_A_ID, 'admin@minera.cl', 'tenant_admin', 'Andrés Admin'],
    ['01890000-0000-7000-8000-0000000000b3', TENANT_B_ID, 'trabajador@andes.cl', 'field_worker', 'Bárbara Trabajadora'],
    ['01890000-0000-7000-8000-0000000000b4', TENANT_B_ID, 'supervisor@andes.cl', 'supervisor', 'Bruno Supervisor'],
  ]
  for (const [id, tenantId, email, role, fullName] of users) {
    await db.query(
      `INSERT INTO app_user (id, tenant_id, email, password_hash, role, full_name)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE
         SET password_hash = EXCLUDED.password_hash,
             failed_login_count = 0,
             locked_until = NULL`,
      [id, tenantId, email, passwordHash, role, fullName],
    )
  }
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error('Falta DATABASE_URL (conexión admin). Ver .env.example')
  }
  const pool = new Pool({ connectionString })
  try {
    await seedDatabase(pool)
    console.log('Seed OK: tenants A/B, faenas y usuarios demo.')
  } finally {
    await pool.end()
  }
}

if (require.main === module) {
  void main()
}
