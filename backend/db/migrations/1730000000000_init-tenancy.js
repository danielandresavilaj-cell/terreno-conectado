/**
 * Migración 001 — Tenancy y usuarios (spec 001) + RLS (Artículo IV).
 *
 * Crea el esquema base y el patrón de aislamiento multi-tenant:
 *  - Rol de aplicación `tc_app` (NOSUPERUSER, NOBYPASSRLS) → sujeto a RLS.
 *  - Políticas RLS por `tenant_id` leyendo `current_setting('app.tenant_id')`.
 *  - Sin `app.tenant_id` fijado, ninguna fila es visible (deny por defecto).
 *
 * Alcance de TSK-WS-002: tenancy (tenant, app_user, site). Las tablas de
 * dominio (inspection, finding, ...) llegan con sus propias tasks. El campo
 * geográfico de `site` (GEOGRAPHY/PostGIS, FR-034) se difiere a su task.
 *
 * @typedef {import('node-pg-migrate').MigrationBuilder} MigrationBuilder
 */

const APP_ROLE = 'tc_app'

/** Tablas sujetas a RLS en esta migración y la columna que las aísla. */
const RLS_TABLES = [
  { table: 'tenant', column: 'id' },
  { table: 'app_user', column: 'tenant_id' },
  { table: 'site', column: 'tenant_id' },
]

/**
 * @param {MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.sql('CREATE EXTENSION IF NOT EXISTS citext')

  // Rol de aplicación sujeto a RLS. Idempotente: en docker-compose el script de
  // init ya lo crea con LOGIN + password; aquí se garantiza para los tests.
  pgm.sql(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${APP_ROLE}') THEN
        CREATE ROLE ${APP_ROLE} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
      END IF;
    END
    $$;
  `)

  pgm.sql(`
    CREATE TABLE tenant (
      id         uuid PRIMARY KEY,
      name       text NOT NULL,
      slug       text NOT NULL UNIQUE,
      status     text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `)

  // `tenant_id` NULL permitido para platform_admin (bypass auditado, §7 spec maestro).
  pgm.sql(`
    CREATE TABLE app_user (
      id            uuid PRIMARY KEY,
      tenant_id     uuid REFERENCES tenant (id) ON DELETE CASCADE,
      email         citext NOT NULL,
      password_hash text NOT NULL,
      role          text NOT NULL CHECK (role IN ('field_worker', 'supervisor', 'tenant_admin', 'platform_admin')),
      full_name     text NOT NULL,
      is_active     boolean NOT NULL DEFAULT true,
      created_at    timestamptz NOT NULL DEFAULT now(),
      updated_at    timestamptz NOT NULL DEFAULT now()
    );
  `)
  pgm.sql('CREATE UNIQUE INDEX app_user_tenant_email_uidx ON app_user (tenant_id, email);')

  pgm.sql(`
    CREATE TABLE site (
      id         uuid PRIMARY KEY,
      tenant_id  uuid NOT NULL REFERENCES tenant (id) ON DELETE CASCADE,
      name       text NOT NULL,
      kind       text NOT NULL CHECK (kind IN ('mining', 'construction')),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  `)
  pgm.sql('CREATE INDEX site_tenant_idx ON site (tenant_id);')

  for (const { table, column } of RLS_TABLES) {
    pgm.sql(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`)
    pgm.sql(`
      CREATE POLICY tenant_isolation ON ${table}
        USING (${column} = current_setting('app.tenant_id', true)::uuid)
        WITH CHECK (${column} = current_setting('app.tenant_id', true)::uuid);
    `)
  }

  pgm.sql(`GRANT USAGE ON SCHEMA public TO ${APP_ROLE};`)
  pgm.sql(`GRANT SELECT, INSERT, UPDATE, DELETE ON tenant, app_user, site TO ${APP_ROLE};`)
  pgm.sql(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${APP_ROLE};`)
}

/**
 * @param {MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS site;')
  pgm.sql('DROP TABLE IF EXISTS app_user;')
  pgm.sql('DROP TABLE IF EXISTS tenant;')
}
