/**
 * Migración 021 — Faenas por cuenta (TSK-ADM-003, FR-065, Enmienda 008).
 *
 * Una fila por (cuenta, faena) en que la cuenta puede capturar. Una cuenta SIN
 * filas puede capturar en todas las faenas de su empresa: así nada cambia para
 * las cuentas existentes. Tabla de dominio: `tenant_id` + RLS (Art. IV). Los
 * permisos de `tc_app` llegan por `ALTER DEFAULT PRIVILEGES` (migración 001).
 *
 * @typedef {import('node-pg-migrate').MigrationBuilder} MigrationBuilder
 */

/** @param {MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE user_site (
      tenant_id   uuid NOT NULL REFERENCES tenant (id) ON DELETE CASCADE,
      user_id     uuid NOT NULL REFERENCES app_user (id) ON DELETE CASCADE,
      site_id     uuid NOT NULL REFERENCES site (id) ON DELETE CASCADE,
      created_by  uuid REFERENCES app_user (id),
      created_at  timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, site_id)
    );
  `)
  pgm.sql('CREATE INDEX user_site_tenant_idx ON user_site (tenant_id);')
  pgm.sql('ALTER TABLE user_site ENABLE ROW LEVEL SECURITY;')
  pgm.sql(`
    CREATE POLICY tenant_isolation ON user_site
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
  `)
}

/** @param {MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS user_site;')
}
