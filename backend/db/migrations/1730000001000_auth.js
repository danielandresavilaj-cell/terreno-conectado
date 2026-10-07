/**
 * Migración 002 — Autenticación (spec 001, NFR-06).
 *
 *  - app_user: contadores de intentos fallidos + bloqueo temporal (FR-005).
 *  - auth_session: refresh tokens con rotación por familia (Decisión D5).
 *  - audit_log: append-only (FR-051); registra la detección de reuso de un
 *    refresh token ya rotado (robo) según el flujo D5.
 *
 * Notas de diseño:
 *  - El lookup de credenciales y la gestión de sesiones usan la conexión owner
 *    (bypass auditado, spec maestro §7): el email identifica al usuario ANTES
 *    de conocer su tenant. Las lecturas de datos autenticadas (p. ej. /me) van
 *    por `tc_app` + `SET LOCAL app.tenant_id` (Artículo IV).
 *  - El bloqueo opera por cuenta (persistido → sobrevive reinicios y múltiples
 *    instancias) y por IP (en memoria, ver AuthService; multi-instancia se
 *    resuelve con un store compartido, fuera del skeleton).
 *  - auth_session.tenant_id se replica del usuario para mantener la política
 *    RLS; platform_admin (tenant NULL) no es visible para ningún tenant.
 *
 * @typedef {import('node-pg-migrate').MigrationBuilder} MigrationBuilder
 */

/**
 * @param {MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE app_user
      ADD COLUMN failed_login_count integer NOT NULL DEFAULT 0,
      ADD COLUMN locked_until timestamptz;
  `)

  pgm.sql(`
    CREATE TABLE auth_session (
      id         uuid PRIMARY KEY,
      user_id    uuid NOT NULL REFERENCES app_user (id) ON DELETE CASCADE,
      tenant_id  uuid REFERENCES tenant (id) ON DELETE CASCADE,
      family_id  uuid NOT NULL,
      token_hash text NOT NULL UNIQUE,
      issued_at  timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL,
      revoked_at timestamptz
    );
  `)
  pgm.sql('CREATE INDEX auth_session_user_idx ON auth_session (user_id);')
  pgm.sql('CREATE INDEX auth_session_family_idx ON auth_session (family_id);')

  pgm.sql(`
    CREATE TABLE audit_log (
      id          uuid PRIMARY KEY,
      actor_id    uuid REFERENCES app_user (id) ON DELETE SET NULL,
      tenant_id   uuid REFERENCES tenant (id) ON DELETE SET NULL,
      action      text NOT NULL,
      entity_type text,
      entity_id   text,
      payload     jsonb,
      occurred_at timestamptz NOT NULL DEFAULT now()
    );
  `)
  pgm.sql('CREATE INDEX audit_log_occurred_idx ON audit_log (occurred_at DESC);')

  for (const table of ['auth_session', 'audit_log']) {
    pgm.sql(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`)
    pgm.sql(`
      CREATE POLICY tenant_isolation ON ${table}
        USING (tenant_id IS NULL OR tenant_id = current_setting('app.tenant_id', true)::uuid)
        WITH CHECK (tenant_id IS NULL OR tenant_id = current_setting('app.tenant_id', true)::uuid);
    `)
  }

  // audit_log es append-only (FR-051): tc_app puede INSERT/SELECT, jamás
  // UPDATE/DELETE. Los defaults del esquema 001 ya dieron los demás permisos.
  pgm.sql('GRANT SELECT, INSERT ON audit_log TO tc_app;')
  pgm.sql('REVOKE UPDATE, DELETE ON audit_log FROM tc_app;')
  pgm.sql('REVOKE DELETE ON auth_session FROM tc_app;')
}

/**
 * @param {MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS audit_log;')
  pgm.sql('DROP TABLE IF EXISTS auth_session;')
  pgm.sql('ALTER TABLE app_user DROP COLUMN IF EXISTS failed_login_count, DROP COLUMN IF EXISTS locked_until;')
}