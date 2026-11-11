/**
 * Migración 013 — RLS estricta en audit_log y auth_session (TSK-DOM-005).
 *
 * La política original admitía `tenant_id IS NULL OR tenant_id = <tenant>`, así
 * que cualquier empresa podía leer las filas de plataforma (p. ej. el incidente
 * `sync_tenant_mismatch`, que nombra el tenant ajeno). Las filas sin tenant
 * sólo las escribe y lee la conexión owner (auth, plataforma); el rol de la app
 * ve exclusivamente las de su empresa.
 *
 * @typedef {import('node-pg-migrate').MigrationBuilder} MigrationBuilder
 */

const TABLAS = ['audit_log', 'auth_session']

/** @param {MigrationBuilder} pgm */
exports.up = (pgm) => {
  for (const t of TABLAS) {
    pgm.sql(`DROP POLICY IF EXISTS tenant_isolation ON ${t};`)
    pgm.sql(`
      CREATE POLICY tenant_isolation ON ${t}
        USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
        WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
    `)
  }
}

/** @param {MigrationBuilder} pgm */
exports.down = (pgm) => {
  for (const t of TABLAS) {
    pgm.sql(`DROP POLICY IF EXISTS tenant_isolation ON ${t};`)
    pgm.sql(`
      CREATE POLICY tenant_isolation ON ${t}
        USING (tenant_id IS NULL OR tenant_id = current_setting('app.tenant_id', true)::uuid)
        WITH CHECK (tenant_id IS NULL OR tenant_id = current_setting('app.tenant_id', true)::uuid);
    `)
  }
}
